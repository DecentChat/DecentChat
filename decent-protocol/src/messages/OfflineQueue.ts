/**
 * OfflineQueue — Queue messages for offline peers, deliver on reconnect.
 *
 * Legacy use: per-peer deferred payload queue.
 * Extended use: peer-only custody queue for opaque encrypted envelopes.
 */

import type {
  CustodyDeliveryState,
  CustodyEnvelope,
  CustodyReplicationClass,
  CustodySyncSummary,
  DeliveryReceipt,
  SyncDomain,
} from './CustodyTypes';

export interface QueuedMessage {
  id?: number; // Auto-increment from IndexedDB
  targetPeerId: string;
  data: any;
  createdAt: number;
  attempts: number;
  lastAttempt?: number;

  // Optional peer-custody metadata (forward-compatible; ignored by legacy callers)
  envelopeId?: string;
  opId?: string;
  workspaceId?: string;
  channelId?: string;
  threadId?: string;
  domain?: SyncDomain;
  recipientPeerIds?: string[];
  replicationClass?: CustodyReplicationClass;
  custodyOwnerPeerId?: string;
  contentHash?: string;
  deliveryState?: CustodyDeliveryState;
  expiresAt?: number;
  deliveredAt?: number;
  acknowledgedAt?: number;
  receipt?: DeliveryReceipt;
  metadata?: Record<string, unknown>;
}

export interface OfflineQueueConfig {
  maxRetries?: number;       // Max delivery attempts (default: 10)
  retryDelayMs?: number;     // Delay between retries (default: 5000)
  maxAgeMs?: number;         // Max age before dropping (default: 7 days)
}

type SaveFn = (targetPeerId: string, data: any, meta?: Partial<QueuedMessage>) => Promise<void>;
type LoadFn = (targetPeerId: string) => Promise<QueuedMessage[]>;
type RemoveFn = (id: number) => Promise<void>;
type RemoveBatchFn = (ids: number[]) => Promise<void>;
type RemoveAllFn = (targetPeerId: string) => Promise<QueuedMessage[]>;
type UpdateFn = (id: number, patch: Partial<QueuedMessage>) => Promise<void>;

export class OfflineQueue {
  private inMemoryQueue = new Map<string, QueuedMessage[]>(); // peerId → messages
  private config: Required<OfflineQueueConfig>;

  // Persistence callbacks (optional — works in-memory without them)
  private saveFn?: SaveFn;
  private loadFn?: LoadFn;
  private removeFn?: RemoveFn;
  private removeBatchFn?: RemoveBatchFn;
  private removeAllFn?: RemoveAllFn;
  private updateFn?: UpdateFn;

