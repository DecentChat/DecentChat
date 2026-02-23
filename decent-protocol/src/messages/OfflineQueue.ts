/**
 * OfflineQueue — Queue messages for offline peers, deliver on reconnect
 * 
 * When you send a message and the recipient is offline:
 * 1. Message is encrypted and queued locally
 * 2. When peer reconnects, queued messages are delivered automatically
 * 3. After successful delivery, messages are removed from queue
 * 
 * Integrates with PersistentStore for crash-safe queuing.
 */

export interface QueuedMessage {
  id?: number; // Auto-increment from IndexedDB
  targetPeerId: string;
  data: any;
  createdAt: number;
  attempts: number;
  lastAttempt?: number;
}

export interface OfflineQueueConfig {
  maxRetries?: number;       // Max delivery attempts (default: 10)
  retryDelayMs?: number;     // Delay between retries (default: 5000)
  maxAgeMs?: number;         // Max age before dropping (default: 7 days)
}

type SaveFn = (targetPeerId: string, data: any) => Promise<void>;
type LoadFn = (targetPeerId: string) => Promise<QueuedMessage[]>;
type RemoveFn = (id: number) => Promise<void>;
type RemoveAllFn = (targetPeerId: string) => Promise<QueuedMessage[]>;
type UpdateFn = (id: number, patch: Partial<QueuedMessage>) => Promise<void>;

export class OfflineQueue {
  private inMemoryQueue = new Map<string, QueuedMessage[]>(); // peerId → messages
  private config: Required<OfflineQueueConfig>;

  // Persistence callbacks (optional — works in-memory without them)
  private saveFn?: SaveFn;
  private loadFn?: LoadFn;
  private removeFn?: RemoveFn;
  private removeAllFn?: RemoveAllFn;
  private updateFn?: UpdateFn;

  constructor(config: OfflineQueueConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 10,
      retryDelayMs: config.retryDelayMs ?? 5000,
      maxAgeMs: config.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000, // 7 days
    };
  }

  /**
   * Wire up persistence (optional — call before using)
   */
  setPersistence(save: SaveFn, load: LoadFn, remove: RemoveFn, removeAll: RemoveAllFn, update?: UpdateFn): void {
    this.saveFn = save;
    this.loadFn = load;
    this.removeFn = remove;
    this.removeAllFn = removeAll;
    this.updateFn = update;
  }

  /**
   * Enqueue a message for an offline peer
   */
  async enqueue(targetPeerId: string, data: any): Promise<void> {
    const msg: QueuedMessage = {
      targetPeerId,
      data,
      createdAt: Date.now(),
      attempts: 0,
    };

    // Persisted mode is source of truth; avoid mirroring into in-memory
    // to prevent stale duplicates after flush/removeAll.
    if (this.saveFn) {
      await this.saveFn(targetPeerId, data);
      return;
    }

    // In-memory fallback
    if (!this.inMemoryQueue.has(targetPeerId)) {
      this.inMemoryQueue.set(targetPeerId, []);
    }
    this.inMemoryQueue.get(targetPeerId)!.push(msg);
  }

  /**
   * Get all queued messages for a peer (for delivery on reconnect)
   */
  async getQueued(targetPeerId: string): Promise<QueuedMessage[]> {
    // Try persistent store first
    if (this.loadFn) {
      const persisted = await this.loadFn(targetPeerId);
      if (persisted.length > 0) {
        return this.filterDeliverable(targetPeerId, persisted);
      }
    }

    // Fall back to in-memory
    const messages = this.inMemoryQueue.get(targetPeerId) || [];
    return this.filterDeliverable(targetPeerId, messages);
  }

  /**
   * Flush all queued messages for a peer (on reconnect)
   * Returns messages to send. Caller is responsible for actual delivery.
   */
  async flush(targetPeerId: string): Promise<any[]> {
    let messages: QueuedMessage[];

    if (this.removeAllFn) {
      messages = await this.removeAllFn(targetPeerId);
    } else {
      messages = this.inMemoryQueue.get(targetPeerId) || [];
      this.inMemoryQueue.delete(targetPeerId);
    }

    // Filter expired
    const now = Date.now();
    const valid = messages.filter(m => (now - m.createdAt) < this.config.maxAgeMs);

    return valid.map(m => m.data);
  }

  /**
   * Remove a specific message from the queue (after successful delivery)
   */
  async remove(targetPeerId: string, messageId: number): Promise<void> {
    if (this.removeFn) {
      await this.removeFn(messageId);
    }

    const queue = this.inMemoryQueue.get(targetPeerId);
    if (queue) {
      const idx = queue.findIndex(m => m.id === messageId);
      if (idx >= 0) queue.splice(idx, 1);
    }
  }

  /**
   * Get count of queued messages for a peer
   */
  getQueuedCount(targetPeerId: string): number {
    return (this.inMemoryQueue.get(targetPeerId) || []).length;
  }

  /**
   * Get total queued messages across all peers
   */
  getTotalQueued(): number {
    let total = 0;
    for (const queue of this.inMemoryQueue.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Get all peer IDs that have queued messages
   */
  getPeersWithQueue(): string[] {
    return Array.from(this.inMemoryQueue.entries())
      .filter(([, msgs]) => msgs.length > 0)
      .map(([peerId]) => peerId);
  }

  async markAttempt(targetPeerId: string, messageId: number): Promise<void> {
    const now = Date.now();

    if (this.updateFn) {
      // Persisted source of truth
      const persisted = await this.loadFn?.(targetPeerId) || [];
      const current = persisted.find((m) => m.id === messageId);
      const nextAttempts = (current?.attempts ?? 0) + 1;
      await this.updateFn(messageId, { attempts: nextAttempts, lastAttempt: now });

      // Dead-letter policy: drop after max retries.
      if (nextAttempts >= this.config.maxRetries) {
        await this.removeFn?.(messageId);
      }
      return;
    }

    const queue = this.inMemoryQueue.get(targetPeerId);
    if (!queue) return;
    const msg = queue.find((m) => m.id === messageId);
    if (!msg) return;

    msg.attempts = (msg.attempts || 0) + 1;
    msg.lastAttempt = now;

    if (msg.attempts >= this.config.maxRetries) {
      const idx = queue.findIndex((m) => m.id === messageId);
      if (idx >= 0) queue.splice(idx, 1);
    }
  }

  private filterDeliverable(targetPeerId: string, messages: QueuedMessage[]): QueuedMessage[] {
    const now = Date.now();
    const deliverable: QueuedMessage[] = [];

    for (const m of messages) {
      const attempts = m.attempts ?? 0;
      const ageMs = now - m.createdAt;
      const backoffMs = Math.min(this.config.retryDelayMs * Math.pow(2, attempts), 60_000);
      const dueAt = (m.lastAttempt ?? 0) + backoffMs;

      const expired = ageMs >= this.config.maxAgeMs;
      const exhausted = attempts >= this.config.maxRetries;

      if (expired || exhausted) {
        // Dead-letter drop
        if (typeof m.id === 'number') {
          // Fire and forget cleanup; caller still gets filtered result.
          this.remove(targetPeerId, m.id).catch(() => {});
        }
        continue;
      }

      if (now >= dueAt) {
        deliverable.push(m);
      }
    }

    return deliverable;
  }

  /**
   * Clear all queues
   */
  clear(): void {
    this.inMemoryQueue.clear();
  }
}
