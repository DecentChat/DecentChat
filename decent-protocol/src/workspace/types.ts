/**
 * Workspace, Channel, and Member types
 */

import type {
  WorkspaceShell,
  MemberDirectoryPage,
  DirectoryShardRef,
  ChannelAccessPolicy,
  PresenceAggregate,
  HistoryPageRef,
  HistoryPageSnapshot,
  HistoryPageDirection,
  HistoryReplicaTier,
  HistoryReplicaHint,
  HistorySyncCapabilities,
  PeerCapabilities,
} from './DirectoryTypes';

export type {
  WorkspaceShell,
  MemberSummary,
  MemberDirectoryPage,
  DirectoryShardRef,
  ChannelAccessPolicy,
  PresenceAggregate,
  HistoryPageRef,
  HistoryPageSnapshot,
  HistoryPageDirection,
  HistoryReplicaTier,
  HistoryReplicaSelectionPolicy,
  HistoryReplicaHint,
  HistorySyncCapabilities,
  PeerCapabilities,
} from './DirectoryTypes';

export enum WorkspaceRole {
  Owner = 'owner',
  Admin = 'admin',
  Member = 'member',
}

export interface WorkspacePermissions {
  whoCanCreateChannels: 'everyone' | 'admins';
  whoCanInviteMembers: 'everyone' | 'admins';
  /** Invite IDs that admins/owners have revoked. */
  revokedInviteIds?: string[];
}

export const DEFAULT_WORKSPACE_PERMISSIONS: WorkspacePermissions = {
  whoCanCreateChannels: 'everyone',
  whoCanInviteMembers: 'everyone',
  revokedInviteIds: [],
};

export interface WorkspaceBan {
  peerId: string;
  bannedBy: string;
  bannedAt: number;
  /** Optional expiry timestamp (epoch ms). Undefined = permanent ban. */
  expiresAt?: number;
  reason?: string;
}

export interface Workspace {
  id: string;
  name: string;
  inviteCode: string;
  /** Optional monotonic workspace version/checkpoint for scalable sync. */
  version?: number;
  createdBy: string; // PeerId
  createdAt: number;
  members: WorkspaceMember[];
  channels: Channel[];
  permissions?: WorkspacePermissions;
  description?: string;
  /** Lightweight shell metadata for scalable/paged clients. */
  shell?: WorkspaceShell;
  /** Optional references to distributed member-directory shards. */
  directoryShards?: DirectoryShardRef[];
  /** Optional aggregate presence view for scalable clients. */
  presenceAggregate?: PresenceAggregate;
  /** Optional advertised capabilities visible within this workspace. */
  peerCapabilities?: Record<string, PeerCapabilities>;
  /** Access revocation list for workspace-level bans */
  bans?: WorkspaceBan[];
}

export interface WorkspaceMember {
  peerId: string;
  alias: string;
  publicKey: string; // Base64 ECDH public key
  signingPublicKey?: string; // Base64 ECDSA signing public key (trust anchor for admin events)
  /** Canonical identity ID (hash of ECDH public key). Optional for backward compat with old data. */
  identityId?: string;
  /** Known devices for this identity (multi-device support). */
  devices?: DeviceInfoSync[];
  joinedAt: number;
  role: 'owner' | 'admin' | 'member';
  /** Whether this member is an automated agent/bot */
  isBot?: boolean;
  /** Privacy preference for workspace-origin DMs (missing/undefined = allow). */
  allowWorkspaceDMs?: boolean;
  addedBy?: string;
}

export interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  type: 'channel' | 'dm';
  /**
   * Explicit membership list.
   * - Required for DMs
   * - Compatibility path for legacy/private/small channels
   * - Not authoritative for scalable public-workspace channels when accessPolicy is present
   */
  members: string[];
  /** Optional scalable access rule. When present, this is authoritative over legacy member arrays. */
  accessPolicy?: ChannelAccessPolicy;
  /** Optional lightweight history pagination hints for scalable clients. */
  historyPages?: HistoryPageRef[];
  /** Latest replica hint metadata for this channel, used by adaptive page source selection. */
  historyReplicaHint?: HistoryReplicaHint;
  createdBy: string;
  createdAt: number;
}

export interface WorkspaceInvite {
  workspaceId: string;
  workspaceName: string;
  inviteCode: string;
  invitedBy: string;
}

/**
 * Signaling server info for Peer Exchange (PEX) - DEP-002
 */
export interface PEXServer {
  url: string;
  lastSeen: number;
  successRate: number;
  latency?: number;
}

