/**
 * uiService — Stateless UI service functions replacing the UIRenderer class.
 *
 * All state is held in Svelte stores (shell.svelte.ts, ui.svelte.ts) and AppState.
 * This module provides:
 *   - Shell sync functions (push computed data to shellData)
 *   - Modal show functions (gather data, call Svelte modal helpers)
 *   - Business logic (channel/workspace switching, thread open/close)
 *   - Initialization (createUIService factory)
 */

import type { WorkspaceManager, MessageStore, PlaintextMessage, InviteData, Contact, WorkspacePermissions } from 'decent-protocol';
import { InviteURI } from 'decent-protocol';
import { MessageSearch } from './MessageSearch';
import { SettingsPanel } from './SettingsPanel';
import { QRCodeManager } from './QRCodeManager';
import { ReactionTracker } from './ReactionTracker';
import { peerColor as peerColorUtil, escapeHtml as escapeHtmlUtil } from '../lib/utils/peer';
import type { UICallbacks, ActivityItem } from './types';
export type { UICallbacks, ActivityItem } from './types';
import { toast } from '../lib/components/shared/Toast.svelte';
import { showModal as svelteShowModal } from '../lib/components/shared/Modal.svelte';
import { showMessageInfoModal } from '../lib/components/modals/MessageInfoModal.svelte';
import { showChannelMembersModal as svelteShowChannelMembersModal } from '../lib/components/modals/ChannelMembersModal.svelte';
import { showWorkspaceMembersModal as svelteShowWorkspaceMembersModal } from '../lib/components/modals/WorkspaceMembersModal.svelte';
import { showWorkspaceSettingsModal as svelteShowWorkspaceSettingsModal } from '../lib/components/modals/WorkspaceSettingsModal.svelte';
import { showJoinWorkspaceModal as svelteShowJoinWorkspaceModal } from '../lib/components/modals/JoinWorkspaceModal.svelte';
import { showPeerSelectModal } from '../lib/components/modals/PeerSelectModal.svelte';
import { showAddContactModal as svelteShowAddContactModal } from '../lib/components/modals/AddContactModal.svelte';
import type { HuddleState, HuddleParticipant } from '../huddle/HuddleManager';
import type { AppState } from '../main';

// Svelte 5 stores
import { huddleUI, lightboxUI, activityUI, cachedData } from '../lib/stores/ui.svelte';
import { shellData, setShellCallbacks, type ShellCallbacks } from '../lib/stores/shell.svelte';

// ---------------------------------------------------------------------------
// UIService — the public API that replaces UIRenderer
// ---------------------------------------------------------------------------

export interface UIService {
  // Shell sync (called by ChatController via UIUpdater)
  syncShellAll(): void;
  renderApp(): void;
  renderWelcome(): void;
  renderMessages(): void;
  renderThreadMessages(): void;
  appendMessageToDOM(msg: PlaintextMessage, container?: HTMLElement, animate?: boolean): void;
  updateSidebar(): void;
  updateChannelHeader(): void;
  updateWorkspaceRail(): void;
  updateMessageStatus(messageId: string, status: 'pending' | 'sent' | 'delivered' | 'read', detail?: { acked?: number; total?: number; read?: number }): void;
  updateStreamingMessage(messageId: string, content: string): void;
  finalizeStreamingMessage(messageId: string): void;
  updateThreadIndicator(parentMessageId: string, channelId: string): void;
  updateTypingIndicator(text: string): void;

  // Business logic
  switchChannel(channelId: string): void;
  switchToDirectConversation(conversationId: string): void;
  switchWorkspace(workspaceId: string): void;
  openThread(messageId: string): void;
  closeThread(): void;
  refreshContactsCache(): Promise<void>;

  // Modals
  showCreateWorkspaceModal(): void;
  showJoinWorkspaceModal(): void;
  showJoinWithInvite(inviteCode: string, peerId: string, workspaceName: string, inviteData?: InviteData): void;
  showToast(message: string, type?: 'info' | 'error' | 'success'): void;

  // Huddle
  onHuddleStateChange(state: HuddleState, channelId: string | null): void;
  onHuddleParticipantsChange(participants: HuddleParticipant[]): void;

  // Activity
  refreshActivityPanel(): void;

