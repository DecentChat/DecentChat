import type { WorkspaceManager, MessageStore } from 'decent-protocol';
import type { AppState } from '../main';
import { shellData, setShellCallbacks } from '../lib/stores/shell.svelte';
import { huddleUI } from '../lib/stores/ui.svelte';
import type { UICallbacks } from './types';
import { MessageSearch } from './MessageSearch';
import type { ModalActions } from './uiModalActions';

interface RegisterShellCallbacksContext {
  state: AppState;
  workspaceManager: WorkspaceManager;
  messageStore: MessageStore;
  callbacks: UICallbacks;
  modalActions: ModalActions;
  toggleActivityPanel: () => void;
  persistViewState: () => void;
  refreshContactsCache: () => Promise<void>;
  syncShellSidebar: () => void;
  syncShellRail: () => void;
  syncShellHeader: () => void;
  syncShellMessages: () => void;
  switchWorkspace: (workspaceId: string) => void;
  switchChannel: (channelId: string) => void;
  switchToDirectConversation: (conversationId: string) => void;
  startMemberDM: (peerId: string) => void;
  openThread: (messageId: string) => void;
  closeThread: () => void;
  rememberReaction: (emoji: string) => void;
  showMessageInfo: (messageId: string) => void;
  openLightbox: (src: string, name: string) => void;
  scrollToMessageAndHighlight: (messageId: string, containerId?: string) => void;
  getPeerAlias: (peerId: string) => string;
  peerStatusClass: (peerId: string) => string;
  peerStatusTitle: (peerId: string) => string;
  showToast: (message: string, type?: 'info' | 'error' | 'success') => void;
  toggleMobileSidebar: () => void;
  closeLightbox: () => void;
  syncShellHuddle: () => void;
}

export function registerShellCallbacks(ctx: RegisterShellCallbacksContext): void {
  const {
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
    showMessageInfo,
    openLightbox,
    scrollToMessageAndHighlight,
    getPeerAlias,
    peerStatusClass,
    peerStatusTitle,
    showToast,
    toggleMobileSidebar,
    closeLightbox,
    syncShellHuddle,
  } = ctx;

  setShellCallbacks({
    // Welcome screen
    onCreateWorkspace: () => modalActions.showCreateWorkspaceModal(),
    onJoinWorkspace: () => modalActions.showJoinWorkspaceModal(),
    onRestoreSeed: () => modalActions.showRestoreSeed(),

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
    onAddWorkspace: () => modalActions.showCreateWorkspaceModal(),

    // Sidebar
    onChannelClick: (channelId) => switchChannel(channelId),
    onMemberClick: (peerId) => startMemberDM(peerId),
    onDirectConvClick: (convId) => switchToDirectConversation(convId),
    onAddChannel: () => modalActions.showCreateChannelModal(),
    onStartDM: () => modalActions.showStartDirectMessageModal(),
    onAddContact: () => modalActions.showAddContactModal(),
    onConnectPeer: () => modalActions.showConnectPeerModal(),
    onCopyInvite: () => {
      if (!state.activeWorkspaceId) return;
      const inviteURL = callbacks.generateInviteURL?.(state.activeWorkspaceId);
      if (inviteURL) { navigator.clipboard.writeText(inviteURL); showToast('Invite link copied!', 'success'); }
    },
    onShowQR: () => modalActions.showMyQR(),
    onCopyPeerId: () => { navigator.clipboard.writeText(state.myPeerId); showToast('Peer ID copied!'); },
    onWorkspaceSettings: () => modalActions.showWorkspaceSettingsModal(),
    onWorkspaceMembers: () => modalActions.showWorkspaceMembersModal(),
    onWorkspaceInvite: () => {
      if (!state.activeWorkspaceId) return;
      const inviteURL = callbacks.generateInviteURL?.(state.activeWorkspaceId);
      if (inviteURL) { navigator.clipboard.writeText(inviteURL); showToast('Invite link copied!', 'success'); }
    },
    onWorkspaceNotifications: () => modalActions.showSettings(),
    getUnreadCount: (id) => callbacks.getUnreadCount?.(id) || 0,
    getPeerAlias: (peerId) => getPeerAlias(peerId),
    getPeerStatusClass: (peerId) => peerStatusClass(peerId),
    getPeerStatusTitle: (peerId) => peerStatusTitle(peerId),

    // Channel header
    onHamburger: () => toggleMobileSidebar(),
    onHuddleToggle: async () => {
      const channelId = state.activeChannelId;
      if (!channelId) return;
      if (huddleUI.state === 'in-call') { await callbacks.leaveHuddle?.(); }
      else { await callbacks.startHuddle?.(channelId); }
    },
    onHeaderConnectPeer: () => modalActions.showConnectPeerModal(),
    onHeaderShowQR: () => modalActions.showMyQR(),
    onSearch: () => modalActions.showSearchPanel(),
    onInvite: () => {
      if (!state.activeWorkspaceId) return;
      const inviteURL = callbacks.generateInviteURL?.(state.activeWorkspaceId);
      if (inviteURL) { navigator.clipboard.writeText(inviteURL); showToast('Invite link copied! Share it with anyone.', 'success'); }
    },
    onSettings: () => modalActions.showSettings(),
    onChannelMembers: () => modalActions.showChannelMembersModal(),

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
}
