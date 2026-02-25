/**
 * Media system tests — Attachments, MediaStore, ChunkedTransfer, Thumbnails
 */

import { describe, test, expect } from 'bun:test';
import {
  inferAttachmentType, calculateChunkCount, createAttachmentMeta, hashBlob,
  CHUNK_SIZE,
  MediaStore, MemoryBlobStorage,
  ChunkedSender, ChunkedReceiver,
  generateWaveform, encodeWaveform, decodeWaveform, waveformToSVG, getFileTypeIcon,
} from '../../src/media';

// Helper: create a random blob of given size
function randomBlob(size: number): ArrayBuffer {
  const arr = new Uint8Array(size);
  for (let i = 0; i < size; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr.buffer;
}

describe('Attachment - Type Inference', () => {
  test('infers image types', () => {
    expect(inferAttachmentType('image/jpeg')).toBe('image');
    expect(inferAttachmentType('image/png')).toBe('image');
    expect(inferAttachmentType('image/webp')).toBe('image');
  });

  test('infers video types', () => {
    expect(inferAttachmentType('video/mp4')).toBe('video');
    expect(inferAttachmentType('video/webm')).toBe('video');
  });

  test('infers voice messages', () => {
    expect(inferAttachmentType('audio/ogg')).toBe('voice');
    expect(inferAttachmentType('audio/webm')).toBe('voice');
  });

  test('infers audio (non-voice)', () => {
    expect(inferAttachmentType('audio/mpeg')).toBe('audio');
    expect(inferAttachmentType('audio/wav')).toBe('audio');
  });

  test('defaults to file', () => {
    expect(inferAttachmentType('application/pdf')).toBe('file');
    expect(inferAttachmentType('text/plain')).toBe('file');
    expect(inferAttachmentType('application/zip')).toBe('file');
  });
});

describe('Attachment - Helpers', () => {
  test('calculateChunkCount', () => {
    expect(calculateChunkCount(0)).toBe(0);
    expect(calculateChunkCount(1)).toBe(1);
    expect(calculateChunkCount(CHUNK_SIZE)).toBe(1);
    expect(calculateChunkCount(CHUNK_SIZE + 1)).toBe(2);
    expect(calculateChunkCount(CHUNK_SIZE * 10)).toBe(10);
    expect(calculateChunkCount(1000000, 64 * 1024)).toBe(16);
  });

  test('createAttachmentMeta', async () => {
    const meta = await createAttachmentMeta(
      { name: 'photo.jpg', size: 3200000, type: 'image/jpeg' },
      'abc123hash',
      { width: 1920, height: 1080, thumbnail: 'base64thumb' }
    );

    expect(meta.id).toBeTruthy();
    expect(meta.name).toBe('photo.jpg');
    expect(meta.size).toBe(3200000);
    expect(meta.type).toBe('image');
    expect(meta.mimeType).toBe('image/jpeg');
    expect(meta.hash).toBe('abc123hash');
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.thumbnail).toBe('base64thumb');
  });

  test('hashBlob produces consistent SHA-256', async () => {
    const data = new TextEncoder().encode('hello world').buffer;
    const hash1 = await hashBlob(data);
    const hash2 = await hashBlob(data);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // 256 bits = 64 hex chars
  });

  test('hashBlob different data → different hash', async () => {
    const a = new TextEncoder().encode('hello').buffer;
    const b = new TextEncoder().encode('world').buffer;
    expect(await hashBlob(a)).not.toBe(await hashBlob(b));
  });
});

