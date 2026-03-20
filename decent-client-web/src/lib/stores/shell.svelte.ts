/**
 * Shell Store — Reactive props for AppShell child components.
 *
 * UIRenderer writes computed prop data here. AppShell reads and passes
 * to child Svelte components declaratively. This replaces the
 * mount/unmount pattern where MountHelpers destroyed and recreated
 * components on every update.
 *
 * Split into data (changes often) and callbacks (set once at init).
 */

import type { PlaintextMessage, Contact, DirectConversation } from 'decent-protocol';
import type { HuddleState, HuddleParticipant } from '../../huddle/HuddleManager';
import type { ActivityItem } from '../../ui/types';
import { MessageSearch } from '../../ui/MessageSearch';

// ── Types ──

export interface ShellMemberData {
  peerId: string;
  alias: string;
  isOnline: boolean;
  isMe: boolean;
  role: string;
  isBot: boolean;
  allowWorkspaceDMs?: boolean;
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

export interface ShellChannelData {
  id: string;
  name: string;
}

export interface ShellDirectConvData {
  id: string;
  contactPeerId: string;
  lastMessageAt: number;
}

export interface ShellWorkspaceData {
  id: string;
  name: string;
}

export interface SidebarConnectionBanner {
  showBanner: boolean;
  level: 'offline' | 'warning' | 'info';
  message: string;
  detail?: string;
}

export interface PresenceSliceSummary {
  onlineCount: number | null;
  sampledOnlineCount: number;
  sampledPeerCount: number;
  hasMore: boolean;
  loadedPages: number;
  activeChannelId?: string;
  updatedAt?: number;
}

// ── Reactive data store (UIRenderer writes, AppShell reads) ──

export const shellData = $state({
  // Current view: 'hidden' (loading), 'welcome' (no workspaces), or 'app' (main chat)
  view: 'hidden' as 'hidden' | 'welcome' | 'app',

  // Welcome screen props
  welcome: {
    myPeerId: '',
    hasWorkspace: false,
  },

  // Workspace rail
  rail: {
    workspaces: [] as ShellWorkspaceData[],
    activeWorkspaceId: null as string | null,
    activityUnread: 0,
    dmUnread: 0,
  },

  // Sidebar
  sidebar: {
    workspaceName: null as string | null,
    channels: [] as ShellChannelData[],
    members: [] as ShellMemberData[],
    directConversations: [] as ShellDirectConvData[],
    activeChannelId: null as string | null,
    activeDirectConversationId: null as string | null,
    myPeerId: '',
    connectionBanner: {
      showBanner: false,
      level: 'info',
      message: '',
    } as SidebarConnectionBanner,
    presence: {
      onlineCount: null,
      sampledOnlineCount: 0,
      sampledPeerCount: 0,
      hasMore: false,
      loadedPages: 0,
    } as PresenceSliceSummary,
  },

  // Channel header
  header: {
    channelName: 'Select a channel',
    memberCount: 0,
    isDirectMessage: false,
    isHuddleActive: false,
    presence: {
      onlineCount: null,
      sampledOnlineCount: 0,
      sampledPeerCount: 0,
      hasMore: false,
      loadedPages: 0,
    } as PresenceSliceSummary,
  },

  // Message list
  messages: {
    messages: [] as PlaintextMessage[],
    channelName: '',
    activeChannelId: null as string | null,
    myPeerId: '',
    myDisplayName: '',
    frequentReactions: [] as string[],
    scrollTargetMessageId: null as string | null,
    scrollTargetNonce: 0,
  },

  // Compose area
  compose: {
    placeholder: 'Message...',
  },

  // Thread panel
  thread: {
    open: false,
    threadId: null as string | null,
    channelId: null as string | null,
    parentMessage: null as PlaintextMessage | null,
    replies: [] as PlaintextMessage[],
    myPeerId: '',
    myDisplayName: '',
    frequentReactions: [] as string[],
    scrollTargetMessageId: null as string | null,
    scrollTargetNonce: 0,
  },

  // Huddle bar
  huddle: {
    state: 'inactive' as HuddleState,
    muted: false,
    participants: [] as HuddleParticipant[],
  },

  // Lightbox
  lightbox: {
    open: false,
    src: '',
    name: '',
  },

  // Search panel
  search: {
    open: false,
    myPeerId: '',
    myAlias: '',
  },

  // Activity panel
  activity: {
    panelOpen: false,
    items: [] as ActivityItem[],
  },

  // Company sim panel
  companySim: {
    open: false,
    workspaceId: null as string | null,
    workspaceName: null as string | null,
  },

  // Typing indicator
  typingText: '',
});

// ── Callback store (set once by UIRenderer, never changes) ──

export interface ShellCallbacks {
  // Welcome screen
  onCreateWorkspace: () => void;
  onJoinWorkspace: () => void;
  onRestoreSeed: () => void;
  onInstallAiTeam: () => void;

