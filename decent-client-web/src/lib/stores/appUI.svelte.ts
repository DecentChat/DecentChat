/**
 * App UI Store — Reactive state that bridges UIRenderer → Svelte components.
 *
 * UIRenderer writes to this store. App.svelte and child components read from it.
 * This replaces the mount/unmount pattern with reactive state updates.
 */

import type { PlaintextMessage, Contact, DirectConversation } from '@decentchat/protocol';
import type { HuddleState, HuddleParticipant } from '../../huddle/HuddleManager';
import type { UICallbacks, ActivityItem } from '../../ui/types';

// ── Types ──

export interface MemberData {
  peerId: string;
  alias: string;
  isOnline: boolean;
  isMe: boolean;
  role: string;
  isBot: boolean;
  statusClass: string;
  statusTitle: string;
}

export interface ChannelData {
  id: string;
  name: string;
}

export interface DirectConvData {
  id: string;
  contactPeerId: string;
  lastMessageAt: number;
}

export interface ThreadData {
  parent: PlaintextMessage | null;
  replies: PlaintextMessage[];
}

export interface ComposeMember {
  peerId: string;
  name: string;
}

// ── Reactive UI State ──

export const appUI = $state({
  // View mode
  view: 'loading' as 'loading' | 'welcome' | 'app',

  // Identity
  myPeerId: '',
  myAlias: '',

  // Active state
  activeWorkspaceId: null as string | null,
  activeChannelId: null as string | null,
  activeDirectConversationId: null as string | null,

  // Sidebar
  workspaceName: null as string | null,
  channels: [] as ChannelData[],
  members: [] as MemberData[],
  directConversations: [] as DirectConvData[],

  // Messages
  messages: [] as PlaintextMessage[],
  channelName: '',
  channelMemberCount: 0,
  isDirectMessage: false,

  // Thread
  threadOpen: false,
  threadId: null as string | null,
  threadData: { parent: null, replies: [] } as ThreadData,

  // Compose
  composePlaceholder: 'Message...',
  composeMembers: [] as ComposeMember[],

  // Huddle
  huddleState: 'inactive' as HuddleState,
  huddleMuted: false,
  huddleChannelId: null as string | null,
  huddleParticipants: [] as HuddleParticipant[],

  // Lightbox
  lightboxOpen: false,
  lightboxSrc: '',
  lightboxName: '',

  // Search panel open
  searchOpen: false,

  // Activity panel
  activityPanelOpen: false,
  activityItems: [] as ActivityItem[],
  activityUnread: 0,

  // Typing indicator
  typingText: '',

  // Workspace rail
  workspaces: [] as Array<{ id: string; name: string }>,

  // Frequent reactions
  frequentReactions: [] as string[],

  // Welcome screen
  hasWorkspace: false,

  // Channel header
  headerChannelName: 'Select a channel',
  headerMemberCount: 0,
  headerIsDirectMessage: false,
  headerIsHuddleActive: false,
});

// ── Callbacks reference (set once by uiService) ──
let _callbacks: UICallbacks | null = null;

export function setUICallbacks(callbacks: UICallbacks): void {
  _callbacks = callbacks;
}

export function getUICallbacks(): UICallbacks | null {
  return _callbacks;
}