  // Reactions
  reloadReactionUsage(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUIService(
  state: AppState,
  workspaceManager: WorkspaceManager,
  messageStore: MessageStore,
  callbacks: UICallbacks,
): UIService {
  // Private helpers
  const messageSearch = new MessageSearch(messageStore);
  let settingsPanel: SettingsPanel | null = null;
  const reactionTracker = new ReactionTracker(state.myPeerId);

  const qrCodeManager = new QRCodeManager({
    onContactScanned: (data) => callbacks.onQRContactScanned?.(data),
    onSeedRestored: (mnemonic) => callbacks.onSeedRestored?.(mnemonic),
    validateSeed: (mnemonic) => callbacks.validateSeed?.(mnemonic) ?? null,
    showToast: (msg, type) => showToast(msg, type),
  });

  // Reset lightbox state
  lightboxUI.open = false;
  lightboxUI.src = '';
  lightboxUI.name = '';
  lightboxUI.blobUrl = null;

  // Initialize cached data
  refreshContactsCache();

  // ── Utility helpers ──

  function peerColor(peerId: string): string {
    return peerColorUtil(peerId);
  }

  function escapeHtml(text: string): string {
    return escapeHtmlUtil(text);
  }

  function peerStatusClass(peerId: string): string {
    if (state.readyPeers.has(peerId)) return 'online';
    if (state.connectingPeers.has(peerId)) return 'connecting';
    return '';
  }

  function peerStatusTitle(peerId: string): string {
    if (state.readyPeers.has(peerId)) return 'Online';
    if (state.connectingPeers.has(peerId)) return 'Connecting...';
    return 'Offline';
  }

  function getPeerAlias(peerId: string): string {
    if (callbacks.getDisplayNameForPeer) {
      return callbacks.getDisplayNameForPeer(peerId);
    }
    const contact = cachedData.contacts.find(c => c.peerId === peerId);
    if (contact) return contact.displayName;
    if (state.activeWorkspaceId) {
      const member = workspaceManager.getMember(state.activeWorkspaceId, peerId);
      if (member?.alias) return member.alias;
    }
    return peerId.slice(0, 8);
  }

  function getMyDisplayName(): string {
    return (state.activeWorkspaceId && state.workspaceAliases?.[state.activeWorkspaceId])
      || state.myAlias || 'You';
  }

  function getComposePlaceholder(): string {
    if (state.activeDirectConversationId) {
      const conv = cachedData.directConversations.find(c => c.id === state.activeDirectConversationId);
      return conv ? `Message ${getPeerAlias(conv.contactPeerId)}` : 'Message contact';
    }
    if (!state.activeChannelId || !state.activeWorkspaceId) {
      return 'Message...';
    }
    const ws = workspaceManager.getWorkspace(state.activeWorkspaceId);
    const channel = ws ? workspaceManager.getChannel(ws.id, state.activeChannelId) : null;
    if (channel?.type === 'dm') return `Message ${channel.name}`;
    return `Message #${channel?.name || 'general'}`;
  }

  function getFrequentReactions(): string[] {
    return reactionTracker.getFrequentReactions();
  }

  function rememberReaction(emoji: string): void {
    reactionTracker.rememberReaction(emoji);
    renderMessages();
  }

  // ── Contacts cache ──

  async function refreshContactsCache(): Promise<void> {
    const [contacts, conversations] = await Promise.all([
      callbacks.getContacts?.() || Promise.resolve([]),
      callbacks.getDirectConversations?.() || Promise.resolve([]),
    ]);
    cachedData.contacts = contacts;
    cachedData.directConversations = conversations
      .slice()
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  // ── View state persistence ──

  function persistViewState(): void {
    const payload = {
      workspaceId: state.activeWorkspaceId,
      channelId: state.activeChannelId,
      threadId: state.threadOpen ? state.activeThreadId : null,
      threadOpen: state.threadOpen,
      directConversationId: state.activeDirectConversationId,
      at: Date.now(),
    };
    void callbacks.persistSetting('ui:lastView', payload).catch(() => {});
  }

  // ── Shell sync methods ──

  function syncShellRail(): void {
    shellData.rail.workspaces = callbacks.getAllWorkspaces?.() || [];
    shellData.rail.activeWorkspaceId = state.activeWorkspaceId;
    shellData.rail.activityUnread = callbacks.getActivityUnreadCount?.() || 0;
  }

  function syncShellSidebar(): void {
    const ws = state.activeWorkspaceId
      ? workspaceManager.getWorkspace(state.activeWorkspaceId)
      : null;
    const channels = ws ? workspaceManager.getChannels(ws.id) : [];

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
            const isMe = identityPeers.includes(state.myPeerId);
            const isOnline = isMe || identityPeers.some((pid: string) => peerStatusClass(pid) === 'online');
            return {
              peerId: m.peerId, alias: getPeerAlias(m.peerId), isOnline, isMe,
              role: m.role, isBot: m.isBot,
              statusClass: peerStatusClass(m.peerId),
              statusTitle: peerStatusTitle(m.peerId),
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
    shellData.sidebar.activeChannelId = state.activeChannelId;
    shellData.sidebar.activeDirectConversationId = state.activeDirectConversationId;
    shellData.sidebar.myPeerId = state.myPeerId;
  }

  function syncShellHeader(): void {
    const isDirectMessage = !!state.activeDirectConversationId;
    let channelName = 'Select a channel';
    let memberCount = 0;

    if (isDirectMessage) {
      const conv = cachedData.directConversations.find(c => c.id === state.activeDirectConversationId);
      channelName = conv ? getPeerAlias(conv.contactPeerId) : 'Direct Message';
    } else {
      const ws = state.activeWorkspaceId ? workspaceManager.getWorkspace(state.activeWorkspaceId) : null;
      const channel = state.activeChannelId && ws ? workspaceManager.getChannel(ws.id, state.activeChannelId) : null;
      if (channel) {
        channelName = channel.type === 'dm' ? channel.name : `# ${channel.name}`;
        memberCount = channel.members.length;
      }
    }

    shellData.header.channelName = channelName;
    shellData.header.memberCount = memberCount;
    shellData.header.isDirectMessage = isDirectMessage;
    shellData.header.isHuddleActive = huddleUI.state === 'in-call' && huddleUI.channelId === state.activeChannelId;
  }

  function getActiveChannelName(): string {
    if (state.activeDirectConversationId) {
      const conv = cachedData.directConversations.find(c => c.id === state.activeDirectConversationId);
      return conv ? getPeerAlias(conv.contactPeerId) : 'this conversation';
    }
    const ws = state.activeWorkspaceId ? workspaceManager.getWorkspace(state.activeWorkspaceId) : null;
    const channel = ws && state.activeChannelId ? workspaceManager.getChannel(ws.id, state.activeChannelId) : null;
    return channel ? (channel.type === 'dm' ? channel.name : '#' + channel.name) : 'the channel';
  }

  function syncShellMessages(): void {
    const channelName = getActiveChannelName();
    const messages = state.activeChannelId
      ? messageStore.getMessages(state.activeChannelId).filter((m: PlaintextMessage) => !m.threadId)
      : [];

    shellData.messages.messages = messages;
    shellData.messages.channelName = channelName;
    shellData.messages.activeChannelId = state.activeChannelId;
    shellData.messages.myPeerId = state.myPeerId;
    shellData.messages.myDisplayName = getMyDisplayName();
    shellData.messages.frequentReactions = getFrequentReactions();
  }

  function syncShellCompose(): void {
    shellData.compose.placeholder = getComposePlaceholder();
  }

  function syncShellThread(): void {
    if (!state.activeChannelId || !state.activeThreadId) {
      shellData.thread.open = state.threadOpen;
      shellData.thread.threadId = null;
      shellData.thread.channelId = state.activeChannelId;
      shellData.thread.parentMessage = null;
      shellData.thread.replies = [];
    } else {
      const allMsgs = messageStore.getMessages(state.activeChannelId);
      let parent = allMsgs.find((m: PlaintextMessage) => m.id === state.activeThreadId);
      if (!parent) parent = messageStore.getThreadRoot(state.activeThreadId);
      const replies = messageStore.getThread(state.activeChannelId, state.activeThreadId!);

      shellData.thread.open = state.threadOpen;
      shellData.thread.threadId = state.activeThreadId;
      shellData.thread.channelId = state.activeChannelId;
      shellData.thread.parentMessage = parent || null;
      shellData.thread.replies = replies;
    }
    shellData.thread.myPeerId = state.myPeerId;
    shellData.thread.myDisplayName = getMyDisplayName();
    shellData.thread.frequentReactions = getFrequentReactions();
  }

  function syncShellHuddle(): void {
    shellData.huddle.state = huddleUI.state;
    shellData.huddle.muted = huddleUI.muted;
    shellData.huddle.participants = huddleUI.participants;
  }

  function syncShellLightbox(): void {
    shellData.lightbox.open = lightboxUI.open;
    shellData.lightbox.src = lightboxUI.src;
    shellData.lightbox.name = lightboxUI.name;
  }

  function syncShellAll(): void {
    syncShellRail();
    syncShellSidebar();
    syncShellHeader();
    syncShellMessages();
    syncShellCompose();
    syncShellThread();
    syncShellHuddle();
    syncShellLightbox();
  }

  // ── Mobile sidebar ──

  function openMobileSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.classList.add('open');
    const existing = document.getElementById('mobile-sidebar-overlay');
    if (existing) return;
    const overlay = document.createElement('div');
    overlay.id = 'mobile-sidebar-overlay';
    overlay.className = 'mobile-overlay';
    overlay.addEventListener('click', () => closeMobileSidebar());
    overlay.addEventListener('touchstart', (e) => { e.preventDefault(); closeMobileSidebar(); }, { passive: false });
    document.body.appendChild(overlay);
  }

  function closeMobileSidebar(): void {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('mobile-sidebar-overlay')?.remove();
  }

  // ── Lightbox ──

  function openLightbox(src: string, name: string): void {
    if (lightboxUI.blobUrl) { URL.revokeObjectURL(lightboxUI.blobUrl); lightboxUI.blobUrl = null; }
    lightboxUI.open = true;
    lightboxUI.src = src;
    lightboxUI.name = name;
    syncShellLightbox();
  }

  function closeLightbox(): void {
    lightboxUI.open = false;
    lightboxUI.src = '';
    lightboxUI.name = '';
    if (lightboxUI.blobUrl) { URL.revokeObjectURL(lightboxUI.blobUrl); lightboxUI.blobUrl = null; }
    syncShellLightbox();
  }

  // ── Activity panel ──

  function toggleActivityPanel(): void {
    activityUI.panelOpen = !activityUI.panelOpen;
    shellData.activity.panelOpen = activityUI.panelOpen;
    if (activityUI.panelOpen) {
      shellData.activity.items = callbacks.getActivityItems?.() || [];
      document.getElementById('activity-btn')?.classList.add('active');
    } else {
      syncShellSidebar();
      document.getElementById('activity-btn')?.classList.remove('active');
    }
  }

  function refreshActivityPanel(): void {
    if (!activityUI.panelOpen) return;
    shellData.activity.items = callbacks.getActivityItems?.() || [];
  }

  // ── Scroll ──

  function scrollToMessageAndHighlight(messageId: string, containerId?: string): void {
    requestAnimationFrame(() => {
      const selector = `[data-message-id="${messageId}"]`;
      const container = containerId ? document.getElementById(containerId) : null;
      const msgEl = container?.querySelector(selector) ?? document.querySelector(selector);
      if (!msgEl) return;
      msgEl.classList.remove('highlight');
      void (msgEl as HTMLElement).offsetWidth;
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('highlight');
      setTimeout(() => msgEl.classList.remove('highlight'), 2500);
    });
  }

  // ── Business logic: channel/workspace/thread switching ──

  function switchChannel(channelId: string): void {
    state.activeChannelId = channelId;
    state.activeDirectConversationId = null;
    callbacks.setFocusedChannel?.(channelId);
    callbacks.markChannelRead?.(channelId);
    void callbacks.onChannelViewed?.(channelId);
    closeThread();
    persistViewState();
    updateSidebar();
    syncShellHeader();
    renderMessages();
    syncShellCompose();
    closeMobileSidebar();
  }

  function switchToDirectConversation(conversationId: string): void {
    state.activeDirectConversationId = conversationId;
    state.activeChannelId = conversationId;
    state.activeWorkspaceId = null;
    callbacks.setFocusedChannel?.(conversationId);
    callbacks.markChannelRead?.(conversationId);
    void callbacks.onChannelViewed?.(conversationId);
    closeThread();
    persistViewState();
    updateSidebar();
    syncShellHeader();
    renderMessages();
    syncShellCompose();
    closeMobileSidebar();
  }

  function switchWorkspace(workspaceId: string): void {
    activityUI.panelOpen = false;
    document.getElementById('activity-btn')?.classList.remove('active');
    const ws = workspaceManager.getWorkspace(workspaceId);
    if (!ws) return;

    state.activeWorkspaceId = workspaceId;
    state.activeDirectConversationId = null;
    state.activeChannelId = ws.channels[0]?.id || null;
    closeThread();
    persistViewState();
    refreshContactsCache();
    updateSidebar();
    syncShellRail();
    syncShellHeader();
    renderMessages();
    syncShellCompose();
  }

  function openThread(messageId: string): void {
    state.activeThreadId = messageId;
    state.threadOpen = true;
    syncShellThread();
    persistViewState();
    if (state.activeChannelId) {
      callbacks.markThreadActivityRead?.(state.activeChannelId, messageId);
      syncShellHeader();
    }
    // After thread panel opens/switches, the channel messages container width changes
    // (text rewraps, scrollHeight changes). Clamp scroll to valid range so channel
    // messages stay visible instead of scrolling into whitespace.
    requestAnimationFrame(() => {
      const ml = document.getElementById('messages-list');
      if (ml) {
        const maxScroll = ml.scrollHeight - ml.clientHeight;
        if (ml.scrollTop > maxScroll) {
          ml.scrollTop = maxScroll;
        }
      }
    });
    setTimeout(() => {
      (document.getElementById('thread-input') as HTMLTextAreaElement)?.focus();
    }, 100);
  }

  function closeThread(): void {
    state.activeThreadId = null;
    state.threadOpen = false;
    persistViewState();
    syncShellThread();
    // Clamp channel scroll after layout reflow (thread panel closing changes width)
    requestAnimationFrame(() => {
      const ml = document.getElementById('messages-list');
      if (ml) {
        const maxScroll = ml.scrollHeight - ml.clientHeight;
        if (ml.scrollTop > maxScroll) {
          ml.scrollTop = maxScroll;
        }
      }
    });
  }

  function startMemberDM(peerId: string): void {
    const existing = cachedData.directConversations.find(c => c.contactPeerId === peerId);
    if (existing) { switchToDirectConversation(existing.id); return; }
    callbacks.startDirectMessage?.(peerId).then(async conv => {
      await refreshContactsCache();
      switchToDirectConversation(conv.id);
    }).catch(() => showToast('Could not start DM', 'error'));
  }

  // ── Rendering delegates (write to shell store) ──

  function hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) { loading.style.opacity = '0'; setTimeout(() => loading.remove(), 300); }
  }

  function renderWelcome(): void {
    hideLoading();
    shellData.welcome.myPeerId = state.myPeerId;
    shellData.welcome.hasWorkspace = (callbacks.getAllWorkspaces?.().length || 0) > 0;
    shellData.view = 'welcome';
  }

  function renderApp(): void {
    hideLoading();
    syncShellAll();
    shellData.view = 'app';
  }

  function renderMessages(): void {
    syncShellMessages();
  }

  function renderThreadMessages(): void {
    syncShellThread();
  }

  function updateSidebar(): void {
    refreshContactsCache()
      .catch(() => {})
      .finally(() => { syncShellSidebar(); });
  }

  function updateChannelHeader(): void {
    syncShellHeader();
  }

  function updateWorkspaceRail(): void {
    syncShellRail();
  }

  function appendMessageToDOM(msg: PlaintextMessage, container?: HTMLElement, animate = false): void {
    const isThreadContainer = container?.id === 'thread-messages';
    if (isThreadContainer) {
      renderThreadMessages();
    } else {
      renderMessages();
    }
  }

  function updateMessageStatus(
    _messageId: string,
    _status: 'pending' | 'sent' | 'delivered' | 'read',
    _detail?: { acked?: number; total?: number; read?: number },
  ): void {
    renderMessages();
  }

  function updateStreamingMessage(_messageId: string, _content: string): void {
    renderMessages();
  }

  function finalizeStreamingMessage(_messageId: string): void {
    renderMessages();
  }

  function updateThreadIndicator(_parentMessageId: string, _channelId: string): void {
    renderMessages();
  }

  function updateTypingIndicator(text: string): void {
    const el = document.getElementById('typing-indicator');
    if (!el) return;
    if (text) { el.textContent = text; el.classList.add('visible'); }
    else { el.classList.remove('visible'); }
  }

  // ── Toast ──

  function showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    toast(message, type);
  }

