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
import type { PlaintextMessage, Contact, DirectConversation } from 'decent-protocol';
export type { UICallbacks, ActivityItem } from './types';
import type { UICallbacks, ActivityItem } from './types';
import { toast } from '../lib/components/shared/Toast.svelte';
import { showModal as svelteShowModal } from '../lib/components/shared/Modal.svelte';
import { showMessageInfoModal } from '../lib/components/modals/MessageInfoModal.svelte';
import { showChannelMembersModal as svelteShowChannelMembersModal } from '../lib/components/modals/ChannelMembersModal.svelte';
import { showWorkspaceMembersModal as svelteShowWorkspaceMembersModal } from '../lib/components/modals/WorkspaceMembersModal.svelte';
import { showWorkspaceSettingsModal as svelteShowWorkspaceSettingsModal } from '../lib/components/modals/WorkspaceSettingsModal.svelte';
import { showJoinWorkspaceModal as svelteShowJoinWorkspaceModal } from '../lib/components/modals/JoinWorkspaceModal.svelte';
import { showPeerSelectModal } from '../lib/components/modals/PeerSelectModal.svelte';
import { showAddContactModal as svelteShowAddContactModal } from '../lib/components/modals/AddContactModal.svelte';
// mount/unmount no longer needed — AppShell.svelte handles all component mounting
import * as MH from './MountHelpers';
import type { MountContext } from './MountHelpers';
// Most component imports moved to MountHelpers.ts (WelcomePage now in AppShell.svelte)

// ActivityItem + UICallbacks interfaces moved to ./types.ts
import type { HuddleState, HuddleParticipant } from '../huddle/HuddleManager';
import type { AppState } from '../main';

// Svelte 5 stores — single source of truth for UI state
import { huddleUI, lightboxUI, activityUI, cachedData, componentRefs } from '../lib/stores/ui.svelte';

// Shell store — reactive props for AppShell (replaces mount/unmount pattern)
import { shellData, setShellCallbacks, type ShellCallbacks } from '../lib/stores/shell.svelte';

// ---------------------------------------------------------------------------
// UIRenderer
// ---------------------------------------------------------------------------

export class UIRenderer {
  // emojiPicker: migrated to Svelte (src/lib/components/shared/EmojiPicker.svelte)
  private messageSearch: MessageSearch;
  private settingsPanel: SettingsPanel | null = null;
  private qrCodeManager: QRCodeManager;

  // Component refs, huddle/lightbox/activity state, and cached data are now
  // in Svelte 5 stores (src/lib/stores/ui.svelte.ts). Access via the imported
  // huddleUI, lightboxUI, activityUI, cachedData, componentRefs objects.

  /** Pending compose attachments (staged before send) */
  // pendingMainAttachments/pendingThreadAttachments removed — migrated to ComposeArea.svelte
  // _boundPasteHandler removed — paste handling migrated to ComposeArea.svelte
  // _boundDropHandler removed — drag-drop handled in bindAppEvents directly

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

    // Reset lightbox state (clean start)
    lightboxUI.open = false;
    lightboxUI.src = '';
    lightboxUI.name = '';
    lightboxUI.blobUrl = null;

