/**
 * UI type definitions — shared between UIRenderer and MountHelpers.
 */

import type { Contact, ContactURIData, DirectConversation } from 'decent-protocol';

export interface ActivityItem {
  id: string;
  type: 'thread-reply' | 'mention';
  workspaceId: string;
  channelId: string;
  threadId?: string;
  messageId: string;
  actorId: string;
  snippet: string;
  timestamp: number;
  read: boolean;
}

export interface WorkspaceInviteItem {
  inviteId: string;
  inviteCode?: string;
  url?: string;
  createdAt?: number;
  expiresAt?: number;
  inviterId?: string;
  permanent: boolean | null;
  revoked: boolean;
  revokedAt?: number;
}

export interface WorkspaceInviteLists {
  active: WorkspaceInviteItem[];
  revoked: WorkspaceInviteItem[];
}

export interface UICallbacks {
  sendMessage: (content: string, threadId?: string) => Promise<void>;
  sendAttachment: (file: File, text?: string, threadId?: string) => Promise<void>;
  resolveAttachmentImageUrl?: (attachmentId: string) => Promise<string | null>;
  connectPeer: (peerId: string) => void;
  createWorkspace: (name: string, alias: string) => import('decent-protocol').Workspace;
  joinWorkspace: (
    code: string,
    alias: string,
    peerId: string,
    inviteData?: import('decent-protocol').InviteData,
    options?: { allowWorkspaceDMs?: boolean },
  ) => Promise<void>;
  createChannel: (name: string) => { success: boolean; channel?: import('decent-protocol').Channel; error?: string };
  removeWorkspaceMember?: (peerId: string) => Promise<{ success: boolean; error?: string }>;
  promoteMember?: (peerId: string, newRole: 'admin') => Promise<{ success: boolean; error?: string }>;
  demoteMember?: (peerId: string) => Promise<{ success: boolean; error?: string }>;
  updateWorkspacePermissions?: (permissions: Partial<import('decent-protocol').WorkspacePermissions>) => Promise<{ success: boolean; error?: string }>;
  updateWorkspaceInfo?: (updates: { name?: string; description?: string }) => Promise<{ success: boolean; error?: string }>;
  deleteWorkspace?: (workspaceId: string) => Promise<boolean>;
  leaveWorkspace?: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
  createDM: (peerId: string) => { success: boolean; channel?: import('decent-protocol').Channel };
  persistWorkspace: (wsId: string) => Promise<void>;
  persistSetting: (key: string, value: unknown) => Promise<void>;
  getCommandSuggestions?: (prefix: string) => Array<{ name: string; description: string }>;
  broadcastTyping?: () => void;
  broadcastStopTyping?: () => void;
  toggleReaction?: (messageId: string, emoji: string) => void;
  getMessageReceiptInfo?: (messageId: string) => {
    messageId: string;
    channelId: string;
    recipients: Array<{ peerId: string; name: string; at?: number }>;
    delivered: Array<{ peerId: string; name: string; at?: number }>;
    read: Array<{ peerId: string; name: string; at?: number }>;
    pending: Array<{ peerId: string; name: string; at?: number }>;
  } | null;
  getSettings?: () => Promise<any>;
  generateInviteURL?: (workspaceId: string, opts?: { permanent?: boolean }) => string | Promise<string>;
  listWorkspaceInvites?: (workspaceId: string) => WorkspaceInviteLists;
  revokeWorkspaceInvite?: (inviteId: string) => Promise<{ success: boolean; error?: string; inviteId?: string; alreadyRevoked?: boolean }>;
  onSettingsAction?: (action: string) => void | Promise<void>;
  onQRContactScanned?: (data: ContactURIData) => void;
  getMyPublicKey?: () => string;
  addContact?: (contact: Contact) => Promise<void>;
  removeContact?: (peerId: string) => Promise<void>;
  getContacts?: () => Promise<Contact[]>;
  startDirectMessage?: (contactPeerId: string, options?: { sourceWorkspaceId?: string }) => Promise<DirectConversation>;
  getDirectConversations?: () => Promise<DirectConversation[]>;
  getAllWorkspaces?: () => Array<import('decent-protocol').Workspace>;
  setWorkspaceAlias?: (wsId: string, alias: string) => void;
  getUnreadCount?: (channelId: string) => number;
  getActivityItems?: () => ActivityItem[];
  getActivityUnreadCount?: () => number;
  markActivityRead?: (id: string) => void;
  markAllActivityRead?: () => void;
  markThreadActivityRead?: (channelId: string, threadId: string) => void;
  setFocusedChannel?: (channelId: string | null) => void;
  markChannelRead?: (channelId: string) => void;
  onChannelViewed?: (channelId: string) => void | Promise<void>;
  getDisplayNameForPeer?: (peerId: string) => string;
  getCurrentSeed?: () => Promise<string | null>;
  validateSeed?: (mnemonic: string) => string | null;
  onSeedRestored?: (mnemonic: string) => Promise<void>;
  startHuddle?: (channelId: string) => Promise<void>;
  joinHuddle?: (channelId: string) => Promise<void>;
  leaveHuddle?: () => Promise<void>;
  toggleHuddleMute?: () => boolean;
}