  // ── Huddle ──

  function onHuddleStateChange(huddleState: HuddleState, channelId: string | null): void {
    huddleUI.state = huddleState;
    huddleUI.channelId = channelId;
    syncShellHuddle();
    syncShellHeader();
  }

  function onHuddleParticipantsChange(participants: HuddleParticipant[]): void {
    huddleUI.participants = participants;
    syncShellHuddle();
  }

  // ── Reactions ──

  function reloadReactionUsage(): void {
    reactionTracker.reload(state.myPeerId);
  }

  // ── Modal helpers ──

  function showModal(
    title: string,
    bodyHTML: string,
    onSubmit: (form: HTMLFormElement) => boolean | void | Promise<boolean | void>,
  ): HTMLDivElement {
    return svelteShowModal(title, bodyHTML, onSubmit);
  }

  function showCreateWorkspaceModal(): void {
    showModal(
      'Create Workspace',
      `<div class="form-group"><label>Workspace Name</label><input type="text" name="name" placeholder="My Team" required /></div>
       <div class="form-group"><label>Your Display Name</label><input type="text" name="alias" placeholder="Your name" required /></div>`,
      (form) => {
        const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        if (!name || !alias) return;
        state.myAlias = alias;
        const ws = callbacks.createWorkspace(name, alias);
        state.activeWorkspaceId = ws.id;
        state.activeChannelId = ws.channels[0]?.id || null;
        Promise.all([
          callbacks.persistWorkspace(ws.id),
          callbacks.persistSetting('myAlias', alias),
        ]).catch(err => console.error('[DecentChat] Failed to persist workspace:', err));
        renderApp();
        showToast(`Workspace "${name}" created! Click 🔗 to copy invite link.`, 'success');
      },
    );
  }