describe('MediaStore - Basic CRUD', () => {
  test('store and retrieve blob', async () => {
    const store = new MediaStore(new MemoryBlobStorage());
    const blob = randomBlob(1000);
    const hash = await hashBlob(blob);

    const meta = await createAttachmentMeta(
      { name: 'test.bin', size: 1000, type: 'application/octet-stream' },
      hash
    );

    const att = await store.store('ws1', meta, blob);
    expect(att.status).toBe('available');

    const retrieved = await store.getBlob(meta.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.byteLength).toBe(1000);
  });

  test('getAttachment returns metadata', async () => {
    const store = new MediaStore(new MemoryBlobStorage());
    const blob = randomBlob(500);

    const meta = await createAttachmentMeta(
      { name: 'doc.pdf', size: 500, type: 'application/pdf' },
      await hashBlob(blob)
    );

    await store.store('ws1', meta, blob);
    const att = store.getAttachment(meta.id);

    expect(att).toBeDefined();
    expect(att!.name).toBe('doc.pdf');
    expect(att!.status).toBe('available');
  });

  test('registerMeta without blob', () => {
    const store = new MediaStore(new MemoryBlobStorage());

    const att = store.registerMeta('ws1', {
      id: 'remote-1',
      mimeType: 'image/jpeg',
      type: 'image',
      name: 'remote.jpg',
      size: 5000000,
      hash: 'remotehash123',
      thumbnail: 'base64thumb',
    });

    expect(att.status).toBe('pruned');
    expect(att.thumbnail).toBe('base64thumb');
  });
});

describe('MediaStore - Pruning', () => {
  test('prune removes blob but keeps metadata', async () => {
    const store = new MediaStore(new MemoryBlobStorage());
    const blob = randomBlob(1000);
    const meta = await createAttachmentMeta(
      { name: 'prune.bin', size: 1000, type: 'application/octet-stream' },
      await hashBlob(blob)
    );

    await store.store('ws1', meta, blob);
    expect(store.getAttachment(meta.id)!.status).toBe('available');

    const pruned = await store.prune(meta.id);
    expect(pruned).toBe(true);
    expect(store.getAttachment(meta.id)!.status).toBe('pruned');
    expect(store.getAttachment(meta.id)!.name).toBe('prune.bin'); // Metadata preserved

    const blob2 = await store.getBlob(meta.id);
    expect(blob2).toBeNull();
  });

  test('pruneOlderThan respects age', async () => {
    const store = new MediaStore(new MemoryBlobStorage());

    // Store two blobs
    for (const name of ['old.bin', 'new.bin']) {
      const blob = randomBlob(100);
      const meta = await createAttachmentMeta(
        { name, size: 100, type: 'application/octet-stream' },
        await hashBlob(blob)
      );
      await store.store('ws1', meta, blob);
    }

    // Small delay to ensure storedAt < cutoff
    await new Promise(r => setTimeout(r, 5));
    const pruned = await store.pruneOlderThan(1); // Older than 1ms
    expect(pruned).toBe(2);
  });

  test('pruneWorkspace only affects target workspace', async () => {
    const store = new MediaStore(new MemoryBlobStorage());

    for (const ws of ['ws1', 'ws2']) {
      const blob = randomBlob(100);
      const meta = await createAttachmentMeta(
        { name: `${ws}.bin`, size: 100, type: 'application/octet-stream' },
        await hashBlob(blob)
      );
      await store.store(ws, meta, blob);
    }

    await store.pruneWorkspace('ws1');

    const stats1 = store.getWorkspaceStats('ws1');
    const stats2 = store.getWorkspaceStats('ws2');

    expect(stats1.prunedCount).toBe(1);
    expect(stats2.totalBytes).toBeGreaterThan(0);
  });
});

describe('MediaStore - Quotas & LRU', () => {
  test('enforces per-workspace quota with LRU eviction', async () => {
    const store = new MediaStore(new MemoryBlobStorage(), {
      maxPerWorkspaceBytes: 500,
    });

    // Store 3 × 200 bytes = 600 bytes (over 500 quota)
    for (let i = 0; i < 3; i++) {
      const blob = randomBlob(200);
      const meta = await createAttachmentMeta(
        { name: `file${i}.bin`, size: 200, type: 'application/octet-stream' },
        await hashBlob(blob)
      );
      await store.store('ws1', meta, blob);
    }

    // Some should be pruned to stay under quota
    const stats = store.getWorkspaceStats('ws1');
    expect(stats.totalBytes).toBeLessThanOrEqual(500);
  });

  test('evictLRU removes least recently accessed first', async () => {
    const store = new MediaStore(new MemoryBlobStorage(), {
      maxTotalBytes: 10000000, // High total limit
      maxPerWorkspaceBytes: 10000000,
    });

    const ids: string[] = [];

    // Store 5 blobs
    for (let i = 0; i < 5; i++) {
      const blob = randomBlob(100);
      const meta = await createAttachmentMeta(
        { name: `lru${i}.bin`, size: 100, type: 'application/octet-stream' },
        await hashBlob(blob)
      );
      await store.store('ws1', meta, blob);
      ids.push(meta.id);
    }

    // Access blob 0 and 4 (making them "recently used")
    await new Promise(r => setTimeout(r, 5)); // Ensure different timestamp
    await store.getBlob(ids[0]);
    await store.getBlob(ids[4]);

    // Evict 100 bytes (should remove at least 1 item — oldest accessed)
    const evicted = await store.evictLRU(100);
    expect(evicted).toBeGreaterThanOrEqual(1);

    // 0 and 4 should still be available (they were accessed most recently)
    expect(store.getAttachment(ids[0])!.status).toBe('available');
    expect(store.getAttachment(ids[4])!.status).toBe('available');
  });
});

