/**
 * Workspace Store — Reactive Svelte state for workspaces, channels, members.
 * 
 * During migration, UIRenderer calls sync functions to push state here.
 * After migration, ChatController will write directly to these stores.
 */

export interface WorkspaceInfo {
  id: string;
  name: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type?: string;
  members: { peerId: string }[];
}

export interface MemberInfo {
  peerId: string;
  alias: string;
  isOnline: boolean;
  isMe: boolean;
  role?: string;
  isBot?: boolean;
  companySim?: {
    automationKind?: string;
    roleTitle?: string;
    teamId?: string;
    managerPeerId?: string;
    avatarUrl?: string;
  };
  statusClass: string;
  statusTitle: string;
}

export interface DirectConversationInfo {
  id: string;
  contactPeerId: string;
  lastMessageAt: number;
}

// ── Reactive state ──
export const workspaceStore = $state({
  workspaces: [] as WorkspaceInfo[],
  activeWorkspaceId: null as string | null,
  activeWorkspaceName: null as string | null,
  channels: [] as ChannelInfo[],
  members: [] as MemberInfo[],
  activeChannelId: null as string | null,
  activeDirectConversationId: null as string | null,
  directConversations: [] as DirectConversationInfo[],
  myPeerId: '',
  activityUnread: 0,
});

// ── Sync functions (called by UIRenderer during migration) ──

export function syncWorkspaces(data: {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  activeWorkspaceName: string | null;
  channels: ChannelInfo[];
  members: MemberInfo[];
  activeChannelId: string | null;
  activeDirectConversationId: string | null;
  directConversations: DirectConversationInfo[];
  myPeerId: string;
  activityUnread: number;
}): void {
  workspaceStore.workspaces = data.workspaces;
  workspaceStore.activeWorkspaceId = data.activeWorkspaceId;
  workspaceStore.activeWorkspaceName = data.activeWorkspaceName;
  workspaceStore.channels = data.channels;
  workspaceStore.members = data.members;
  workspaceStore.activeChannelId = data.activeChannelId;
  workspaceStore.activeDirectConversationId = data.activeDirectConversationId;
  workspaceStore.directConversations = data.directConversations;
  workspaceStore.myPeerId = data.myPeerId;
  workspaceStore.activityUnread = data.activityUnread;
}