  function showJoinWithInvite(inviteCode: string, peerId: string, workspaceName: string, inviteData?: InviteData): void {
    showModal(
      `Join ${workspaceName || 'Workspace'}`,
      `<input type="hidden" name="peerId" value="${peerId}" />
       ${workspaceName ? `<p style="color: var(--text-muted); margin-bottom: 16px; font-size: 15px;">You've been invited to <strong>${escapeHtml(workspaceName)}</strong></p>` : ''}
       <div class="form-group"><label>Your Display Name</label><input type="text" name="alias" placeholder="Enter your name" required autofocus /></div>`,
      (form) => {
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        if (!alias) return;
        state.myAlias = alias;
        callbacks.persistSetting('myAlias', alias);
        callbacks.joinWorkspace(workspaceName || inviteCode, alias, peerId, inviteData);
        showToast(`Joining ${workspaceName || 'workspace'}...`);
      },
    );
  }

  function parseJoinInviteInput(invite: string): { code: string; peerId?: string; inviteData?: InviteData; error?: string } {
    if (invite.includes('://') || invite.includes('/')) {
      try {
        const data = InviteURI.decode(invite);
        if (data.host && data.port) {
          console.log(`[DecentChat] Invite points to signaling: ${data.host}:${data.port}`);
        }
        return { code: data.inviteCode, peerId: data.peerId, inviteData: data };
      } catch {
        return { code: '', error: 'Invalid invite link' };
      }
    }
    return { code: invite.toUpperCase() };
  }

  function showJoinWorkspaceModal(): void {
    svelteShowJoinWorkspaceModal({
      parseInvite: (invite: string) => parseJoinInviteInput(invite),
      onJoin: (wsName: string, alias: string, peerId: string, inviteDataParam?: any) => {
        state.myAlias = alias;
        callbacks.persistSetting('myAlias', alias);
        callbacks.joinWorkspace(wsName, alias, peerId, inviteDataParam);
        showToast(`Joining workspace... connecting to ${peerId.slice(0, 8)}`);
      },
      onToast: (msg: string, type?: string) => showToast(msg, type as any),
    });
  }

  function showConnectPeerModal(): void {
    showModal(
      'Connect to Peer',
      `<div class="form-group"><label>Peer ID</label><input type="text" name="peerId" placeholder="Enter peer ID" required /></div>`,
      (form) => {
        const peerId = (form.elements.namedItem('peerId') as HTMLInputElement).value.trim();
        if (peerId) { callbacks.connectPeer(peerId); showToast(`Connecting to ${peerId.slice(0, 8)}...`); }
      },
    );
  }

  function showCreateChannelModal(): void {
    if (!state.activeWorkspaceId) return;
    showModal(
      'Create Channel',
      `<div class="form-group"><label>Channel Name</label><input type="text" name="name" placeholder="e.g. random, dev, design" required /></div>`,
      (form) => {
        const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim().toLowerCase().replace(/\s+/g, '-');
        if (!name) return;
        const result = callbacks.createChannel(name);
        if (result.success && result.channel) {
          callbacks.persistWorkspace(state.activeWorkspaceId!);
          switchChannel(result.channel.id);
          updateSidebar();
          showToast(`#${name} created!`, 'success');
        } else {
          showToast(result.error || 'Failed to create channel', 'error');
        }
      },
    );
  }

  function showCreateDMModal(): void {
    if (!state.activeWorkspaceId) return;
    const ws = workspaceManager.getWorkspace(state.activeWorkspaceId)!;
    const otherMembers = ws.members.filter(
      (m: import('decent-protocol').WorkspaceMember) => m.peerId !== state.myPeerId,
    );
    if (otherMembers.length === 0) {
      showToast('No other members in workspace yet. Invite someone first!', 'error');
      return;
    }
    showPeerSelectModal({
      title: 'New Direct Message',
      label: 'Select a member',
      peers: otherMembers.map(m => ({
        peerId: m.peerId, name: m.alias,
        statusClass: peerStatusClass(m.peerId),
        statusTitle: peerStatusTitle(m.peerId),
      })),
      onSelect: (peerId: string) => {
        const result = callbacks.createDM(peerId);
        if (result.success && result.channel) { switchChannel(result.channel.id); updateSidebar(); }
      },
    });
  }

  function showAddContactModal(): void {
    svelteShowAddContactModal({
      onAdd: async (contact: Contact) => {
        await callbacks.addContact?.(contact);
        await refreshContactsCache();
        updateSidebar();
      },
      onToast: (msg: string, type?: string) => showToast(msg, type as any),
    });
  }

  function showStartDirectMessageModal(): void {
    if (cachedData.contacts.length === 0) {
      showToast('Add a contact first to start a DM', 'error');
      return;
    }
    showPeerSelectModal({
      title: 'Start Direct Message',
      label: 'Select a contact',
      peers: cachedData.contacts.map(c => ({
        peerId: c.peerId, name: c.displayName,
        statusClass: peerStatusClass(c.peerId),
        statusTitle: peerStatusTitle(c.peerId),
      })),
      onSelect: (peerId: string) => {
        callbacks.startDirectMessage?.(peerId).then(async (conv) => {
          await refreshContactsCache();
          switchToDirectConversation(conv.id);
        });
      },
    });
  }

  function showMessageInfo(messageId: string): void {
    const info = callbacks.getMessageReceiptInfo?.(messageId);
    if (!info) { showToast('Message info unavailable', 'error'); return; }
    showMessageInfoModal(info);
  }

  function showChannelMembersModal(): void {
    if (!state.activeWorkspaceId || !state.activeChannelId) return;
    const ws = workspaceManager.getWorkspace(state.activeWorkspaceId);
    const channel = ws ? workspaceManager.getChannel(ws.id, state.activeChannelId) : null;
    if (!ws || !channel) return;

    const channelMembers = ws.members.filter(m => channel.members.includes(m.peerId));
    svelteShowChannelMembersModal({
      channelName: channel.name,
      members: channelMembers.map(member => ({
        peerId: member.peerId,
        name: getPeerAlias(member.peerId),
        isOnline: state.connectedPeers.has(member.peerId) || member.peerId === state.myPeerId,
        isYou: member.peerId === state.myPeerId,
        isBot: !!(member as any).isBot,
        color: peerColor(member.peerId),
      })),
    });
  }

  function showWorkspaceMembersModal(): void {
    if (!state.activeWorkspaceId) return;
    const ws = workspaceManager.getWorkspace(state.activeWorkspaceId);
    if (!ws) return;

    const myMember = ws.members.find(m => m.peerId === state.myPeerId);
    const myRole = myMember?.role || 'member';
    const isOwner = myRole === 'owner' || ws.createdBy === state.myPeerId || workspaceManager.isOwner(ws.id, state.myPeerId);
    const isAdminOrOwner = isOwner || myRole === 'admin' || workspaceManager.isAdmin(ws.id, state.myPeerId);

    svelteShowWorkspaceMembersModal({
      members: ws.members.map(member => ({
        peerId: member.peerId,
        name: getPeerAlias(member.peerId),
        role: member.role,
        isBot: !!member.isBot,
        isOnline: state.connectedPeers.has(member.peerId) || member.peerId === state.myPeerId,
        isYou: member.peerId === state.myPeerId,
        color: member.isBot ? '#7c3aed' : peerColor(member.peerId),
      })),
      isOwner,
      isAdminOrOwner,
      onRemove: async (peerId: string) => {
        if (!callbacks.removeWorkspaceMember) return { success: false, error: 'Not available' };
        return callbacks.removeWorkspaceMember(peerId);
      },
      onPromote: async (peerId: string) => {
        if (!callbacks.promoteMember) return { success: false, error: 'Not available' };
        return callbacks.promoteMember(peerId, 'admin');
      },
      onDemote: async (peerId: string) => {
        if (!callbacks.demoteMember) return { success: false, error: 'Not available' };
        return callbacks.demoteMember(peerId);
      },
      onToast: (msg: string, type?: string) => showToast(msg, type as any),
      onRefresh: () => { updateSidebar(); syncShellHeader(); },
    });
  }

  function showWorkspaceSettingsModal(): void {
    if (!state.activeWorkspaceId) return;
    const ws = workspaceManager.getWorkspace(state.activeWorkspaceId);
    if (!ws) return;
    const isOwner = workspaceManager.isOwner(ws.id, state.myPeerId);
    const perms = ws.permissions ?? { whoCanCreateChannels: 'everyone', whoCanInviteMembers: 'everyone' };

    svelteShowWorkspaceSettingsModal({
      name: ws.name,
      description: ws.description || '',
      isOwner,
      permissions: { whoCanCreateChannels: perms.whoCanCreateChannels, whoCanInviteMembers: perms.whoCanInviteMembers },
      onSave: async (data: { name: string; description: string; whoCanCreateChannels: string; whoCanInviteMembers: string }) => {
        if (data.name !== ws.name || data.description !== (ws.description || '')) {
          const infoRes = await callbacks.updateWorkspaceInfo?.({ name: data.name, description: data.description });
          if (infoRes && !infoRes.success) { showToast(infoRes.error || 'Failed to update workspace info', 'error'); return false; }
        }

        const normalizedPerms: WorkspacePermissions = {
          whoCanCreateChannels: data.whoCanCreateChannels === 'admins' ? 'admins' : 'everyone',
          whoCanInviteMembers: data.whoCanInviteMembers === 'admins' ? 'admins' : 'everyone',
        };

        if (
          normalizedPerms.whoCanCreateChannels !== perms.whoCanCreateChannels ||
          normalizedPerms.whoCanInviteMembers !== perms.whoCanInviteMembers
        ) {
          const permRes = await callbacks.updateWorkspacePermissions?.(normalizedPerms);
          if (permRes && !permRes.success) { showToast(permRes.error || 'Failed to update permissions', 'error'); return false; }
        }
        showToast('Workspace settings saved', 'success');
        updateSidebar();
        syncShellHeader();
        return true;
      },
      onManageMembers: () => showWorkspaceMembersModal(),
      onDelete: async () => {
        const result = await callbacks.deleteWorkspace?.(ws.id);
        if (result) {
          showToast('Workspace deleted', 'success');
          state.activeWorkspaceId = null;
          state.activeChannelId = null;
          renderApp();
        } else {
          showToast('Failed to delete workspace', 'error');
        }
      },
      onToast: (msg: string, type?: string) => showToast(msg, type as any),
    });
  }

  function showMyQR(): void {
    const publicKey = callbacks.getMyPublicKey?.();
    if (!publicKey) { showToast('Public key not available yet', 'error'); return; }
    qrCodeManager.showMyQR({
      publicKey,
      displayName: state.myAlias || state.myPeerId.slice(0, 8),
      peerId: state.myPeerId,
    });
  }

  function showScanQR(): void {
    qrCodeManager.showScanQR();
  }

  function showSearchPanel(): void {
    shellData.search.open = !shellData.search.open;
    shellData.search.myPeerId = state.myPeerId;
    shellData.search.myAlias = state.myAlias || 'You';
  }

  function showSettings(): void {
    const wsId = state.activeWorkspaceId;
    settingsPanel = new SettingsPanel(
      async () => ({
        ...await (callbacks.getSettings?.() || {}),
        myPeerId: state.myPeerId,
        myAlias: state.myAlias,
        activeWorkspaceId: wsId,
        workspaceAlias: wsId ? (state.workspaceAliases?.[wsId] || '') : '',
      }),
      async (key, value) => {
        if (key === 'workspaceAlias' && wsId) { callbacks.setWorkspaceAlias?.(wsId, value as string); return; }
        if (key === 'myAlias' && typeof value === 'string' && value.trim()) { state.myAlias = value.trim(); }
        await callbacks.persistSetting(key, value);
        if (key === 'showLiveReconnectActivity') { updateSidebar(); }
      },
      async (action) => {
        if (action === 'generateSeed') {
          await callbacks.onSettingsAction?.(action);
        } else if (action === 'seed-transfer') {
          const seed = await callbacks.getCurrentSeed?.();
          if (seed) { qrCodeManager.showSeedQR(seed); }
          else { showToast('No seed phrase found — generate one in Settings first', 'error'); }
        }
      },
    );
    void settingsPanel.show();
  }

  // ── Initialize shell callbacks (stable references for AppShell) ──

  setShellCallbacks({
    // Welcome screen
    onCreateWorkspace: () => showCreateWorkspaceModal(),
    onJoinWorkspace: () => showJoinWorkspaceModal(),
    onRestoreSeed: () => qrCodeManager.showRestoreSeed(),

    // Workspace rail
    onSwitchToDMs: () => {
      state.activeWorkspaceId = null;
      if (!state.activeDirectConversationId) state.activeChannelId = null;
      persistViewState();
      refreshContactsCache().catch(() => {});
      syncShellSidebar();
      syncShellRail();
      syncShellHeader();
      syncShellMessages();
    },
    onSwitchWorkspace: (wsId) => switchWorkspace(wsId),
    onToggleActivity: () => toggleActivityPanel(),
    onAddWorkspace: () => showCreateWorkspaceModal(),

    // Sidebar
    onChannelClick: (channelId) => switchChannel(channelId),
    onMemberClick: (peerId) => startMemberDM(peerId),
    onDirectConvClick: (convId) => switchToDirectConversation(convId),
    onAddChannel: () => showCreateChannelModal(),
    onStartDM: () => showStartDirectMessageModal(),
    onAddContact: () => showAddContactModal(),
    onConnectPeer: () => showConnectPeerModal(),
    onCopyInvite: () => {
      if (!state.activeWorkspaceId) return;
      const inviteURL = callbacks.generateInviteURL?.(state.activeWorkspaceId);
      if (inviteURL) { navigator.clipboard.writeText(inviteURL); showToast('Invite link copied!', 'success'); }
    },
    onShowQR: () => showMyQR(),
    onCopyPeerId: () => { navigator.clipboard.writeText(state.myPeerId); showToast('Peer ID copied!'); },
    onWorkspaceSettings: () => showWorkspaceSettingsModal(),
    onWorkspaceMembers: () => showWorkspaceMembersModal(),
    onWorkspaceInvite: () => {
      if (!state.activeWorkspaceId) return;
      const inviteURL = callbacks.generateInviteURL?.(state.activeWorkspaceId);
      if (inviteURL) { navigator.clipboard.writeText(inviteURL); showToast('Invite link copied!', 'success'); }
    },
    onWorkspaceNotifications: () => showSettings(),
    getUnreadCount: (id) => callbacks.getUnreadCount?.(id) || 0,
    getPeerAlias: (peerId) => getPeerAlias(peerId),
    getPeerStatusClass: (peerId) => peerStatusClass(peerId),
    getPeerStatusTitle: (peerId) => peerStatusTitle(peerId),

    // Channel header
    onHamburger: () => {
      const sidebar = document.getElementById('sidebar');
      sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar();
    },
    onHuddleToggle: async () => {
      const channelId = state.activeChannelId;
      if (!channelId) return;
      if (huddleUI.state === 'in-call') { await callbacks.leaveHuddle?.(); }
      else { await callbacks.startHuddle?.(channelId); }
    },
    onHeaderConnectPeer: () => showConnectPeerModal(),
    onHeaderShowQR: () => showMyQR(),
    onSearch: () => showSearchPanel(),
    onInvite: () => {
      if (!state.activeWorkspaceId) return;
      const inviteURL = callbacks.generateInviteURL?.(state.activeWorkspaceId);
      if (inviteURL) { navigator.clipboard.writeText(inviteURL); showToast('Invite link copied! Share it with anyone.', 'success'); }
    },
    onSettings: () => showSettings(),
    onChannelMembers: () => showChannelMembersModal(),

    // Messages
    getThread: (channelId, messageId) => messageStore.getThread(channelId, messageId),
    isBot: (senderId) => {
      const ws = state.activeWorkspaceId ? workspaceManager.getWorkspace(state.activeWorkspaceId) : null;
      return ws?.members.find((m: any) => m.peerId === senderId)?.isBot === true;
    },
    onOpenThread: (messageId) => openThread(messageId),
    onToggleReaction: (messageId, emoji) => callbacks.toggleReaction?.(messageId, emoji),
    onRememberReaction: (emoji) => rememberReaction(emoji),
    onShowMessageInfo: (messageId) => showMessageInfo(messageId),
    onImageClick: (name, src) => openLightbox(src, name),

    // Compose
    onSend: async (text, files) => {
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          await callbacks.sendAttachment(files[i], i === 0 ? (text || undefined) : undefined, undefined);
        }
      } else if (text) {
        await callbacks.sendMessage(text, undefined);
      }
    },
    onTyping: () => callbacks.broadcastTyping?.(),
    onStopTyping: () => callbacks.broadcastStopTyping?.(),
    getCommandSuggestions: callbacks.getCommandSuggestions
      ? (prefix: string) => callbacks.getCommandSuggestions!(prefix)
      : undefined,
    getMembers: () => {
      const ws = state.activeWorkspaceId ? workspaceManager.getWorkspace(state.activeWorkspaceId) : null;
      if (!ws) return [];
      return ws.members.filter((m: any) => m.peerId !== state.myPeerId).map((m: any) => ({
        peerId: m.peerId, name: getPeerAlias(m.peerId),
      }));
    },

    // Thread
    onCloseThread: () => closeThread(),
    onThreadSend: async (text, files) => {
      const threadId = state.activeThreadId || undefined;
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          await callbacks.sendAttachment(files[i], i === 0 ? (text || undefined) : undefined, threadId);
        }
      } else if (text) {
        await callbacks.sendMessage(text, threadId);
      }
    },

    // Huddle
    onToggleMute: () => {
      const muted = callbacks.toggleHuddleMute?.() ?? false;
      huddleUI.muted = muted;
      syncShellHuddle();
    },
    onLeaveHuddle: async () => { await callbacks.leaveHuddle?.(); },
    onJoinHuddle: async () => {
      const channelId = huddleUI.channelId || state.activeChannelId;
      if (channelId) await callbacks.joinHuddle?.(channelId);
    },

    // Lightbox
    onCloseLightbox: () => closeLightbox(),

    // Search
    onSearchQuery: (query) => {
      const search = new MessageSearch(messageStore);
      return search.search(query, { channelId: state.activeChannelId || undefined, limit: 20 });
    },
    onScrollToMessage: (messageId) => scrollToMessageAndHighlight(messageId),
    onCloseSearch: () => { shellData.search.open = false; },

    // Activity
    onCloseActivity: () => toggleActivityPanel(),
    onMarkAllRead: () => { callbacks.markAllActivityRead?.(); },
    onMarkRead: (id) => callbacks.markActivityRead?.(id),
    onNavigateActivity: (item: any) => {
      toggleActivityPanel();
      const needsChannelSwitch = item.channelId && item.channelId !== state.activeChannelId;
      const needsThreadOpen = !!(item.threadId && item.threadId.trim());
      const needsThreadSwitch = needsThreadOpen && (!state.threadOpen || state.activeThreadId !== item.threadId);

      if (needsChannelSwitch) switchChannel(item.channelId);

      if (needsThreadOpen && needsThreadSwitch) {
        setTimeout(() => {
          openThread(item.threadId!);
          if (item.messageId) setTimeout(() => scrollToMessageAndHighlight(item.messageId, 'thread-messages'), 100);
        }, needsChannelSwitch ? 50 : 0);
      } else if (needsThreadOpen && !needsThreadSwitch) {
        if (item.messageId) scrollToMessageAndHighlight(item.messageId, 'thread-messages');
      } else if (item.messageId) {
        setTimeout(() => scrollToMessageAndHighlight(item.messageId, 'messages-list'), needsChannelSwitch ? 100 : 0);
      }

      syncShellHeader();
      syncShellRail();
    },
    getActivityPeerAlias: (peerId) => getPeerAlias(peerId),
  });

  // ── Return public API ──

  return {
    syncShellAll,
    renderApp,
    renderWelcome,
    renderMessages,
    renderThreadMessages,
    appendMessageToDOM,
    updateSidebar,
    updateChannelHeader,
    updateWorkspaceRail,
    updateMessageStatus,
    updateStreamingMessage,
    finalizeStreamingMessage,
    updateThreadIndicator,
    updateTypingIndicator,
    switchChannel,
    switchToDirectConversation,
    switchWorkspace,
    openThread,
    closeThread,
    refreshContactsCache,
    showCreateWorkspaceModal,
    showJoinWorkspaceModal,
    showJoinWithInvite,
    showToast,
    onHuddleStateChange,
    onHuddleParticipantsChange,
    refreshActivityPanel,
    reloadReactionUsage,
  };
}
