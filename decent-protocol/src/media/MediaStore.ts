/**
 * MediaStore — Blob storage with pruning, quotas, and LRU eviction
 * 
 * Stores encrypted media blobs separately from messages.
 * Supports:
 * - Per-workspace storage quotas
 * - LRU eviction (least recently accessed pruned first)
 * - Age-based auto-pruning (delete blobs older than X days)
 * - Manual pruning (keep metadata + thumbnail, delete blob)
 * - Storage stats per workspace
 * 
 * Backend-agnostic: uses a simple key-value interface.
 * Default implementation uses in-memory Map (for testing).
 * Client wires this to IndexedDB.
 */

import type { Attachment, AttachmentMeta, AttachmentStatus } from './Attachment';

/** Storage backend interface (implement for IndexedDB, filesystem, etc.) */
export interface BlobStorage {
  get(key: string): Promise<ArrayBuffer | null>;
  set(key: string, data: ArrayBuffer): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
}

/** In-memory blob storage (for testing) */
export class MemoryBlobStorage implements BlobStorage {
  private store = new Map<string, ArrayBuffer>();

  async get(key: string): Promise<ArrayBuffer | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, data: ArrayBuffer): Promise<void> {
    this.store.set(key, data);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }
  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

export interface MediaStoreConfig {
  /** Max total storage in bytes (default: 1GB) */
  maxTotalBytes?: number;
  /** Per-workspace max in bytes (default: 500MB) */
  maxPerWorkspaceBytes?: number;
  /** Auto-prune blobs older than X ms (default: 30 days, 0 = never) */
  autoPruneAgeMs?: number;
  /** Auto-download settings */
  autoDownload?: AutoDownloadConfig;
}

export interface AutoDownloadConfig {
  /** Auto-download images under this size (bytes, 0 = never) */
  images: number;
  /** Auto-download voice messages under this size */
  voice: number;
  /** Auto-download audio under this size */
  audio: number;
  /** Auto-download video under this size (usually 0) */
  video: number;
  /** Auto-download files under this size (usually 0) */
  files: number;
}

export interface StorageStats {
  totalBytes: number;
  attachmentCount: number;
  prunedCount: number;
  byType: Record<string, { count: number; bytes: number }>;
}

export interface WorkspaceStorageStats extends StorageStats {
  workspaceId: string;
}

const DEFAULT_CONFIG: Required<MediaStoreConfig> = {
  maxTotalBytes: 1024 * 1024 * 1024, // 1 GB
  maxPerWorkspaceBytes: 500 * 1024 * 1024, // 500 MB
  autoPruneAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  autoDownload: {
    images: 5 * 1024 * 1024, // 5 MB
    voice: 10 * 1024 * 1024, // 10 MB
    audio: 0,
    video: 0,
    files: 0,
  },
};

/** Tracked attachment with workspace association */
interface TrackedAttachment {
  attachment: Attachment;
  workspaceId: string;
  storedAt: number;
  blobKey: string; // Key in BlobStorage
}

export class MediaStore {
  private config: Required<MediaStoreConfig>;
  private blobStorage: BlobStorage;
  /** Attachment metadata index: attachmentId → tracked info */
  private index = new Map<string, TrackedAttachment>();