    // Set up shell callbacks (stable references for AppShell)
    this.initShellCallbacks();
  }

  /** Initialize stable callback references for AppShell components */
  private initShellCallbacks(): void {
    setShellCallbacks({
      // Welcome screen
      onCreateWorkspace: () => this.showCreateWorkspaceModal(),
      onJoinWorkspace: () => this.showJoinWorkspaceModal(),
      onRestoreSeed: () => this.qrCodeManager.showRestoreSeed(),

      // Workspace rail
      onSwitchToDMs: () => {
        this.state.activeWorkspaceId = null;
        if (!this.state.activeDirectConversationId) this.state.activeChannelId = null;
        this.persistViewState();
        this.refreshContactsCache().catch(() => {});
        this.syncShellSidebar();
        this.syncShellRail();
        this.syncShellHeader();
        this.syncShellMessages();
      },
      onSwitchWorkspace: (wsId) => this.switchWorkspace(wsId),
      onToggleActivity: () => this.toggleActivityPanel(),
      onAddWorkspace: () => this.showCreateWorkspaceModal(),

      // Sidebar
      onChannelClick: (channelId) => this.switchChannel(channelId),
      onMemberClick: (peerId) => this.startMemberDM(peerId),
      onDirectConvClick: (convId) => this.switchToDirectConversation(convId),
      onAddChannel: () => this.showCreateChannelModal(),
      onStartDM: () => this.showStartDirectMessageModal(),
      onAddContact: () => this.showAddContactModal(),
      onConnectPeer: () => this.showConnectPeerModal(),
      onCopyInvite: () => {
        if (!this.state.activeWorkspaceId) return;
        const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
        if (inviteURL) { navigator.clipboard.writeText(inviteURL); this.showToast('Invite link copied!', 'success'); }
      },
      onShowQR: () => this.showMyQR(),
      onCopyPeerId: () => { navigator.clipboard.writeText(this.state.myPeerId); this.showToast('Peer ID copied!'); },
      onWorkspaceSettings: () => this.showWorkspaceSettingsModal(),
      onWorkspaceMembers: () => this.showWorkspaceMembersModal(),
      onWorkspaceInvite: () => {
        if (!this.state.activeWorkspaceId) return;
        const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
        if (inviteURL) { navigator.clipboard.writeText(inviteURL); this.showToast('Invite link copied!', 'success'); }
      },
      onWorkspaceNotifications: () => this.showSettings(),
      getUnreadCount: (id) => this.callbacks.getUnreadCount?.(id) || 0,
      getPeerAlias: (peerId) => this.getPeerAlias(peerId),
      getPeerStatusClass: (peerId) => this.peerStatusClass(peerId),
      getPeerStatusTitle: (peerId) => this.peerStatusTitle(peerId),

      // Channel header
      onHamburger: () => {
        const sidebar = document.getElementById('sidebar');
        sidebar?.classList.contains('open') ? this.closeMobileSidebar() : this.openMobileSidebar();
      },
      onHuddleToggle: async () => {
        const channelId = this.state.activeChannelId;
        if (!channelId) return;
        if (huddleUI.state === 'in-call') { await this.callbacks.leaveHuddle?.(); }
        else { await this.callbacks.startHuddle?.(channelId); }
      },
      onHeaderConnectPeer: () => this.showConnectPeerModal(),
      onHeaderShowQR: () => this.showMyQR(),
      onSearch: () => this.showSearchPanel(),
      onInvite: () => {
        if (!this.state.activeWorkspaceId) return;
        const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
        if (inviteURL) { navigator.clipboard.writeText(inviteURL); this.showToast('Invite link copied! Share it with anyone.', 'success'); }
      },
      onSettings: () => this.showSettings(),
      onChannelMembers: () => this.showChannelMembersModal(),

      // Messages
      getThread: (channelId, messageId) => this.messageStore.getThread(channelId, messageId),
      isBot: (senderId) => {
        const ws = this.state.activeWorkspaceId ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId) : null;
        return ws?.members.find((m: any) => m.peerId === senderId)?.isBot === true;
      },
      onOpenThread: (messageId) => this.openThread(messageId),
      onToggleReaction: (messageId, emoji) => this.callbacks.toggleReaction?.(messageId, emoji),
      onRememberReaction: (emoji) => this.rememberReaction(emoji),
      onShowMessageInfo: (messageId) => this.showMessageInfo(messageId),
      onImageClick: (name, src) => this.openLightbox(src, name),

      // Compose
      onSend: async (text, files) => {
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
        const ws = this.state.activeWorkspaceId ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId) : null;
        if (!ws) return [];
        return ws.members.filter((m: any) => m.peerId !== this.state.myPeerId).map((m: any) => ({
          peerId: m.peerId, name: this.getPeerAlias(m.peerId),
        }));
      },

      // Thread
      onCloseThread: () => this.closeThread(),
      onThreadSend: async (text, files) => {
        const threadId = this.state.activeThreadId || undefined;
        if (files.length > 0) {
          for (let i = 0; i < files.length; i++) {
            await this.callbacks.sendAttachment(files[i], i === 0 ? (text || undefined) : undefined, threadId);
          }
        } else if (text) {
          await this.callbacks.sendMessage(text, threadId);
        }
      },

      // Huddle
      onToggleMute: () => {
        const muted = this.callbacks.toggleHuddleMute?.() ?? false;
        huddleUI.muted = muted;
        this.syncShellHuddle();
      },
      onLeaveHuddle: async () => { await this.callbacks.leaveHuddle?.(); },
      onJoinHuddle: async () => {
        const channelId = huddleUI.channelId || this.state.activeChannelId;
        if (channelId) await this.callbacks.joinHuddle?.(channelId);
      },

      // Lightbox
      onCloseLightbox: () => this.closeLightbox(),

      // Search
      onSearchQuery: (query) => {
        const search = new MessageSearch(this.messageStore);
        return search.search(query, { channelId: this.state.activeChannelId || undefined, limit: 20 });
      },
      onScrollToMessage: (messageId) => this.scrollToMessageAndHighlight(messageId),
      onCloseSearch: () => {
        shellData.search.open = false;
      },

      // Activity
      onCloseActivity: () => this.toggleActivityPanel(),
      onMarkAllRead: () => {
        this.callbacks.markAllActivityRead?.();
      },
      onMarkRead: (id) => this.callbacks.markActivityRead?.(id),
      onNavigateActivity: (item: any) => {
        this.toggleActivityPanel();
        const needsChannelSwitch = item.channelId && item.channelId !== this.state.activeChannelId;
        const needsThreadOpen = !!(item.threadId && item.threadId.trim());
        const needsThreadSwitch = needsThreadOpen && (!this.state.threadOpen || this.state.activeThreadId !== item.threadId);

        if (needsChannelSwitch) this.switchChannel(item.channelId);

        if (needsThreadOpen && needsThreadSwitch) {
          setTimeout(() => {
            this.openThread(item.threadId!);
            if (item.messageId) setTimeout(() => this.scrollToMessageAndHighlight(item.messageId, 'thread-messages'), 100);
          }, needsChannelSwitch ? 50 : 0);
        } else if (needsThreadOpen && !needsThreadSwitch) {
          if (item.messageId) this.scrollToMessageAndHighlight(item.messageId, 'thread-messages');
        } else if (item.messageId) {
          setTimeout(() => this.scrollToMessageAndHighlight(item.messageId, 'messages-list'), needsChannelSwitch ? 100 : 0);
        }

        this.syncShellHeader();
        this.syncShellRail();
      },
      getActivityPeerAlias: (peerId) => this.getPeerAlias(peerId),
    });
  }

  // =========================================================================
  // Shell store sync methods — write computed props to shellData
  // =========================================================================

  /** Sync all shell data (called on renderApp / full refresh) */
  syncShellAll(): void {
    this.syncShellRail();
    this.syncShellSidebar();
    this.syncShellHeader();
    this.syncShellMessages();
    this.syncShellCompose();
    this.syncShellThread();
    this.syncShellHuddle();
    this.syncShellLightbox();
  }

  private syncShellRail(): void {
    shellData.rail.workspaces = this.callbacks.getAllWorkspaces?.() || [];
    shellData.rail.activeWorkspaceId = this.state.activeWorkspaceId;
    shellData.rail.activityUnread = this.callbacks.getActivityUnreadCount?.() || 0;
  }

  private syncShellSidebar(): void {
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    const channels = ws ? this.workspaceManager.getChannels(ws.id) : [];

    const memberData = ws
      ? (() => {
          const seen = new Set<string>();
          return ws.members.filter((m: any) => {
            const key = m.identityId || m.peerId;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).map((m: any) => {
            const identityPeers = m.identityId
              ? ws.members.filter((other: any) => other.identityId === m.identityId).map((other: any) => other.peerId)
              : [m.peerId];
            const isMe = identityPeers.includes(this.state.myPeerId);
            const isOnline = isMe || identityPeers.some((pid: string) => this.peerStatusClass(pid) === 'online');
            return {
              peerId: m.peerId, alias: this.getPeerAlias(m.peerId), isOnline, isMe,
              role: m.role, isBot: m.isBot,
              statusClass: this.peerStatusClass(m.peerId),
              statusTitle: this.peerStatusTitle(m.peerId),
            };
          });
        })()
      : [];

    shellData.sidebar.workspaceName = ws?.name ?? null;
    shellData.sidebar.channels = channels.map((ch: any) => ({ id: ch.id, name: ch.name }));
    shellData.sidebar.members = memberData;
    shellData.sidebar.directConversations = cachedData.directConversations.map(c => ({
      id: c.id, contactPeerId: c.contactPeerId, lastMessageAt: c.lastMessageAt,
    }));
    shellData.sidebar.activeChannelId = this.state.activeChannelId;
    shellData.sidebar.activeDirectConversationId = this.state.activeDirectConversationId;
    shellData.sidebar.myPeerId = this.state.myPeerId;
  }

  private syncShellHeader(): void {
    const isDirectMessage = !!this.state.activeDirectConversationId;
    let channelName = 'Select a channel';
    let memberCount = 0;

    if (isDirectMessage) {
      const conv = cachedData.directConversations.find(c => c.id === this.state.activeDirectConversationId);
      channelName = conv ? this.getPeerAlias(conv.contactPeerId) : 'Direct Message';
    } else {
      const ws = this.state.activeWorkspaceId ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId) : null;
      const channel = this.state.activeChannelId && ws ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId) : null;
      if (channel) {
        channelName = channel.type === 'dm' ? channel.name : `# ${channel.name}`;
        memberCount = channel.members.length;
      }
    }

    shellData.header.channelName = channelName;
    shellData.header.memberCount = memberCount;
    shellData.header.isDirectMessage = isDirectMessage;
    shellData.header.isHuddleActive = huddleUI.state === 'in-call' && huddleUI.channelId === this.state.activeChannelId;
  }

  private syncShellMessages(): void {
    const channelName = MH.getActiveChannelName(this.ctx());
    const messages = this.state.activeChannelId
      ? this.messageStore.getMessages(this.state.activeChannelId).filter((m: PlaintextMessage) => !m.threadId)
      : [];

    shellData.messages.messages = messages;
    shellData.messages.channelName = channelName;
    shellData.messages.activeChannelId = this.state.activeChannelId;
    shellData.messages.myPeerId = this.state.myPeerId;
    shellData.messages.myDisplayName = this.getMyDisplayName();
    shellData.messages.frequentReactions = this.getFrequentReactions();
  }

  private syncShellCompose(): void {
    shellData.compose.placeholder = this.getComposePlaceholder();
  }

  private syncShellThread(): void {
    if (!this.state.activeChannelId || !this.state.activeThreadId) {
      shellData.thread.open = this.state.threadOpen;
      shellData.thread.threadId = null;
      shellData.thread.channelId = this.state.activeChannelId;
      shellData.thread.parentMessage = null;
      shellData.thread.replies = [];
    } else {
      const allMsgs = this.messageStore.getMessages(this.state.activeChannelId);
      let parent = allMsgs.find((m: PlaintextMessage) => m.id === this.state.activeThreadId);
      if (!parent) parent = this.messageStore.getThreadRoot(this.state.activeThreadId);
      const replies = this.messageStore.getThread(this.state.activeChannelId, this.state.activeThreadId!);

      shellData.thread.open = this.state.threadOpen;
      shellData.thread.threadId = this.state.activeThreadId;
      shellData.thread.channelId = this.state.activeChannelId;
      shellData.thread.parentMessage = parent || null;
      shellData.thread.replies = replies;
    }
    shellData.thread.myPeerId = this.state.myPeerId;
    shellData.thread.myDisplayName = this.getMyDisplayName();
    shellData.thread.frequentReactions = this.getFrequentReactions();
  }

  private syncShellHuddle(): void {
    shellData.huddle.state = huddleUI.state;
    shellData.huddle.muted = huddleUI.muted;
    shellData.huddle.participants = huddleUI.participants;
  }

  private syncShellLightbox(): void {
    shellData.lightbox.open = lightboxUI.open;
    shellData.lightbox.src = lightboxUI.src;
    shellData.lightbox.name = lightboxUI.name;
  }

  private tracePrefix(): string {
    const alias = (this.state.myAlias || '').trim();
    if (/^alice$/i.test(alias)) return '[TRACE Alice]';
    if (/^bob$/i.test(alias)) return '[TRACE Bob]';
    return `[TRACE ${alias || this.state.myPeerId.slice(0, 8)}]`;
  }

  /** Build MountContext for delegation to MountHelpers */
  private ctx(): MountContext {
    return {
      state: this.state,
      workspaceManager: this.workspaceManager,
      messageStore: this.messageStore,
      callbacks: this.callbacks,
      getPeerAlias: (id) => this.getPeerAlias(id),
      peerColor: (id) => this.peerColor(id),
      peerStatusClass: (id) => this.peerStatusClass(id),
      peerStatusTitle: (id) => this.peerStatusTitle(id),
      getFrequentReactions: () => this.getFrequentReactions(),
      getMyDisplayName: () => this.getMyDisplayName(),
      getComposePlaceholder: () => this.getComposePlaceholder(),
      cachedContacts: cachedData.contacts,
      cachedDirectConversations: cachedData.directConversations,
      huddleState: huddleUI.state,
      huddleChannelId: huddleUI.channelId,
      huddleParticipants: huddleUI.participants,
      huddleMuted: huddleUI.muted,
      lightboxOpen: lightboxUI.open,
      lightboxSrc: lightboxUI.src,
      lightboxName: lightboxUI.name,
      switchChannel: (id) => this.switchChannel(id),
      switchToDirectConversation: (id) => this.switchToDirectConversation(id),
      switchWorkspace: (id) => this.switchWorkspace(id),
      openThread: (id) => this.openThread(id),
      closeThread: () => this.closeThread(),
      showChannelMembersModal: () => this.showChannelMembersModal(),
      showWorkspaceSettingsModal: () => this.showWorkspaceSettingsModal(),
      showWorkspaceMembersModal: () => this.showWorkspaceMembersModal(),
      showCreateChannelModal: () => this.showCreateChannelModal(),
      showConnectPeerModal: () => this.showConnectPeerModal(),
      showCreateWorkspaceModal: () => this.showCreateWorkspaceModal(),
      showStartDirectMessageModal: () => this.showStartDirectMessageModal(),
      showAddContactModal: () => this.showAddContactModal(),
      showMyQR: () => this.showMyQR(),
      showScanQR: () => this.showScanQR(),
      showSearchPanel: () => this.showSearchPanel(),
      showSettings: () => this.showSettings(),
      showToast: (msg, type) => this.showToast(msg, type),
      showMessageInfo: (id) => this.showMessageInfo(id),
      openMobileSidebar: () => this.openMobileSidebar(),
      closeMobileSidebar: () => this.closeMobileSidebar(),
      closeLightbox: () => this.closeLightbox(),
      openLightbox: (src, name) => this.openLightbox(src, name),
      rememberReaction: (emoji) => this.rememberReaction(emoji),
      startMemberDM: (id) => this.startMemberDM(id),
      toggleActivityPanel: () => this.toggleActivityPanel(),
      scrollToMessageAndHighlight: (id, cid) => this.scrollToMessageAndHighlight(id, cid),
      persistViewState: () => this.persistViewState(),
      refreshContactsCache: () => this.refreshContactsCache(),
      updateSidebar: () => this.updateSidebar(),
      updateChannelHeader: () => this.updateChannelHeader(),
      updateWorkspaceRail: () => this.updateWorkspaceRail(),
      renderMessages: () => this.renderMessages(),
      updateComposePlaceholder: () => this.updateComposePlaceholder(),
      mountCompose: () => this.syncShellCompose(),
      mountHuddleBar: () => this.syncShellHuddle(),
      mountLightbox: () => this.syncShellLightbox(),
      mountSidebar: () => this.syncShellSidebar(),
      mountThreadPanel: () => this.syncShellThread(),
    };
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
    cachedData.contacts = contacts;
    cachedData.directConversations = conversations
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
    // Set shell store to show welcome view (AppShell handles rendering)
    shellData.welcome.myPeerId = this.state.myPeerId;
    shellData.welcome.hasWorkspace = (this.callbacks.getAllWorkspaces?.().length || 0) > 0;
    shellData.view = 'welcome';
  }

  // =========================================================================
  // Main app layout
  // =========================================================================

  renderApp(): void {
    this.hideLoading();
    // AppShell.svelte owns the layout and component mounting.
    // Sync all data to the shell store and switch to app view.
    this.syncShellAll();
    shellData.view = 'app';
  }

  // =========================================================================
  // Workspace rail (left icon strip like Discord/Slack)
  // =========================================================================

  // renderWorkspaceRailHTML() — removed (migrated to WorkspaceRail.svelte)
  // bindWorkspaceRailEvents() — removed (migrated to WorkspaceRail.svelte)

  switchWorkspace(workspaceId: string): void {
    activityUI.panelOpen = false;
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
    this.syncShellRail();
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
    this.syncShellMessages();
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
    this.syncShellThread();
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

    this.syncShellThread();

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
    this.syncShellThread();
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
    this.syncShellCompose();
  }

  // =========================================================================
  // DOM update helpers
  // =========================================================================

  updateSidebar(): void {
    this.refreshContactsCache()
      .catch(() => {})
      .finally(() => {
        this.syncShellSidebar();
      });
  }

  updateChannelHeader(): void {
    this.syncShellHeader();
  }

  // bindAppEvents() — moved to AppShell.svelte

  /**
   * Start a DM with a workspace member — reuses existing conversation if one exists,
   * otherwise creates a new one.
   */
  private startMemberDM(peerId: string): void {
    // Check if there's already a direct conversation with this peer
    const existing = cachedData.directConversations.find(c => c.contactPeerId === peerId);
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
    huddleUI.state = state;
    huddleUI.channelId = channelId;
    this.syncShellHuddle();
    this.updateChannelHeader();
  }

  onHuddleParticipantsChange(participants: HuddleParticipant[]): void {
    huddleUI.participants = participants;
    this.syncShellHuddle();
  }

  // =========================================================================
  // Modal helpers
  // =========================================================================

  toggleActivityPanel(): void {
    activityUI.panelOpen = !activityUI.panelOpen;

    // AppShell handles sidebar/activity panel switching reactively
    shellData.activity.panelOpen = activityUI.panelOpen;
    if (activityUI.panelOpen) {
      shellData.activity.items = this.callbacks.getActivityItems?.() || [];
      document.getElementById('activity-btn')?.classList.add('active');
    } else {
      this.syncShellSidebar();
      document.getElementById('activity-btn')?.classList.remove('active');
    }
  }

  refreshActivityPanel(): void {
    if (!activityUI.panelOpen) return;
    shellData.activity.items = this.callbacks.getActivityItems?.() || [];
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
          this.renderApp();
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
    if (cachedData.contacts.length === 0) {
      this.showToast('Add a contact first to start a DM', 'error');
      return;
    }

    showPeerSelectModal({
      title: 'Start Direct Message',
      label: 'Select a contact',
      peers: cachedData.contacts.map(c => ({
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

  // addPendingAttachments() — moved to MountHelpers.ts

  showSearchPanel(): void {
    // Toggle search panel visibility
    shellData.search.open = !shellData.search.open;
    shellData.search.myPeerId = this.state.myPeerId;
    shellData.search.myAlias = this.state.myAlias || 'You';
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
      const conv = cachedData.directConversations.find(c => c.id === this.state.activeDirectConversationId);
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
    if (lightboxUI.blobUrl) {
      URL.revokeObjectURL(lightboxUI.blobUrl);
      lightboxUI.blobUrl = null;
    }
    lightboxUI.open = true;
    lightboxUI.src = src;
    lightboxUI.name = name;
    this.syncShellLightbox();
  }

  private closeLightbox(): void {
    lightboxUI.open = false;
    lightboxUI.src = '';
    lightboxUI.name = '';
    if (lightboxUI.blobUrl) {
      URL.revokeObjectURL(lightboxUI.blobUrl);
      lightboxUI.blobUrl = null;
    }
    this.syncShellLightbox();
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
    const contact = cachedData.contacts.find(c => c.peerId === peerId);
    if (contact) return contact.displayName;
    if (this.state.activeWorkspaceId) {
      const member = this.workspaceManager.getMember(this.state.activeWorkspaceId, peerId);
      if (member?.alias) return member.alias;
    }
    return peerId.slice(0, 8);
  }
}
