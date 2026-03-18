import { OfflineQueue } from './OfflineQueue';
import type {
  CustodyEnvelope,
  CustodyEnvelopeInput,
  CustodyRecipientSummary,
  CustodyReconciliationResult,
  CustodySyncSummary,
  DeliveryReceipt,
  SyncDomain,
} from './CustodyTypes';

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type SaveReceiptFn = (receipt: DeliveryReceipt) => Promise<void>;
type LoadReceiptsFn = (recipientPeerId: string) => Promise<DeliveryReceipt[]>;

export class CustodyStore {
  private readonly receiptLog = new Map<string, DeliveryReceipt[]>();
  private saveReceiptFn?: SaveReceiptFn;
  private loadReceiptsFn?: LoadReceiptsFn;

  constructor(
    private readonly queue: OfflineQueue = new OfflineQueue({ maxAgeMs: DEFAULT_TTL_MS }),
  ) {}

  get offlineQueue(): OfflineQueue {
    return this.queue;
  }

  setReceiptPersistence(save: SaveReceiptFn, load: LoadReceiptsFn): void {
    this.saveReceiptFn = save;
    this.loadReceiptsFn = load;
  }

  async storeEnvelope(input: CustodyEnvelopeInput): Promise<CustodyEnvelope> {
    const envelope = this.normalizeEnvelope(input);
    for (const peerId of envelope.recipientPeerIds) {
      await this.queue.enqueueEnvelope(peerId, envelope);
    }
    return envelope;
  }

  async getPendingForRecipient(recipientPeerId: string): Promise<CustodyEnvelope[]> {
    const queued = await this.queue.getQueued(recipientPeerId);
    return queued
      .map((item) => item.data as CustodyEnvelope)
      .filter((item): item is CustodyEnvelope => this.isCustodyEnvelope(item));
  }

  async listAllForRecipient(recipientPeerId: string): Promise<CustodyEnvelope[]> {
    const queued = await this.queue.listQueued(recipientPeerId);
    return queued
      .map((item) => item.data as CustodyEnvelope)
      .filter((item): item is CustodyEnvelope => this.isCustodyEnvelope(item));
  }

  async markDelivered(recipientPeerId: string, envelopeId: string, receipt?: DeliveryReceipt): Promise<boolean> {
    const normalized = receipt ? this.normalizeReceipt(recipientPeerId, receipt) : undefined;
    const marked = await this.queue.markDeliveredEnvelope(recipientPeerId, envelopeId, normalized);
    if (marked && normalized) {
      await this.recordReceipt(normalized);
    }
    return marked;
  }

  async acknowledge(recipientPeerId: string, envelopeId: string, receipt?: DeliveryReceipt): Promise<boolean> {
    const normalized = receipt ? this.normalizeReceipt(recipientPeerId, receipt) : undefined;
    const acked = await this.queue.acknowledgeEnvelope(recipientPeerId, envelopeId, normalized);
    if (acked && normalized) {
      await this.recordReceipt(normalized);
    }
    return acked;
  }

  async applyReceipt(recipientPeerId: string, receipt: DeliveryReceipt): Promise<boolean> {
    const normalized = this.normalizeReceipt(recipientPeerId, receipt);
    const applied = await this.queue.applyReceipt(recipientPeerId, normalized);
    if (applied) {
      await this.recordReceipt(normalized);
    }
    return applied;
  }

  async recordReceipt(receipt: DeliveryReceipt): Promise<void> {
    const existing = this.receiptLog.get(receipt.recipientPeerId) || [];
    if (!existing.some((entry) => entry.receiptId === receipt.receiptId)) {
      existing.push(receipt);
      existing.sort((a, b) => a.timestamp - b.timestamp || a.receiptId.localeCompare(b.receiptId));
      this.receiptLog.set(receipt.recipientPeerId, existing);
    }
    await this.saveReceiptFn?.(receipt);
  }

  async getReceipts(recipientPeerId: string): Promise<DeliveryReceipt[]> {
    if (this.loadReceiptsFn) {
      const receipts = await this.loadReceiptsFn(recipientPeerId);
      this.receiptLog.set(recipientPeerId, [...receipts]);
      return receipts;
    }
    return [...(this.receiptLog.get(recipientPeerId) || [])];
  }

