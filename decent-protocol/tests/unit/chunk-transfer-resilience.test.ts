/**
 * GAP 3: Chunk Transfer Resilience
 *
 * Scenario (a): Peer drops at chunk 30 of 100, reconnects, re-requests
 *   from chunk 30 — transfer completes successfully.
 * Scenario (b): A chunk with wrong hash arrives — receiver rejects it
 *   and re-requests.
 * Scenario (c): Storage quota hit mid-transfer — graceful failure,
 *   no partial corrupt state.
 */

import { describe, test, expect } from 'bun:test';
import { ChunkedSender, ChunkedReceiver } from '../../src/media/ChunkedTransfer';
import { MediaStore, MemoryBlobStorage } from '../../src/media/MediaStore';
import { hashBlob, CHUNK_SIZE } from '../../src/media/Attachment';
import type { MediaChunk } from '../../src/media/Attachment';

// Helper: create test data of given size
function createTestData(sizeBytes: number): ArrayBuffer {
  const data = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    data[i] = i % 256;
  }
  return data.buffer;
}

describe('Chunk Transfer Resilience — (a) Resume after drop', () => {
  test('receiver tracks missing chunks after partial transfer', async () => {
    const data = createTestData(100 * 1024); // 100KB → multiple chunks
    const hash = await hashBlob(data);
    const sender = new ChunkedSender('att-1', data, 1024); // 1KB chunks
    const totalChunks = sender.totalChunks;

    const receiver = new ChunkedReceiver('att-1', totalChunks, hash);

    // Transfer first 30 chunks
    let chunkIdx = 0;
    for await (const chunk of sender.chunks()) {
      if (chunkIdx >= 30) break;
      await receiver.addChunk(chunk);
      chunkIdx++;
    }

    // Verify partial state
    expect(receiver.isComplete()).toBe(false);
    const progress = receiver.getProgress();
    expect(progress.receivedChunks).toBe(30);

    // Missing chunks should be 30..totalChunks-1
    const missing = receiver.getMissingChunks();
    expect(missing.length).toBe(totalChunks - 30);
    expect(missing[0]).toBe(30);
  });

  test('resume from chunk 30 completes transfer successfully', async () => {
    const data = createTestData(100 * 1024);
    const hash = await hashBlob(data);
    const sender = new ChunkedSender('att-1', data, 1024);
    const totalChunks = sender.totalChunks;

    const receiver = new ChunkedReceiver('att-1', totalChunks, hash);

    // Phase 1: send first 30 chunks
    let idx = 0;
    for await (const chunk of sender.chunks()) {
      if (idx >= 30) break;
      await receiver.addChunk(chunk);
      idx++;
    }
    expect(receiver.isComplete()).toBe(false);

    // Phase 2: "reconnect" — resume from chunk 30
    for await (const chunk of sender.chunks(30)) {
      await receiver.addChunk(chunk);
    }

    expect(receiver.isComplete()).toBe(true);

    // Assemble and verify hash
    const assembled = await receiver.assemble();
    const assembledHash = await hashBlob(assembled);
    expect(assembledHash).toBe(hash);
  });

  test('out-of-order chunk delivery still assembles correctly', async () => {
    const data = createTestData(10 * 1024);
    const hash = await hashBlob(data);
    const sender = new ChunkedSender('att-1', data, 1024);
    const totalChunks = sender.totalChunks;

    const receiver = new ChunkedReceiver('att-1', totalChunks, hash);

    // Collect all chunks
    const chunks: MediaChunk[] = [];
    for await (const chunk of sender.chunks()) {
      chunks.push(chunk);
    }

    // Deliver in reverse order
    for (let i = chunks.length - 1; i >= 0; i--) {
      await receiver.addChunk(chunks[i]);
    }

    expect(receiver.isComplete()).toBe(true);
    const assembled = await receiver.assemble();
    expect(await hashBlob(assembled)).toBe(hash);
  });

  test('re-sending an already received chunk is idempotent', async () => {
    const data = createTestData(5 * 1024);
    const hash = await hashBlob(data);
    const sender = new ChunkedSender('att-1', data, 1024);
    const totalChunks = sender.totalChunks;

    const receiver = new ChunkedReceiver('att-1', totalChunks, hash);

    const firstChunk = await sender.getChunk(0);
    await receiver.addChunk(firstChunk);
    await receiver.addChunk(firstChunk); // duplicate

    // Should still count as 1 unique chunk
    expect(receiver.getProgress().receivedChunks).toBe(1);
  });
});

