/**
 * UI type definitions — shared between UIRenderer and MountHelpers.
 */

import type { Contact, ContactURIData, DirectConversation } from 'decent-protocol';
import type { TopologyDebugSnapshot } from '../app/topology/TopologyTelemetry';

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

export interface WorkspaceMemberDirectoryView {
  members: Array<{
    peerId: string;
    alias: string;
    role: 'owner' | 'admin' | 'member';
    isBot: boolean;
    isOnline: boolean;
    isYou: boolean;
    allowWorkspaceDMs: boolean;
    companySim?: {
      automationKind?: string;
      roleTitle?: string;
      teamId?: string;
      managerPeerId?: string;
      avatarUrl?: string;
    };
  }>;
  loadedCount: number;
  totalCount: number;
  hasMore: boolean;
  presence?: {
    onlineCount: number | null;
    sampledOnlineCount: number;
    sampledPeerCount: number;
    hasMore: boolean;
    nextCursor?: string;
    loadedPages: number;
    activeChannelId?: string;
    updatedAt?: number;
  };
}

export interface CompanyTemplateQuestionDefinition {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
}

export type CompanyTemplateRoleAvatarStyle =
  | 'helm'
  | 'visor'
  | 'circuit'
  | 'glyph'
  | 'sentinel'
  | 'oracle'
  | 'wisp'
  | 'vanguard';

export type CompanyTemplateRoleStatKey = 'planning' | 'execution' | 'quality' | 'adaptability';

export type CompanyTemplateRoleStats = Record<CompanyTemplateRoleStatKey, number>;

export interface CompanyTemplateRoleAvatarDefinition {
  style?: CompanyTemplateRoleAvatarStyle;
  seed?: string;
  accent?: string;
}

export interface CompanyTemplateRoleProfileDefinition {
  archetype?: string;
  bioLine?: string;
  traitPool?: string[];
  statPreset?: Partial<CompanyTemplateRoleStats>;
  avatar?: CompanyTemplateRoleAvatarDefinition;
  channelAffinity?: string;
}

export interface CompanyTemplateRoleDefinition {
  id: string;
  title: string;
  teamId: string;
  defaultAlias: string;
  aliasQuestionId?: string;
  managerRoleId?: string;
  profile?: CompanyTemplateRoleProfileDefinition;
}

export interface CompanyTemplateDefinition {
  id: string;
  label: string;
  description: string;
  icon?: string;
  channels: string[];
  roles: CompanyTemplateRoleDefinition[];
  questions: CompanyTemplateQuestionDefinition[];
}

export interface CompanyTemplateGeneratedAvatar {
  style: CompanyTemplateRoleAvatarStyle;
  seed: string;
  accent: string;
  dataUrl: string;
}

export interface CompanyTemplateInstallPreviewMember {
  roleId: string;
  roleTitle: string;
  teamId: string;
  alias: string;
  peerId: string;
  managerRoleId?: string;
  archetype?: string;
  bioLine?: string;
  traits?: string[];
  stats?: CompanyTemplateRoleStats;
  avatar?: CompanyTemplateGeneratedAvatar;
  channelAffinity?: string;
}

export interface CompanyTemplateInstallPreview {
  templateId: string;
  templateLabel: string;
  companyName: string;
  workspaceName: string;
  channelNames: string[];
  members: CompanyTemplateInstallPreviewMember[];
}

export interface CompanyTemplateInstallRequest {
  templateId: string;
  workspaceId: string;
  answers: Record<string, string>;
}

export type CompanyTemplateProvisioningMode =
  | 'runtime-provisioned'
  | 'config-provisioned'
  | 'workspace-shell';

export interface CompanyTemplateInstallResult {
  templateId: string;
  templateLabel: string;
  workspaceId: string;
  workspaceName: string;
  companyName: string;
  createdChannelNames: string[];
  createdMemberPeerIds: string[];
  channelNames: string[];
  members: CompanyTemplateInstallPreviewMember[];
  provisioningMode: CompanyTemplateProvisioningMode;
  statusHeadline: string;
  statusDetail: string;
  createdAccountIds: string[];
  provisionedAccountIds: string[];
  onlineReadyAccountIds: string[];
  manualActionRequiredAccountIds: string[];
  manualActionItems: string[];
}

export interface CompanyTemplateRuntimeBridgeResult {
  provisioningMode?: Exclude<CompanyTemplateProvisioningMode, 'workspace-shell'>;
  createdAccountIds?: string[];
  provisionedAccountIds?: string[];
  onlineReadyAccountIds?: string[];
  manualActionRequiredAccountIds?: string[];
  manualActionItems?: string[];
}

export interface CompanyTemplateRuntimeBridge {
  listTemplates?: () => Promise<CompanyTemplateDefinition[]> | CompanyTemplateDefinition[];
  installTemplate?: (
    request: CompanyTemplateInstallRequest,
  ) => Promise<CompanyTemplateRuntimeBridgeResult> | CompanyTemplateRuntimeBridgeResult;
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
  banWorkspaceMember?: (peerId: string, opts?: { durationMs?: number; reason?: string }) => Promise<{ success: boolean; error?: string }>;
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
  getWorkspaceMemberDirectory?: (workspaceId: string) => WorkspaceMemberDirectoryView;
  prefetchWorkspaceMemberDirectory?: (workspaceId: string) => Promise<void>;
  loadMoreWorkspaceMemberDirectory?: (workspaceId: string) => Promise<WorkspaceMemberDirectoryView | null>;
  getPresenceScopeState?: (workspaceId: string, channelId?: string | null) => {
    onlineCount: number | null;
    sampledOnlineCount: number;
    sampledPeerCount: number;
    hasMore: boolean;
    nextCursor?: string;
    loadedPages: number;
    activeChannelId?: string;
    updatedAt?: number;
  };
  loadMorePresenceScope?: (workspaceId: string, channelId: string) => Promise<{
    onlineCount: number | null;
    sampledOnlineCount: number;
    sampledPeerCount: number;
    hasMore: boolean;
    nextCursor?: string;
    loadedPages: number;
    activeChannelId?: string;
    updatedAt?: number;
  }>;
  onWorkspaceActivated?: (workspaceId: string) => void | Promise<void>;
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
  getConnectionStatus?: () => {
    showBanner: boolean;
    level: 'offline' | 'warning' | 'info';
    message: string;
    detail?: string;
    debug?: {
      partialMeshEnabled: boolean;
      desiredPeerCount?: number;
      connectedDesiredPeerCount?: number;
      connectingDesiredPeerCount?: number;
      connectedPeerCount: number;
      likelyPeerCount: number;
      coldPeerCount: number;
      desiredPeers?: string[];
      anchors?: string[];
      explorers?: string[];
      topology?: TopologyDebugSnapshot;
    };
  };
  retryReconnect?: () => Promise<{ attempted: number; reinitialized: boolean }>;
  listCompanyTemplates?: () => Promise<CompanyTemplateDefinition[]> | CompanyTemplateDefinition[];
  installCompanyTemplate?: (request: CompanyTemplateInstallRequest) => Promise<CompanyTemplateInstallResult>;
}