  async buildRecipientSummary(recipientPeerId: string): Promise<CustodyRecipientSummary> {
    const envelopes = await this.listAllForRecipient(recipientPeerId);
    const byDomain: Partial<Record<SyncDomain, number>> = {};

    let minCreatedAt: number | undefined;
    let maxCreatedAt: number | undefined;

    for (const envelope of envelopes) {
      byDomain[envelope.domain] = (byDomain[envelope.domain] ?? 0) + 1;
      minCreatedAt = minCreatedAt === undefined ? envelope.createdAt : Math.min(minCreatedAt, envelope.createdAt);
      maxCreatedAt = maxCreatedAt === undefined ? envelope.createdAt : Math.max(maxCreatedAt, envelope.createdAt);
    }

    const sorted = [...envelopes].sort((a, b) => a.createdAt - b.createdAt || a.envelopeId.localeCompare(b.envelopeId));

    return {
      recipientPeerId,
      count: envelopes.length,
      envelopeIds: sorted.map((envelope) => envelope.envelopeId),
      opIds: sorted.map((envelope) => envelope.opId),
      byDomain,
      minCreatedAt,
      maxCreatedAt,
      latestEnvelopeId: sorted.length > 0 ? sorted[sorted.length - 1].envelopeId : undefined,
    };
  }

  async buildSyncSummary(recipientPeerId: string): Promise<CustodySyncSummary> {
    const queueSummary = await this.queue.getSyncSummary(recipientPeerId);
    const receipts = await this.getReceipts(recipientPeerId);

    return {
      ...queueSummary,
      pendingReceiptCount: Math.max(queueSummary.pendingReceiptCount, queueSummary.deliverableCount - receipts.length),
      lastReceiptAt: receipts.length > 0
        ? receipts[receipts.length - 1].timestamp
        : queueSummary.lastReceiptAt,
    };
  }

  async reconcileRecipientSummary(
    recipientPeerId: string,
    remoteSummary: Pick<CustodyRecipientSummary, 'envelopeIds'>,
  ): Promise<CustodyReconciliationResult> {
    const localSummary = await this.buildRecipientSummary(recipientPeerId);
    const localSet = new Set(localSummary.envelopeIds);
    const remoteSet = new Set(remoteSummary.envelopeIds);

    return {
      missingEnvelopeIds: [...localSet].filter((id) => !remoteSet.has(id)),
      extraEnvelopeIds: [...remoteSet].filter((id) => !localSet.has(id)),
    };
  }

  private normalizeEnvelope(input: CustodyEnvelopeInput): CustodyEnvelope {
    const createdAt = input.createdAt ?? Date.now();
    const expiresAt = input.expiresAt ?? (createdAt + (input.ttlMs ?? DEFAULT_TTL_MS));

    return {
      envelopeId: input.envelopeId ?? crypto.randomUUID(),
      opId: input.opId,
      recipientPeerIds: [...new Set(input.recipientPeerIds)],
      workspaceId: input.workspaceId,
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      domain: input.domain ?? 'channel-message',
      ciphertext: input.ciphertext,
      ...(input.contentHash ? { contentHash: input.contentHash } : {}),
      createdAt,
      expiresAt,
      ...(input.custodyOwnerPeerId ? { custodyOwnerPeerId: input.custodyOwnerPeerId } : {}),
      replicationClass: input.replicationClass ?? 'standard',
      deliveryState: input.deliveryState ?? 'stored',
      ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
    };
  }

  private normalizeReceipt(recipientPeerId: string, receipt: DeliveryReceipt): DeliveryReceipt {
    if (receipt.recipientPeerId === recipientPeerId) return receipt;
    return {
      ...receipt,
      recipientPeerId,
      metadata: {
        ...(receipt.metadata || {}),
        originalRecipientPeerId: receipt.recipientPeerId,
      },
    };
  }

  private isCustodyEnvelope(value: unknown): value is CustodyEnvelope {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<CustodyEnvelope>;
    return typeof v.envelopeId === 'string'
      && typeof v.opId === 'string'
      && Array.isArray(v.recipientPeerIds)
      && typeof v.workspaceId === 'string'
      && typeof v.domain === 'string';
  }
}
