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
import { QUICK_REACTIONS } from './ReactionManager';
import { ContactURI, InviteURI } from 'decent-protocol';
import type { PlaintextMessage, Contact, ContactURIData, DirectConversation } from 'decent-protocol';
import { toast } from '../lib/components/shared/Toast.svelte';
import { showModal as svelteShowModal } from '../lib/components/shared/Modal.svelte';
import { showEmojiPicker } from '../lib/components/shared/EmojiPicker.svelte';
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
  private _boundDropHandler: ((e: Event) => void) | null = null;
  private lightboxBlobUrl: string | null = null;
  private activityPanelOpen = false;

  /**
   * Scroll-lock state for streaming messages.
   * When user intentionally scrolls up during an active stream, we stop
   * auto-scrolling until they scroll back to bottom or the stream ends.
   */
  private _userScrolledAway = false;
  private _programmaticScroll = false;
  private _scrollListenerBound = false;
  private frequentReactions: string[] = [];
  private reactionUsage: Record<string, number> = {};

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
    this.reactionUsage = this.loadReactionUsage();
    this.frequentReactions = this.loadFrequentReactions();
  }

  private tracePrefix(): string {
    const alias = (this.state.myAlias || '').trim();
    if (/^alice$/i.test(alias)) return '[TRACE Alice]';
    if (/^bob$/i.test(alias)) return '[TRACE Bob]';
    return `[TRACE ${alias || this.state.myPeerId.slice(0, 8)}]`;
  }

  private frequentReactionsKey(): string {
    return `decentchat:frequentReactions:${this.state.myPeerId || 'anon'}`;
  }

  private reactionUsageKey(): string {
    return `decentchat:reactionUsage:${this.state.myPeerId || 'anon'}`;
  }

  /** Reload reaction usage from localStorage (call after myPeerId is set) */
  reloadReactionUsage(): void {
    this.reactionUsage = this.loadReactionUsage();
    this.frequentReactions = this.loadFrequentReactions();
  }

  private loadReactionUsage(): Record<string, number> {
    try {
      const raw = localStorage.getItem(this.reactionUsageKey());
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const normalized: Record<string, number> = {};
        for (const [emoji, count] of Object.entries(parsed || {})) {
          if (typeof emoji === 'string' && emoji.length > 0 && typeof count === 'number' && count > 0) {
            normalized[emoji] = Math.floor(count);
          }
        }
        return normalized;
      }
    } catch {}
    return {};
  }

  private saveReactionUsage(): void {
    try {
      localStorage.setItem(this.reactionUsageKey(), JSON.stringify(this.reactionUsage));
    } catch {}
  }

  private loadFrequentReactions(): string[] {
    // Primary: derive from usage counts (true "frequently used").
    const fromUsage = Object.entries(this.reactionUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji]) => emoji);
    if (fromUsage.length > 0) {
      for (const fallback of QUICK_REACTIONS) {
        if (!fromUsage.includes(fallback)) fromUsage.push(fallback);
        if (fromUsage.length >= 3) break;
      }
      return fromUsage.slice(0, 3);
    }

    // Backward compatibility: old list-only storage.
    try {
      const raw = localStorage.getItem(this.frequentReactionsKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const normalized = parsed.filter((e) => typeof e === 'string' && e.length > 0);
          if (normalized.length > 0) {
            return normalized.slice(0, 3);
          }
        }
      }
    } catch {}

    return QUICK_REACTIONS.slice(0, 3);
  }

  private saveFrequentReactions(): void {
    try {
      localStorage.setItem(this.frequentReactionsKey(), JSON.stringify(this.frequentReactions.slice(0, 3)));
    } catch {}
  }

  private rememberReaction(emoji: string): void {
    if (!emoji) return;

    this.reactionUsage[emoji] = (this.reactionUsage[emoji] || 0) + 1;
    this.saveReactionUsage();

    const ranked = Object.entries(this.reactionUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([e]) => e);

    for (const fallback of [...this.frequentReactions, ...QUICK_REACTIONS]) {
      if (!ranked.includes(fallback)) ranked.push(fallback);
      if (ranked.length >= 3) break;
    }

    this.frequentReactions = ranked.slice(0, 3);

    this.saveFrequentReactions();
    this.refreshQuickReactionButtons();
  }

  private refreshQuickReactionButtons(): void {
    const frequent = this.getFrequentReactions();
    document.querySelectorAll('.message-actions-bar').forEach((barEl) => {
      const bar = barEl as HTMLElement;
      const addBtn = bar.querySelector('.quick-react-add') as HTMLElement | null;
      const msgId = addBtn?.dataset.msgId;
      if (!addBtn || !msgId) return;

      bar.querySelectorAll('.quick-react').forEach((btn) => btn.remove());

      for (const emoji of frequent) {
        const btn = document.createElement('button');
        btn.className = 'quick-react';
        btn.dataset.msgId = msgId;
        btn.dataset.emoji = emoji;
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
          this.rememberReaction(emoji);
          this.callbacks.toggleReaction?.(msgId, emoji);
        });
        bar.insertBefore(btn, addBtn);
      }
    });
  }

  private getFrequentReactions(): string[] {
    if (!this.frequentReactions.length) {
      this.frequentReactions = this.loadFrequentReactions();
    }
    return this.frequentReactions.slice(0, 3);
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

  /**
   * Return true when a scroll container is at (or near) the bottom.
   */
  private isNearBottom(container: HTMLElement, thresholdPx = 80): boolean {
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= thresholdPx;
  }

  /** Programmatic scroll that won't trigger the user-scroll-away detector. */
  private scrollToBottom(container: HTMLElement): void {
    this._programmaticScroll = true;
    container.scrollTop = container.scrollHeight;
    // Clear flag after the scroll event fires (microtask timing).
    requestAnimationFrame(() => { this._programmaticScroll = false; });
  }

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

  /**
   * Bind a one-time scroll listener on the messages container that detects
   * when the user intentionally scrolls away from the bottom during streaming.
   * Re-entering the bottom zone clears the flag so auto-scroll resumes.
   */
  private ensureScrollListener(): void {
    if (this._scrollListenerBound) return;
    const list = document.getElementById('messages-list');
    if (!list) return;
    this._scrollListenerBound = true;
    list.addEventListener('scroll', () => {
      if (this._programmaticScroll) return; // ignore our own scrolls
      if (this.isNearBottom(list, 80)) {
        this._userScrolledAway = false;
      } else {
        this._userScrolledAway = true;
      }
    }, { passive: true });
  }

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
   * DEP-005: Update the delivery status tick on a sent message without re-rendering everything.
   * Called when an ACK arrives from the recipient.
   */
  updateMessageStatus(
    messageId: string,
    status: 'pending' | 'sent' | 'delivered' | 'read',
    detail?: { acked?: number; total?: number; read?: number },
  ): void {
    const el = document.querySelector(`.msg-delivery-status[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (!el) return;
    el.className = `msg-delivery-status ${status}`;

    const acked = detail?.acked;
    const read = detail?.read;
    const total = detail?.total;
    const hasCounts = typeof total === 'number' && total > 0;

    el.title = status === 'read'
      ? (hasCounts ? `Read (${read ?? 0}/${total})` : 'Read')
      : status === 'delivered'
        ? (hasCounts ? `Delivered (${acked ?? 0}/${total})` : 'Delivered')
        : status === 'sent'
          ? (hasCounts ? `Sent (${acked ?? 0}/${total} delivered)` : 'Sent')
          : 'Sending…';

    el.textContent = status === 'read' ? '✓✓' : status === 'delivered' ? '✓✓' : status === 'sent' ? '✓' : '⏳';

    const detailEl = document.querySelector(`.msg-delivery-detail[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (hasCounts) {
      const value = status === 'read' ? (read ?? 0) : (acked ?? 0);
      if (detailEl) {
        detailEl.textContent = `${value}/${total}`;
      } else if (el.parentElement) {
        const span = document.createElement('span');
        span.className = 'msg-delivery-detail';
        span.dataset.messageId = messageId;
        span.textContent = `${value}/${total}`;
        el.insertAdjacentElement('afterend', span);
      }
    } else if (detailEl) {
      detailEl.remove();
    }
  }

  private showMessageInfo(messageId: string): void {
    const info = this.callbacks.getMessageReceiptInfo?.(messageId);
    if (!info) {
      this.showToast('Message info unavailable', 'error');
      return;
    }

    const fmt = (ts?: number) => ts ? new Date(ts).toLocaleString([], { hour12: false }) : '—';
    const renderList = (title: string, items: Array<{ peerId: string; name: string; at?: number }>) => `
      <div class="message-info-section">
        <div class="message-info-title">${title} <span class="message-info-count">(${items.length})</span></div>
        ${items.length > 0
          ? `<ul class="message-info-list">${items.map((u) => `<li><span class="name">${this.escapeHtml(u.name)}</span> <span class="peer">${this.escapeHtml(u.peerId.slice(0, 8))}</span> <span class="at">${this.escapeHtml(fmt(u.at))}</span></li>`).join('')}</ul>`
          : '<div class="message-info-empty">—</div>'}
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay message-info-overlay';
    overlay.innerHTML = `
      <div class="modal message-info-modal">
        <h3>Message Info</h3>
        ${renderList('Read by', info.read)}
        ${renderList('Delivered to', info.delivered)}
        ${renderList('Pending', info.pending)}
        <div class="message-info-actions">
          <button id="message-info-close" class="btn-secondary">Close</button>
        </div>
      </div>
    `;

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('#message-info-close')?.addEventListener('click', close);
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(overlay);
  }

  updateStreamingMessage(messageId: string, content: string): void {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (!msgEl) return;

    this.ensureScrollListener();

    const contentEl = msgEl.querySelector('.message-content') as HTMLElement | null;
    if (!contentEl) return;
    contentEl.innerHTML = renderMarkdown(content + ' ▋');
    msgEl.classList.add('streaming');

    // Only auto-scroll if user hasn't intentionally scrolled away
    // AND we're actually near the bottom (double-guard against missed events).
    if (!this._userScrolledAway) {
      const container = msgEl.closest('.message-list, #thread-messages, #messages-list') as HTMLElement | null;
      if (container && this.isNearBottom(container)) this.scrollToBottom(container);
    }
  }

  finalizeStreamingMessage(messageId: string): void {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (!msgEl) return;
    const contentEl = msgEl.querySelector('.message-content') as HTMLElement | null;
    if (!contentEl) return;
    // Get the raw text from the stored message (not from DOM which has HTML)
    const activeChannelId = this.state.activeChannelId;
    let finalText = '';
    if (activeChannelId) {
      const msg = this.messageStore.getMessages(activeChannelId).find((m: PlaintextMessage) => m.id === messageId);
      finalText = msg?.content ?? '';
    }
    if (!finalText) {
      finalText = (contentEl.textContent ?? '').replace(/ ▋$/, '');
    }
    contentEl.innerHTML = renderMarkdown(finalText);

    if (activeChannelId) {
      const msg = this.messageStore.getMessages(activeChannelId).find((m: PlaintextMessage) => m.id === messageId);
      if (msg) {
        msg.content = finalText;
        (msg as any).streaming = false;
      }
    }

    msgEl.classList.remove('streaming');
    // Reset scroll-lock so next message/stream auto-scrolls normally.
    this._userScrolledAway = false;
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
   */
  updateThreadIndicator(parentMessageId: string, channelId: string): void {
    const parentDiv = document.querySelector(`[data-message-id="${parentMessageId}"]`);
    if (!parentDiv) return;

    const replies = this.messageStore.getThread(channelId, parentMessageId);
    const indicator = parentDiv.querySelector('.message-thread-indicator') as HTMLElement | null;

    if (indicator) {
      if (replies.length > 0) {
        indicator.classList.add('has-replies');
        indicator.innerHTML = this.renderThreadIndicatorContent(replies);
      } else {
        indicator.classList.remove('has-replies');
        indicator.innerHTML = '';
      }
    }
  }

  /**
   * Render the Slack-style thread indicator content (avatars + reply count + last reply time).
   */
  private renderThreadIndicatorContent(replies: import('decent-protocol').PlaintextMessage[]): string {
    const count = replies.length;
    if (count === 0) return '';

    // Unique senders (up to 4 avatars)
    const seen = new Set<string>();
    const uniqueSenders: string[] = [];
    for (const r of replies) {
      if (!seen.has(r.senderId)) {
        seen.add(r.senderId);
        uniqueSenders.push(r.senderId);
        if (uniqueSenders.length >= 4) break;
      }
    }

    const avatarsHTML = uniqueSenders.map(peerId => {
      const name = this.getPeerAlias(peerId);
      const initials = name.slice(0, 2).toUpperCase();
      const color = this.peerColor(peerId);
      return `<span class="thread-indicator-avatar" style="background:${color}" title="${this.escapeHtml(name)}">${this.escapeHtml(initials)}</span>`;
    }).join('');

    // Last reply relative time
    const lastReply = replies[replies.length - 1];
    const relTime = this.relativeTime(lastReply.timestamp);

    return `
      <span class="thread-indicator-avatars">${avatarsHTML}</span>
      <span class="thread-indicator-count">${count} ${count === 1 ? 'reply' : 'replies'}</span>
      <span class="thread-indicator-time">${relTime}</span>
    `;
  }

  /** Format a timestamp as a short relative time string */
  private relativeTime(ts: number): string {
    const diffMs = Date.now() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  }

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

    const membersHTML = channelMembers.map(member => {
      const { peerId } = member;
      const name = this.getPeerAlias(peerId);
      const initial = name.charAt(0).toUpperCase();
      const color = this.peerColor(peerId);
      const isYou = peerId === this.state.myPeerId;
      const isOnline = this.state.connectedPeers.has(peerId) || isYou;

      const isBot = !!(member as any).isBot;
      return `
        <div class="member-row">
          <div class="member-info">
            <div class="member-avatar${isBot ? ' bot-avatar' : ''}" style="background:${color}">${isBot ? '🤖' : this.escapeHtml(initial)}</div>
            <div class="member-details">
              <div class="member-name-line">
                <span class="member-name">${this.escapeHtml(name)}</span>
                ${isYou ? '<span class="you-badge">you</span>' : ''}
              </div>
              <span class="member-status ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    this.showModal(
      `Channel Members · #${this.escapeHtml(channel.name)}`,
      `
      <div class="form-group" style="margin-bottom: 8px;">
        <div style="font-size: 13px; color: var(--text-muted);">${channelMembers.length} member${channelMembers.length === 1 ? '' : 's'}</div>
      </div>
      <div class="members-list">
        ${membersHTML}
      </div>
    `,
      () => true,
    );
  }

  private showWorkspaceMembersModal(): void {
    if (!this.state.activeWorkspaceId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    if (!ws) return;

    const myMember = ws.members.find(m => m.peerId === this.state.myPeerId);
    const myRole = myMember?.role || 'member';
    const isOwner = myRole === 'owner' || ws.createdBy === this.state.myPeerId || this.workspaceManager.isOwner(ws.id, this.state.myPeerId);
    const isAdminOrOwner = isOwner || myRole === 'admin' || this.workspaceManager.isAdmin(ws.id, this.state.myPeerId);

    const roleBadge = (role: string, isBot?: boolean) => {
      const badge = role === 'owner' ? '<span class="role-badge role-owner" title="Owner">Owner</span>'
        : role === 'admin' ? '<span class="role-badge role-admin" title="Admin">Admin</span>' : '';
      const botBadge = isBot ? '<span class="role-badge role-bot" title="Bot">BOT</span>' : '';
      return botBadge + badge;
    };

    const membersHTML = ws.members.map(member => {
      const { peerId, role, isBot } = member;
      const name = this.getPeerAlias(peerId);
      const initial = name.charAt(0).toUpperCase();
      const color = isBot ? '#7c3aed' : this.peerColor(peerId);
      const isYou = peerId === this.state.myPeerId;
      const isOnline = this.state.connectedPeers.has(peerId) || isYou;
      const canRemove = isAdminOrOwner && !isYou && role !== 'owner';
      const canPromote = isOwner && !isYou && role === 'member';
      const canDemote = isOwner && !isYou && role === 'admin';

      let actionButtons = '';
      if (canPromote) actionButtons += `<button type="button" class="btn-action promote-btn" data-peer-id="${peerId}" title="Promote to Admin">Promote</button>`;
      if (canDemote) actionButtons += `<button type="button" class="btn-action demote-btn" data-peer-id="${peerId}" title="Demote to Member">Demote</button>`;
      if (canRemove) actionButtons += `<button type="button" class="btn-action btn-danger remove-member-btn" data-remove-peer-id="${peerId}" title="Remove from workspace">Remove</button>`;

      return `
        <div class="member-row">
          <div class="member-info">
            <div class="member-avatar${isBot ? ' bot-avatar' : ''}" style="background:${color}">${isBot ? '🤖' : this.escapeHtml(initial)}</div>
            <div class="member-details">
              <div class="member-name-line">
                <span class="member-name">${this.escapeHtml(name)}</span>
                ${roleBadge(role, isBot)}
                ${isYou ? '<span class="you-badge">you</span>' : ''}
              </div>
              <span class="member-status ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span>
            </div>
          </div>
          <div class="member-actions">${actionButtons}</div>
        </div>
      `;
    }).join('');

    this.showModal(
      `Workspace Members`,
      `
      <div class="form-group" style="margin-bottom: 8px;">
        <div id="members-count-label" style="font-size: 13px; color: var(--text-muted);">${ws.members.length} member${ws.members.length === 1 ? '' : 's'}</div>
      </div>
      <div class="members-list">${membersHTML}</div>
    `,
      () => true,
    );

    const overlay = document.querySelector('.modal-overlay:last-of-type') as HTMLElement | null;

    overlay?.querySelectorAll('.remove-member-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const peerId = (e.currentTarget as HTMLElement).getAttribute('data-remove-peer-id');
        if (!peerId || !this.callbacks.removeWorkspaceMember) return;
        if (!confirm(`Remove ${this.getPeerAlias(peerId)} from workspace?`)) return;

        const res = await this.callbacks.removeWorkspaceMember(peerId);
        if (!res.success) return this.showToast(res.error || 'Failed to remove member', 'error');

        // Keep dialog experience open by immediately re-rendering members modal.
        overlay.remove();
        this.showWorkspaceMembersModal();

        this.showToast('Member removed', 'success');
        this.updateSidebar();
        this.updateChannelHeader();
      });
    });

    overlay?.querySelectorAll('.promote-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const peerId = (e.currentTarget as HTMLElement).getAttribute('data-peer-id');
        if (!peerId || !this.callbacks.promoteMember) return;

        const res = await this.callbacks.promoteMember(peerId, 'admin');
        if (!res.success) return this.showToast(res.error || 'Failed to promote member', 'error');

        overlay.remove();
        this.showToast(`${this.getPeerAlias(peerId)} promoted to Admin`, 'success');
        this.updateSidebar();
        this.updateChannelHeader();
      });
    });

    overlay?.querySelectorAll('.demote-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const peerId = (e.currentTarget as HTMLElement).getAttribute('data-peer-id');
        if (!peerId || !this.callbacks.demoteMember) return;

        const res = await this.callbacks.demoteMember(peerId);
        if (!res.success) return this.showToast(res.error || 'Failed to demote member', 'error');

        overlay.remove();
        this.showToast(`${this.getPeerAlias(peerId)} demoted to Member`, 'success');
        this.updateSidebar();
        this.updateChannelHeader();
      });
    });
  }

  private showWorkspaceSettingsModal(): void {
    if (!this.state.activeWorkspaceId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    if (!ws) return;

    const isOwner = this.workspaceManager.isOwner(ws.id, this.state.myPeerId);
    const perms = ws.permissions ?? { whoCanCreateChannels: 'everyone', whoCanInviteMembers: 'everyone' };

    const deleteSection = isOwner ? `
      <div class="form-group" style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
        <button type="button" class="btn-danger" id="delete-workspace-btn" style="width:100%;">Delete Workspace</button>
      </div>
    ` : '';

    this.showModal(
      'Workspace Settings',
      `
      <div class="form-group">
        <label>Workspace Name</label>
        <input type="text" name="ws-name" value="${this.escapeHtml(ws.name)}" required />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea name="ws-description" rows="2" placeholder="What's this workspace about?">${this.escapeHtml(ws.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label>Who can create channels?</label>
        <select name="ws-create-channels" class="modal-select">
          <option value="everyone" ${perms.whoCanCreateChannels === 'everyone' ? 'selected' : ''}>Everyone</option>
          <option value="admins" ${perms.whoCanCreateChannels === 'admins' ? 'selected' : ''}>Admins only</option>
        </select>
      </div>
      <div class="form-group">
        <label>Who can invite members?</label>
        <select name="ws-invite-members" class="modal-select">
          <option value="everyone" ${perms.whoCanInviteMembers === 'everyone' ? 'selected' : ''}>Everyone</option>
          <option value="admins" ${perms.whoCanInviteMembers === 'admins' ? 'selected' : ''}>Admins only</option>
        </select>
      </div>
      <div class="form-group">
        <button type="button" class="btn-secondary" id="manage-members-btn" style="width:100%;">Manage Members</button>
      </div>
      ${deleteSection}
    `,
      async (form) => {
        const name = (form.elements.namedItem('ws-name') as HTMLInputElement).value.trim();
        const description = (form.elements.namedItem('ws-description') as HTMLTextAreaElement).value.trim();
        const whoCanCreateChannels = (form.elements.namedItem('ws-create-channels') as HTMLSelectElement).value as 'everyone' | 'admins';
        const whoCanInviteMembers = (form.elements.namedItem('ws-invite-members') as HTMLSelectElement).value as 'everyone' | 'admins';

        if (!name) return false;

        // Update workspace info
        if (name !== ws.name || description !== (ws.description || '')) {
          const infoRes = await this.callbacks.updateWorkspaceInfo?.({ name, description });
          if (infoRes && !infoRes.success) {
            this.showToast(infoRes.error || 'Failed to update workspace info', 'error');
            return false;
          }
        }

        // Update permissions
        if (whoCanCreateChannels !== perms.whoCanCreateChannels || whoCanInviteMembers !== perms.whoCanInviteMembers) {
          const permRes = await this.callbacks.updateWorkspacePermissions?.({ whoCanCreateChannels, whoCanInviteMembers });
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
    );

    const overlay = document.querySelector('.modal-overlay:last-of-type') as HTMLElement | null;
    overlay?.querySelector('#manage-members-btn')?.addEventListener('click', () => {
      overlay.remove();
      this.showWorkspaceMembersModal();
    });

    // Bind delete workspace button
    if (isOwner) {
      overlay?.querySelector('#delete-workspace-btn')?.addEventListener('click', async () => {
        const confirmed = confirm(`Delete "${ws.name}"? This cannot be undone.`);
        if (!confirmed) return;
        const secondConfirm = confirm(`Are you sure? All channels and messages will be lost.`);
        if (!secondConfirm) return;

        const result = await this.callbacks.deleteWorkspace?.(ws.id);
        if (result) {
          overlay?.remove();
          this.showToast('Workspace deleted', 'success');
          this.state.activeWorkspaceId = null;
          this.state.activeChannelId = null;
          (this as any).renderApp?.() ?? this.updateSidebar();
        } else {
          this.showToast('Failed to delete workspace', 'error');
        }
      });
    }
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

  private updateWorkspacePreview(overlay: HTMLDivElement): void {
    const inviteInput = overlay.querySelector('input[name="invite"]') as HTMLInputElement | null;
    const previewGroup = overlay.querySelector('[data-workspace-preview]') as HTMLElement | null;
    const previewInput = overlay.querySelector('input[name="workspacePreview"]') as HTMLInputElement | null;

    if (!inviteInput || !previewGroup || !previewInput) return;

    const parsed = this.parseJoinInviteInput(inviteInput.value.trim());
    const workspaceName = parsed.inviteData?.workspaceName?.trim();

    if (workspaceName) {
      const wasVisible = previewGroup.classList.contains('workspace-preview-visible');
      previewInput.value = workspaceName;
      previewGroup.style.display = 'block';
      previewGroup.classList.add('workspace-preview-visible');
      if (!wasVisible) {
        previewInput.classList.remove('workspace-preview-pop');
        requestAnimationFrame(() => previewInput.classList.add('workspace-preview-pop'));
      }
    } else {
      previewInput.value = '';
      previewGroup.style.display = 'none';
      previewGroup.classList.remove('workspace-preview-visible');
      previewInput.classList.remove('workspace-preview-pop');
    }
  }

  showJoinWorkspaceModal(): void {
    const overlay = this.showModal(
      'Join Workspace',
      `
      <div class="form-group">
        <label>Invite Link or Code</label>
        <input type="text" name="invite" class="invite-input" placeholder="https://decentchat.app/join/... or paste invite link" required />
        <small style="color: var(--text-muted); margin-top: 4px; display: block;">
          Paste the full invite link you received
        </small>
        <small class="invite-autofill-hint" data-invite-autofill-hint style="display: none;">
          ✅ We found an invite in your clipboard and pasted it here for you.
        </small>
      </div>
      <div class="form-group" data-workspace-preview style="display: none;">
        <label>Workspace</label>
        <input type="text" name="workspacePreview" readonly />
      </div>
      <div class="form-group">
        <label>Your Display Name</label>
        <input type="text" name="alias" class="join-alias-input" placeholder="Your name" required />
      </div>
    `,
      (form) => {
        const invite = (form.elements.namedItem('invite') as HTMLInputElement).value.trim();
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        if (!invite || !alias) return;

        const parsed = this.parseJoinInviteInput(invite);
        if (parsed.error) {
          this.showToast(parsed.error, 'error');
          return;
        }

        let peerId = parsed.peerId;
        if (!peerId) {
          const peerInput = prompt('Enter the Peer ID of someone in the workspace:');
          if (!peerInput) return;
          peerId = peerInput.trim();
        }

        if (!peerId) {
          this.showToast('Invite link missing peer info — ask the inviter for an updated link', 'error');
          return;
        }

        this.state.myAlias = alias;
        this.callbacks.persistSetting('myAlias', alias);
        const wsName = parsed.inviteData?.workspaceName || parsed.code;
        this.callbacks.joinWorkspace(wsName, alias, peerId, parsed.inviteData);
        this.showToast(`Joining workspace... connecting to ${peerId.slice(0, 8)}`);
      },
    );

    const inviteInput = overlay.querySelector('input[name="invite"]') as HTMLInputElement | null;
    const aliasInput = overlay.querySelector('input[name="alias"]') as HTMLInputElement | null;
    const autofillHint = overlay.querySelector('[data-invite-autofill-hint]') as HTMLElement | null;

    if (inviteInput) {
      inviteInput.addEventListener('input', () => {
        this.updateWorkspacePreview(overlay);
        inviteInput.classList.remove('invite-autofilled');
        if (autofillHint) {
          autofillHint.style.display = 'none';
          autofillHint.classList.remove('invite-autofill-hint-visible');
        }
      });
    }

    // Clipboard auto-detect (requires user gesture: opening modal)
    if (navigator.clipboard?.readText) {
      navigator.clipboard.readText()
        .then((text) => {
          const clipboardText = text.trim();
          if (!clipboardText || !inviteInput || inviteInput.value.trim()) return;

          const parsed = this.parseJoinInviteInput(clipboardText);
          if (parsed.error || !parsed.inviteData) return;

          inviteInput.value = clipboardText;
          inviteInput.classList.remove('invite-autofilled');
          requestAnimationFrame(() => inviteInput.classList.add('invite-autofilled'));
          this.updateWorkspacePreview(overlay);

          if (autofillHint) {
            autofillHint.style.display = 'block';
            autofillHint.classList.remove('invite-autofill-hint-visible');
            requestAnimationFrame(() => autofillHint.classList.add('invite-autofill-hint-visible'));
          }

          // Move user directly to the next step.
          // Delay slightly so it wins over modal's initial autofocus on first input.
          setTimeout(() => {
            aliasInput?.focus();
            aliasInput?.select();
          }, 90);
        })
        .catch(() => {
          // Clipboard read can fail due to browser permissions; ignore silently.
        });
    }
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

    const memberOptions = otherMembers
      .map(
        (m: import('decent-protocol').WorkspaceMember) =>
          `<div class="sidebar-item" data-peer-id="${m.peerId}" style="background: var(--surface); margin: 4px 0; border-radius: 6px; color: var(--text); padding: 10px 12px; cursor: pointer;">
        <span class="dm-status ${this.peerStatusClass(m.peerId)}" title="${this.peerStatusTitle(m.peerId)}"></span>
        ${this.escapeHtml(m.alias)} (${m.peerId.slice(0, 8)})
      </div>`,
      )
      .join('');

    this.showModal(
      'New Direct Message',
      `
      <div class="form-group">
        <label>Select a member</label>
        <div id="member-list">${memberOptions}</div>
        <input type="hidden" name="peerId" id="dm-peer-select" />
      </div>
    `,
      (form) => {
        const peerId = (form.elements.namedItem('peerId') as HTMLInputElement).value;
        if (!peerId) return;

        const result = this.callbacks.createDM(peerId);
        if (result.success && result.channel) {
          this.switchChannel(result.channel.id);
          this.updateSidebar();
        }
      },
    );

    setTimeout(() => {
      document.getElementById('member-list')?.addEventListener('click', (e) => {
        const item = (e.target as HTMLElement).closest('[data-peer-id]') as HTMLElement;
        if (item) {
          (document.getElementById('dm-peer-select') as HTMLInputElement).value =
            item.dataset.peerId!;
          document
            .querySelectorAll('#member-list .sidebar-item')
            .forEach((el) => ((el as HTMLElement).style.border = 'none'));
          item.style.border = '2px solid var(--accent)';
        }
      });
    }, 50);
  }

  // =========================================================================
  // Contact modals
  // =========================================================================

  showAddContactModal(): void {
    this.showModal(
      'Add Contact',
      `
      <div class="form-group">
        <label>Contact URI</label>
        <textarea name="contactUri" id="contact-uri-input" placeholder="Paste decent://contact?... URI" rows="4" required></textarea>
      </div>
      <div class="form-group">
        <label>Display Name Override (optional)</label>
        <input type="text" name="displayNameOverride" placeholder="Override contact name" />
      </div>
    `,
      async (form) => {
        const uri = (form.elements.namedItem('contactUri') as HTMLTextAreaElement).value.trim();
        const displayNameOverride = (form.elements.namedItem('displayNameOverride') as HTMLInputElement).value.trim();

        if (!ContactURI.isValid(uri)) {
          this.showToast('Invalid Contact URI', 'error');
          return false;
        }

        const parsed = ContactURI.decode(uri);

        const contact: Contact = {
          peerId: parsed.peerId || `contact-${Date.now()}`,
          publicKey: parsed.publicKey,
          displayName: displayNameOverride || parsed.displayName,
          signalingServers: parsed.signalingServers || [],
          addedAt: Date.now(),
          lastSeen: 0,
        };

        await this.callbacks.addContact?.(contact);
        await this.refreshContactsCache();
        this.updateSidebar();
        this.showToast(`Added ${contact.displayName} to contacts`, 'success');
        return true;
      },
    );
  }

  showStartDirectMessageModal(): void {
    if (this.cachedContacts.length === 0) {
      this.showToast('Add a contact first to start a DM', 'error');
      return;
    }

    const contactOptions = this.cachedContacts
      .map(c => {
        return `<div class="sidebar-item" data-peer-id="${c.peerId}" style="background: var(--surface); margin: 4px 0; border-radius: 6px; color: var(--text); padding: 10px 12px; cursor: pointer;">
          <span class="dm-status ${this.peerStatusClass(c.peerId)}" title="${this.peerStatusTitle(c.peerId)}"></span>
          ${this.escapeHtml(c.displayName)} (${c.peerId.slice(0, 8)})
        </div>`;
      })
      .join('');

    this.showModal(
      'Start Direct Message',
      `
      <div class="form-group">
        <label>Select a contact</label>
        <div id="contact-list">${contactOptions}</div>
        <input type="hidden" name="peerId" id="dm-contact-select" />
      </div>
    `,
      (form) => {
        const peerId = (form.elements.namedItem('peerId') as HTMLInputElement).value;
        if (!peerId) return;

        this.callbacks.startDirectMessage?.(peerId).then(async (conv) => {
          await this.refreshContactsCache();
          this.switchToDirectConversation(conv.id);
        });
      },
    );

    setTimeout(() => {
      document.getElementById('contact-list')?.addEventListener('click', (e) => {
        const item = (e.target as HTMLElement).closest('[data-peer-id]') as HTMLElement;
        if (item) {
          (document.getElementById('dm-contact-select') as HTMLInputElement).value =
            item.dataset.peerId!;
          document
            .querySelectorAll('#contact-list .sidebar-item')
            .forEach((el) => ((el as HTMLElement).style.border = 'none'));
          item.style.border = '2px solid var(--accent)';
        }
      });
    }, 50);
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

  private upgradeInlineImagePreviews(container?: HTMLElement): void {
    const root = container || document.getElementById('messages-list');
    if (!root) return;

    // Respect optional low-quality mode.
    this.callbacks.getSettings?.().then(settings => {
      if (settings?.lowQualityPreviews) return;

      const imgs = root.querySelectorAll<HTMLImageElement>('img.attachment-thumbnail[data-attachment-id]');
      for (const img of imgs) {
        if (img.getAttribute('data-inline-upgrade') === 'done') continue;
        const attachmentId = img.getAttribute('data-attachment-id');
        if (!attachmentId) continue;

        const tryResolve = (attempt = 1) => {
          this.callbacks.resolveAttachmentImageUrl?.(attachmentId).then((fullUrl) => {
            if (fullUrl) {
              img.src = fullUrl;
              img.setAttribute('data-inline-upgrade', 'done');
              return;
            }
            if (attempt < 3) {
              setTimeout(() => tryResolve(attempt + 1), 2500);
            }
          }).catch(() => {
            if (attempt < 3) setTimeout(() => tryResolve(attempt + 1), 2500);
          });
        };

        img.setAttribute('data-inline-upgrade', 'loading');
        tryResolve(1);
      }
    }).catch(() => {});
  }

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

  /** Render attachment previews for a message */
  private renderAttachments(attachments?: any[]): string {
    if (!attachments || attachments.length === 0) return '';

    return attachments.map((att: any) => {
      const sizeStr = this.formatFileSize(att.size);

      if (att.type === 'image' && att.thumbnail) {
        return `
          <div class="attachment attachment-image" data-attachment-id="${att.id}">
            <img src="data:image/jpeg;base64,${att.thumbnail}" alt="${this.escapeHtml(att.name)}" class="attachment-thumbnail" data-attachment-name="${this.escapeHtml(att.name)}" data-attachment-id="${att.id}" />
            <div class="attachment-info">
              <span class="attachment-name">${this.escapeHtml(att.name)}</span>
              <span class="attachment-size">${sizeStr}</span>
            </div>
          </div>`;
      }

      if (att.type === 'image' && !att.thumbnail) {
        return `
          <div class="attachment attachment-image attachment-no-preview" data-attachment-id="${att.id}">
            <span class="attachment-icon">🖼️</span>
            <div class="attachment-info">
              <span class="attachment-name">${this.escapeHtml(att.name)}</span>
              <span class="attachment-size">${sizeStr}</span>
              <span class="attachment-hint">Image — preview unavailable</span>
            </div>
          </div>`;
      }

      if (att.type === 'voice' || att.type === 'audio') {
        return `
          <div class="attachment attachment-audio" data-attachment-id="${att.id}">
            <span class="attachment-icon">🎵</span>
            <div class="attachment-info">
              <span class="attachment-name">${this.escapeHtml(att.name)}</span>
              <span class="attachment-size">${sizeStr}${att.durationSec ? ` · ${Math.round(att.durationSec)}s` : ''}</span>
            </div>
          </div>`;
      }

      // Generic file
      const icon = att.type === 'video' ? '🎬' : '📎';
      return `
        <div class="attachment attachment-file" data-attachment-id="${att.id}">
          <span class="attachment-icon">${icon}</span>
          <div class="attachment-info">
            <span class="attachment-name">${this.escapeHtml(att.name)}</span>
            <span class="attachment-size">${sizeStr}</span>
          </div>
        </div>`;
    }).join('');
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  peerColor(peerId: string): string {
    const colors = [
      '#e01e5a',
      '#2eb67d',
      '#ecb22e',
      '#36c5f0',
      '#611f69',
      '#1264a3',
      '#e57373',
      '#4fc3f7',
    ];
    let hash = 0;
    for (let i = 0; i < peerId.length; i++)
      hash = peerId.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
