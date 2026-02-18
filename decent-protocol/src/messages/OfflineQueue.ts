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

export class OfflineQueue {
  private inMemoryQueue = new Map<string, QueuedMessage[]>(); // peerId → messages
  private config: Required<OfflineQueueConfig>;

  // Persistence callbacks (optional — works in-memory without them)
  private saveFn?: SaveFn;
  private loadFn?: LoadFn;
  private removeFn?: RemoveFn;
  private removeAllFn?: RemoveAllFn;

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
  setPersistence(save: SaveFn, load: LoadFn, remove: RemoveFn, removeAll: RemoveAllFn): void {
    this.saveFn = save;
    this.loadFn = load;
    this.removeFn = remove;
    this.removeAllFn = removeAll;
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

    // In-memory
    if (!this.inMemoryQueue.has(targetPeerId)) {
      this.inMemoryQueue.set(targetPeerId, []);
    }
    this.inMemoryQueue.get(targetPeerId)!.push(msg);

    // Persist
    if (this.saveFn) {
      await this.saveFn(targetPeerId, data);
    }
  }

  /**
   * Get all queued messages for a peer (for delivery on reconnect)
   */
  async getQueued(targetPeerId: string): Promise<QueuedMessage[]> {
    // Try persistent store first
    if (this.loadFn) {
      const persisted = await this.loadFn(targetPeerId);
      if (persisted.length > 0) return persisted;
    }

    // Fall back to in-memory
    const messages = this.inMemoryQueue.get(targetPeerId) || [];

    // Filter out expired messages
    const now = Date.now();
    return messages.filter(m => (now - m.createdAt) < this.config.maxAgeMs);
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

  /**
   * Clear all queues
   */
  clear(): void {
    this.inMemoryQueue.clear();
  }
}