  constructor(config: OfflineQueueConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 10,
      retryDelayMs: config.retryDelayMs ?? 5000,
      maxAgeMs: config.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000, // 7 days
    };
  }

  /** Wire up persistence (optional — call before using). */
  setPersistence(save: SaveFn, load: LoadFn, remove: RemoveFn, removeAll: RemoveAllFn, update?: UpdateFn, removeBatch?: RemoveBatchFn): void {
    this.saveFn = save;
    this.loadFn = load;
    this.removeFn = remove;
    this.removeAllFn = removeAll;
    this.updateFn = update;
    this.removeBatchFn = removeBatch;
  }

  /**
   * Enqueue a message for an offline peer.
   * `meta` is optional and enables custody-oriented bookkeeping.
   */
  async enqueue(targetPeerId: string, data: any, meta: Partial<QueuedMessage> = {}): Promise<void> {
    const msg: QueuedMessage = {
      targetPeerId,
      data,
      createdAt: meta.createdAt ?? Date.now(),
      attempts: meta.attempts ?? 0,
      ...(meta.lastAttempt !== undefined ? { lastAttempt: meta.lastAttempt } : {}),
      ...(meta.envelopeId ? { envelopeId: meta.envelopeId } : {}),
      ...(meta.opId ? { opId: meta.opId } : {}),
      ...(meta.workspaceId ? { workspaceId: meta.workspaceId } : {}),
      ...(meta.channelId ? { channelId: meta.channelId } : {}),
      ...(meta.threadId ? { threadId: meta.threadId } : {}),
      ...(meta.domain ? { domain: meta.domain } : {}),
      ...(meta.recipientPeerIds ? { recipientPeerIds: [...meta.recipientPeerIds] } : {}),
      ...(meta.replicationClass ? { replicationClass: meta.replicationClass } : {}),
      ...(meta.custodyOwnerPeerId ? { custodyOwnerPeerId: meta.custodyOwnerPeerId } : {}),
      ...(meta.contentHash ? { contentHash: meta.contentHash } : {}),
      ...(meta.deliveryState ? { deliveryState: meta.deliveryState } : {}),
      ...(meta.expiresAt !== undefined ? { expiresAt: meta.expiresAt } : {}),
      ...(meta.deliveredAt !== undefined ? { deliveredAt: meta.deliveredAt } : {}),
      ...(meta.acknowledgedAt !== undefined ? { acknowledgedAt: meta.acknowledgedAt } : {}),
      ...(meta.receipt ? { receipt: meta.receipt } : {}),
      ...(meta.metadata ? { metadata: { ...meta.metadata } } : {}),
    };

    // Persisted mode is source of truth; avoid mirroring into in-memory
    // to prevent stale duplicates after flush/removeAll.
    if (this.saveFn) {
      await this.saveFn(targetPeerId, data, msg);
      return;
    }

    if (!this.inMemoryQueue.has(targetPeerId)) {
      this.inMemoryQueue.set(targetPeerId, []);
    }
    this.inMemoryQueue.get(targetPeerId)!.push(msg);
  }

  /** Convenience helper for custody envelopes. */
  async enqueueEnvelope(targetPeerId: string, envelope: CustodyEnvelope): Promise<void> {
    await this.enqueue(targetPeerId, envelope, {
      envelopeId: envelope.envelopeId,
      opId: envelope.opId,
      workspaceId: envelope.workspaceId,
      channelId: envelope.channelId,
      threadId: envelope.threadId,
      domain: envelope.domain,
      recipientPeerIds: envelope.recipientPeerIds,
      replicationClass: envelope.replicationClass,
      custodyOwnerPeerId: envelope.custodyOwnerPeerId,
      contentHash: envelope.contentHash,
      deliveryState: envelope.deliveryState,
      createdAt: envelope.createdAt,
      expiresAt: envelope.expiresAt,
      metadata: envelope.metadata,
    });
  }

  /** Get all queued messages for a peer (for delivery on reconnect). */
  async getQueued(targetPeerId: string): Promise<QueuedMessage[]> {
    if (this.loadFn) {
      const persisted = await this.loadFn(targetPeerId);
      if (persisted.length > 0) {
        return this.filterDeliverable(targetPeerId, persisted);
      }
    }

    const messages = this.inMemoryQueue.get(targetPeerId) || [];
    return this.filterDeliverable(targetPeerId, messages);
  }

  /**
   * Read all queued messages for a peer, including those currently backing off.
   * Useful for custody summaries/reconciliation.
   */
  async listQueued(targetPeerId: string): Promise<QueuedMessage[]> {
    if (this.loadFn) return await this.loadFn(targetPeerId);
    return [...(this.inMemoryQueue.get(targetPeerId) || [])];
  }

  /** Build a custody sync summary for a recipient queue. */
  async getSyncSummary(targetPeerId: string): Promise<CustodySyncSummary> {
    const messages = await this.listQueued(targetPeerId);
    const now = Date.now();

    const byDomain: Partial<Record<SyncDomain, number>> = {};
    const byReplicationClass: Partial<Record<CustodyReplicationClass, number>> = {};

    let deliverableCount = 0;
    let backingOffCount = 0;
    let exhaustedCount = 0;
    let expiredCount = 0;
    let acknowledgedCount = 0;
    let pendingReceiptCount = 0;

    let minCreatedAt: number | undefined;
    let maxCreatedAt: number | undefined;
    let latestEnvelopeId: string | undefined;
    let nextRetryAt: number | undefined;
    let lastReceiptAt: number | undefined;

    for (const m of messages) {
      if (m.domain) byDomain[m.domain] = (byDomain[m.domain] ?? 0) + 1;
      if (m.replicationClass) {
        byReplicationClass[m.replicationClass] = (byReplicationClass[m.replicationClass] ?? 0) + 1;
      }

      minCreatedAt = minCreatedAt === undefined ? m.createdAt : Math.min(minCreatedAt, m.createdAt);
      maxCreatedAt = maxCreatedAt === undefined ? m.createdAt : Math.max(maxCreatedAt, m.createdAt);

      if (m.envelopeId) {
        if (!latestEnvelopeId || m.createdAt >= (maxCreatedAt ?? 0)) latestEnvelopeId = m.envelopeId;
      }

      if (m.receipt?.timestamp !== undefined) {
        lastReceiptAt = lastReceiptAt === undefined
          ? m.receipt.timestamp
          : Math.max(lastReceiptAt, m.receipt.timestamp);
      }

      if (m.deliveryState === 'acknowledged') {
        acknowledgedCount += 1;
        continue;
      }

      if (m.deliveryState === 'delivered' && !m.receipt) {
        pendingReceiptCount += 1;
      }

      if (this.isExpired(now, m)) {
        expiredCount += 1;
        continue;
      }

      const attempts = m.attempts ?? 0;
      if (attempts >= this.config.maxRetries) {
        exhaustedCount += 1;
        continue;
      }

      const dueAt = this.getDueAt(m);
      if (now >= dueAt) {
        deliverableCount += 1;
      } else {
        backingOffCount += 1;
        nextRetryAt = nextRetryAt === undefined ? dueAt : Math.min(nextRetryAt, dueAt);
      }
    }

    return {
      recipientPeerId: targetPeerId,
      totalEnvelopes: messages.length,
      deliverableCount,
      backingOffCount,
      exhaustedCount,
      expiredCount,
      acknowledgedCount,
      byDomain,
      byReplicationClass,
      pendingReceiptCount,
      minCreatedAt,
      maxCreatedAt,
      latestEnvelopeId,
      nextRetryAt,
      lastReceiptAt,
    };
  }

  /** Flush all queued messages for a peer (on reconnect). Returns raw data payloads. */
  async flush(targetPeerId: string): Promise<any[]> {
    let messages: QueuedMessage[];

    if (this.removeAllFn) {
      messages = await this.removeAllFn(targetPeerId);
    } else {
      messages = this.inMemoryQueue.get(targetPeerId) || [];
      this.inMemoryQueue.delete(targetPeerId);
    }

    const now = Date.now();
    const valid = messages.filter((m) => !this.isExpired(now, m));
    return valid.map((m) => m.data);
  }

  /** Remove a specific message from the queue (after successful delivery). */
  async remove(targetPeerId: string, messageId: number): Promise<void> {
    if (this.removeFn) {
      await this.removeFn(messageId);
    }

    const queue = this.inMemoryQueue.get(targetPeerId);
    if (queue) {
      const idx = queue.findIndex((m) => m.id === messageId);
      if (idx >= 0) queue.splice(idx, 1);
    }
  }

  /** Batch-remove messages from the queue. Single IDB transaction instead of N. */
  async removeBatch(targetPeerId: string, messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) return;
    if (messageIds.length === 1) { await this.remove(targetPeerId, messageIds[0]); return; }

    if (this.removeBatchFn) {
      await this.removeBatchFn(messageIds);
    } else if (this.removeFn) {
      // Fallback: individual removes if no batch fn wired
      for (const id of messageIds) await this.removeFn(id);
    }

    const queue = this.inMemoryQueue.get(targetPeerId);
    if (queue) {
      const idSet = new Set(messageIds);
      const filtered = queue.filter((m) => typeof m.id !== 'number' || !idSet.has(m.id));
      if (filtered.length !== queue.length) {
        this.inMemoryQueue.set(targetPeerId, filtered);
      }
    }
  }

  /** Mark a queued custody envelope as delivered but still retained. */
  async markDeliveredEnvelope(targetPeerId: string, envelopeId: string, receipt?: DeliveryReceipt): Promise<boolean> {
    const messages = await this.listQueued(targetPeerId);
    const match = messages.find((m) => m.envelopeId === envelopeId);
    if (!match || typeof match.id !== 'number') {
      const queue = this.inMemoryQueue.get(targetPeerId);
      const inMemory = queue?.find((m) => m.envelopeId === envelopeId);
      if (!inMemory) return false;
      inMemory.deliveryState = 'delivered';
      inMemory.deliveredAt = receipt?.timestamp ?? Date.now();
      if (receipt) inMemory.receipt = receipt;
      return true;
    }

    await this.updateFn?.(match.id, {
      deliveryState: 'delivered',
      deliveredAt: receipt?.timestamp ?? Date.now(),
      ...(receipt ? { receipt } : {}),
    });
    return true;
  }

  /** Acknowledge and remove a custody envelope for a recipient. */
  async acknowledgeEnvelope(targetPeerId: string, envelopeId: string, receipt?: DeliveryReceipt): Promise<boolean> {
    const messages = await this.listQueued(targetPeerId);
    const match = messages.find((m) => m.envelopeId === envelopeId);
    if (!match) return false;

    if (typeof match.id === 'number' && this.updateFn) {
      await this.updateFn(match.id, {
        deliveryState: 'acknowledged',
        acknowledgedAt: receipt?.timestamp ?? Date.now(),
        ...(receipt ? { receipt } : {}),
      });
      await this.remove(targetPeerId, match.id);
      return true;
    }

    if (typeof match.id === 'number') {
      await this.remove(targetPeerId, match.id);
      return true;
    }

    const queue = this.inMemoryQueue.get(targetPeerId);
    if (!queue) return false;
    const idx = queue.findIndex((m) => m.envelopeId === envelopeId);
    if (idx < 0) return false;
    queue[idx].deliveryState = 'acknowledged';
    queue[idx].acknowledgedAt = receipt?.timestamp ?? Date.now();
    if (receipt) queue[idx].receipt = receipt;
    queue.splice(idx, 1);
    return true;
  }

  /** Acknowledge and remove an item by logical message/op id. */
  async acknowledgeByMessageId(targetPeerId: string, messageId: string, receipt?: DeliveryReceipt): Promise<boolean> {
    const messages = await this.listQueued(targetPeerId);
    const match = messages.find((m) => this.matchesMessageId(m, messageId));
    if (!match) return false;

    if (match.envelopeId) {
      return await this.acknowledgeEnvelope(targetPeerId, match.envelopeId, receipt);
    }

    if (typeof match.id === 'number' && this.updateFn) {
      await this.updateFn(match.id, {
        deliveryState: 'acknowledged',
        acknowledgedAt: receipt?.timestamp ?? Date.now(),
        ...(receipt ? { receipt } : {}),
      });
      await this.remove(targetPeerId, match.id);
      return true;
    }

    if (typeof match.id === 'number') {
      await this.remove(targetPeerId, match.id);
      return true;
    }

    const queue = this.inMemoryQueue.get(targetPeerId);
    if (!queue) return false;
    const idx = queue.findIndex((m) => this.matchesMessageId(m, messageId));
    if (idx < 0) return false;
    queue.splice(idx, 1);
    return true;
  }

  /** Mark a queued envelope/message as delivered without removing it. */
  async markDeliveredByMessageId(targetPeerId: string, messageId: string, receipt?: DeliveryReceipt): Promise<boolean> {
    const messages = await this.listQueued(targetPeerId);
    const match = messages.find((m) => this.matchesMessageId(m, messageId));
    if (!match) return false;

    if (match.envelopeId) {
      return await this.markDeliveredEnvelope(targetPeerId, match.envelopeId, receipt);
    }

    if (typeof match.id === 'number' && this.updateFn) {
      await this.updateFn(match.id, {
        deliveryState: 'delivered',
        deliveredAt: receipt?.timestamp ?? Date.now(),
        ...(receipt ? { receipt } : {}),
      });
      return true;
    }

    const queue = this.inMemoryQueue.get(targetPeerId);
    if (!queue) return false;
    const idx = queue.findIndex((m) => this.matchesMessageId(m, messageId));
    if (idx < 0) return false;
    queue[idx].deliveryState = 'delivered';
    queue[idx].deliveredAt = receipt?.timestamp ?? Date.now();
    if (receipt) queue[idx].receipt = receipt;
    return true;
  }

  /** Apply a custody receipt to queued data. */
  async applyReceipt(targetPeerId: string, receipt: DeliveryReceipt): Promise<boolean> {
    const kind = receipt.kind;

    if (kind === 'stored' || kind === 'delivered') {
      if (receipt.envelopeId) {
        return await this.markDeliveredEnvelope(targetPeerId, receipt.envelopeId, receipt);
      }
      return await this.markDeliveredByMessageId(targetPeerId, receipt.opId, receipt);
    }

    if (receipt.envelopeId) {
      return await this.acknowledgeEnvelope(targetPeerId, receipt.envelopeId, receipt);
    }
    return await this.acknowledgeByMessageId(targetPeerId, receipt.opId, receipt);
  }

  /** Get count of queued messages for a peer (in-memory only in legacy mode). */
  getQueuedCount(targetPeerId: string): number {
    return (this.inMemoryQueue.get(targetPeerId) || []).length;
  }

  /** Get total queued messages across all peers (in-memory only in legacy mode). */
  getTotalQueued(): number {
    let total = 0;
    for (const queue of this.inMemoryQueue.values()) {
      total += queue.length;
    }
    return total;
  }

  /** Get all peer IDs that have queued messages (in-memory only in legacy mode). */
  getPeersWithQueue(): string[] {
    return Array.from(this.inMemoryQueue.entries())
      .filter(([, msgs]) => msgs.length > 0)
      .map(([peerId]) => peerId);
  }

  async markAttempt(targetPeerId: string, messageId: number): Promise<void> {
    const now = Date.now();

    if (this.updateFn) {
      const persisted = await this.loadFn?.(targetPeerId) || [];
      const current = persisted.find((m) => m.id === messageId);
      const nextAttempts = (current?.attempts ?? 0) + 1;
      await this.updateFn(messageId, { attempts: nextAttempts, lastAttempt: now });

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
      const dueAt = this.getDueAt(m);
      const expired = this.isExpired(now, m);
      const exhausted = attempts >= this.config.maxRetries;

      if (expired || exhausted) {
        if (typeof m.id === 'number') {
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

  private getDueAt(message: QueuedMessage): number {
    const attempts = message.attempts ?? 0;
    const backoffMs = Math.min(this.config.retryDelayMs * Math.pow(2, attempts), 60_000);
    return (message.lastAttempt ?? 0) + backoffMs;
  }

  private matchesMessageId(message: QueuedMessage, messageId: string): boolean {
    if (message.opId === messageId) return true;
    if (message.envelopeId === messageId) return true;

    const data = message.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return false;

    return data.messageId === messageId || data.id === messageId;
  }

  private isExpired(now: number, message: QueuedMessage): boolean {
    const ageMs = now - message.createdAt;
    if (ageMs >= this.config.maxAgeMs) return true;
    if (message.expiresAt !== undefined && now >= message.expiresAt) return true;
    return false;
  }

  /** Clear all queues. */
  clear(): void {
    this.inMemoryQueue.clear();
  }
}
