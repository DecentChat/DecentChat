/**
 * UIRenderer — All HTML rendering and DOM manipulation for the P2P Chat app.
 *
 * Takes app state (by reference) and callbacks for actions that require
 * business logic (send, connect, create workspace, etc.).
 */

import type { WorkspaceManager, MessageStore } from 'decent-protocol';
import { MessageSearch } from './MessageSearch';
import { SettingsPanel } from './SettingsPanel';
import { QRCodeManager } from './QRCodeManager';
import { ReactionTracker } from './ReactionTracker';
import { peerColor as peerColorUtil, escapeHtml as escapeHtmlUtil } from '../lib/utils/peer';
import { ContactURI, InviteURI } from 'decent-protocol';
import type { PlaintextMessage, Contact, ContactURIData, DirectConversation } from 'decent-protocol';
import { toast } from '../lib/components/shared/Toast.svelte';
import { showModal as svelteShowModal } from '../lib/components/shared/Modal.svelte';
import { showEmojiPicker } from '../lib/components/shared/EmojiPicker.svelte';
import { showMessageInfoModal } from '../lib/components/modals/MessageInfoModal.svelte';
import { showChannelMembersModal as svelteShowChannelMembersModal } from '../lib/components/modals/ChannelMembersModal.svelte';
import { showWorkspaceMembersModal as svelteShowWorkspaceMembersModal } from '../lib/components/modals/WorkspaceMembersModal.svelte';
import { showWorkspaceSettingsModal as svelteShowWorkspaceSettingsModal } from '../lib/components/modals/WorkspaceSettingsModal.svelte';
import { showJoinWorkspaceModal as svelteShowJoinWorkspaceModal } from '../lib/components/modals/JoinWorkspaceModal.svelte';
import { showPeerSelectModal } from '../lib/components/modals/PeerSelectModal.svelte';
import { showAddContactModal as svelteShowAddContactModal } from '../lib/components/modals/AddContactModal.svelte';
import { mount, unmount } from 'svelte';
import WorkspaceRail from '../lib/components/layout/WorkspaceRail.svelte';
import Sidebar from '../lib/components/layout/Sidebar.svelte';
import ChannelHeader from '../lib/components/layout/ChannelHeader.svelte';
import MessageList from '../lib/components/messages/MessageList.svelte';
import WelcomePage from '../lib/components/layout/WelcomePage.svelte';
import ComposeArea from '../lib/components/compose/ComposeArea.svelte';
import ThreadPanel from '../lib/components/layout/ThreadPanel.svelte';
import ActivityPanel from '../lib/components/layout/ActivityPanel.svelte';
import HuddleBar from '../lib/components/layout/HuddleBar.svelte';
import SearchPanel from '../lib/components/layout/SearchPanel.svelte';
import Lightbox from '../lib/components/shared/Lightbox.svelte';

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
import type { HuddleState, HuddleParticipant } from '../huddle/HuddleManager';
import type { AppState } from '../main';
import { renderMarkdown } from './renderMarkdown';

// ---------------------------------------------------------------------------
// Callback interfaces
// ---------------------------------------------------------------------------

export interface UICallbacks {
  /** Send a chat message (optionally in a thread) */
  sendMessage: (content: string, threadId?: string) => Promise<void>;
  /** Send a file attachment with optional text/thread */
  sendAttachment: (file: File, text?: string, threadId?: string) => Promise<void>;
  /** Resolve full-quality image URL for an attachment (blob URL), if available */
  resolveAttachmentImageUrl?: (attachmentId: string) => Promise<string | null>;
  /** Initiate a WebRTC connection to a peer */
  connectPeer: (peerId: string) => void;
  /** Create a new workspace and return it */
  createWorkspace: (name: string, alias: string) => import('decent-protocol').Workspace;
  /** Initiate join flow (connect to a peer with invite code) */
  joinWorkspace: (code: string, alias: string, peerId: string, inviteData?: import('decent-protocol').InviteData) => Promise<void>;
  /** Create a channel inside the active workspace */
  createChannel: (name: string) => { success: boolean; channel?: import('decent-protocol').Channel; error?: string };
  /** Remove a member from the active workspace (owner/admin) */
  removeWorkspaceMember?: (peerId: string) => Promise<{ success: boolean; error?: string }>;
  /** Promote a member's role */
  promoteMember?: (peerId: string, newRole: 'admin') => Promise<{ success: boolean; error?: string }>;
  /** Demote a member to regular member */
  demoteMember?: (peerId: string) => Promise<{ success: boolean; error?: string }>;
  /** Update workspace permissions */
  updateWorkspacePermissions?: (permissions: Partial<import('decent-protocol').WorkspacePermissions>) => Promise<{ success: boolean; error?: string }>;
  /** Update workspace name/description */
  updateWorkspaceInfo?: (updates: { name?: string; description?: string }) => Promise<{ success: boolean; error?: string }>;
  /** Delete workspace */
  deleteWorkspace?: (workspaceId: string) => Promise<boolean>;
  /** Open a DM channel */
  createDM: (peerId: string) => { success: boolean; channel?: import('decent-protocol').Channel };
  /** Persist workspace state */
  persistWorkspace: (wsId: string) => Promise<void>;
  /** Persist a key-value setting */
  persistSetting: (key: string, value: unknown) => Promise<void>;
  /** Get command autocomplete suggestions */
  getCommandSuggestions?: (prefix: string) => Array<{ name: string; description: string }>;
  /** Broadcast typing indicator */
  broadcastTyping?: () => void;
  /** Broadcast stop typing */
  broadcastStopTyping?: () => void;
  /** Toggle reaction on a message */
  toggleReaction?: (messageId: string, emoji: string) => void;
  /** WhatsApp-like message info (delivered/read breakdown) */
  getMessageReceiptInfo?: (messageId: string) => {
    messageId: string;
    channelId: string;
    recipients: Array<{ peerId: string; name: string; at?: number }>;
    delivered: Array<{ peerId: string; name: string; at?: number }>;
    read: Array<{ peerId: string; name: string; at?: number }>;
    pending: Array<{ peerId: string; name: string; at?: number }>;
  } | null;
  /** Get settings for settings panel */
  getSettings?: () => Promise<any>;
  /** Generate full invite URL for a workspace */
  generateInviteURL?: (workspaceId: string) => string;
  /** Settings panel action (e.g. generateSeed) */
  onSettingsAction?: (action: string) => void | Promise<void>;
  /** Handle scanned QR contact — add to contacts and optionally connect */
  onQRContactScanned?: (data: ContactURIData) => void;
  /** Get user's public key for QR code generation */
  getMyPublicKey?: () => string;
  /** Add a contact */
  addContact?: (contact: Contact) => Promise<void>;
  /** Remove a contact */
  removeContact?: (peerId: string) => Promise<void>;
  /** Get all contacts */
  getContacts?: () => Promise<Contact[]>;
  /** Start a standalone DM with a contact */
  startDirectMessage?: (contactPeerId: string) => Promise<DirectConversation>;
  /** Get all standalone direct conversations */
  getDirectConversations?: () => Promise<DirectConversation[]>;
  /** Get all workspaces for the workspace switcher */
  getAllWorkspaces?: () => Array<import('decent-protocol').Workspace>;
  /** Set a per-workspace display name alias */
  setWorkspaceAlias?: (wsId: string, alias: string) => void;
  /** Get unread message count for a channel */
  getUnreadCount?: (channelId: string) => number;
  /** Activity feed items (thread replies, mentions, etc.) */
  getActivityItems?: () => ActivityItem[];
  /** Count unread activity items */
  getActivityUnreadCount?: () => number;
  /** Mark one activity item as read */
  markActivityRead?: (id: string) => void;
  /** Mark all activity as read */
  markAllActivityRead?: () => void;
  /** Mark activity entries for a specific thread as read */
  markThreadActivityRead?: (channelId: string, threadId: string) => void;
  /** Notify the notification system which channel is currently active */
  setFocusedChannel?: (channelId: string | null) => void;
  /** Mark a channel as fully read */
  markChannelRead?: (channelId: string) => void;
  /** Late-read receipt scan when opening a channel/conversation */
  onChannelViewed?: (channelId: string) => void | Promise<void>;
  /** Resolve best display name for a peer — checks contacts, workspace members, fallback */
  getDisplayNameForPeer?: (peerId: string) => string;
  /** Get current seed phrase (for transfer QR) */
  getCurrentSeed?: () => Promise<string | null>;
  /** Validate a seed phrase — returns error string or null if valid */
  validateSeed?: (mnemonic: string) => string | null;
  /** Called when user restores identity from seed phrase */
  onSeedRestored?: (mnemonic: string) => Promise<void>;
  /** Start a voice huddle in a channel */
  startHuddle?: (channelId: string) => Promise<void>;
  /** Join an existing voice huddle */
  joinHuddle?: (channelId: string) => Promise<void>;
  /** Leave the current voice huddle */
  leaveHuddle?: () => Promise<void>;
  /** Toggle mute in the current huddle */
  toggleHuddleMute?: () => boolean;
}