  constructor(blobStorage: BlobStorage, config: MediaStoreConfig = {}) {
    this.blobStorage = blobStorage;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      autoDownload: { ...DEFAULT_CONFIG.autoDownload, ...config.autoDownload },
    };
  }

  /**
   * Store an attachment blob
   */
  async store(
    workspaceId: string,
    meta: AttachmentMeta,
    encryptedBlob: ArrayBuffer
  ): Promise<Attachment> {
    const blobKey = `media:${workspaceId}:${meta.id}`;

    // Check quotas before storing
    await this.enforceQuotas(workspaceId, encryptedBlob.byteLength);

    // Store blob
    await this.blobStorage.set(blobKey, encryptedBlob);

    // Create tracked attachment
    const attachment: Attachment = {
      ...meta,
      status: 'available',
      lastAccessedAt: Date.now(),
    };

    this.index.set(meta.id, {
      attachment,
      workspaceId,
      storedAt: Date.now(),
      blobKey,
    });

    return attachment;
  }

  /**
   * Retrieve an attachment blob
   */
  async getBlob(attachmentId: string): Promise<ArrayBuffer | null> {
    const tracked = this.index.get(attachmentId);
    if (!tracked) return null;

    const blob = await this.blobStorage.get(tracked.blobKey);
    if (blob) {
      // Update access time for LRU
      tracked.attachment.lastAccessedAt = Date.now();
    } else {
      // Blob was pruned or missing
      tracked.attachment.status = 'pruned';
    }

    return blob;
  }

  /**
   * Get attachment metadata (without blob)
   */
  getAttachment(attachmentId: string): Attachment | undefined {
    return this.index.get(attachmentId)?.attachment;
  }

  /**
   * Register attachment metadata only (no blob yet — e.g., received message with attachment)
   */
  registerMeta(workspaceId: string, meta: AttachmentMeta, status: AttachmentStatus = 'pruned'): Attachment {
    const blobKey = `media:${workspaceId}:${meta.id}`;
    const attachment: Attachment = {
      ...meta,
      status,
    };

    this.index.set(meta.id, {
      attachment,
      workspaceId,
      storedAt: Date.now(),
      blobKey,
    });

    return attachment;
  }

  /**
   * Prune a specific attachment (delete blob, keep metadata + thumbnail)
   */
  async prune(attachmentId: string): Promise<boolean> {
    const tracked = this.index.get(attachmentId);
    if (!tracked) return false;

    await this.blobStorage.delete(tracked.blobKey);
    tracked.attachment.status = 'pruned';
    return true;
  }

  /**
   * Prune all attachments in a workspace
   */
  async pruneWorkspace(workspaceId: string): Promise<number> {
    let pruned = 0;
    for (const [id, tracked] of this.index) {
      if (tracked.workspaceId === workspaceId && tracked.attachment.status === 'available') {
        await this.prune(id);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Prune attachments older than the given age
   */
  async pruneOlderThan(ageMs: number): Promise<number> {
    const cutoff = Date.now() - ageMs;
    let pruned = 0;

    for (const [id, tracked] of this.index) {
      if (tracked.attachment.status === 'available' && tracked.storedAt < cutoff) {
        await this.prune(id);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * LRU eviction — prune least recently accessed attachments until under budget
   */
  async evictLRU(targetBytes: number): Promise<number> {
    const available = Array.from(this.index.entries())
      .filter(([_, t]) => t.attachment.status === 'available')
      .sort((a, b) => (a[1].attachment.lastAccessedAt ?? 0) - (b[1].attachment.lastAccessedAt ?? 0));

    let freed = 0;
    let evicted = 0;

    for (const [id, tracked] of available) {
      if (freed >= targetBytes) break;
      freed += tracked.attachment.size;
      await this.prune(id);
      evicted++;
    }

    return evicted;
  }

  /**
   * Run auto-pruning based on config
   */
  async autoprune(): Promise<number> {
    let pruned = 0;

    // Age-based pruning
    if (this.config.autoPruneAgeMs > 0) {
      pruned += await this.pruneOlderThan(this.config.autoPruneAgeMs);
    }

    // Quota-based LRU eviction
    const stats = this.getStats();
    if (stats.totalBytes > this.config.maxTotalBytes) {
      const excess = stats.totalBytes - this.config.maxTotalBytes;
      pruned += await this.evictLRU(excess);
    }

    return pruned;
  }

  /**
   * Should this attachment be auto-downloaded?
   */
  shouldAutoDownload(meta: AttachmentMeta): boolean {
    const limits = this.config.autoDownload;
    switch (meta.type) {
      case 'image': return meta.size <= limits.images;
      case 'voice': return meta.size <= limits.voice;
      case 'audio': return meta.size <= limits.audio;
      case 'video': return meta.size <= limits.video;
      case 'file': return meta.size <= limits.files;
      default: return false;
    }
  }

  /**
   * Get storage stats (total)
   */
  getStats(): StorageStats {
    let totalBytes = 0;
    let attachmentCount = 0;
    let prunedCount = 0;
    const byType: Record<string, { count: number; bytes: number }> = {};

    for (const tracked of this.index.values()) {
      const { attachment } = tracked;
      attachmentCount++;

      if (attachment.status === 'pruned' || attachment.status === 'unavailable') {
        prunedCount++;
        continue;
      }

      totalBytes += attachment.size;

      if (!byType[attachment.type]) {
        byType[attachment.type] = { count: 0, bytes: 0 };
      }
      byType[attachment.type].count++;
      byType[attachment.type].bytes += attachment.size;
    }

    return { totalBytes, attachmentCount, prunedCount, byType };
  }

  /**
   * Get storage stats per workspace
   */
  getWorkspaceStats(workspaceId: string): WorkspaceStorageStats {
    let totalBytes = 0;
    let attachmentCount = 0;
    let prunedCount = 0;
    const byType: Record<string, { count: number; bytes: number }> = {};

    for (const tracked of this.index.values()) {
      if (tracked.workspaceId !== workspaceId) continue;
      const { attachment } = tracked;
      attachmentCount++;

      if (attachment.status === 'pruned' || attachment.status === 'unavailable') {
        prunedCount++;
        continue;
      }

      totalBytes += attachment.size;
      if (!byType[attachment.type]) byType[attachment.type] = { count: 0, bytes: 0 };
      byType[attachment.type].count++;
      byType[attachment.type].bytes += attachment.size;
    }

    return { workspaceId, totalBytes, attachmentCount, prunedCount, byType };
  }

  /**
   * Update config (e.g., change auto-download settings)
   */
  updateConfig(config: Partial<MediaStoreConfig>): void {
    if (config.maxTotalBytes !== undefined) this.config.maxTotalBytes = config.maxTotalBytes;
    if (config.maxPerWorkspaceBytes !== undefined) this.config.maxPerWorkspaceBytes = config.maxPerWorkspaceBytes;
    if (config.autoPruneAgeMs !== undefined) this.config.autoPruneAgeMs = config.autoPruneAgeMs;
    if (config.autoDownload) {
      this.config.autoDownload = { ...this.config.autoDownload, ...config.autoDownload };
    }
  }

  // === Internal ===

  private async enforceQuotas(workspaceId: string, incomingBytes: number): Promise<void> {
    // Check workspace quota
    const wsStats = this.getWorkspaceStats(workspaceId);
    if (wsStats.totalBytes + incomingBytes > this.config.maxPerWorkspaceBytes) {
      // Try LRU eviction within workspace
      const excess = (wsStats.totalBytes + incomingBytes) - this.config.maxPerWorkspaceBytes;
      const wsAttachments = Array.from(this.index.entries())
        .filter(([_, t]) => t.workspaceId === workspaceId && t.attachment.status === 'available')
        .sort((a, b) => (a[1].attachment.lastAccessedAt ?? 0) - (b[1].attachment.lastAccessedAt ?? 0));

      let freed = 0;
      for (const [id] of wsAttachments) {
        if (freed >= excess) break;
        const tracked = this.index.get(id)!;
        freed += tracked.attachment.size;
        await this.prune(id);
      }

      // If still over quota after eviction, reject
      if (freed < excess) {
        throw new Error(`Workspace storage quota exceeded (${this.config.maxPerWorkspaceBytes} bytes)`);
      }
    }

    // Check total quota
    const totalStats = this.getStats();
    if (totalStats.totalBytes + incomingBytes > this.config.maxTotalBytes) {
      const excess = (totalStats.totalBytes + incomingBytes) - this.config.maxTotalBytes;
      await this.evictLRU(excess);
    }
  }
}
