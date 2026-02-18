/**
 * ChunkedTransfer — Stream large files over P2P DataChannel
 * 
 * Splits encrypted blobs into 64KB chunks, sends with integrity hashes,
 * supports pause/resume, progress tracking, and multi-source download.
 * 
 * Sender:
 *   const transfer = ChunkedTransfer.createSender(attachmentId, encryptedBlob);
 *   for (const chunk of transfer.chunks()) {
 *     await sendToPeer(chunk);
 *   }
 * 
 * Receiver:
 *   const transfer = ChunkedTransfer.createReceiver(attachmentId, totalChunks, expectedHash);
 *   transfer.addChunk(chunk);  // returns progress 0-1
 *   if (transfer.isComplete()) {
 *     const blob = transfer.assemble();  // verified against hash
 *   }
 */

import { CHUNK_SIZE, hashBlob } from './Attachment';
import type { MediaChunk } from './Attachment';

export interface TransferProgress {
  attachmentId: string;
  receivedChunks: number;
  totalChunks: number;
  /** 0 to 1 */
  progress: number;
  /** Bytes received so far */
  bytesReceived: number;
  /** Total bytes expected */
  bytesTotal: number;
  /** Estimated time remaining in ms (based on throughput) */
  etaMs?: number;
  /** Throughput in bytes/sec */
  throughputBps?: number;
}

/** Sender-side: splits a blob into chunks */
export class ChunkedSender {
  readonly attachmentId: string;
  private data: ArrayBuffer;
  private chunkSize: number;
  readonly totalChunks: number;

  constructor(attachmentId: string, data: ArrayBuffer, chunkSize: number = CHUNK_SIZE) {
    this.attachmentId = attachmentId;
    this.data = data;
    this.chunkSize = chunkSize;
    this.totalChunks = Math.ceil(data.byteLength / chunkSize);
  }

  /** Get a specific chunk */
  async getChunk(index: number): Promise<MediaChunk> {
    if (index < 0 || index >= this.totalChunks) {
      throw new Error(`Chunk index ${index} out of range (0-${this.totalChunks - 1})`);
    }

    const start = index * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.data.byteLength);
    const chunkData = this.data.slice(start, end);

    const chunkHash = await hashBlob(chunkData);
    const base64 = arrayBufferToBase64(chunkData);

    return {
      attachmentId: this.attachmentId,
      index,
      total: this.totalChunks,
      data: base64,
      chunkHash,
    };
  }

  /** Generator: yield all chunks in order */
  async *chunks(fromIndex: number = 0): AsyncGenerator<MediaChunk> {
    for (let i = fromIndex; i < this.totalChunks; i++) {
      yield await this.getChunk(i);
    }
  }
}

/** Receiver-side: assembles chunks into a complete blob */
export class ChunkedReceiver {
  readonly attachmentId: string;
  readonly totalChunks: number;
  private expectedHash: string;
  private chunks = new Map<number, ArrayBuffer>();
  private startTime: number;
  private bytesReceived = 0;
  private lastProgressTime: number;
  private lastProgressBytes = 0;

  constructor(attachmentId: string, totalChunks: number, expectedHash: string) {
    this.attachmentId = attachmentId;
    this.totalChunks = totalChunks;
    this.expectedHash = expectedHash;
    this.startTime = Date.now();
    this.lastProgressTime = Date.now();
  }

  /**
   * Add a received chunk. Returns progress info.
   * Throws if chunk hash doesn't match (corrupted transfer).
   */
  async addChunk(chunk: MediaChunk): Promise<TransferProgress> {
    if (chunk.attachmentId !== this.attachmentId) {
      throw new Error(`Chunk for wrong attachment: ${chunk.attachmentId} vs ${this.attachmentId}`);
    }

    if (chunk.index < 0 || chunk.index >= this.totalChunks) {
      throw new Error(`Chunk index ${chunk.index} out of range`);
    }

    // Decode base64
    const data = base64ToArrayBuffer(chunk.data);

    // Verify chunk integrity
    const actualHash = await hashBlob(data);
    if (actualHash !== chunk.chunkHash) {
      throw new Error(`Chunk ${chunk.index} hash mismatch — corrupted transfer`);
    }

    // Store chunk
    this.chunks.set(chunk.index, data);
    this.bytesReceived += data.byteLength;

    // Calculate throughput
    const now = Date.now();
    const elapsed = now - this.lastProgressTime;
    let throughputBps: number | undefined;
    let etaMs: number | undefined;

    if (elapsed > 0) {
      const recentBytes = this.bytesReceived - this.lastProgressBytes;
      throughputBps = (recentBytes / elapsed) * 1000;
      const remaining = this.totalChunks - this.chunks.size;
      if (throughputBps > 0 && remaining > 0) {
        const avgChunkSize = this.bytesReceived / this.chunks.size;
        etaMs = (remaining * avgChunkSize / throughputBps) * 1000;
      }
    }

    if (elapsed > 1000) {
      this.lastProgressTime = now;
      this.lastProgressBytes = this.bytesReceived;
    }

    return {
      attachmentId: this.attachmentId,
      receivedChunks: this.chunks.size,
      totalChunks: this.totalChunks,
      progress: this.chunks.size / this.totalChunks,
      bytesReceived: this.bytesReceived,
      bytesTotal: 0, // Unknown until complete
      throughputBps,
      etaMs,
    };
  }

  /** Check if all chunks received */
  isComplete(): boolean {
    return this.chunks.size === this.totalChunks;
  }

  /** Get missing chunk indices (for resume/retry) */
  getMissingChunks(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.chunks.has(i)) missing.push(i);
    }
    return missing;
  }

  /**
   * Assemble all chunks into the final blob.
   * Verifies overall hash matches expected.
   * Throws if incomplete or hash mismatch.
   */
  async assemble(): Promise<ArrayBuffer> {
    if (!this.isComplete()) {
      throw new Error(`Transfer incomplete: ${this.chunks.size}/${this.totalChunks} chunks`);
    }

    // Concatenate in order
    let totalSize = 0;
    for (const chunk of this.chunks.values()) {
      totalSize += chunk.byteLength;
    }

    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (let i = 0; i < this.totalChunks; i++) {
      const chunk = this.chunks.get(i)!;
      result.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    // Verify overall hash
    const actualHash = await hashBlob(result.buffer);
    if (actualHash !== this.expectedHash) {
      throw new Error(`Assembled blob hash mismatch — expected ${this.expectedHash.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...`);
    }

    return result.buffer;
  }

  /** Get current progress */
  getProgress(): TransferProgress {
    return {
      attachmentId: this.attachmentId,
      receivedChunks: this.chunks.size,
      totalChunks: this.totalChunks,
      progress: this.chunks.size / this.totalChunks,
      bytesReceived: this.bytesReceived,
      bytesTotal: 0,
    };
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