describe('MediaStore - Auto Download', () => {
  test('shouldAutoDownload respects config', () => {
    const store = new MediaStore(new MemoryBlobStorage(), {
      autoDownload: {
        images: 5 * 1024 * 1024, // 5MB
        voice: 10 * 1024 * 1024,
        audio: 0,
        video: 0,
        files: 0,
      },
    });

    expect(store.shouldAutoDownload({ id: '1', mimeType: 'image/jpeg', type: 'image', name: 'a.jpg', size: 1000000, hash: 'x' })).toBe(true);
    expect(store.shouldAutoDownload({ id: '2', mimeType: 'image/jpeg', type: 'image', name: 'b.jpg', size: 10000000, hash: 'x' })).toBe(false); // Too large
    expect(store.shouldAutoDownload({ id: '3', mimeType: 'audio/ogg', type: 'voice', name: 'c.ogg', size: 500000, hash: 'x' })).toBe(true);
    expect(store.shouldAutoDownload({ id: '4', mimeType: 'video/mp4', type: 'video', name: 'd.mp4', size: 1000, hash: 'x' })).toBe(false); // Disabled
    expect(store.shouldAutoDownload({ id: '5', mimeType: 'application/pdf', type: 'file', name: 'e.pdf', size: 100, hash: 'x' })).toBe(false);
  });
});

describe('MediaStore - Stats', () => {
  test('tracks stats by type', async () => {
    const store = new MediaStore(new MemoryBlobStorage());

    for (const [name, type] of [['a.jpg', 'image/jpeg'], ['b.mp3', 'audio/mpeg'], ['c.jpg', 'image/jpeg']]) {
      const blob = randomBlob(1000);
      const meta = await createAttachmentMeta({ name: name as string, size: 1000, type: type as string }, await hashBlob(blob));
      await store.store('ws1', meta, blob);
    }

    const stats = store.getStats();
    expect(stats.attachmentCount).toBe(3);
    expect(stats.totalBytes).toBe(3000);
    expect(stats.byType['image'].count).toBe(2);
    expect(stats.byType['audio'].count).toBe(1);
  });
});