// ---------------------------------------------------------------------------
// UIRenderer
// ---------------------------------------------------------------------------

export class UIRenderer {
  // emojiPicker: migrated to Svelte (src/lib/components/shared/EmojiPicker.svelte)
  private messageSearch: MessageSearch;
  private settingsPanel: SettingsPanel | null = null;
  private qrCodeManager: QRCodeManager;
  private _workspaceRailComponent: Record<string, any> | null = null;
  private _sidebarComponent: Record<string, any> | null = null;
  private _channelHeaderComponent: Record<string, any> | null = null;
  private _messageListComponent: Record<string, any> | null = null;
  private _threadListComponent: Record<string, any> | null = null;
  private _welcomeComponent: Record<string, any> | null = null;
  private _composeComponent: Record<string, any> | null = null;
  private _threadPanelComponent: Record<string, any> | null = null;
  private _activityPanelComponent: Record<string, any> | null = null;
  private _huddleBarComponent: Record<string, any> | null = null;
  private _searchPanelComponent: Record<string, any> | null = null;
  private _lightboxComponent: Record<string, any> | null = null;

  /** Cached contacts for synchronous sidebar rendering */
  private cachedContacts: Contact[] = [];
  /** Cached direct conversations for synchronous sidebar rendering */
  private cachedDirectConversations: DirectConversation[] = [];

  /** Huddle (voice call) state */
  private huddleState: HuddleState = 'inactive';
  private huddleChannelId: string | null = null;
  private huddleParticipants: HuddleParticipant[] = [];
  private huddleMuted = false;

  /** Pending compose attachments (staged before send) */
  // pendingMainAttachments/pendingThreadAttachments removed — migrated to ComposeArea.svelte
  // _boundPasteHandler removed — paste handling migrated to ComposeArea.svelte
  // _boundDropHandler removed — drag-drop handled in bindAppEvents directly
  private lightboxBlobUrl: string | null = null;
  private activityPanelOpen = false;

  // _userScrolledAway, _programmaticScroll, _scrollListenerBound — removed (scroll management in Svelte)
  private reactionTracker!: ReactionTracker;

  constructor(
    private state: AppState,
    private workspaceManager: WorkspaceManager,
    private messageStore: MessageStore,
    private callbacks: UICallbacks,
  ) {
    this.messageSearch = new MessageSearch(messageStore);
    this.qrCodeManager = new QRCodeManager({
      onContactScanned: (data) => this.callbacks.onQRContactScanned?.(data),
      onSeedRestored: (mnemonic) => this.callbacks.onSeedRestored?.(mnemonic),
      validateSeed: (mnemonic) => this.callbacks.validateSeed?.(mnemonic) ?? null,
      showToast: (msg, type) => this.showToast(msg, type),
    });
    this.refreshContactsCache();
    this.reactionTracker = new ReactionTracker(this.state.myPeerId);
  }

  private tracePrefix(): string {
    const alias = (this.state.myAlias || '').trim();
    if (/^alice$/i.test(alias)) return '[TRACE Alice]';
    if (/^bob$/i.test(alias)) return '[TRACE Bob]';
    return `[TRACE ${alias || this.state.myPeerId.slice(0, 8)}]`;
  }

  /** Reload reaction usage from localStorage (call after myPeerId is set) */
  reloadReactionUsage(): void {
    this.reactionTracker.reload(this.state.myPeerId);
  }

  private rememberReaction(emoji: string): void {
    this.reactionTracker.rememberReaction(emoji);
    // Re-render messages to pick up new frequent reactions
    this.renderMessages();
  }

  private getFrequentReactions(): string[] {
    return this.reactionTracker.getFrequentReactions();
  }

