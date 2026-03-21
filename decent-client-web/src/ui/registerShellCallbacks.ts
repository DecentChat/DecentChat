import type { WorkspaceManager, MessageStore } from 'decent-protocol';
import type { AppState } from '../main';
import { shellData, setShellCallbacks } from '../lib/stores/shell.svelte';
import { closeCompanySimPanel, openCompanySimPanel } from '../lib/company-sim/store.svelte';
import { huddleUI } from '../lib/stores/ui.svelte';
import type { UICallbacks, WorkspaceMemberDirectoryView } from './types';
import { MessageSearch } from './MessageSearch';
import { filterMentionMembers, searchMentionMembers } from './mentionSearch';
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
  refreshActivityPanel: () => void;
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
    refreshActivityPanel,
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

  const MENTION_SUGGESTION_LIMIT = 8;
  const mentionDirectoryLoadInFlight = new Map<string, Promise<void>>();

  const mapDirectoryMentionMembers = (directoryMembers: WorkspaceMemberDirectoryView['members']) =>
    directoryMembers
      .filter((member) => !member.isYou)
      .map((member) => ({
        peerId: member.peerId,
        name: member.alias || getPeerAlias(member.peerId),
      }));

  const getMentionMembersForWorkspace = (workspaceId: string): Array<{ peerId: string; name: string }> => {
    const ws = workspaceManager.getWorkspace(workspaceId);
    if (!ws) return [];

    const directoryView = callbacks.getWorkspaceMemberDirectory?.(workspaceId);
    if (directoryView && directoryView.members.length > 0) {
      return mapDirectoryMentionMembers(directoryView.members);
    }

    return ws.members.filter((member: any) => member.peerId !== state.myPeerId).map((member: any) => ({
      peerId: member.peerId,
      name: getPeerAlias(member.peerId),
    }));
  };

  const waitForDirectoryAdvance = async (workspaceId: string, loadedCountBaseline: number): Promise<void> => {
    const timeoutMs = 1200;
    const pollMs = 120;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const snapshot = callbacks.getWorkspaceMemberDirectory?.(workspaceId);
      if (!snapshot) return;
      if (snapshot.loadedCount > loadedCountBaseline || !snapshot.hasMore) return;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  };

  const loadNextDirectoryPageForMentions = async (workspaceId: string): Promise<void> => {
    const existing = mentionDirectoryLoadInFlight.get(workspaceId);
    if (existing) {
      await existing;
      return;
    }

    const initialSnapshot = callbacks.getWorkspaceMemberDirectory?.(workspaceId);
    if (!initialSnapshot?.hasMore) return;

    const run = (async () => {
      if (callbacks.loadMoreWorkspaceMemberDirectory) {
        await callbacks.loadMoreWorkspaceMemberDirectory(workspaceId);
      } else {
        await callbacks.prefetchWorkspaceMemberDirectory?.(workspaceId);
      }
      await waitForDirectoryAdvance(workspaceId, initialSnapshot.loadedCount);
    })();

    mentionDirectoryLoadInFlight.set(workspaceId, run);
    try {
      await run;
    } finally {
      mentionDirectoryLoadInFlight.delete(workspaceId);
    }
  };

  const copyInviteForActiveWorkspace = async (successMessage: string): Promise<void> => {
    if (!state.activeWorkspaceId) return;
    const inviteURL = await callbacks.generateInviteURL?.(state.activeWorkspaceId);
    if (inviteURL) {
      await navigator.clipboard.writeText(inviteURL);
      showToast(successMessage, 'success');
    }
  };

  setShellCallbacks({
    // Welcome screen
    onCreateWorkspace: () => modalActions.showCreateWorkspaceModal(),
    onJoinWorkspace: () => modalActions.showJoinWorkspaceModal(),
    onRestoreSeed: () => modalActions.showRestoreSeed(),
    onInstallAiTeam: () => modalActions.showInstallTeamTemplateModal(),

    // Workspace rail
    onSwitchToDMs: () => {
      state.activeWorkspaceId = null;
      if (!state.activeDirectConversationId) state.activeChannelId = null;
      callbacks.setFocusedChannel?.(state.activeDirectConversationId || null);
      persistViewState();
      refreshContactsCache().catch(() => {});
      syncShellSidebar();
      syncShellRail();
      syncShellHeader();
      syncShellMessages();
    },
    onSwitchWorkspace: async (wsId) => {
      switchWorkspace(wsId);
      if (shellData.companySim.open) {
        const workspace = workspaceManager.getWorkspace(wsId);
        try {
          await openCompanySimPanel(wsId, workspace?.name ?? null);
        } catch (error) {
          showToast(`Company Sim: ${(error as Error).message}`, 'error');
        }
      }
    },
    onToggleActivity: () => toggleActivityPanel(),
    onAddWorkspace: () => modalActions.showCreateWorkspaceModal(),
    onOpenCompanySim: async () => {
      if (!state.activeWorkspaceId) {
        showToast('Open a workspace before viewing Company Sim.', 'error');
        return;
      }
      const workspace = workspaceManager.getWorkspace(state.activeWorkspaceId);
      shellData.activity.panelOpen = false;
      shellData.search.open = false;
      try {
        await openCompanySimPanel(state.activeWorkspaceId, workspace?.name ?? null);
      } catch (error) {
        showToast(`Company Sim: ${(error as Error).message}`, 'error');
      }
    },
    onCloseCompanySim: () => closeCompanySimPanel(),

    // Sidebar
    onChannelClick: (channelId) => switchChannel(channelId),
    onMemberClick: (peerId) => startMemberDM(peerId),
    onDirectConvClick: (convId) => switchToDirectConversation(convId),
    onAddChannel: () => modalActions.showCreateChannelModal(),
    onStartDM: () => {
      if (state.activeWorkspaceId) {
        modalActions.showStartWorkspaceMemberDMModal();
        return;
      }
      modalActions.showStartDirectMessageModal();
    },
    onAddContact: () => modalActions.showAddContactModal(),
    onConnectPeer: () => modalActions.showConnectPeerModal(),
    onCopyInvite: async () => {
      await copyInviteForActiveWorkspace('Invite link copied!');
    },
    onShowQR: () => modalActions.showMyQR(),
    onCopyPeerId: () => { navigator.clipboard.writeText(state.myPeerId); showToast('Peer ID copied!'); },
    onWorkspaceSettings: () => modalActions.showWorkspaceSettingsModal(),
    onWorkspaceMembers: () => modalActions.showWorkspaceMembersModal(),
    onWorkspaceInvite: async () => {
      await copyInviteForActiveWorkspace('Invite link copied!');
    },
    onWorkspaceNotifications: () => modalActions.showSettings(),
    onRetryReconnect: async () => {
      if (!callbacks.retryReconnect) return;
      try {
        const result = await callbacks.retryReconnect();
        if (result.reinitialized) {
          showToast('Transport was restarted. Reconnecting…', 'info');
        } else if (result.attempted > 0) {
          showToast(`Retrying connection to ${result.attempted} peer(s)…`, 'info');
        } else {
          showToast('Reconnect check triggered.', 'info');
        }
      } catch (err) {
        showToast(`Reconnect failed: ${(err as Error).message}`, 'error');
      } finally {
        syncShellSidebar();
      }
    },
    onLoadMorePresence: async () => {
      if (!state.activeWorkspaceId || !state.activeChannelId || !callbacks.loadMorePresenceScope) return;
      await callbacks.loadMorePresenceScope(state.activeWorkspaceId, state.activeChannelId);
      syncShellSidebar();
      syncShellHeader();
    },
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
    onInvite: async () => {
      await copyInviteForActiveWorkspace('Invite link copied! Share it with anyone.');
    },
    onSettings: () => modalActions.showSettings(),
    onChannelMembers: () => modalActions.showChannelMembersModal(),

    // Messages
    getThread: (channelId, messageId) => messageStore.getThread(channelId, messageId),
    isBot: (senderId) => {
      const ws = state.activeWorkspaceId ? workspaceManager.getWorkspace(state.activeWorkspaceId) : null;
      return ws?.members.find((m: any) => m.peerId === senderId)?.isBot === true;
    },
    getCompanySimProfile: (senderId) => {
      const ws = state.activeWorkspaceId ? workspaceManager.getWorkspace(state.activeWorkspaceId) : null;
      return ws?.members.find((m: any) => m.peerId === senderId)?.companySim;
    },
    onOpenThread: (messageId) => openThread(messageId),
    onToggleReaction: (messageId, emoji) => callbacks.toggleReaction?.(messageId, emoji),
    onRememberReaction: (emoji) => rememberReaction(emoji),
    onShowMessageInfo: (messageId) => showMessageInfo(messageId),
    resolveAttachmentImageUrl: callbacks.resolveAttachmentImageUrl,
    onImageClick: async (name, src, attachmentId) => {
      if (attachmentId && callbacks.resolveAttachmentImageUrl) {
        try {
          const fullSrc = await callbacks.resolveAttachmentImageUrl(attachmentId);
          openLightbox(fullSrc || src, name);
          return;
        } catch {
          // Fallback to thumbnail lightbox
        }
      }
      openLightbox(src, name);
    },

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
      if (!state.activeWorkspaceId) return [];
      return getMentionMembersForWorkspace(state.activeWorkspaceId);
    },
    searchMembers: async (query, limit = MENTION_SUGGESTION_LIMIT) => {
      if (!state.activeWorkspaceId) return [];
      const workspaceId = state.activeWorkspaceId;

      const initialDirectoryView = callbacks.getWorkspaceMemberDirectory?.(workspaceId);
      const usingDirectory = Boolean(initialDirectoryView && (initialDirectoryView.members.length > 0 || initialDirectoryView.hasMore));
      if (!usingDirectory) {
        return filterMentionMembers(getMentionMembersForWorkspace(workspaceId), query, limit);
      }

      return searchMentionMembers(
        {
          getMembers: () => getMentionMembersForWorkspace(workspaceId),
          getLoadedCount: () => callbacks.getWorkspaceMemberDirectory?.(workspaceId)?.loadedCount ?? 0,
          hasMore: () => Boolean(callbacks.getWorkspaceMemberDirectory?.(workspaceId)?.hasMore),
          loadNextPage: () => loadNextDirectoryPageForMentions(workspaceId),
        },
        query,
        limit,
      );
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
    onMarkAllRead: () => {
      callbacks.markAllActivityRead?.();
      syncShellRail();
      refreshActivityPanel();
    },
    onMarkRead: (id) => {
      callbacks.markActivityRead?.(id);
      syncShellRail();
      refreshActivityPanel();
    },
    onNavigateActivity: (item: any) => {
      toggleActivityPanel();
      const needsWorkspaceSwitch = !!(item.workspaceId && item.workspaceId !== state.activeWorkspaceId);
      const needsChannelSwitch = !!(item.channelId && (needsWorkspaceSwitch || item.channelId !== state.activeChannelId));
      const needsThreadOpen = !!(item.threadId && item.threadId.trim());
      const needsThreadSwitch = needsThreadOpen && (!state.threadOpen || state.activeThreadId !== item.threadId);

      if (needsWorkspaceSwitch) switchWorkspace(item.workspaceId);
      if (needsChannelSwitch) switchChannel(item.channelId);

      const navigationDelay = (needsWorkspaceSwitch || needsChannelSwitch) ? 50 : 0;

      if (needsThreadOpen && needsThreadSwitch) {
        setTimeout(() => {
          openThread(item.threadId!);
          if (item.messageId) setTimeout(() => scrollToMessageAndHighlight(item.messageId, 'thread-messages'), 100);
        }, navigationDelay);
      } else if (needsThreadOpen && !needsThreadSwitch) {
        if (item.messageId) scrollToMessageAndHighlight(item.messageId, 'thread-messages');
      } else if (item.messageId) {
        setTimeout(() => scrollToMessageAndHighlight(item.messageId, 'messages-list'), navigationDelay ? 100 : 0);
      }

      syncShellHeader();
      syncShellRail();
    },
    getActivityPeerAlias: (peerId) => getPeerAlias(peerId),
  });
}
