import type { WorkspaceManager, MessageStore, PlaintextMessage } from 'decent-protocol';
import type { AppState } from '../main';
import type { UICallbacks } from './types';
import { shellData } from '../lib/stores/shell.svelte';
import { cachedData, huddleUI, lightboxUI } from '../lib/stores/ui.svelte';

interface ShellSyncContext {
  state: AppState;
  workspaceManager: WorkspaceManager;
  messageStore: MessageStore;
  callbacks: UICallbacks;
  getPeerAlias: (peerId: string) => string;
  getMyDisplayName: () => string;
  getComposePlaceholder: () => string;
  getFrequentReactions: () => string[];
  peerStatusClass: (peerId: string) => string;
  peerStatusTitle: (peerId: string) => string;
}

export interface ShellSyncHelpers {
  syncShellRail: () => void;
  syncShellSidebar: () => void;
  syncShellHeader: () => void;
  syncShellMessages: () => void;
  syncShellCompose: () => void;
  syncShellThread: () => void;
  syncShellHuddle: () => void;
  syncShellLightbox: () => void;
  syncShellAll: () => void;
}

export function createShellSyncHelpers(ctx: ShellSyncContext): ShellSyncHelpers {
  const {
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
  } = ctx;

  function syncShellRail(): void {
    shellData.rail.workspaces = callbacks.getAllWorkspaces?.() || [];
    shellData.rail.activeWorkspaceId = state.activeWorkspaceId;
    shellData.rail.activityUnread = callbacks.getActivityUnreadCount?.() || 0;
    shellData.rail.dmUnread = cachedData.directConversations
      .reduce((total, conv) => total + (callbacks.getUnreadCount?.(conv.id) || 0), 0);
  }

  const buildPresenceSummary = (workspaceId?: string | null, channelId?: string | null) => {
    if (!workspaceId || !callbacks.getPresenceScopeState) {
      return {
        onlineCount: null,
        sampledOnlineCount: 0,
        sampledPeerCount: 0,
        hasMore: false,
        loadedPages: 0,
        activeChannelId: channelId || undefined,
        updatedAt: undefined,
      };
    }

    const scope = callbacks.getPresenceScopeState(workspaceId, channelId);
    return {
      onlineCount: scope?.onlineCount ?? null,
      sampledOnlineCount: scope?.sampledOnlineCount ?? 0,
      sampledPeerCount: scope?.sampledPeerCount ?? 0,
      hasMore: scope?.hasMore ?? false,
      loadedPages: scope?.loadedPages ?? 0,
      activeChannelId: scope?.activeChannelId ?? channelId ?? undefined,
      updatedAt: scope?.updatedAt,
    };
  };

  function syncShellSidebar(): void {
    const ws = state.activeWorkspaceId
      ? workspaceManager.getWorkspace(state.activeWorkspaceId)
      : null;
    const channels = ws ? workspaceManager.getChannels(ws.id) : [];

    const directoryView = ws ? callbacks.getWorkspaceMemberDirectory?.(ws.id) : null;

    const memberData = ws
      ? (() => {
          if (directoryView && directoryView.members.length > 0) {
            return directoryView.members.map((member) => ({
              peerId: member.peerId,
              alias: member.alias || getPeerAlias(member.peerId),
              isOnline: member.isOnline,
              isMe: member.isYou,
              role: member.role,
              isBot: member.isBot,
              allowWorkspaceDMs: member.allowWorkspaceDMs,
              companySim: (member as any).companySim,
              statusClass: peerStatusClass(member.peerId),
              statusTitle: peerStatusTitle(member.peerId),
            }));
          }

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
              peerId: m.peerId,
              alias: getPeerAlias(m.peerId),
              isOnline,
              isMe,
              role: m.role,
              isBot: m.isBot,
              allowWorkspaceDMs: m.allowWorkspaceDMs !== false,
              companySim: (m as any).companySim,
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
    const connectionStatus = callbacks.getConnectionStatus?.();
    const connectionBanner = {
      showBanner: connectionStatus?.showBanner ?? false,
      level: connectionStatus?.level ?? ('info' as const),
      message: connectionStatus?.message ?? '',
      detail: connectionStatus?.detail,
    };

    shellData.sidebar.activeChannelId = state.activeChannelId;
    shellData.sidebar.activeDirectConversationId = state.activeDirectConversationId;
    shellData.sidebar.myPeerId = state.myPeerId;
    shellData.sidebar.connectionBanner = connectionBanner;
    shellData.sidebar.presence = buildPresenceSummary(state.activeWorkspaceId, state.activeChannelId);
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
      if (ws && channel) {
        channelName = channel.type === 'dm' ? channel.name : `# ${channel.name}`;
        if (channel.type === 'channel' && channel.accessPolicy?.mode === 'public-workspace') {
          const directoryView = callbacks.getWorkspaceMemberDirectory?.(ws.id);
          memberCount = directoryView?.totalCount ?? ws.shell?.memberCount ?? ws.members.length;
        } else {
          memberCount = channel.members.length;
        }
      }
    }

    shellData.header.channelName = channelName;
    shellData.header.memberCount = memberCount;
    shellData.header.isDirectMessage = isDirectMessage;
    shellData.header.isHuddleActive = huddleUI.state === 'in-call' && huddleUI.channelId === state.activeChannelId;
    shellData.header.presence = buildPresenceSummary(state.activeWorkspaceId, state.activeChannelId);
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
      ? messageStore.getMessages(state.activeChannelId)
          .filter((m: PlaintextMessage) => !m.threadId)
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
      shellData.thread.scrollTargetMessageId = null;
      shellData.thread.scrollTargetNonce = 0;
    } else {
      const allMsgs = messageStore.getMessages(state.activeChannelId);
      let parent = allMsgs.find((m: PlaintextMessage) => m.id === state.activeThreadId);
      if (!parent) parent = messageStore.getThreadRoot(state.activeThreadId);
      const replies = messageStore.getThread(state.activeChannelId, state.activeThreadId!);

      shellData.thread.open = state.threadOpen;
      shellData.thread.threadId = state.activeThreadId;
      shellData.thread.channelId = state.activeChannelId;
      shellData.thread.parentMessage = parent ?? null;
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

  return {
    syncShellRail,
    syncShellSidebar,
    syncShellHeader,
    syncShellMessages,
    syncShellCompose,
    syncShellThread,
    syncShellHuddle,
    syncShellLightbox,
    syncShellAll,
  };
}