  /** Refresh the cached contacts/conversations from the async stores */
  async refreshContactsCache(): Promise<void> {
    const [contacts, conversations] = await Promise.all([
      this.callbacks.getContacts?.() || Promise.resolve([]),
      this.callbacks.getDirectConversations?.() || Promise.resolve([]),
    ]);
    this.cachedContacts = contacts;
    this.cachedDirectConversations = conversations
      .slice()
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  // =========================================================================
  // Welcome screen
  // =========================================================================

  private hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => loading.remove(), 300);
    }
  }

  renderWelcome(): void {
    this.hideLoading();
    const app = document.getElementById('app')!;
    const hasWorkspace = (this.callbacks.getAllWorkspaces?.().length || 0) > 0;

    // Unmount previous welcome component if any
    if (this._welcomeComponent) {
      try { unmount(this._welcomeComponent); } catch {}
      this._welcomeComponent = null;
    }
    app.innerHTML = '';

    this._welcomeComponent = mount(WelcomePage, {
      target: app,
      props: {
        myPeerId: this.state.myPeerId,
        hasWorkspace,
        onCreateWorkspace: () => this.showCreateWorkspaceModal(),
        onJoinWorkspace: () => this.showJoinWorkspaceModal(),
        onRestoreSeed: () => this.qrCodeManager.showRestoreSeed(),
      },
    });
  }

  // =========================================================================
  // Main app layout
  // =========================================================================

  renderApp(): void {
    this.hideLoading();
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div class="app-layout">
        <div class="workspace-rail" id="workspace-rail"></div>
        <div class="sidebar" id="sidebar"></div>
        <div class="main-content">
          <div id="channel-header-mount"></div>
          <div id="search-mount"></div>
          <div id="huddle-mount"></div>
          <div class="messages-area">
            <div class="messages-pane">
              <div class="messages-list" id="messages-list"></div>
              <div class="typing-indicator" id="typing-indicator"></div>
              <div id="huddle-bar-mount"></div>
              <div id="compose-mount"></div>
            </div>
            <div id="thread-mount"></div>
          </div>
        </div>
        <div id="lightbox-mount"></div>
      </div>
    `;

    this.updateWorkspaceRail();
    this.mountSidebar(document.getElementById('sidebar')!);
    this.mountChannelHeader(document.getElementById('channel-header-mount')!);
    this.mountCompose();
    this.mountThreadPanel();
    this.mountHuddleBar();
    this.mountLightbox();
    this.bindAppEvents();
    this.renderMessages();
  }

  // ── Svelte component mounts ──

  private mountCompose(): void {
    if (this._composeComponent) {
      try { unmount(this._composeComponent); } catch {}
      this._composeComponent = null;
    }
    const container = document.getElementById('compose-mount');
    if (!container) return;
    container.innerHTML = '';

    this._composeComponent = mount(ComposeArea, {
      target: container,
      props: {
        placeholder: this.getComposePlaceholder(),
        target: 'main',
        onSend: async (text: string, files: File[]) => {
          if (files.length > 0) {
            for (let i = 0; i < files.length; i++) {
              await this.callbacks.sendAttachment(files[i], i === 0 ? (text || undefined) : undefined, undefined);
            }
          } else if (text) {
            await this.callbacks.sendMessage(text, undefined);
          }
        },
        onTyping: () => this.callbacks.broadcastTyping?.(),
        onStopTyping: () => this.callbacks.broadcastStopTyping?.(),
        getCommandSuggestions: this.callbacks.getCommandSuggestions
          ? (prefix: string) => this.callbacks.getCommandSuggestions!(prefix)
          : undefined,
        getMembers: () => {
          const ws = this.state.activeWorkspaceId
            ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
            : null;
          if (!ws) return [];
          return ws.members
            .filter((m: any) => m.peerId !== this.state.myPeerId)
            .map((m: any) => ({ peerId: m.peerId, name: this.getPeerAlias(m.peerId) }));
        },
      },
    });
  }

  private mountThreadPanel(): void {
    if (this._threadPanelComponent) {
      try { unmount(this._threadPanelComponent); } catch {}
      this._threadPanelComponent = null;
    }
    const container = document.getElementById('thread-mount');
    if (!container) return;
    container.innerHTML = '';

    const getThreadData = () => {
      if (!this.state.activeChannelId || !this.state.activeThreadId) {
        return { parent: null, replies: [] as PlaintextMessage[] };
      }
      const allMsgs = this.messageStore.getMessages(this.state.activeChannelId);
      let parent = allMsgs.find((m: PlaintextMessage) => m.id === this.state.activeThreadId);
      if (!parent) parent = this.messageStore.getThreadRoot(this.state.activeThreadId);
      const replies = this.messageStore.getThread(this.state.activeChannelId, this.state.activeThreadId!);
      return { parent: parent || null, replies };
    };

    const data = getThreadData();

    this._threadPanelComponent = mount(ThreadPanel, {
      target: container,
      props: {
        open: this.state.threadOpen,
        threadId: this.state.activeThreadId,
        channelId: this.state.activeChannelId,
        parentMessage: data.parent,
        replies: data.replies,
        myPeerId: this.state.myPeerId,
        myDisplayName: this.getMyDisplayName(),
        frequentReactions: this.getFrequentReactions(),
        getThread: (channelId: string, messageId: string) => this.messageStore.getThread(channelId, messageId),
        getPeerAlias: (peerId: string) => this.getPeerAlias(peerId),
        isBot: (senderId: string) => {
          const ws = this.state.activeWorkspaceId ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId) : null;
          return ws?.members.find((m: any) => m.peerId === senderId)?.isBot === true;
        },
        onOpenThread: (messageId: string) => this.openThread(messageId),
        onToggleReaction: (messageId: string, emoji: string) => this.callbacks.toggleReaction?.(messageId, emoji),
        onRememberReaction: (emoji: string) => this.rememberReaction(emoji),
        onShowMessageInfo: (messageId: string) => this.showMessageInfo(messageId),
        onClose: () => this.closeThread(),
        onSend: async (text: string, files: File[]) => {
          const threadId = this.state.activeThreadId || undefined;
          if (files.length > 0) {
            for (let i = 0; i < files.length; i++) {
              await this.callbacks.sendAttachment(files[i], i === 0 ? (text || undefined) : undefined, threadId);
            }
          } else if (text) {
            await this.callbacks.sendMessage(text, threadId);
          }
        },
        getMembers: () => {
          const ws = this.state.activeWorkspaceId
            ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
            : null;
          if (!ws) return [];
          return ws.members
            .filter((m: any) => m.peerId !== this.state.myPeerId)
            .map((m: any) => ({ peerId: m.peerId, name: this.getPeerAlias(m.peerId) }));
        },
      },
    });
  }

  private mountHuddleBar(): void {
    if (this._huddleBarComponent) {
      try { unmount(this._huddleBarComponent); } catch {}
      this._huddleBarComponent = null;
    }
    const container = document.getElementById('huddle-mount');
    if (!container) return;
    container.innerHTML = '';

    this._huddleBarComponent = mount(HuddleBar, {
      target: container,
      props: {
        state: this.huddleState,
        muted: this.huddleMuted,
        participants: this.huddleParticipants,
        onToggleMute: () => {
          const muted = this.callbacks.toggleHuddleMute?.() ?? false;
          this.huddleMuted = muted;
          this.mountHuddleBar();
        },
        onLeave: async () => {
          await this.callbacks.leaveHuddle?.();
        },
        onJoin: async () => {
          const channelId = this.huddleChannelId || this.state.activeChannelId;
          if (channelId) await this.callbacks.joinHuddle?.(channelId);
        },
      },
    });
  }

  private mountLightbox(): void {
    if (this._lightboxComponent) {
      try { unmount(this._lightboxComponent); } catch {}
      this._lightboxComponent = null;
    }
    const container = document.getElementById('lightbox-mount');
    if (!container) return;
    container.innerHTML = '';

    this._lightboxComponent = mount(Lightbox, {
      target: container,
      props: {
        open: this._lightboxOpen ?? false,
        src: this._lightboxSrc ?? '',
        name: this._lightboxName ?? '',
        onClose: () => this.closeLightbox(),
      },
    });
  }

  private _lightboxOpen = false;
  private _lightboxSrc = '';
  private _lightboxName = '';

  // =========================================================================
  // Workspace rail (left icon strip like Discord/Slack)
  // =========================================================================

  // renderWorkspaceRailHTML() — removed (migrated to WorkspaceRail.svelte)
  // bindWorkspaceRailEvents() — removed (migrated to WorkspaceRail.svelte)

  switchWorkspace(workspaceId: string): void {
    this.activityPanelOpen = false;
    document.getElementById('activity-btn')?.classList.remove('active');
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return;

    this.state.activeWorkspaceId = workspaceId;
    this.state.activeDirectConversationId = null;
    this.state.activeChannelId = ws.channels[0]?.id || null;
    this.closeThread();
    this.persistViewState();
    this.refreshContactsCache();
    this.updateSidebar();
    this.updateWorkspaceRail();
    this.updateChannelHeader();
    this.renderMessages();
    this.updateComposePlaceholder();
  }

  updateWorkspaceRail(): void {
    const rail = document.getElementById('workspace-rail');
    if (!rail) return;
    // Unmount previous Svelte component
    if (this._workspaceRailComponent) {
      try { unmount(this._workspaceRailComponent); } catch {}
      this._workspaceRailComponent = null;
    }
    rail.innerHTML = '';
    this._workspaceRailComponent = mount(WorkspaceRail, {
      target: rail,
      props: {
        workspaces: this.callbacks.getAllWorkspaces?.() || [],
        activeWorkspaceId: this.state.activeWorkspaceId,
        activityUnread: this.callbacks.getActivityUnreadCount?.() || 0,
        onSwitchToDMs: () => {
          this.activityPanelOpen = false;
          document.getElementById('activity-btn')?.classList.remove('active');
          this.state.activeWorkspaceId = null;
          if (!this.state.activeDirectConversationId) {
            this.state.activeChannelId = null;
          }
          this.persistViewState();
          this.refreshContactsCache().catch(() => {});
          this.updateSidebar();
          this.updateWorkspaceRail();
          this.updateChannelHeader();
          this.renderMessages();
        },
        onSwitchWorkspace: (wsId: string) => {
          this.switchWorkspace(wsId);
        },
        onToggleActivity: () => this.toggleActivityPanel(),
        onAddWorkspace: () => this.showCreateWorkspaceModal(),
      },
    });
  }

  // =========================================================================
  // Sidebar & channel header HTML generators — MIGRATED TO SVELTE
  // renderSidebarHTML() -> Sidebar.svelte
  // renderChannelHeaderHTML() -> ChannelHeader.svelte
  // bindSidebarEvents() -> Sidebar.svelte
  // bindChannelHeaderEvents() -> ChannelHeader.svelte
  // =========================================================================

  // =========================================================================
  // Messages
  // =========================================================================

  // isNearBottom() / scrollToBottom() — removed (scroll management now in Svelte components)

  /**
   * Scroll to a specific message by ID and highlight it with a fade-out animation.
   * Works in both the main message list and the thread panel.
   */
  scrollToMessageAndHighlight(messageId: string, containerId?: string): void {
    // Small delay to let DOM settle after channel switch / thread open
    requestAnimationFrame(() => {
      const selector = `[data-message-id="${messageId}"]`;
      // Search in specific container first, then fall back to global
      const container = containerId ? document.getElementById(containerId) : null;
      const msgEl = container?.querySelector(selector) ?? document.querySelector(selector);
      if (!msgEl) return;

      // Remove any existing highlight first
      msgEl.classList.remove('highlight');
      // Force reflow so re-adding the class restarts the animation
      void (msgEl as HTMLElement).offsetWidth;

      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('highlight');
      setTimeout(() => msgEl.classList.remove('highlight'), 2500);
    });
  }

  // ensureScrollListener() — removed (scroll management now in Svelte MessageList)

  renderMessages(): void {
    const listContainer = document.getElementById('messages-list')!;
    this._scrollListenerBound = false;
    this._userScrolledAway = false;

    // Unmount previous Svelte component
    if (this._messageListComponent) {
      try { unmount(this._messageListComponent); } catch {}
      this._messageListComponent = null;
    }

    const channelName = this.getActiveChannelName();
    const messages = this.state.activeChannelId
      ? this.messageStore.getMessages(this.state.activeChannelId).filter((m: PlaintextMessage) => !m.threadId)
      : [];

    // Mount Svelte MessageList in place of the messages-list div
    listContainer.innerHTML = '';
    this._messageListComponent = mount(MessageList, {
      target: listContainer,
      props: this.getMessageListProps(messages, channelName, false),
    });
  }

  private getMessageListProps(messages: PlaintextMessage[], channelName: string, inThreadView: boolean, threadRoot?: PlaintextMessage | null) {
    return {
      messages,
      channelName,
      activeChannelId: this.state.activeChannelId,
      myPeerId: this.state.myPeerId,
      myDisplayName: this.getMyDisplayName(),
      inThreadView,
      threadRoot: threadRoot || null,
      frequentReactions: this.getFrequentReactions(),
      getThread: (channelId: string, messageId: string) =>
        this.messageStore.getThread(channelId, messageId),
      getPeerAlias: (peerId: string) => this.getPeerAlias(peerId),
      isBot: (senderId: string) => {
        const ws = this.state.activeWorkspaceId ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId) : null;
        return ws?.members.find((m: any) => m.peerId === senderId)?.isBot === true;
      },
      onOpenThread: (messageId: string) => this.openThread(messageId),
      onToggleReaction: (messageId: string, emoji: string) =>
        this.callbacks.toggleReaction?.(messageId, emoji),
      onRememberReaction: (emoji: string) => this.rememberReaction(emoji),
      onShowMessageInfo: (messageId: string) => this.showMessageInfo(messageId),
    };
  }

  private getActiveChannelName(): string {
    if (this.state.activeDirectConversationId) {
      const conv = this.cachedDirectConversations.find(c => c.id === this.state.activeDirectConversationId);
      return conv ? this.getPeerAlias(conv.contactPeerId) : 'this conversation';
    }
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    const channel = ws && this.state.activeChannelId
      ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId)
      : null;
    return channel ? (channel.type === 'dm' ? channel.name : '#' + channel.name) : 'the channel';
  }

  private getMyDisplayName(): string {
    return (this.state.activeWorkspaceId && this.state.workspaceAliases?.[this.state.activeWorkspaceId])
      || this.state.myAlias || 'You';
  }

  appendMessageToDOM(msg: PlaintextMessage, container?: HTMLElement, animate = false): void {
    console.log(this.tracePrefix(), 'appendMessageToDOM', {
      id: msg.id,
      content: msg.content,
      channelId: msg.channelId,
    });

    // With Svelte MessageList, re-render the entire list to pick up the new message.
    // The Svelte component handles scroll management internally.
    const isThreadContainer = container?.id === 'thread-messages';
    if (isThreadContainer) {
      this.renderThreadMessages();
    } else {
      this.renderMessages();
    }
  }

  renderThreadMessages(): void {
    // Re-mount the thread panel with updated data
    this.mountThreadPanel();
  }

  /**
   * DEP-005: Update the delivery status tick on a sent message.
   * Re-renders the message list to reflect updated status from the message store.
   */
  updateMessageStatus(
    _messageId: string,
    _status: 'pending' | 'sent' | 'delivered' | 'read',
    _detail?: { acked?: number; total?: number; read?: number },
  ): void {
    // MessageItem.svelte renders status from message props — re-render to pick up changes.
    this.renderMessages();
  }

  private showMessageInfo(messageId: string): void {
    const info = this.callbacks.getMessageReceiptInfo?.(messageId);
    if (!info) {
      this.showToast('Message info unavailable', 'error');
      return;
    }
    showMessageInfoModal(info);
  }

  updateStreamingMessage(_messageId: string, _content: string): void {
    // Re-render the message list to pick up content updates.
    // The Svelte MessageList handles scroll management internally.
    this.renderMessages();
  }

  finalizeStreamingMessage(_messageId: string): void {
    // Re-render to finalize display (remove cursor, streaming class).
    this.renderMessages();
  }

  // =========================================================================
  // Thread open/close
  // =========================================================================

  private persistViewState(): void {
    const payload = {
      workspaceId: this.state.activeWorkspaceId,
      channelId: this.state.activeChannelId,
      threadId: this.state.threadOpen ? this.state.activeThreadId : null,
      threadOpen: this.state.threadOpen,
      directConversationId: this.state.activeDirectConversationId,
      at: Date.now(),
    };

    void this.callbacks.persistSetting('ui:lastView', payload).catch(() => {});
  }

  openThread(messageId: string): void {
    this.state.activeThreadId = messageId;
    this.state.threadOpen = true;

    // Re-mount thread panel with updated state
    this.mountThreadPanel();

    this.persistViewState();
    if (this.state.activeChannelId) {
      this.callbacks.markThreadActivityRead?.(this.state.activeChannelId, messageId);
      this.updateChannelHeader();
    }

    // Focus the thread input
    setTimeout(() => {
      (document.getElementById('thread-input') as HTMLTextAreaElement)?.focus();
    }, 100);
  }

  closeThread(): void {
    this.state.activeThreadId = null;
    this.state.threadOpen = false;
    this.persistViewState();
    this.mountThreadPanel();
  }

  // setupThreadResize() — removed (migrated to ThreadPanel.svelte)

  // =========================================================================
  // Mobile sidebar helpers
  // =========================================================================

  openMobileSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.classList.add('open');

    // Inject backdrop overlay — tapping it closes the sidebar
    const existing = document.getElementById('mobile-sidebar-overlay');
    if (existing) return; // Already open

    const overlay = document.createElement('div');
    overlay.id = 'mobile-sidebar-overlay';
    overlay.className = 'mobile-overlay';
    overlay.addEventListener('click', () => this.closeMobileSidebar());
    // Also close on touch start for faster response on mobile
    overlay.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.closeMobileSidebar();
    }, { passive: false });
    document.body.appendChild(overlay);
  }

  closeMobileSidebar(): void {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('mobile-sidebar-overlay')?.remove();
  }

  /**
   * Update the thread reply indicator on the parent message in the main list.
   * Called when a new thread reply arrives from a peer.
   * Now re-renders the message list since MessageItem.svelte handles thread indicators.
   */
  updateThreadIndicator(_parentMessageId: string, _channelId: string): void {
    this.renderMessages();
  }

  // renderThreadIndicatorContent() — removed (migrated to MessageItem.svelte)

  // relativeTime() — removed (migrated to $lib/utils/format.ts)

  // =========================================================================
  // Channel switching
  // =========================================================================

  switchChannel(channelId: string): void {
    this.state.activeChannelId = channelId;
    this.state.activeDirectConversationId = null;
    this.callbacks.setFocusedChannel?.(channelId);
    this.callbacks.markChannelRead?.(channelId);
    void this.callbacks.onChannelViewed?.(channelId);
    this.closeThread();
    this.persistViewState();
    this.updateSidebar();
    this.updateChannelHeader();
    this.renderMessages();
    this.updateComposePlaceholder();
    this.closeMobileSidebar();
  }

  /** Switch to a standalone direct conversation */
  switchToDirectConversation(conversationId: string): void {
    this.state.activeDirectConversationId = conversationId;
    this.state.activeChannelId = conversationId; // channelId = conversationId for message routing
    this.state.activeWorkspaceId = null;
    this.callbacks.setFocusedChannel?.(conversationId);
    this.callbacks.markChannelRead?.(conversationId);
    void this.callbacks.onChannelViewed?.(conversationId);
    this.closeThread();
    this.persistViewState();
    this.updateSidebar();
    this.updateChannelHeader();
    this.renderMessages();
    this.updateComposePlaceholder();
    this.closeMobileSidebar();
  }

  private updateComposePlaceholder(): void {
    // Re-mount compose area to update placeholder
    this.mountCompose();
  }

  // =========================================================================
  // DOM update helpers
  // =========================================================================

  updateSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    this.refreshContactsCache()
      .catch(() => {})
      .finally(() => {
        this.mountSidebar(sidebar);
      });
  }

  private mountSidebar(sidebar: HTMLElement): void {
    // Unmount previous Svelte component
    if (this._sidebarComponent) {
      try { unmount(this._sidebarComponent); } catch {}
      this._sidebarComponent = null;
    }
    sidebar.innerHTML = '';

    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    const channels = ws ? this.workspaceManager.getChannels(ws.id) : [];

    // Build member data with online/offline grouping (same logic as before)
    const memberData = ws
      ? (() => {
          const seen = new Set<string>();
          return ws.members.filter((m) => {
            const key = m.identityId || m.peerId;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).map((m) => {
            const identityPeers = m.identityId
              ? ws.members.filter(other => other.identityId === m.identityId).map(other => other.peerId)
              : [m.peerId];
            const isMe = identityPeers.includes(this.state.myPeerId);
            const isOnline = isMe || identityPeers.some(pid => this.peerStatusClass(pid) === 'online');
            const alias = this.getPeerAlias(m.peerId);
            return {
              peerId: m.peerId, alias, isOnline, isMe,
              role: m.role, isBot: m.isBot,
              statusClass: this.peerStatusClass(m.peerId),
              statusTitle: this.peerStatusTitle(m.peerId),
            };
          });
        })()
      : [];

    this._sidebarComponent = mount(Sidebar, {
      target: sidebar,
      props: {
        workspaceName: ws?.name ?? null,
        channels: channels.map(ch => ({ id: ch.id, name: ch.name })),
        members: memberData,
        directConversations: this.cachedDirectConversations.map(c => ({
          id: c.id,
          contactPeerId: c.contactPeerId,
          lastMessageAt: c.lastMessageAt,
        })),
        activeChannelId: this.state.activeChannelId,
        activeDirectConversationId: this.state.activeDirectConversationId,
        getUnreadCount: (id: string) => this.callbacks.getUnreadCount?.(id) || 0,
        getPeerAlias: (peerId: string) => this.getPeerAlias(peerId),
        getPeerStatusClass: (peerId: string) => this.peerStatusClass(peerId),
        getPeerStatusTitle: (peerId: string) => this.peerStatusTitle(peerId),
        onChannelClick: (channelId: string) => this.switchChannel(channelId),
        onMemberClick: (peerId: string) => this.startMemberDM(peerId),
        onDirectConvClick: (convId: string) => this.switchToDirectConversation(convId),
        myPeerId: this.state.myPeerId,
        onAddChannel: () => this.showCreateChannelModal(),
        onStartDM: () => this.showStartDirectMessageModal(),
        onAddContact: () => this.showAddContactModal(),
        onConnectPeer: () => this.showConnectPeerModal(),
        onCopyInvite: () => {
          if (!this.state.activeWorkspaceId) return;
          const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
          if (inviteURL) {
            navigator.clipboard.writeText(inviteURL);
            this.showToast('Invite link copied!', 'success');
          }
        },
        onShowQR: () => this.showMyQR(),
        onCopyPeerId: () => {
          navigator.clipboard.writeText(this.state.myPeerId);
          this.showToast('Peer ID copied!');
        },
        onWorkspaceSettings: () => this.showWorkspaceSettingsModal(),
        onWorkspaceMembers: () => this.showWorkspaceMembersModal(),
        onWorkspaceInvite: () => {
          if (!this.state.activeWorkspaceId) return;
          const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
          if (inviteURL) {
            navigator.clipboard.writeText(inviteURL);
            this.showToast('Invite link copied!', 'success');
          }
        },
        onWorkspaceNotifications: () => this.showSettings(),
      },
    });
  }

  updateChannelHeader(): void {
    const headerContainer = document.getElementById('channel-header-mount');
    if (!headerContainer) return;
    this.mountChannelHeader(headerContainer);
  }

  private mountChannelHeader(container: HTMLElement): void {
    if (this._channelHeaderComponent) {
      try { unmount(this._channelHeaderComponent); } catch {}
      this._channelHeaderComponent = null;
    }
    container.innerHTML = '';

    const isDirectMessage = !!this.state.activeDirectConversationId;
    let channelName = 'Select a channel';
    let memberCount = 0;

    if (isDirectMessage) {
      const conv = this.cachedDirectConversations.find(c => c.id === this.state.activeDirectConversationId);
      channelName = conv ? this.getPeerAlias(conv.contactPeerId) : 'Direct Message';
    } else {
      const ws = this.state.activeWorkspaceId
        ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
        : null;
      const channel = this.state.activeChannelId && ws
        ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId)
        : null;
      if (channel) {
        channelName = channel.type === 'dm' ? channel.name : `# ${channel.name}`;
        memberCount = channel.members.length;
      }
    }

    this._channelHeaderComponent = mount(ChannelHeader, {
      target: container,
      props: {
        channelName,
        memberCount,
        isDirectMessage,
        isHuddleActive: this.huddleState === 'in-call' && this.huddleChannelId === this.state.activeChannelId,
        onHamburger: () => {
          const sidebar = document.getElementById('sidebar');
          if (sidebar?.classList.contains('open')) {
            this.closeMobileSidebar();
          } else {
            this.openMobileSidebar();
          }
        },
        onHuddleToggle: async () => {
          const channelId = this.state.activeChannelId;
          if (!channelId) return;
          if (this.huddleState === 'in-call') {
            await this.callbacks.leaveHuddle?.();
          } else {
            await this.callbacks.startHuddle?.(channelId);
          }
        },
        onConnectPeer: () => this.showConnectPeerModal(),
        onShowQR: () => this.showMyQR(),
        onSearch: () => this.showSearchPanel(),
        onInvite: () => {
          if (!this.state.activeWorkspaceId) return;
          const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
          if (inviteURL) {
            navigator.clipboard.writeText(inviteURL);
            this.showToast('Invite link copied! Share it with anyone.', 'success');
          }
        },
        onSettings: () => this.showSettings(),
        onChannelMembers: () => this.showChannelMembersModal(),
      },
    });
  }

  // =========================================================================
  // Event binding
  // =========================================================================

  private bindAppEvents(): void {
    // ── Compose, thread, emoji, file attach — now handled by ComposeArea.svelte ──
    // ── Thread open/close — now handled by ThreadPanel.svelte ──
    // ── Huddle events — now handled by HuddleBar.svelte ──
    // ── Lightbox events — now handled by Lightbox.svelte ──

    // Thumbnail click -> open lightbox (event delegation on message lists)
    const handleThumbnailClick = async (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('attachment-thumbnail')) {
        const img = target as HTMLImageElement;
        const name = img.getAttribute('data-attachment-name') || '';
        const attachmentId = img.getAttribute('data-attachment-id') || '';

        this.openLightbox(img.src, name);

        if (attachmentId && this.callbacks.resolveAttachmentImageUrl) {
          const fullSrc = await this.callbacks.resolveAttachmentImageUrl(attachmentId);
          if (fullSrc) {
            if (this._lightboxOpen) {
              if (this.lightboxBlobUrl) URL.revokeObjectURL(this.lightboxBlobUrl);
              this.lightboxBlobUrl = fullSrc;
              this._lightboxSrc = fullSrc;
              this.mountLightbox();
            }
          }
        }
      }
    };

    const messagesList = document.getElementById('messages-list');
    messagesList?.addEventListener('click', handleThumbnailClick);

    // Drag & drop file support
    const messagesArea = document.querySelector('.messages-area') as HTMLElement;
    if (messagesArea) {
      messagesArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        messagesArea.classList.add('drag-active');
      });
      messagesArea.addEventListener('dragleave', (e) => {
        if (!messagesArea.contains(e.relatedTarget as Node)) {
          messagesArea.classList.remove('drag-active');
        }
      });
      messagesArea.addEventListener('drop', (e) => {
        e.preventDefault();
        messagesArea.classList.remove('drag-active');
        const files = Array.from(e.dataTransfer?.files || []);
        if (this.state.activeChannelId || this.state.activeDirectConversationId) {
          // TODO: Use ComposeArea.addExternalFiles when Svelte component refs are wired
          const dropTarget = e.target as HTMLElement | null;
          const target: 'main' | 'thread' = dropTarget?.closest?.('#thread-panel') ? 'thread' : 'main';
          this.addPendingAttachments(files, target);
        }
      });
    }

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this._lightboxOpen) { this.closeLightbox(); return; }
        const autocomplete = document.getElementById('command-autocomplete') || document.getElementById('mention-autocomplete');
        if (autocomplete) { autocomplete.remove(); return; }
        const modal = document.querySelector('.modal-overlay');
        if (modal) { modal.remove(); return; }
        if (this.state.threadOpen) { this.closeThread(); return; }
      }

      // Ctrl/Cmd + K: focus compose
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const composeInput = document.getElementById('compose-input') as HTMLTextAreaElement;
        if (composeInput) {
          composeInput.focus();
          if (!composeInput.value) composeInput.value = '/';
        }
      }

      // Ctrl/Cmd + F: search messages
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        this.showSearchPanel();
      }

      // Ctrl/Cmd + Shift + M: toggle sidebar on mobile
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        const sidebar = document.getElementById('sidebar');
        sidebar?.classList.contains('open') ? this.closeMobileSidebar() : this.openMobileSidebar();
      }
    });
  }

  /**
   * Start a DM with a workspace member — reuses existing conversation if one exists,
   * otherwise creates a new one.
   */
  private startMemberDM(peerId: string): void {
    // Check if there's already a direct conversation with this peer
    const existing = this.cachedDirectConversations.find(c => c.contactPeerId === peerId);
    if (existing) {
      this.switchToDirectConversation(existing.id);
      return;
    }
    // Create new direct conversation
    this.callbacks.startDirectMessage?.(peerId).then(async conv => {
      await this.refreshContactsCache();
      this.switchToDirectConversation(conv.id);
    }).catch(() => this.showToast('Could not start DM', 'error'));
  }

  // Dead code removed: bindSidebarEvents(), bindSidebarActionEvents(), bindChannelHeaderEvents()
  // Migrated to: Sidebar.svelte, ChannelHeader.svelte
  // Dead code removed: bindHuddleEvents()
  // Migrated to: HuddleBar.svelte

  onHuddleStateChange(state: HuddleState, channelId: string | null): void {
    this.huddleState = state;
    this.huddleChannelId = channelId;
    this.mountHuddleBar();
    this.updateChannelHeader();
  }

  onHuddleParticipantsChange(participants: HuddleParticipant[]): void {
    this.huddleParticipants = participants;
    this.mountHuddleBar();
  }

  // =========================================================================
  // Modal helpers
  // =========================================================================

  toggleActivityPanel(): void {
    this.activityPanelOpen = !this.activityPanelOpen;
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    if (this.activityPanelOpen) {
      // Unmount Svelte sidebar before activity panel takes over
      if (this._sidebarComponent) {
        try { unmount(this._sidebarComponent); } catch {}
        this._sidebarComponent = null;
      }
      if (this._activityPanelComponent) {
        try { unmount(this._activityPanelComponent); } catch {}
        this._activityPanelComponent = null;
      }
      sidebar.innerHTML = '';

      this._activityPanelComponent = mount(ActivityPanel, {
        target: sidebar,
        props: {
          items: this.callbacks.getActivityItems?.() || [],
          getPeerAlias: (peerId: string) => this.getPeerAlias(peerId),
          onClose: () => this.toggleActivityPanel(),
          onMarkAllRead: () => {
            this.callbacks.markAllActivityRead?.();
            this.refreshActivityPanel();
            this.updateWorkspaceRail();
          },
          onMarkRead: (id: string) => this.callbacks.markActivityRead?.(id),
          onNavigate: (item: any) => {
            // Close activity panel and restore sidebar
            this.activityPanelOpen = false;
            this.mountSidebar(sidebar);
            document.getElementById('activity-btn')?.classList.remove('active');

            const needsChannelSwitch = item.channelId && item.channelId !== this.state.activeChannelId;
            const needsThreadOpen = !!(item.threadId && item.threadId.trim());
            const needsThreadSwitch = needsThreadOpen && (!this.state.threadOpen || this.state.activeThreadId !== item.threadId);

            if (needsChannelSwitch) this.switchChannel(item.channelId);

            if (needsThreadOpen && needsThreadSwitch) {
              const openDelay = needsChannelSwitch ? 50 : 0;
              setTimeout(() => {
                this.openThread(item.threadId!);
                if (item.messageId) setTimeout(() => this.scrollToMessageAndHighlight(item.messageId, 'thread-messages'), 100);
              }, openDelay);
            } else if (needsThreadOpen && !needsThreadSwitch) {
              if (item.messageId) this.scrollToMessageAndHighlight(item.messageId, 'thread-messages');
            } else if (item.messageId) {
              const scrollDelay = needsChannelSwitch ? 100 : 0;
              setTimeout(() => this.scrollToMessageAndHighlight(item.messageId, 'messages-list'), scrollDelay);
            }

            this.updateChannelHeader();
            this.updateWorkspaceRail();
          },
        },
      });
      document.getElementById('activity-btn')?.classList.add('active');
    } else {
      if (this._activityPanelComponent) {
        try { unmount(this._activityPanelComponent); } catch {}
        this._activityPanelComponent = null;
      }
      this.mountSidebar(sidebar);
      document.getElementById('activity-btn')?.classList.remove('active');
    }
  }

  /** Refresh activity panel content if open */
  refreshActivityPanel(): void {
    if (!this.activityPanelOpen) return;
    // Re-mount the Svelte activity panel with fresh data
    this.toggleActivityPanel(); // close
    this.toggleActivityPanel(); // re-open with fresh data
  }

  private showChannelMembersModal(): void {
    if (!this.state.activeWorkspaceId || !this.state.activeChannelId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    const channel = ws ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId) : null;
    if (!ws || !channel) return;

    const channelMembers = ws.members.filter(m => channel.members.includes(m.peerId));
    svelteShowChannelMembersModal({
      channelName: channel.name,
      members: channelMembers.map(member => ({
        peerId: member.peerId,
        name: this.getPeerAlias(member.peerId),
        isOnline: this.state.connectedPeers.has(member.peerId) || member.peerId === this.state.myPeerId,
        isYou: member.peerId === this.state.myPeerId,
        isBot: !!(member as any).isBot,
        color: this.peerColor(member.peerId),
      })),
    });
  }

  private showWorkspaceMembersModal(): void {
    if (!this.state.activeWorkspaceId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    if (!ws) return;

    const myMember = ws.members.find(m => m.peerId === this.state.myPeerId);
    const myRole = myMember?.role || 'member';
    const isOwner = myRole === 'owner' || ws.createdBy === this.state.myPeerId || this.workspaceManager.isOwner(ws.id, this.state.myPeerId);
    const isAdminOrOwner = isOwner || myRole === 'admin' || this.workspaceManager.isAdmin(ws.id, this.state.myPeerId);

    svelteShowWorkspaceMembersModal({
      members: ws.members.map(member => ({
        peerId: member.peerId,
        name: this.getPeerAlias(member.peerId),
        role: member.role,
        isBot: !!member.isBot,
        isOnline: this.state.connectedPeers.has(member.peerId) || member.peerId === this.state.myPeerId,
        isYou: member.peerId === this.state.myPeerId,
        color: member.isBot ? '#7c3aed' : this.peerColor(member.peerId),
      })),
      isOwner,
      isAdminOrOwner,
      onRemove: async (peerId: string) => {
        if (!this.callbacks.removeWorkspaceMember) return { success: false, error: 'Not available' };
        return this.callbacks.removeWorkspaceMember(peerId);
      },
      onPromote: async (peerId: string) => {
        if (!this.callbacks.promoteMember) return { success: false, error: 'Not available' };
        return this.callbacks.promoteMember(peerId, 'admin');
      },
      onDemote: async (peerId: string) => {
        if (!this.callbacks.demoteMember) return { success: false, error: 'Not available' };
        return this.callbacks.demoteMember(peerId);
      },
      onToast: (msg: string, type?: string) => this.showToast(msg, type as any),
      onRefresh: () => { this.updateSidebar(); this.updateChannelHeader(); },
    });
  }

  private showWorkspaceSettingsModal(): void {
    if (!this.state.activeWorkspaceId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    if (!ws) return;

    const isOwner = this.workspaceManager.isOwner(ws.id, this.state.myPeerId);
    const perms = ws.permissions ?? { whoCanCreateChannels: 'everyone', whoCanInviteMembers: 'everyone' };

    svelteShowWorkspaceSettingsModal({
      name: ws.name,
      description: ws.description || '',
      isOwner,
      permissions: { whoCanCreateChannels: perms.whoCanCreateChannels, whoCanInviteMembers: perms.whoCanInviteMembers },
      onSave: async (data: { name: string; description: string; whoCanCreateChannels: string; whoCanInviteMembers: string }) => {
        if (data.name !== ws.name || data.description !== (ws.description || '')) {
          const infoRes = await this.callbacks.updateWorkspaceInfo?.({ name: data.name, description: data.description });
          if (infoRes && !infoRes.success) {
            this.showToast(infoRes.error || 'Failed to update workspace info', 'error');
            return false;
          }
        }
        if (data.whoCanCreateChannels !== perms.whoCanCreateChannels || data.whoCanInviteMembers !== perms.whoCanInviteMembers) {
          const permRes = await this.callbacks.updateWorkspacePermissions?.({ whoCanCreateChannels: data.whoCanCreateChannels, whoCanInviteMembers: data.whoCanInviteMembers });
          if (permRes && !permRes.success) {
            this.showToast(permRes.error || 'Failed to update permissions', 'error');
            return false;
          }
        }
        this.showToast('Workspace settings saved', 'success');
        this.updateSidebar();
        this.updateChannelHeader();
        return true;
      },
      onManageMembers: () => this.showWorkspaceMembersModal(),
      onDelete: async () => {
        const result = await this.callbacks.deleteWorkspace?.(ws.id);
        if (result) {
          this.showToast('Workspace deleted', 'success');
          this.state.activeWorkspaceId = null;
          this.state.activeChannelId = null;
          (this as any).renderApp?.() ?? this.updateSidebar();
        } else {
          this.showToast('Failed to delete workspace', 'error');
        }
      },
      onToast: (msg: string, type?: string) => this.showToast(msg, type as any),
    });
  }

  showModal(
    title: string,
    bodyHTML: string,
    onSubmit: (form: HTMLFormElement) => boolean | void | Promise<boolean | void>,
  ): HTMLDivElement {
    return svelteShowModal(title, bodyHTML, onSubmit);
  }

  showCreateWorkspaceModal(): void {
    this.showModal(
      'Create Workspace',
      `
      <div class="form-group">
        <label>Workspace Name</label>
        <input type="text" name="name" placeholder="My Team" required />
      </div>
      <div class="form-group">
        <label>Your Display Name</label>
        <input type="text" name="alias" placeholder="Your name" required />
      </div>
    `,
      (form) => {
        const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        if (!name || !alias) return;

        this.state.myAlias = alias;
        const ws = this.callbacks.createWorkspace(name, alias);
        this.state.activeWorkspaceId = ws.id;
        this.state.activeChannelId = ws.channels[0]?.id || null;
        // Persist in background — both must complete before data is safe
        Promise.all([
          this.callbacks.persistWorkspace(ws.id),
          this.callbacks.persistSetting('myAlias', alias),
        ]).catch(err => console.error('[DecentChat] Failed to persist workspace:', err));
        this.renderApp();
        this.showToast(`Workspace "${name}" created! Click 🔗 to copy invite link.`, 'success');
      },
    );
  }

  /** Show join modal pre-filled from an invite URL */
  showJoinWithInvite(inviteCode: string, peerId: string, workspaceName: string, inviteData?: import('decent-protocol').InviteData): void {
    this.showModal(
      `Join ${workspaceName || 'Workspace'}`,
      `
      <input type="hidden" name="peerId" value="${peerId}" />
      ${workspaceName ? `<p style="color: var(--text-muted); margin-bottom: 16px; font-size: 15px;">You've been invited to <strong>${this.escapeHtml(workspaceName)}</strong></p>` : ''}
      <div class="form-group">
        <label>Your Display Name</label>
        <input type="text" name="alias" placeholder="Enter your name" required autofocus />
      </div>
    `,
      (form) => {
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        if (!alias) return;

        this.state.myAlias = alias;
        this.callbacks.persistSetting('myAlias', alias);
        this.callbacks.joinWorkspace(workspaceName || inviteCode, alias, peerId, inviteData);
        this.showToast(`Joining ${workspaceName || 'workspace'}...`);
      },
    );
  }

  private parseJoinInviteInput(invite: string): { code: string; peerId?: string; inviteData?: import('decent-protocol').InviteData; error?: string } {
    if (invite.includes('://') || invite.includes('/')) {
      try {
        const data = InviteURI.decode(invite);

        // Auto-connect to signaling server from invite
        if (data.host && data.port) {
          console.log(`[DecentChat] Invite points to signaling: ${data.host}:${data.port}`);
        }

        return {
          code: data.inviteCode,
          peerId: data.peerId,
          inviteData: data,
        };
      } catch {
        return { code: '', error: 'Invalid invite link' };
      }
    }

    // Plain invite code — need a peer ID
    return { code: invite.toUpperCase() };
  }

  // updateWorkspacePreview() — removed (migrated to JoinWorkspaceModal.svelte)

  showJoinWorkspaceModal(): void {
    svelteShowJoinWorkspaceModal({
      parseInvite: (invite: string) => this.parseJoinInviteInput(invite),
      onJoin: (wsName: string, alias: string, peerId: string, inviteData?: any) => {
        this.state.myAlias = alias;
        this.callbacks.persistSetting('myAlias', alias);
        this.callbacks.joinWorkspace(wsName, alias, peerId, inviteData);
        this.showToast(`Joining workspace... connecting to ${peerId.slice(0, 8)}`);
      },
      onToast: (msg: string, type?: string) => this.showToast(msg, type as any),
    });
  }

  showConnectPeerModal(): void {
    this.showModal(
      'Connect to Peer',
      `
      <div class="form-group">
        <label>Peer ID</label>
        <input type="text" name="peerId" placeholder="Enter peer ID" required />
      </div>
    `,
      (form) => {
        const peerId = (form.elements.namedItem('peerId') as HTMLInputElement).value.trim();
        if (peerId) {
          this.callbacks.connectPeer(peerId);
          this.showToast(`Connecting to ${peerId.slice(0, 8)}...`);
        }
      },
    );
  }

  showCreateChannelModal(): void {
    if (!this.state.activeWorkspaceId) return;

    this.showModal(
      'Create Channel',
      `
      <div class="form-group">
        <label>Channel Name</label>
        <input type="text" name="name" placeholder="e.g. random, dev, design" required />
      </div>
    `,
      (form) => {
        const name = (form.elements.namedItem('name') as HTMLInputElement).value
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-');
        if (!name) return;

        const result = this.callbacks.createChannel(name);
        if (result.success && result.channel) {
          this.callbacks.persistWorkspace(this.state.activeWorkspaceId!);
          this.switchChannel(result.channel.id);
          this.updateSidebar();
          this.showToast(`#${name} created!`, 'success');
        } else {
          this.showToast(result.error || 'Failed to create channel', 'error');
        }
      },
    );
  }

  showCreateDMModal(): void {
    if (!this.state.activeWorkspaceId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)!;
    const otherMembers = ws.members.filter(
      (m: import('decent-protocol').WorkspaceMember) => m.peerId !== this.state.myPeerId,
    );

    if (otherMembers.length === 0) {
      this.showToast('No other members in workspace yet. Invite someone first!', 'error');
      return;
    }

    showPeerSelectModal({
      title: 'New Direct Message',
      label: 'Select a member',
      peers: otherMembers.map(m => ({
        peerId: m.peerId,
        name: m.alias,
        statusClass: this.peerStatusClass(m.peerId),
        statusTitle: this.peerStatusTitle(m.peerId),
      })),
      onSelect: (peerId: string) => {
        const result = this.callbacks.createDM(peerId);
        if (result.success && result.channel) {
          this.switchChannel(result.channel.id);
          this.updateSidebar();
        }
      },
    });
  }

  // =========================================================================
  // Contact modals
  // =========================================================================

  showAddContactModal(): void {
    svelteShowAddContactModal({
      onAdd: async (contact) => {
        await this.callbacks.addContact?.(contact);
        await this.refreshContactsCache();
        this.updateSidebar();
      },
      onToast: (msg: string, type?: string) => this.showToast(msg, type as any),
    });
  }

  showStartDirectMessageModal(): void {
    if (this.cachedContacts.length === 0) {
      this.showToast('Add a contact first to start a DM', 'error');
      return;
    }

    showPeerSelectModal({
      title: 'Start Direct Message',
      label: 'Select a contact',
      peers: this.cachedContacts.map(c => ({
        peerId: c.peerId,
        name: c.displayName,
        statusClass: this.peerStatusClass(c.peerId),
        statusTitle: this.peerStatusTitle(c.peerId),
      })),
      onSelect: (peerId: string) => {
        this.callbacks.startDirectMessage?.(peerId).then(async (conv) => {
          await this.refreshContactsCache();
          this.switchToDirectConversation(conv.id);
        });
      },
    });
  }

  // =========================================================================
  // Toast notifications
  // =========================================================================

  showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    toast(message, type);
  }

  // =========================================================================
  // Utility helpers
  // =========================================================================

  // upgradeInlineImagePreviews() — removed (dead code, image upgrade handled in MessageItem)

  /** Bridge for drag-drop: dispatch files to the Svelte ComposeArea */
  private addPendingAttachments(files: File[], target: 'main' | 'thread'): void {
    // Dispatch files into the Svelte ComposeArea by synthesizing a paste event on the target input
    const inputId = target === 'thread' ? 'thread-input' : 'compose-input';
    const inputEl = document.getElementById(inputId) as HTMLTextAreaElement | null;
    if (!inputEl) return;

    // Use internal method: set up files via the file input
    const fileInputId = target === 'thread' ? 'thread-file-input' : 'file-input';
    const fileInput = document.getElementById(fileInputId) as HTMLInputElement | null;
    if (fileInput) {
      const dt = new DataTransfer();
      for (const file of files) dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /** Show search panel */
  showSearchPanel(): void {
    const container = document.getElementById('search-mount');
    if (!container) return;

    // Toggle: if already open, close it
    if (this._searchPanelComponent) {
      try { unmount(this._searchPanelComponent); } catch {}
      this._searchPanelComponent = null;
      container.innerHTML = '';
      return;
    }

    this._searchPanelComponent = mount(SearchPanel, {
      target: container,
      props: {
        myPeerId: this.state.myPeerId,
        myAlias: this.state.myAlias || 'You',
        onSearch: (query: string) => {
          return this.messageSearch.search(query, {
            channelId: this.state.activeChannelId || undefined,
            limit: 20,
          });
        },
        onScrollToMessage: (messageId: string) => this.scrollToMessageAndHighlight(messageId),
        onClose: () => {
          if (this._searchPanelComponent) {
            try { unmount(this._searchPanelComponent); } catch {}
            this._searchPanelComponent = null;
          }
          container.innerHTML = '';
        },
      },
    });
  }

  /** Show QR code with user's identity */
  showMyQR(): void {
    const publicKey = this.callbacks.getMyPublicKey?.();
    if (!publicKey) {
      this.showToast('Public key not available yet', 'error');
      return;
    }
    this.qrCodeManager.showMyQR({
      publicKey,
      displayName: this.state.myAlias || this.state.myPeerId.slice(0, 8),
      peerId: this.state.myPeerId,
    });
  }

  /** Show QR scanner to add a contact */
  showScanQR(): void {
    this.qrCodeManager.showScanQR();
  }

  /** Show settings panel */
  showSettings(): void {
    const wsId = this.state.activeWorkspaceId;
    this.settingsPanel = new SettingsPanel(
      async () => ({
        ...await (this.callbacks.getSettings?.() || {}),
        myPeerId: this.state.myPeerId,
        myAlias: this.state.myAlias,
        activeWorkspaceId: wsId,
        workspaceAlias: wsId ? (this.state.workspaceAliases?.[wsId] || '') : '',
      }),
      async (key, value) => {
        if (key === 'workspaceAlias' && wsId) {
          this.callbacks.setWorkspaceAlias?.(wsId, value as string);
          return;
        }
        if (key === 'myAlias' && typeof value === 'string' && value.trim()) {
          this.state.myAlias = value.trim();
        }
        await this.callbacks.persistSetting(key, value);
        if (key === 'showLiveReconnectActivity') {
          this.updateSidebar();
        }
      },
      async (action) => {
        if (action === 'generateSeed') {
          await this.callbacks.onSettingsAction?.(action);
        } else if (action === 'seed-transfer') {
          const seed = await this.callbacks.getCurrentSeed?.();
          if (seed) {
            this.qrCodeManager.showSeedQR(seed);
          } else {
            this.showToast('No seed phrase found — generate one in Settings first', 'error');
          }
        }
      },
    );
    void this.settingsPanel.show();
  }

  /** Update typing indicator display */
  updateTypingIndicator(text: string): void {
    const el = document.getElementById('typing-indicator');
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  /** Get placeholder text for compose input */
  private getComposePlaceholder(): string {
    if (this.state.activeDirectConversationId) {
      const conv = this.cachedDirectConversations.find(c => c.id === this.state.activeDirectConversationId);
      return conv ? `Message ${this.getPeerAlias(conv.contactPeerId)}` : 'Message contact';
    }
    if (!this.state.activeChannelId || !this.state.activeWorkspaceId) {
      return 'Message...';
    }
    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    const channel = ws ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId) : null;
    if (channel?.type === 'dm') return `Message ${channel.name}`;
    return `Message #${channel?.name || 'general'}`;
  }

  // handleMentionAutocomplete() — removed (migrated to ComposeArea.svelte)
  // handleCommandAutocomplete() — removed (migrated to ComposeArea.svelte)

  private openLightbox(src: string, name: string): void {
    if (this.lightboxBlobUrl) {
      URL.revokeObjectURL(this.lightboxBlobUrl);
      this.lightboxBlobUrl = null;
    }
    this._lightboxOpen = true;
    this._lightboxSrc = src;
    this._lightboxName = name;
    this.mountLightbox();
  }

  private closeLightbox(): void {
    this._lightboxOpen = false;
    this._lightboxSrc = '';
    this._lightboxName = '';
    if (this.lightboxBlobUrl) {
      URL.revokeObjectURL(this.lightboxBlobUrl);
      this.lightboxBlobUrl = null;
    }
    this.mountLightbox();
  }

  // renderAttachments() — removed (migrated to MessageItem.svelte)
  // formatFileSize() — removed (migrated to $lib/utils/format.ts)

  peerColor(peerId: string): string {
    return peerColorUtil(peerId);
  }

  escapeHtml(text: string): string {
    return escapeHtmlUtil(text);
  }

  /** 3-state presence CSS class: 'online' | 'connecting' | '' */
  private peerStatusClass(peerId: string): string {
    if (this.state.readyPeers.has(peerId)) return 'online';
    if (this.state.connectingPeers.has(peerId)) return 'connecting';
    return '';
  }

  /** Tooltip text for the presence dot */
  private peerStatusTitle(peerId: string): string {
    if (this.state.readyPeers.has(peerId)) return 'Online';
    if (this.state.connectingPeers.has(peerId)) return 'Connecting...';
    return 'Offline';
  }

  private getPeerAlias(peerId: string): string {
    // Use controller callback if available — checks contacts + ALL workspace members
    if (this.callbacks.getDisplayNameForPeer) {
      return this.callbacks.getDisplayNameForPeer(peerId);
    }

    // Fallback: cached contacts then active workspace
    const contact = this.cachedContacts.find(c => c.peerId === peerId);
    if (contact) return contact.displayName;
    if (this.state.activeWorkspaceId) {
      const member = this.workspaceManager.getMember(this.state.activeWorkspaceId, peerId);
      if (member?.alias) return member.alias;
    }
    return peerId.slice(0, 8);
  }
}