describe('ChunkedTransfer - Send & Receive', () => {
  test('sender splits blob into correct number of chunks', async () => {
    const data = randomBlob(CHUNK_SIZE * 3 + 100); // 3.x chunks
    const sender = new ChunkedSender('att-1', data);

    expect(sender.totalChunks).toBe(4);

    const chunk0 = await sender.getChunk(0);
    expect(chunk0.index).toBe(0);
    expect(chunk0.total).toBe(4);
    expect(chunk0.attachmentId).toBe('att-1');
    expect(chunk0.chunkHash).toHaveLength(64);
  });

  test('full send → receive → assemble roundtrip', async () => {
    const originalData = randomBlob(CHUNK_SIZE * 2 + 500);
    const hash = await hashBlob(originalData);

    const sender = new ChunkedSender('att-2', originalData);
    const receiver = new ChunkedReceiver('att-2', sender.totalChunks, hash);

    // Transfer all chunks
    for await (const chunk of sender.chunks()) {
      const progress = await receiver.addChunk(chunk);
      expect(progress.progress).toBeGreaterThan(0);
    }

    expect(receiver.isComplete()).toBe(true);

    // Assemble and verify
    const assembled = await receiver.assemble();
    expect(assembled.byteLength).toBe(originalData.byteLength);

    // Verify byte-for-byte match
    const orig = new Uint8Array(originalData);
    const result = new Uint8Array(assembled);
    for (let i = 0; i < orig.length; i++) {
      if (orig[i] !== result[i]) {
        throw new Error(`Byte mismatch at ${i}`);
      }
    }
  });

  test('rejects corrupted chunk', async () => {
    const data = randomBlob(1000);
    const sender = new ChunkedSender('att-3', data);
    const receiver = new ChunkedReceiver('att-3', 1, await hashBlob(data));

    const chunk = await sender.getChunk(0);
    chunk.chunkHash = 'corrupted'; // Tamper with hash

    await expect(receiver.addChunk(chunk)).rejects.toThrow('hash mismatch');
  });

  test('rejects wrong attachment chunk', async () => {
    const receiver = new ChunkedReceiver('att-4', 1, 'hash');
    const badChunk = { attachmentId: 'att-other', index: 0, total: 1, data: '', chunkHash: '' };

    await expect(receiver.addChunk(badChunk)).rejects.toThrow('wrong attachment');
  });

  test('getMissingChunks tracks progress', async () => {
    const data = randomBlob(CHUNK_SIZE * 5);
    const sender = new ChunkedSender('att-5', data);
    const receiver = new ChunkedReceiver('att-5', 5, await hashBlob(data));

    // Send only chunks 0 and 3
    await receiver.addChunk(await sender.getChunk(0));
    await receiver.addChunk(await sender.getChunk(3));

    const missing = receiver.getMissingChunks();
    expect(missing).toEqual([1, 2, 4]);
  });

  test('resume from specific chunk', async () => {
    const data = randomBlob(CHUNK_SIZE * 3);
    const sender = new ChunkedSender('att-6', data);

    // Start from chunk 2
    const chunks: any[] = [];
    for await (const chunk of sender.chunks(2)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1); // Only chunk 2
    expect(chunks[0].index).toBe(2);
  });

  test('assemble fails if incomplete', async () => {
    const receiver = new ChunkedReceiver('att-7', 5, 'hash');
    await expect(receiver.assemble()).rejects.toThrow('incomplete');
  });

  test('assemble fails if hash mismatch', async () => {
    const data = randomBlob(100);
    const sender = new ChunkedSender('att-8', data);
    const receiver = new ChunkedReceiver('att-8', 1, 'wrong-hash');

    await receiver.addChunk(await sender.getChunk(0));
    await expect(receiver.assemble()).rejects.toThrow('hash mismatch');
  });
});

describe('Thumbnail - Waveform', () => {
  test('generateWaveform produces correct number of bars', () => {
    const samples = new Float32Array(44100); // 1 second at 44.1kHz
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin(i * 0.1) * (i / samples.length);
    }

    const waveform = generateWaveform(samples, 50);
    expect(waveform).toHaveLength(50);

    // All values 0-1
    for (const v of waveform) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('encode/decode waveform roundtrip', () => {
    const original = [0.1, 0.5, 1.0, 0.0, 0.75, 0.33];
    const encoded = encodeWaveform(original);
    const decoded = decodeWaveform(encoded);

    expect(decoded).toHaveLength(original.length);
    // Allow small rounding error (1 byte precision)
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(decoded[i] - original[i])).toBeLessThan(0.02);
    }
  });

  test('encoded waveform is compact', () => {
    const waveform = new Array(50).fill(0.5);
    const encoded = encodeWaveform(waveform);
    // 50 bytes → ~68 chars base64
    expect(encoded.length).toBeLessThan(100);
  });

  test('waveformToSVG generates valid SVG', () => {
    const waveform = [0.2, 0.8, 0.5, 1.0, 0.3];
    const svg = waveformToSVG(waveform);

    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<rect');
  });
});

describe('Thumbnail - File Type Icons', () => {
  test('returns correct icons', () => {
    expect(getFileTypeIcon('image/jpeg')).toBe('🖼️');
    expect(getFileTypeIcon('video/mp4')).toBe('🎬');
    expect(getFileTypeIcon('audio/mpeg')).toBe('🎵');
    expect(getFileTypeIcon('application/pdf')).toBe('📄');
    expect(getFileTypeIcon('application/zip')).toBe('📦');
    expect(getFileTypeIcon('text/plain')).toBe('📃');
    expect(getFileTypeIcon('application/octet-stream')).toBe('📎');
  });
});
