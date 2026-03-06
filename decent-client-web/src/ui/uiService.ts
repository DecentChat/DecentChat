/**
 * uiService — thin orchestration layer for Svelte UI stores/components.
 */

import type {
  WorkspaceManager,
  MessageStore,
  PlaintextMessage,
  InviteData,
} from 'decent-protocol';
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

  async function refreshContactsCache(): Promise<void> {
    const [contacts, conversations] = await Promise.all([
      callbacks.getContacts?.() || Promise.resolve([]),
      callbacks.getDirectConversations?.() || Promise.resolve([]),
    ]);
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
    void refreshContactsCache();
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

    clampMainMessagesScroll();
    setTimeout(() => (document.getElementById('thread-input') as HTMLTextAreaElement | null)?.focus(), 100);
  }

  function closeThread(): void {
    state.activeThreadId = null;
    state.threadOpen = false;
    persistViewState();
    syncShellThread();
    clampMainMessagesScroll();
  }

  function startMemberDM(peerId: string): void {
    const existing = cachedData.directConversations.find(c => c.contactPeerId === peerId);
    if (existing) {
      switchToDirectConversation(existing.id);
      return;
    }
    callbacks.startDirectMessage?.(peerId)
      .then(async conv => {
        await refreshContactsCache();
        switchToDirectConversation(conv.id);
      })
      .catch(() => showToast('Could not start DM', 'error'));
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
    refreshContactsCache().catch(() => {}).finally(() => syncShellSidebar());
  }

  function updateChannelHeader(): void {
    syncShellHeader();
  }

  function updateWorkspaceRail(): void {
    syncShellRail();
  }

  function appendMessageToDOM(_msg: PlaintextMessage, container?: HTMLElement): void {
    const isThreadContainer = container?.id === 'thread-messages';
    isThreadContainer ? renderThreadMessages() : renderMessages();
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