describe('Chunk Transfer Resilience — (b) Wrong hash rejection', () => {
  test('chunk with corrupted data is rejected', async () => {
    const data = createTestData(5 * 1024);
    const hash = await hashBlob(data);
    const sender = new ChunkedSender('att-1', data, 1024);
    const totalChunks = sender.totalChunks;

    const receiver = new ChunkedReceiver('att-1', totalChunks, hash);

    // Get a valid chunk and corrupt its data
    const chunk = await sender.getChunk(0);
    const corruptedChunk: MediaChunk = {
      ...chunk,
      data: btoa('CORRUPTED_DATA_THAT_DOES_NOT_MATCH_HASH'),
    };

    // Receiver should throw on hash mismatch
    let threw = false;
    try {
      await receiver.addChunk(corruptedChunk);
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain('hash mismatch');
    }
    expect(threw).toBe(true);

    // Chunk should NOT be stored
    const missing = receiver.getMissingChunks();
    expect(missing).toContain(0);
  });

  test('valid chunk accepted after rejecting corrupted one', async () => {
    const data = createTestData(3 * 1024);
    const hash = await hashBlob(data);
    const sender = new ChunkedSender('att-1', data, 1024);
    const totalChunks = sender.totalChunks;

    const receiver = new ChunkedReceiver('att-1', totalChunks, hash);

    // Send corrupted chunk first
    const chunk = await sender.getChunk(0);
    const corrupted: MediaChunk = { ...chunk, data: btoa('BAD') };
    try { await receiver.addChunk(corrupted); } catch {}

    // Now send the real chunk
    await receiver.addChunk(chunk);
    expect(receiver.getMissingChunks()).not.toContain(0);
  });

  test('chunk for wrong attachment ID is rejected', async () => {
    const data = createTestData(2 * 1024);
    const hash = await hashBlob(data);
    const sender = new ChunkedSender('att-OTHER', data, 1024);

    const receiver = new ChunkedReceiver('att-1', 2, hash);

    const chunk = await sender.getChunk(0);
    let threw = false;
    try {
      await receiver.addChunk(chunk);
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain('wrong attachment');
    }
    expect(threw).toBe(true);
  });

  test('out-of-range chunk index is rejected', async () => {
    const data = createTestData(2 * 1024);
    const hash = await hashBlob(data);
    const sender = new ChunkedSender('att-1', data, 1024);

    const receiver = new ChunkedReceiver('att-1', sender.totalChunks, hash);

    // Create a chunk with invalid index
    const validChunk = await sender.getChunk(0);
    const badChunk: MediaChunk = { ...validChunk, index: 999 };
    let threw = false;
    try {
      await receiver.addChunk(badChunk);
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain('out of range');
    }
    expect(threw).toBe(true);
  });
});

describe('Chunk Transfer Resilience — (c) Storage quota mid-transfer', () => {
  test('MediaStore rejects store when quota exceeded and eviction insufficient', async () => {
    const blobStorage = new MemoryBlobStorage();
    const store = new MediaStore(blobStorage, {
      maxTotalBytes: 5000, // Very small quota: 5KB
      maxPerWorkspaceBytes: 5000,
    });

    // Store a small attachment
    const data1 = createTestData(2000);
    const hash1 = await hashBlob(data1);
    await store.store('ws-1', {
      id: 'att-1', mimeType: 'application/octet-stream', type: 'file',
      name: 'file1.bin', size: 2000, hash: hash1,
    }, data1);

    // Try to store one larger than the total quota — even after evicting att-1,
    // it still won't fit (6000 > 5000)
    const data2 = createTestData(6000);
    const hash2 = await hashBlob(data2);
    let threw = false;
    try {
      await store.store('ws-1', {
        id: 'att-2', mimeType: 'application/octet-stream', type: 'file',
        name: 'file2.bin', size: 6000, hash: hash2,
      }, data2);
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain('quota exceeded');
    }
    expect(threw).toBe(true);
  });

  test('LRU eviction frees space for new attachment', async () => {
    const blobStorage = new MemoryBlobStorage();
    const store = new MediaStore(blobStorage, {
      maxTotalBytes: 10000,
      maxPerWorkspaceBytes: 10000,
    });

    // Store several attachments
    for (let i = 0; i < 5; i++) {
      const data = createTestData(1500);
      const hash = await hashBlob(data);
      await store.store('ws-1', {
        id: `att-${i}`, mimeType: 'application/octet-stream', type: 'file',
        name: `file${i}.bin`, size: 1500, hash,
      }, data);
    }

    // Total: 7500 bytes. Store another 4000 → triggers LRU eviction
    const bigData = createTestData(4000);
    const bigHash = await hashBlob(bigData);
    await store.store('ws-1', {
      id: 'att-big', mimeType: 'application/octet-stream', type: 'file',
      name: 'big.bin', size: 4000, hash: bigHash,
    }, bigData);

    // Big attachment should be available
    const bigBlob = await store.getBlob('att-big');
    expect(bigBlob).not.toBeNull();

    // Some older attachments should be pruned
    const stats = store.getStats();
    expect(stats.prunedCount).toBeGreaterThan(0);
  });

  test('incomplete transfer leaves no corrupt state in receiver', async () => {
    const data = createTestData(10 * 1024);
    const hash = await hashBlob(data);
    const sender = new ChunkedSender('att-1', data, 1024);

    const receiver = new ChunkedReceiver('att-1', sender.totalChunks, hash);

    // Partially transfer
    for (let i = 0; i < 3; i++) {
      const chunk = await sender.getChunk(i);
      await receiver.addChunk(chunk);
    }

    // Trying to assemble incomplete transfer throws
    let threw = false;
    try {
      await receiver.assemble();
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain('incomplete');
    }
    expect(threw).toBe(true);

    // Progress still accurate
    expect(receiver.getProgress().receivedChunks).toBe(3);
    expect(receiver.isComplete()).toBe(false);
  });
});
