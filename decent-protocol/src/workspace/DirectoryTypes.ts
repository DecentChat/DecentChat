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

export interface PeerCapabilities {
  directory?: { shardPrefixes: string[] };
  relay?: { channels?: string[] };
  archive?: { retentionDays?: number };
  presenceAggregator?: boolean;
}
