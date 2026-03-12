export interface WorkspaceShell {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: number;
  version: number;
  memberCount: number;
  channelCount: number;
  capabilityFlags?: string[];
}

export interface MemberSummary {
  peerId: string;
  alias: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  identityId?: string;
  isBot?: boolean;
  /** Privacy preference for workspace-origin DMs (missing/undefined = allow). */
  allowWorkspaceDMs?: boolean;
  presence?: 'online' | 'offline' | 'away';
}

export interface MemberDirectoryPage {
  workspaceId: string;
  pageSize: number;
  members: MemberSummary[];
  cursor?: string;
  nextCursor?: string;
  shardRef?: DirectoryShardRef;
}

export interface DirectoryShardRef {
  workspaceId: string;
  shardId: string;
  shardPrefix: string;
  replicaPeerIds: string[];
  version?: number;
}

export interface ChannelAccessPolicy {
  mode: 'dm' | 'public-workspace' | 'group' | 'role-gated' | 'explicit';
  groupIds?: string[];
  roles?: Array<'owner' | 'admin' | 'member'>;
  explicitMemberPeerIds?: string[];
}

export interface PresenceAggregate {
  workspaceId: string;
  onlineCount: number;
  awayCount?: number;
  activeChannelId?: string;
  updatedAt: number;
}

export interface HistoryPageRef {
  workspaceId: string;
  channelId: string;
  pageId: string;
  startCursor?: string;
  endCursor?: string;
  replicaPeerIds?: string[];
}

export type HistoryPageDirection = 'older' | 'newer';
export type HistoryReplicaTier = 'recent' | 'archive';

export interface HistoryPageSnapshotMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderIdentityId?: string;
  timestamp: number;
  type: 'text' | 'file' | 'system';
  threadId?: string;
  prevHash: string;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  recipientPeerIds?: string[];
  ackedBy?: string[];
  ackedAt?: Record<string, number>;
  readBy?: string[];
  readAt?: Record<string, number>;
  vectorClock?: Record<string, number>;
  metadata?: Record<string, unknown>;
  content?: string;
}

export interface HistoryPageSnapshot {
  workspaceId: string;
  channelId: string;
  pageId: string;
  pageSize: number;
  direction: HistoryPageDirection;
  tier: HistoryReplicaTier;
  cursor?: string;
  nextCursor?: string;
  startCursor?: string;
  endCursor?: string;
  hasMore?: boolean;
  generatedAt: number;
  replicaPeerIds?: string[];
  messages: HistoryPageSnapshotMessage[];
}

export interface HistoryReplicaHint {
  workspaceId: string;
  channelId: string;
  recentReplicaPeerIds: string[];
  archiveReplicaPeerIds?: string[];
  updatedAt: number;
}

export interface PeerCapabilities {
  directory?: { shardPrefixes: string[] };
  relay?: { channels?: string[] };
  archive?: { retentionDays?: number };
  presenceAggregator?: boolean;
}
