export type CustodyReplicationClass = 'critical' | 'standard' | 'bulk';

export type CustodyDeliveryState =
  | 'stored'
  | 'replicated'
  | 'delivered'
  | 'acknowledged'
  | 'expired'
  | 'garbage-collected';

export type SyncDomain =
  | 'workspace-manifest'
  | 'membership'
  | 'channel-manifest'
  | 'channel-message'
  | 'thread'
  | 'receipt'
  | 'attachment';

export interface DeliveryReceipt {
  receiptId: string;
  kind: 'stored' | 'delivered' | 'read' | 'acknowledged';
  opId: string;
  envelopeId?: string;
  recipientPeerId: string;
  timestamp: number;
  signature?: string;
  metadata?: Record<string, unknown>;
}


export interface CustodySyncSummary {
  recipientPeerId: string;
  totalEnvelopes: number;
  deliverableCount: number;
  backingOffCount: number;
  exhaustedCount: number;
  expiredCount: number;
  acknowledgedCount: number;
  byDomain: Partial<Record<SyncDomain, number>>;
  byReplicationClass: Partial<Record<CustodyReplicationClass, number>>;
  pendingReceiptCount: number;
  minCreatedAt?: number;
  maxCreatedAt?: number;
  latestEnvelopeId?: string;
  nextRetryAt?: number;
  lastReceiptAt?: number;
}

export interface CustodyEnvelope {
  envelopeId: string;
  opId: string;
  recipientPeerIds: string[];
  workspaceId: string;
  channelId?: string;
  threadId?: string;
  domain: SyncDomain;
  ciphertext: unknown;
  contentHash?: string;
  createdAt: number;
  expiresAt: number;
  custodyOwnerPeerId?: string;
  replicationClass: CustodyReplicationClass;
  deliveryState: CustodyDeliveryState;
  metadata?: Record<string, unknown>;
}

export interface CustodyEnvelopeInput {
  opId: string;
  recipientPeerIds: string[];
  workspaceId: string;
  channelId?: string;
  threadId?: string;
  domain?: SyncDomain;
  ciphertext: unknown;
  contentHash?: string;
  createdAt?: number;
  expiresAt?: number;
  ttlMs?: number;
  custodyOwnerPeerId?: string;
  replicationClass?: CustodyReplicationClass;
  deliveryState?: CustodyDeliveryState;
  metadata?: Record<string, unknown>;
  envelopeId?: string;
}

export interface CustodyRecipientSummary {
  recipientPeerId: string;
  count: number;
  envelopeIds: string[];
  opIds: string[];
  byDomain: Partial<Record<SyncDomain, number>>;
  minCreatedAt?: number;
  maxCreatedAt?: number;
  latestEnvelopeId?: string;
}

export interface CustodyReconciliationResult {
  missingEnvelopeIds: string[];
  extraEnvelopeIds: string[];
}
