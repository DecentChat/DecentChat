export const PUBLIC_WORKSPACE_STORES = {
  workspaceShells: 'workspaceShells',
  memberDirectoryPages: 'memberDirectoryPages',
  directoryShardRefs: 'directoryShardRefs',
  channelPolicies: 'channelPolicies',
  presenceAggregates: 'presenceAggregates',
  historyPages: 'historyPages',
} as const;

export type PublicWorkspaceStoreName = typeof PUBLIC_WORKSPACE_STORES[keyof typeof PUBLIC_WORKSPACE_STORES];

export const makeMemberDirectoryPageKey = (workspaceId: string, cursor?: string) => `${workspaceId}::${cursor || 'first'}`;
export const makeChannelPolicyKey = (workspaceId: string, channelId: string) => `${workspaceId}::${channelId}`;
export const makeDirectoryShardKey = (workspaceId: string, shardId: string) => `${workspaceId}::${shardId}`;
export const makeHistoryPageKey = (workspaceId: string, channelId: string, pageId: string) => `${workspaceId}::${channelId}::${pageId}`;