// P2P sync messages
export interface WorkspaceDeltaOp {
  op: 'upsert-channel' | 'remove-channel' | 'upsert-member' | 'remove-member' | 'update-shell';
  channel?: Channel;
  channelId?: string;
  member?: WorkspaceMember;
  peerId?: string;
  shellPatch?: Partial<WorkspaceShell> & { description?: string; name?: string };
}

export interface WorkspaceDelta {
  workspaceId: string;
  baseVersion: number;
  version: number;
  checkpointId?: string;
  ops: WorkspaceDeltaOp[];
}

export type SyncMessage =
  | {
      type: 'join-request';
      inviteCode: string;
      member: WorkspaceMember;
      inviteId?: string;
      pexServers?: PEXServer[];
      historySyncMode?: 'legacy' | 'paged';
      historyCapabilities?: HistorySyncCapabilities;
    }
  // `messageHistory` intentionally omits plaintext message content during sync.
  | {
      type: 'join-accepted';
      workspace: Workspace;
      messageHistory: Record<string, any[]>;
      pexServers?: PEXServer[];
      historyReplicaHints?: HistoryReplicaHint[];
      historyCapabilities?: HistorySyncCapabilities;
    }
  | { type: 'join-rejected'; reason: string }
  | { type: 'member-joined'; member: WorkspaceMember }
  | { type: 'member-left'; peerId: string }
  | { type: 'member-removed'; peerId: string; removedBy: string; reason?: 'kicked' | 'banned'; banExpiresAt?: number }
  | { type: 'role-changed'; peerId: string; newRole: WorkspaceMember['role']; changedBy: string; timestamp: number }
  | { type: 'workspace-settings-updated'; settings: WorkspacePermissions; changedBy: string; timestamp: number }
  | { type: 'channel-created'; channel: Channel }
  | { type: 'channel-removed'; channelId: string; removedBy: string }
  | { type: 'workspace-deleted'; workspaceId: string; deletedBy: string }
  | { type: 'channel-message'; channelId: string; message: any }
  | {
      type: 'sync-request';
      workspaceId: string;
      historySyncMode?: 'legacy' | 'paged';
      historyCapabilities?: HistorySyncCapabilities;
    }
  // `messageHistory` intentionally omits plaintext message content during sync.
  | {
      type: 'sync-response';
      workspace: Workspace;
      messageHistory: Record<string, any[]>;
      historyReplicaHints?: HistoryReplicaHint[];
      historyCapabilities?: HistorySyncCapabilities;
    }
  | { type: 'workspace-shell-request'; workspaceId: string }
  | { type: 'workspace-shell-response'; shell: WorkspaceShell; inviteCode?: string }
  | { type: 'workspace-delta'; delta: WorkspaceDelta }
  | { type: 'workspace-delta-ack'; workspaceId: string; version: number; checkpointId?: string }
  | { type: 'member-page-request'; workspaceId: string; cursor?: string; pageSize?: number; shardPrefix?: string }
  | { type: 'member-page-response'; page: MemberDirectoryPage }
  | {
      type: 'history-page-request';
      workspaceId: string;
      channelId: string;
      cursor?: string;
      pageSize?: number;
      direction?: HistoryPageDirection;
      tier?: HistoryReplicaTier;
    }
  | {
      type: 'history-page-response';
      workspaceId: string;
      channelId: string;
      page: HistoryPageSnapshot;
      historyReplicaHints?: HistoryReplicaHint[];
    }
  | { type: 'history-replica-hints'; workspaceId: string; hints: HistoryReplicaHint[] }
  | { type: 'directory-shard-advertisement'; shard: DirectoryShardRef }
  | { type: 'directory-shard-repair'; workspaceId: string; shardId: string; requestedBy: string; targetReplicaPeerIds?: string[] }
  | { type: 'peer-exchange'; servers: PEXServer[] }
  | { type: 'device-announce'; identityId: string; device: DeviceInfoSync; proof: DeviceProofSync }
  | { type: 'device-ack'; identityId: string; deviceId: string };

/** Device info for sync messages */
export interface DeviceInfoSync {
  deviceId: string;
  peerId: string;
  deviceLabel: string;
  lastSeen: number;
}

/** Cryptographic proof of device ownership for sync */
export interface DeviceProofSync {
  identityId: string;
  deviceId: string;
  timestamp: number;
  /** ECDSA signature over (identityId + deviceId + timestamp), base64-encoded */
  signature: string;
}
