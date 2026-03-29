/**
 * uiService — thin orchestration layer for Svelte UI stores/components.
 */

import type {
  WorkspaceManager,
  MessageStore,
  PlaintextMessage,
  InviteData,
} from '@decentchat/protocol';
import type { HuddleState, HuddleParticipant } from '../huddle/HuddleManager';
import type { AppState } from '../main';
import type { UIService } from './uiService.types';
export type { UIService } from './uiService.types';
import { MessageSearch } from './MessageSearch';
import { ReactionTracker } from './ReactionTracker';
import { peerColor as peerColorUtil, escapeHtml as escapeHtmlUtil } from '../lib/utils/peer';
import { toast } from '../lib/components/shared/Toast.svelte';
import { createQRFlow } from '../lib/components/modals/QRFlowModal.svelte';
import type { UICallbacks } from './types';
export type { UICallbacks, ActivityItem } from './types';

import { huddleUI, lightboxUI, activityUI, cachedData } from '../lib/stores/ui.svelte';
import { shellData } from '../lib/stores/shell.svelte';

import { createShellSyncHelpers } from './uiShellSync';
import { createDomEffects } from './uiDomEffects';
import { createModalActions } from './uiModalActions';
import { registerShellCallbacks } from './registerShellCallbacks';

export function createUIService(
  state: AppState,
  workspaceManager: WorkspaceManager,
  messageStore: MessageStore,
  callbacks: UICallbacks,
): UIService {
  const messageSearch = new MessageSearch(messageStore);
  const reactionTracker = new ReactionTracker(state.myPeerId);

  const qrFlow = createQRFlow({
    onContactScanned: (data: any) => callbacks.onQRContactScanned?.(data),
    onSeedRestored: (mnemonic: string) => callbacks.onSeedRestored?.(mnemonic),
    validateSeed: (mnemonic: string) => callbacks.validateSeed?.(mnemonic) ?? null,
    showToast: (msg: string, type?: 'info' | 'error' | 'success') => showToast(msg, type),
  });

  lightboxUI.open = false;
  lightboxUI.src = '';
  lightboxUI.name = '';
  lightboxUI.blobUrl = null;

  function peerColor(peerId: string): string {
    return peerColorUtil(peerId);
  }

  function escapeHtml(text: string): string {
    return escapeHtmlUtil(text);
  }

  function peerStatusClass(peerId: string): string {
    if (peerId === state.myPeerId) return 'online';
    if (state.readyPeers.has(peerId)) return 'online';
    if (state.connectingPeers.has(peerId)) return 'connecting';
    return '';
  }

  function peerStatusTitle(peerId: string): string {
    if (peerId === state.myPeerId) return 'Online';
    if (state.readyPeers.has(peerId)) return 'Online';
    if (state.connectingPeers.has(peerId)) return 'Connecting...';
    return 'Offline';
  }

  function getPeerAlias(peerId: string): string {
    if (callbacks.getDisplayNameForPeer) return callbacks.getDisplayNameForPeer(peerId);
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
    if (!state.activeChannelId || !state.activeWorkspaceId) return 'Message...';
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

  let contactsCacheRefreshSeq = 0;
  let sidebarSyncQueued = false;
  let sidebarNeedsContactsRefresh = false;
  let contactsRefreshInFlight = false;
  let messageSyncQueued = false;
  let headerSyncQueued = false;
  let appRenderQueued = false;

  async function refreshContactsCache(): Promise<void> {
    const requestSeq = ++contactsCacheRefreshSeq;
    const [contacts, conversations] = await Promise.all([
      callbacks.getContacts?.() || Promise.resolve([]),
      callbacks.getDirectConversations?.() || Promise.resolve([]),
    ]);

    if (requestSeq !== contactsCacheRefreshSeq) return;

    cachedData.contacts = contacts;
    cachedData.directConversations = conversations.slice().sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

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

  const {
    syncShellRail,
    syncShellSidebar,
    syncShellHeader,
    syncShellMessages,
    syncShellCompose,
    syncShellThread,
    syncShellHuddle,
    syncShellLightbox,
    syncShellAll,
  } = createShellSyncHelpers({
    state,
    workspaceManager,
    messageStore,
    callbacks,
    getPeerAlias,
    getMyDisplayName,
    getComposePlaceholder,
    getFrequentReactions,
    peerStatusClass,
    peerStatusTitle,
    hasOlderMessages: callbacks.hasOlderMessages,
  });

  const {
    closeMobileSidebar,
    toggleMobileSidebar,
    openLightbox,
    closeLightbox,
    toggleActivityPanel,
    refreshActivityPanel,
    scrollToMessageAndHighlight,
    clampMainMessagesScroll,
  } = createDomEffects({
    callbacks,
    syncShellSidebar,
    syncShellLightbox,
  });

  function switchChannel(channelId: string): void {
    state.activeChannelId = channelId;
    state.activeDirectConversationId = null;
    callbacks.setFocusedChannel?.(channelId);
    callbacks.markChannelRead?.(channelId);
    void callbacks.onChannelViewed?.(channelId);
    closeThread();
    persistViewState();
    updateSidebar({ refreshContacts: false });
    syncShellHeader();
    renderMessages();
    syncShellCompose();
    closeMobileSidebar();
  }

  function switchToDirectConversation(conversationId: string): void {
    const alreadyActive = state.activeDirectConversationId === conversationId
      && state.activeChannelId === conversationId
      && state.activeWorkspaceId === null;

    if (alreadyActive && !state.threadOpen) {
      callbacks.markChannelRead?.(conversationId);
      void callbacks.onChannelViewed?.(conversationId);
      closeMobileSidebar();
      return;
    }

    state.activeDirectConversationId = conversationId;
    state.activeChannelId = conversationId;
    state.activeWorkspaceId = null;
    callbacks.setFocusedChannel?.(conversationId);
    callbacks.markChannelRead?.(conversationId);
    void callbacks.onChannelViewed?.(conversationId);
    closeThread();
    persistViewState();
    updateSidebar({ refreshContacts: false });
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
    callbacks.setFocusedChannel?.(state.activeChannelId);
    if (state.activeChannelId) {
      callbacks.markChannelRead?.(state.activeChannelId);
      void callbacks.onChannelViewed?.(state.activeChannelId);
    }
    closeThread();
    persistViewState();
    void callbacks.onWorkspaceActivated?.(workspaceId);
    updateSidebar({ refreshContacts: false });
    syncShellRail();
    syncShellHeader();
    renderMessages();
    syncShellCompose();
    closeMobileSidebar();
  }

  function openThread(messageId: string): void {
    state.activeThreadId = messageId;
    state.threadOpen = true;
    shellData.thread.scrollTargetMessageId = null;
    shellData.thread.scrollTargetNonce = 0;
    syncShellThread();
    persistViewState();

    if (state.activeChannelId) {
      callbacks.markThreadActivityRead?.(state.activeChannelId, messageId);
      syncShellHeader();
    }

    clampMainMessagesScroll();
    requestAnimationFrame(() => (window as any).__ctrl?.syncReactionsToDOM?.());
    setTimeout(() => (document.getElementById('thread-input') as HTMLTextAreaElement | null)?.focus(), 100);
  }

  function closeThread(): void {
    state.activeThreadId = null;
    state.threadOpen = false;
    shellData.thread.scrollTargetMessageId = null;
    shellData.thread.scrollTargetNonce = 0;
    persistViewState();
    syncShellThread();
    clampMainMessagesScroll();
  }

  function startMemberDM(peerId: string): void {
    callbacks.startDirectMessage?.(peerId, {
      sourceWorkspaceId: state.activeWorkspaceId || undefined,
    })
      .then(async conv => {
        await refreshContactsCache();
        switchToDirectConversation(conv.id);
      })
      .catch((err: any) => {
        const message = err?.message || 'Could not start DM';
        showToast(message, 'error');
      });
  }

  function hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => loading.remove(), 300);
    }
  }

  function renderWelcome(): void {
    hideLoading();
    shellData.welcome.myPeerId = state.myPeerId;
    shellData.welcome.hasWorkspace = (callbacks.getAllWorkspaces?.().length || 0) > 0;
    shellData.view = 'welcome';
  }

  function scheduleAppRender(): void {
    if (appRenderQueued) return;
    appRenderQueued = true;
    const run = () => {
      appRenderQueued = false;
      hideLoading();
      syncShellAll();
      shellData.view = 'app';
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function renderApp(): void {
    scheduleAppRender();
  }

  function scheduleMessageSync(): void {
    if (messageSyncQueued) return;
    messageSyncQueued = true;
    const run = () => {
      messageSyncQueued = false;
      syncShellMessages();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function renderMessages(): void {
    scheduleMessageSync();
  }

  function renderThreadMessages(): void {
    syncShellThread();
  }

  function scheduleSidebarSync(): void {
    if (sidebarSyncQueued) return;
    sidebarSyncQueued = true;

    const run = () => {
      sidebarSyncQueued = false;
      syncShellSidebar();

      if (!sidebarNeedsContactsRefresh || contactsRefreshInFlight) return;

      sidebarNeedsContactsRefresh = false;
      contactsRefreshInFlight = true;
      refreshContactsCache()
        .then(() => syncShellSidebar())
        .catch(() => {})
        .finally(() => {
          contactsRefreshInFlight = false;
          if (sidebarNeedsContactsRefresh) scheduleSidebarSync();
        });
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function updateSidebar(options: { refreshContacts?: boolean } = {}): void {
    const { refreshContacts = true } = options;
    if (refreshContacts) sidebarNeedsContactsRefresh = true;
    scheduleSidebarSync();
  }

  function scheduleHeaderSync(): void {
    if (headerSyncQueued) return;
    headerSyncQueued = true;
    const run = () => {
      headerSyncQueued = false;
      syncShellHeader();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function updateChannelHeader(): void {
    scheduleHeaderSync();
  }

  function updateWorkspaceRail(): void {
    syncShellRail();
  }

  function appendMessageToDOM(_msg: PlaintextMessage, container?: HTMLElement): void {
    const isThreadContainer = container?.id === 'thread-messages';
    isThreadContainer ? renderThreadMessages() : renderMessages();
  }

  function updateMessageStatus(
    messageId: string,
    status: 'pending' | 'sent' | 'delivered' | 'read',
    detail?: { acked?: number; total?: number; read?: number },
  ): void {
    const patch = (msg: any) => {
      if (!msg || msg.id !== messageId) return msg;

      const nextRecipientPeerIds = typeof detail?.total === 'number'
        ? Array.from({ length: detail.total }, (_, i) => msg?.recipientPeerIds?.[i] ?? `pending-${i}`)
        : msg.recipientPeerIds;
      const nextAckedBy = typeof detail?.acked === 'number'
        ? Array.from({ length: detail.acked }, (_, i) => msg?.ackedBy?.[i] ?? `acked-${i}`)
        : msg.ackedBy;
      const nextReadBy = typeof detail?.read === 'number'
        ? Array.from({ length: detail.read }, (_, i) => msg?.readBy?.[i] ?? `read-${i}`)
        : msg.readBy;

      const sameRecipientCount = nextRecipientPeerIds === msg.recipientPeerIds
        || (Array.isArray(nextRecipientPeerIds)
          && Array.isArray(msg.recipientPeerIds)
          && nextRecipientPeerIds.length === msg.recipientPeerIds.length);
      const sameAckedCount = nextAckedBy === msg.ackedBy
        || (Array.isArray(nextAckedBy)
          && Array.isArray(msg.ackedBy)
          && nextAckedBy.length === msg.ackedBy.length);
      const sameReadCount = nextReadBy === msg.readBy
        || (Array.isArray(nextReadBy)
          && Array.isArray(msg.readBy)
          && nextReadBy.length === msg.readBy.length);

      if (msg.status === status && sameRecipientCount && sameAckedCount && sameReadCount) {
        return msg;
      }

      return {
        ...msg,
        status,
        recipientPeerIds: nextRecipientPeerIds,
        ackedBy: nextAckedBy,
        readBy: nextReadBy,
      };
    };

    let messagesChanged = false;
    shellData.messages.messages = shellData.messages.messages.map((msg: any) => {
      const next = patch(msg);
      if (next !== msg) messagesChanged = true;
      return next;
    });

    // If the message wasn't found in the shell store, it may not have been
    // synced from the MessageStore yet (the rAF-based syncShellMessages is
    // still queued).  Flush the sync synchronously and retry the patch so the
    // status update isn't silently lost.
    if (!messagesChanged && !shellData.messages.messages.some((m: any) => m?.id === messageId)) {
      syncShellMessages();
      shellData.messages.messages = shellData.messages.messages.map((msg: any) => {
        const next = patch(msg);
        if (next !== msg) messagesChanged = true;
        return next;
      });
    }

    let threadParentChanged = false;
    if (shellData.thread.parentMessage?.id === messageId) {
      const parent = shellData.thread.parentMessage as any;
      const nextParent = patch(parent);
      threadParentChanged = nextParent !== parent;
      if (threadParentChanged) {
        shellData.thread.parentMessage = nextParent;
      }
    }

    let threadRepliesChanged = false;
    shellData.thread.replies = shellData.thread.replies.map((msg: any) => {
      const next = patch(msg);
      if (next !== msg) threadRepliesChanged = true;
      return next;
    });

    if (!(messagesChanged || threadParentChanged || threadRepliesChanged)) return;

    renderMessages();
    if (state.threadOpen && state.activeThreadId) {
      renderThreadMessages();
    }

    const total = Math.max(0, detail?.total ?? 0);
    const acked = Math.max(0, Math.min(detail?.acked ?? 0, total));
    const read = Math.max(0, Math.min(detail?.read ?? 0, total));
    const effectiveDelivered = (status === 'delivered' || status === 'read') ? Math.max(acked, total) : acked;
    const effectiveRead = status === 'read' ? Math.max(read, total) : read;
    const symbol = status === 'read' || status === 'delivered' ? '✓✓' : status === 'sent' ? '✓' : '⏳';
    const tooltip = status === 'read'
      ? (total > 0 ? `Read by ${effectiveRead}/${total}` : 'Read')
      : status === 'delivered'
        ? (total > 0 ? `Delivered to ${effectiveDelivered}/${total} • Read by ${effectiveRead}/${total}` : 'Delivered')
        : status === 'sent'
          ? (total > 0 ? 'Sent • Waiting for delivery receipt' : 'Sent')
          : (total > 0 && (effectiveDelivered > 0 || effectiveRead > 0)
              ? `Syncing status… Delivered to ${effectiveDelivered}/${total} • Read by ${effectiveRead}/${total}`
              : 'Sending…');

    const statusNodes = document.querySelectorAll(`.msg-delivery-status[data-message-id="${messageId}"]`);
    statusNodes.forEach((node) => {
      const el = node as HTMLElement;
      el.textContent = symbol;
      el.setAttribute('data-tooltip', tooltip);
      el.classList.remove('pending', 'sent', 'delivered', 'read');
      el.classList.add(status);
    });

    if (total > 0) {
      const detailText = `${status === 'read' ? effectiveRead : (status === 'delivered' ? effectiveDelivered : acked)}/${total}`;
      const detailNodes = document.querySelectorAll(`.msg-delivery-detail[data-message-id="${messageId}"]`);
      detailNodes.forEach((node) => {
        (node as HTMLElement).textContent = detailText;
      });
    }
  }

  function updateStreamingMessage(_messageId: string, _content: string): void {
    renderMessages();
    if (state.threadOpen) {
      renderThreadMessages();
    }
  }

  function finalizeStreamingMessage(_messageId: string): void {
    renderMessages();
    if (state.threadOpen) {
      renderThreadMessages();
    }
  }

  function updateThreadIndicator(_parentMessageId: string, _channelId: string): void {
    renderMessages();
  }

  function updateTypingIndicator(text: string): void {
    shellData.typingText = text;
  }

  function showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    toast(message, type);
  }

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

  function reloadReactionUsage(): void {
    reactionTracker.reload(state.myPeerId);
  }

  const modalActions = createModalActions({
    state,
    workspaceManager,
    callbacks,
    qrFlow,
    showToast,
    refreshContactsCache,
    updateSidebar,
    syncShellHeader,
    switchChannel,
    switchToDirectConversation,
    renderApp,
    peerColor,
    peerStatusClass,
    peerStatusTitle,
    getPeerAlias,
    escapeHtml,
  });

  registerShellCallbacks({
    state,
    workspaceManager,
    messageStore,
    callbacks,
    modalActions,
    toggleActivityPanel,
    persistViewState,
    refreshContactsCache,
    syncShellSidebar,
    syncShellRail,
    syncShellHeader,
    syncShellMessages,
    refreshActivityPanel,
    switchWorkspace,
    switchChannel,
    switchToDirectConversation,
    startMemberDM,
    openThread,
    closeThread,
    rememberReaction,
    showMessageInfo: modalActions.showMessageInfo,
    openLightbox,
    scrollToMessageAndHighlight,
    getPeerAlias,
    peerStatusClass,
    peerStatusTitle,
    showToast,
    toggleMobileSidebar,
    closeMobileSidebar,
    closeLightbox,
    syncShellHuddle,
  });

  void refreshContactsCache();

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
    showCreateWorkspaceModal: modalActions.showCreateWorkspaceModal,
    showJoinWorkspaceModal: modalActions.showJoinWorkspaceModal,
    showJoinWithInvite: modalActions.showJoinWithInvite,
    showToast,
    onHuddleStateChange,
    onHuddleParticipantsChange,
    refreshActivityPanel,
    reloadReactionUsage,
  };
}
