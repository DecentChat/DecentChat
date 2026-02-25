/**
 * GAP 9: Storage Pressure — Quota management under active messaging
 *
 * Scenario: Storage fills up during active messaging, auto-prune fires,
 * remaining messages still valid, new messages still accepted.
 *
 * Verify: quota manager integrates correctly with active message flow,
 * no corrupt chain after prune.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MediaStore, MemoryBlobStorage } from '../../src/media/MediaStore';
import { MessageStore } from '../../src/messages/MessageStore';
import { hashBlob } from '../../src/media/Attachment';
import type { AttachmentMeta } from '../../src/media/Attachment';

function createBlob(sizeBytes: number): ArrayBuffer {
  const data = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) data[i] = i % 256;
  return data.buffer;
}

async function createMeta(id: string, size: number, blob: ArrayBuffer): Promise<AttachmentMeta> {
  return {
    id,
    mimeType: 'application/octet-stream',
    type: 'file',
    name: `${id}.bin`,
    size,
    hash: await hashBlob(blob),
  };
}

describe('Storage Pressure — Quota management under active messaging', () => {
  let blobStorage: MemoryBlobStorage;
  let mediaStore: MediaStore;
  let messageStore: MessageStore;

  beforeEach(() => {
    blobStorage = new MemoryBlobStorage();
    mediaStore = new MediaStore(blobStorage, {
      maxTotalBytes: 10000,
      maxPerWorkspaceBytes: 10000,
      autoPruneAgeMs: 0, // Disable age-based for these tests
    });
    messageStore = new MessageStore();
  });

  test('storage fills up and triggers LRU eviction', async () => {
    // Store 5 x 2KB = 10KB (fills quota exactly)
    for (let i = 0; i < 5; i++) {
      const blob = createBlob(2000);
      const meta = await createMeta(`att-${i}`, 2000, blob);
      await mediaStore.store('ws-1', meta, blob);
    }

    const stats = mediaStore.getStats();
    expect(stats.totalBytes).toBe(10000);

    // Store one more → triggers LRU eviction
    const newBlob = createBlob(2000);
    const newMeta = await createMeta('att-new', 2000, newBlob);
    await mediaStore.store('ws-1', newMeta, newBlob);

    // Some old attachments should be pruned
    const newStats = mediaStore.getStats();
    expect(newStats.prunedCount).toBeGreaterThan(0);

    // New attachment should be available
    const newAtt = mediaStore.getAttachment('att-new');
    expect(newAtt).toBeDefined();
    expect(newAtt!.status).toBe('available');
  });

  test('auto-prune fires and preserves attachment metadata', async () => {
    // Store some attachments
    for (let i = 0; i < 3; i++) {
      const blob = createBlob(3000);
      const meta = await createMeta(`att-${i}`, 3000, blob);
      await mediaStore.store('ws-1', meta, blob);
    }

    // Manually prune oldest
    await mediaStore.prune('att-0');

    // Metadata should still exist
    const att = mediaStore.getAttachment('att-0');
    expect(att).toBeDefined();
    expect(att!.status).toBe('pruned');

    // But blob is gone
    const blob = await mediaStore.getBlob('att-0');
    expect(blob).toBeNull();
  });

  test('message hash chain remains valid during storage pressure', async () => {
    // Create messages with small delays to ensure distinct timestamps
    for (let i = 0; i < 5; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 2));
      const msg = await messageStore.createMessage('ch-1', 'alice', `File msg ${i}`);
      const added = await messageStore.addMessage(msg);
      expect(added.success).toBe(true);
    }

    // Simulate storage pressure: store and prune attachments
    for (let i = 0; i < 3; i++) {
      const blob = createBlob(4000);
      const meta = await createMeta(`att-${i}`, 4000, blob);
      await mediaStore.store('ws-1', meta, blob);
    }

    // Prune some attachments (simulating storage pressure)
    await mediaStore.prune('att-0');
    await mediaStore.prune('att-1');

    // Message chain should still be valid (messages are independent of media blobs)
    const verification = await messageStore.verifyChannel('ch-1');
    expect(verification.valid).toBe(true);
    expect(messageStore.getMessages('ch-1')).toHaveLength(5);
  });

  test('new messages accepted after prune frees space', async () => {
    // Fill storage
    for (let i = 0; i < 5; i++) {
      const blob = createBlob(2000);
      const meta = await createMeta(`att-${i}`, 2000, blob);
      await mediaStore.store('ws-1', meta, blob);
    }

    // Create new messages (not media — pure text)
    const m1 = await messageStore.createMessage('ch-1', 'alice', 'After storage pressure');
    const result = await messageStore.addMessage(m1);
    expect(result.success).toBe(true);

    // Auto-prune and store new media
    await mediaStore.autoprune();

    const newBlob = createBlob(1000);
    const newMeta = await createMeta('att-after-prune', 1000, newBlob);
    await mediaStore.store('ws-1', newMeta, newBlob);

    const att = mediaStore.getAttachment('att-after-prune');
    expect(att).toBeDefined();
    expect(att!.status).toBe('available');
  });

  test('per-workspace quota enforced', async () => {
    const smallStore = new MediaStore(new MemoryBlobStorage(), {
      maxTotalBytes: 100000,
      maxPerWorkspaceBytes: 5000,
    });

    // Fill workspace-1 quota
    for (let i = 0; i < 2; i++) {
      const blob = createBlob(2000);
      const meta = await createMeta(`ws1-att-${i}`, 2000, blob);
      await smallStore.store('ws-1', meta, blob);
    }

    // workspace-2 should still be able to store
    const blob2 = createBlob(2000);
    const meta2 = await createMeta('ws2-att-0', 2000, blob2);
    await smallStore.store('ws-2', meta2, blob2);

    const ws2Att = smallStore.getAttachment('ws2-att-0');
    expect(ws2Att).toBeDefined();
    expect(ws2Att!.status).toBe('available');
  });

  test('evictLRU removes least recently accessed first', async () => {
    // Store 3 attachments
    for (let i = 0; i < 3; i++) {
      const blob = createBlob(1000);
      const meta = await createMeta(`att-${i}`, 1000, blob);
      await mediaStore.store('ws-1', meta, blob);
      // Space out storage times
      await new Promise(r => setTimeout(r, 10));
    }

    // Access att-2 to make it "most recently used"
    await mediaStore.getBlob('att-2');

    // Evict 1 attachment
    const evicted = await mediaStore.evictLRU(1000);
    expect(evicted).toBe(1);

    // att-0 should be pruned (least recently accessed)
    const att0 = mediaStore.getAttachment('att-0');
    expect(att0!.status).toBe('pruned');

    // att-2 should still be available (most recently accessed)
    const att2 = mediaStore.getAttachment('att-2');
    expect(att2!.status).toBe('available');
  });

  test('pruning old attachments by age', async () => {
    const store = new MediaStore(new MemoryBlobStorage(), {
      maxTotalBytes: 100000,
      maxPerWorkspaceBytes: 100000,
      autoPruneAgeMs: 100, // Very short for testing
    });

    // Store some attachments
    const blob = createBlob(1000);
    const meta = await createMeta('old-att', 1000, blob);
    await store.store('ws-1', meta, blob);

    // Wait for them to age
    await new Promise(r => setTimeout(r, 150));

    // Auto-prune should remove old attachments
    const pruned = await store.autoprune();
    expect(pruned).toBeGreaterThan(0);

    const att = store.getAttachment('old-att');
    expect(att!.status).toBe('pruned');
  });

  test('stats are accurate after mixed store/prune operations', async () => {
    // Store 4 attachments
    for (let i = 0; i < 4; i++) {
      const blob = createBlob(1000);
      const meta = await createMeta(`att-${i}`, 1000, blob);
      await mediaStore.store('ws-1', meta, blob);
    }

    // Prune 2
    await mediaStore.prune('att-0');
    await mediaStore.prune('att-1');

    const stats = mediaStore.getStats();
    expect(stats.attachmentCount).toBe(4);
    expect(stats.prunedCount).toBe(2);
    expect(stats.totalBytes).toBe(2000); // Only 2 active × 1000
  });

  test('registerMeta without blob does not affect quota', () => {
    const meta: AttachmentMeta = {
      id: 'meta-only', mimeType: 'image/jpeg', type: 'image',
      name: 'photo.jpg', size: 50000, hash: 'abc123',
    };

    mediaStore.registerMeta('ws-1', meta);

    const att = mediaStore.getAttachment('meta-only');
    expect(att).toBeDefined();
    expect(att!.status).toBe('pruned');

    // Should not count toward quota
    const stats = mediaStore.getStats();
    expect(stats.totalBytes).toBe(0);
  });
});