  // Workspace rail
  onSwitchToDMs: () => void;
  onSwitchWorkspace: (wsId: string) => void;
  onToggleActivity: () => void;
  onAddWorkspace: () => void;
  onOpenCompanySim: () => Promise<void> | void;
  onCloseCompanySim: () => void;

  // Sidebar
  onChannelClick: (channelId: string) => void;
  onMemberClick: (peerId: string) => void;
  onDirectConvClick: (convId: string) => void;
  onAddChannel: () => void;
  onStartDM: () => void;
  onAddContact: () => void;
  onConnectPeer: () => void;
  onCopyInvite: () => void;
  onShowQR: () => void;
  onCopyPeerId: () => void;
  onWorkspaceSettings: () => void;
  onWorkspaceMembers: () => void;
  onWorkspaceInvite: () => void;
  onWorkspaceNotifications: () => void;
  onRetryReconnect: () => Promise<void>;
  onLoadMorePresence: () => Promise<void>;
  getUnreadCount: (id: string) => number;
  getPeerAlias: (peerId: string) => string;
  getPeerStatusClass: (peerId: string) => string;
  getPeerStatusTitle: (peerId: string) => string;

  // Channel header
  onHamburger: () => void;
  onHuddleToggle: () => void;
  onHeaderConnectPeer: () => void;
  onHeaderShowQR: () => void;
  onSearch: () => void;
  onInvite: () => void;
  onSettings: () => void;
  onChannelMembers: () => void;

  // Messages
  getThread: (channelId: string, messageId: string) => PlaintextMessage[];
  isBot: (senderId: string) => boolean;
  getCompanySimProfile: (senderId: string) => { automationKind?: string; roleTitle?: string; teamId?: string; managerPeerId?: string; avatarUrl?: string } | undefined;
  onOpenThread: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onRememberReaction: (emoji: string) => void;
  onShowMessageInfo: (messageId: string) => void;
  onImageClick: (name: string, src: string, attachmentId?: string) => void | Promise<void>;
  resolveAttachmentImageUrl?: (attachmentId: string) => Promise<string | null>;

  // Compose
  onSend: (text: string, files: File[]) => Promise<void>;
  onTyping: () => void;
  onStopTyping: () => void;
  getCommandSuggestions?: (prefix: string) => any[];
  getMembers: () => Array<{ peerId: string; name: string }>;
  searchMembers?: (query: string, limit?: number) => Promise<Array<{ peerId: string; name: string }>>;

  // Thread
  onCloseThread: () => void;
  onThreadSend: (text: string, files: File[]) => Promise<void>;

  // Huddle
  onToggleMute: () => void;
  onLeaveHuddle: () => void;
  onJoinHuddle: () => void;

  // Lightbox
  onCloseLightbox: () => void;

  // Search
  onSearchQuery: (query: string) => any[];
  onScrollToMessage: (messageId: string) => void;
  onCloseSearch: () => void;

  // Activity
  onCloseActivity: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onNavigateActivity: (item: ActivityItem) => void;
  getActivityPeerAlias: (peerId: string) => string;
}

let _callbacks: ShellCallbacks | null = null;

export function setShellCallbacks(callbacks: ShellCallbacks): void {
  _callbacks = callbacks;
}

export function getShellCallbacks(): ShellCallbacks | null {
  return _callbacks;
}

