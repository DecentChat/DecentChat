/**
 * SyncManifest — Explicit versioned state summaries for each sync domain.
 *
 * Replaces implicit "latest history + sync on reconnect" with:
 * - explicit manifest objects (workspace, membership, channels, messages)
 * - per-domain version vectors or checkpoints
 * - negentropy-style set reconciliation per domain
 * - snapshot + delta replay
 */

import type { SyncDomain } from '../messages/CustodyTypes';

export type ManifestVersion = {
  domain: SyncDomain;
  workspaceId: string;
  version: number;
  lastUpdatedAt: number;
  lastUpdatedBy: string;
  itemCount: number;
  checksum?: string;
};

export type ManifestDomainVersion = ManifestVersion & {
  channelId?: string;
};

export type WorkspaceManifestSnapshot = {
  domain: 'workspace-manifest';
  workspaceId: string;
  version: number;
  name: string;
  description?: string;
  policy?: Record<string, unknown>;
  snapshotId: string;
  snapshotVersion: number;
  basedOnVersion: number;
  deltasSince: number;
  createdAt: number;
  createdBy: string;
  checksum?: string;
};

export type MembershipManifestSnapshot = {
  domain: 'membership';
  workspaceId: string;
  version: number;
  snapshotId: string;
  basedOnVersion: number;
  memberCount: number;
  members: Array<{
    peerId: string;
    alias?: string;
    role: string;
    joinedAt: number;
  }>;
  createdAt: number;
  createdBy: string;
  checksum?: string;
};

export type ChannelManifestSnapshot = {
  domain: 'channel-manifest';
  workspaceId: string;
  version: number;
  snapshotId: string;
  basedOnVersion: number;
  channelCount: number;
  channels: Array<{
    id: string;
    name: string;
    type: string;
    createdAt: number;
    createdBy: string;
  }>;
  createdAt: number;
  createdBy: string;
  checksum?: string;
};

export type MessageLogSnapshot = {
  domain: 'channel-message';
  workspaceId: string;
  channelId: string;
  version: number;
  snapshotId: string;
  basedOnVersion: number;
  messageCount: number;
  messageIds: string[];
  minTimestamp: number;
  maxTimestamp: number;
  checksum?: string;
  createdAt: number;
  createdBy: string;
};

export type SyncManifestSnapshot =
  | WorkspaceManifestSnapshot
  | MembershipManifestSnapshot
  | ChannelManifestSnapshot
  | MessageLogSnapshot;

export interface ManifestDelta {
  domain: SyncDomain;
  workspaceId: string;
  channelId?: string;
  version: number;
  baseVersion: number;
  opId: string;
  operation: 'create' | 'update' | 'delete';
  subject: string;
  data: Record<string, unknown>;
  timestamp: number;
  author: string;
}

export interface ManifestSnapshotPointer {
  domain: SyncDomain;
  workspaceId: string;
  channelId?: string;
  snapshotId: string;
  version: number;
  basedOnVersion: number;
  createdAt: number;
  createdBy: string;
}

export interface SyncManifestSummary {
  workspaceId: string;
  generatedAt: number;
  versions: ManifestDomainVersion[];
  snapshots?: ManifestSnapshotPointer[];
}

export interface ManifestDiffRequest {
  domain: SyncDomain;
  workspaceId: string;
  channelId?: string;
  fromVersion: number;
  toVersion?: number;
}

export interface ManifestDiffResponse {
  workspaceId: string;
  generatedAt: number;
  deltas: ManifestDelta[];
  snapshots?: ManifestSnapshotPointer[];
}

export type SyncManifestState = Partial<Record<SyncDomain, ManifestVersion>>;
