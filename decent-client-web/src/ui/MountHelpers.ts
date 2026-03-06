/**
 * MountHelpers — Extracted mount methods from UIRenderer.
 * Each helper manages the mount/unmount lifecycle for a Svelte component.
 */

import { mount, unmount } from 'svelte';
import type { PlaintextMessage, Contact, DirectConversation, InviteData } from 'decent-protocol';
import { InviteURI } from 'decent-protocol';
import { MessageSearch } from './MessageSearch';
import { showJoinWorkspaceModal } from '../lib/components/modals/JoinWorkspaceModal.svelte';
import type { HuddleState, HuddleParticipant } from '../huddle/HuddleManager';
import type { UICallbacks, ActivityItem } from './types';
import type { AppState } from '../main';
import type { WorkspaceManager, MessageStore } from 'decent-protocol';

import Sidebar from '../lib/components/layout/Sidebar.svelte';
import ChannelHeader from '../lib/components/layout/ChannelHeader.svelte';
import ComposeArea from '../lib/components/compose/ComposeArea.svelte';
import ThreadPanel from '../lib/components/layout/ThreadPanel.svelte';
import HuddleBar from '../lib/components/layout/HuddleBar.svelte';
import Lightbox from '../lib/components/shared/Lightbox.svelte';
import MessageList from '../lib/components/messages/MessageList.svelte';
import WorkspaceRail from '../lib/components/layout/WorkspaceRail.svelte';
import SearchPanel from '../lib/components/layout/SearchPanel.svelte';
import WelcomePage from '../lib/components/layout/WelcomePage.svelte';
import ActivityPanel from '../lib/components/layout/ActivityPanel.svelte';

// ── Ref wrapper for mount/unmount lifecycle ──

type SvelteRef = Record<string, any> | null;

function remount(ref: { current: SvelteRef }, container: HTMLElement, Component: any, props: Record<string, any>): SvelteRef {
  if (ref.current) {
    try { unmount(ref.current); } catch {}
    ref.current = null;
  }
  container.innerHTML = '';
  ref.current = mount(Component, { target: container, props });
  return ref.current;
}

// ── Shared utilities ──

export interface MountContext {
  state: AppState;
  workspaceManager: WorkspaceManager;
  messageStore: MessageStore;
  callbacks: UICallbacks;
  getPeerAlias: (peerId: string) => string;
  peerColor: (peerId: string) => string;
  peerStatusClass: (peerId: string) => string;
  peerStatusTitle: (peerId: string) => string;
  getFrequentReactions: () => string[];
  getMyDisplayName: () => string;
  getComposePlaceholder: () => string;
  cachedContacts: Contact[];
  cachedDirectConversations: DirectConversation[];
  huddleState: HuddleState;
  huddleChannelId: string | null;
  huddleParticipants: HuddleParticipant[];
  huddleMuted: boolean;
  lightboxOpen: boolean;
  lightboxSrc: string;
  lightboxName: string;
  // Actions
  switchChannel: (id: string) => void;
  switchToDirectConversation: (id: string) => void;
  switchWorkspace: (id: string) => void;
  openThread: (id: string) => void;
  closeThread: () => void;
  showChannelMembersModal: () => void;
  showWorkspaceSettingsModal: () => void;
  showWorkspaceMembersModal: () => void;
  showCreateChannelModal: () => void;
  showConnectPeerModal: () => void;
  showCreateWorkspaceModal: () => void;
  showStartDirectMessageModal: () => void;
  showAddContactModal: () => void;
  showMyQR: () => void;
  showScanQR: () => void;
  showSearchPanel: () => void;
  showSettings: () => void;
  showToast: (msg: string, type?: any) => void;
  showMessageInfo: (id: string) => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  closeLightbox: () => void;
  openLightbox: (src: string, name: string) => void;
  rememberReaction: (emoji: string) => void;
  startMemberDM: (peerId: string) => void;
  toggleActivityPanel: () => void;
  scrollToMessageAndHighlight: (id: string, containerId?: string) => void;
  persistViewState: () => void;
  refreshContactsCache: () => Promise<void>;
  updateSidebar: () => void;
  updateChannelHeader: () => void;
  updateWorkspaceRail: () => void;
  renderMessages: () => void;
  updateComposePlaceholder: () => void;
  mountCompose: () => void;
  mountHuddleBar: () => void;
  mountLightbox: () => void;
  mountSidebar: (el?: HTMLElement) => void;
  mountThreadPanel: () => void;
}

// ── Sidebar ──

export function mountSidebar(ref: { current: SvelteRef }, sidebar: HTMLElement, ctx: MountContext): void {
  const ws = ctx.state.activeWorkspaceId
    ? ctx.workspaceManager.getWorkspace(ctx.state.activeWorkspaceId)
    : null;
  const channels = ws ? ctx.workspaceManager.getChannels(ws.id) : [];

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
          const isMe = identityPeers.includes(ctx.state.myPeerId);
          const isOnline = isMe || identityPeers.some((pid: string) => ctx.peerStatusClass(pid) === 'online');
          return {
            peerId: m.peerId, alias: ctx.getPeerAlias(m.peerId), isOnline, isMe,
            role: m.role, isBot: m.isBot,
            statusClass: ctx.peerStatusClass(m.peerId),
            statusTitle: ctx.peerStatusTitle(m.peerId),
          };
        });
      })()
    : [];

  remount(ref, sidebar, Sidebar, {
    workspaceName: ws?.name ?? null,
    channels: channels.map((ch: any) => ({ id: ch.id, name: ch.name })),
    members: memberData,
    directConversations: ctx.cachedDirectConversations.map(c => ({
      id: c.id, contactPeerId: c.contactPeerId, lastMessageAt: c.lastMessageAt,
    })),
    activeChannelId: ctx.state.activeChannelId,
    activeDirectConversationId: ctx.state.activeDirectConversationId,
    getUnreadCount: (id: string) => ctx.callbacks.getUnreadCount?.(id) || 0,
    getPeerAlias: (peerId: string) => ctx.getPeerAlias(peerId),
    getPeerStatusClass: (peerId: string) => ctx.peerStatusClass(peerId),
    getPeerStatusTitle: (peerId: string) => ctx.peerStatusTitle(peerId),
    onChannelClick: (channelId: string) => ctx.switchChannel(channelId),
    onMemberClick: (peerId: string) => ctx.startMemberDM(peerId),
    onDirectConvClick: (convId: string) => ctx.switchToDirectConversation(convId),
    myPeerId: ctx.state.myPeerId,
    onAddChannel: () => ctx.showCreateChannelModal(),
    onStartDM: () => ctx.showStartDirectMessageModal(),
    onAddContact: () => ctx.showAddContactModal(),
    onConnectPeer: () => ctx.showConnectPeerModal(),
    onCopyInvite: () => {
      if (!ctx.state.activeWorkspaceId) return;
      const inviteURL = ctx.callbacks.generateInviteURL?.(ctx.state.activeWorkspaceId);
      if (inviteURL) { navigator.clipboard.writeText(inviteURL); ctx.showToast('Invite link copied!', 'success'); }
    },
    onShowQR: () => ctx.showMyQR(),
    onCopyPeerId: () => { navigator.clipboard.writeText(ctx.state.myPeerId); ctx.showToast('Peer ID copied!'); },
    onWorkspaceSettings: () => ctx.showWorkspaceSettingsModal(),
    onWorkspaceMembers: () => ctx.showWorkspaceMembersModal(),
    onWorkspaceInvite: () => {
      if (!ctx.state.activeWorkspaceId) return;
      const inviteURL = ctx.callbacks.generateInviteURL?.(ctx.state.activeWorkspaceId);
      if (inviteURL) { navigator.clipboard.writeText(inviteURL); ctx.showToast('Invite link copied!', 'success'); }
    },
    onWorkspaceNotifications: () => ctx.showSettings(),
  });
}

// ── Channel Header ──

export function mountChannelHeader(ref: { current: SvelteRef }, container: HTMLElement, ctx: MountContext): void {
  const isDirectMessage = !!ctx.state.activeDirectConversationId;
  let channelName = 'Select a channel';
  let memberCount = 0;

  if (isDirectMessage) {
    const conv = ctx.cachedDirectConversations.find(c => c.id === ctx.state.activeDirectConversationId);
    channelName = conv ? ctx.getPeerAlias(conv.contactPeerId) : 'Direct Message';
  } else {
    const ws = ctx.state.activeWorkspaceId ? ctx.workspaceManager.getWorkspace(ctx.state.activeWorkspaceId) : null;
    const channel = ctx.state.activeChannelId && ws ? ctx.workspaceManager.getChannel(ws.id, ctx.state.activeChannelId) : null;
    if (channel) {
      channelName = channel.type === 'dm' ? channel.name : `# ${channel.name}`;
      memberCount = channel.members.length;
    }
  }

  remount(ref, container, ChannelHeader, {
    channelName, memberCount, isDirectMessage,
    isHuddleActive: ctx.huddleState === 'in-call' && ctx.huddleChannelId === ctx.state.activeChannelId,
    onHamburger: () => {
      const sidebar = document.getElementById('sidebar');
      sidebar?.classList.contains('open') ? ctx.closeMobileSidebar() : ctx.openMobileSidebar();
    },
    onHuddleToggle: async () => {
      const channelId = ctx.state.activeChannelId;
      if (!channelId) return;
      if (ctx.huddleState === 'in-call') { await ctx.callbacks.leaveHuddle?.(); }
      else { await ctx.callbacks.startHuddle?.(channelId); }
    },
    onConnectPeer: () => ctx.showConnectPeerModal(),
    onShowQR: () => ctx.showMyQR(),
    onSearch: () => ctx.showSearchPanel(),
    onInvite: () => {
      if (!ctx.state.activeWorkspaceId) return;
      const inviteURL = ctx.callbacks.generateInviteURL?.(ctx.state.activeWorkspaceId);
      if (inviteURL) { navigator.clipboard.writeText(inviteURL); ctx.showToast('Invite link copied! Share it with anyone.', 'success'); }
    },
    onSettings: () => ctx.showSettings(),
    onChannelMembers: () => ctx.showChannelMembersModal(),
  });
}

// ── Compose Area ──

export function mountCompose(ref: { current: SvelteRef }, ctx: MountContext): void {
  const container = document.getElementById('compose-mount');
  if (!container) return;

  remount(ref, container, ComposeArea, {
    placeholder: ctx.getComposePlaceholder(),
    target: 'main',
    onSend: async (text: string, files: File[]) => {
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          await ctx.callbacks.sendAttachment(files[i], i === 0 ? (text || undefined) : undefined, undefined);
        }
      } else if (text) {
        await ctx.callbacks.sendMessage(text, undefined);
      }
    },
    onTyping: () => ctx.callbacks.broadcastTyping?.(),
    onStopTyping: () => ctx.callbacks.broadcastStopTyping?.(),
    getCommandSuggestions: ctx.callbacks.getCommandSuggestions
      ? (prefix: string) => ctx.callbacks.getCommandSuggestions!(prefix)
      : undefined,
    getMembers: () => {
      const ws = ctx.state.activeWorkspaceId ? ctx.workspaceManager.getWorkspace(ctx.state.activeWorkspaceId) : null;
      if (!ws) return [];
      return ws.members.filter((m: any) => m.peerId !== ctx.state.myPeerId).map((m: any) => ({ peerId: m.peerId, name: ctx.getPeerAlias(m.peerId) }));
    },
  });
}

// ── Thread Panel ──

export function mountThreadPanel(ref: { current: SvelteRef }, ctx: MountContext): void {
  const container = document.getElementById('thread-mount');
  if (!container) return;

  const getThreadData = () => {
    if (!ctx.state.activeChannelId || !ctx.state.activeThreadId) return { parent: null, replies: [] as PlaintextMessage[] };
    const allMsgs = ctx.messageStore.getMessages(ctx.state.activeChannelId);
    let parent = allMsgs.find((m: PlaintextMessage) => m.id === ctx.state.activeThreadId);
    if (!parent) parent = ctx.messageStore.getThreadRoot(ctx.state.activeThreadId);
    const replies = ctx.messageStore.getThread(ctx.state.activeChannelId, ctx.state.activeThreadId!);
    return { parent: parent || null, replies };
  };

  const data = getThreadData();

  remount(ref, container, ThreadPanel, {
    open: ctx.state.threadOpen,
    threadId: ctx.state.activeThreadId,
    channelId: ctx.state.activeChannelId,
    parentMessage: data.parent,
    replies: data.replies,
    myPeerId: ctx.state.myPeerId,
    myDisplayName: ctx.getMyDisplayName(),
    frequentReactions: ctx.getFrequentReactions(),
    getThread: (channelId: string, messageId: string) => ctx.messageStore.getThread(channelId, messageId),
    getPeerAlias: (peerId: string) => ctx.getPeerAlias(peerId),
    isBot: (senderId: string) => {
      const ws = ctx.state.activeWorkspaceId ? ctx.workspaceManager.getWorkspace(ctx.state.activeWorkspaceId) : null;
      return ws?.members.find((m: any) => m.peerId === senderId)?.isBot === true;
    },
    onOpenThread: (messageId: string) => ctx.openThread(messageId),
    onToggleReaction: (messageId: string, emoji: string) => ctx.callbacks.toggleReaction?.(messageId, emoji),
    onRememberReaction: (emoji: string) => ctx.rememberReaction(emoji),
    onShowMessageInfo: (messageId: string) => ctx.showMessageInfo(messageId),
    onClose: () => ctx.closeThread(),
    onSend: async (text: string, files: File[]) => {
      const threadId = ctx.state.activeThreadId || undefined;
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          await ctx.callbacks.sendAttachment(files[i], i === 0 ? (text || undefined) : undefined, threadId);
        }
      } else if (text) {
        await ctx.callbacks.sendMessage(text, threadId);
      }
    },
    getMembers: () => {
      const ws = ctx.state.activeWorkspaceId ? ctx.workspaceManager.getWorkspace(ctx.state.activeWorkspaceId) : null;
      if (!ws) return [];
      return ws.members.filter((m: any) => m.peerId !== ctx.state.myPeerId).map((m: any) => ({ peerId: m.peerId, name: ctx.getPeerAlias(m.peerId) }));
    },
  });
}

// ── Huddle Bar ──

export function mountHuddleBar(ref: { current: SvelteRef }, ctx: MountContext): void {
  const container = document.getElementById('huddle-mount');
  if (!container) return;

  remount(ref, container, HuddleBar, {
    state: ctx.huddleState,
    muted: ctx.huddleMuted,
    participants: ctx.huddleParticipants,
    onToggleMute: () => {
      const muted = ctx.callbacks.toggleHuddleMute?.() ?? false;
      ctx.huddleMuted = muted;
      ctx.mountHuddleBar();
    },
    onLeave: async () => { await ctx.callbacks.leaveHuddle?.(); },
    onJoin: async () => {
      const channelId = ctx.huddleChannelId || ctx.state.activeChannelId;
      if (channelId) await ctx.callbacks.joinHuddle?.(channelId);
    },
  });
}

// ── Lightbox ──

export function mountLightbox(ref: { current: SvelteRef }, ctx: MountContext): void {
  const container = document.getElementById('lightbox-mount');
  if (!container) return;

  remount(ref, container, Lightbox, {
    open: ctx.lightboxOpen,
    src: ctx.lightboxSrc,
    name: ctx.lightboxName,
    onClose: () => ctx.closeLightbox(),
  });
}

// ── Workspace Rail ──

export function mountWorkspaceRail(ref: { current: SvelteRef }, ctx: MountContext): void {
  const rail = document.getElementById('workspace-rail');
  if (!rail) return;

  remount(ref, rail, WorkspaceRail, {
    workspaces: ctx.callbacks.getAllWorkspaces?.() || [],
    activeWorkspaceId: ctx.state.activeWorkspaceId,
    activityUnread: ctx.callbacks.getActivityUnreadCount?.() || 0,
    onSwitchToDMs: () => {
      ctx.state.activeWorkspaceId = null;
      if (!ctx.state.activeDirectConversationId) ctx.state.activeChannelId = null;
      ctx.persistViewState();
      ctx.refreshContactsCache().catch(() => {});
      ctx.updateSidebar();
      ctx.updateWorkspaceRail();
      ctx.updateChannelHeader();
      ctx.renderMessages();
    },
    onSwitchWorkspace: (wsId: string) => ctx.switchWorkspace(wsId),
    onToggleActivity: () => ctx.toggleActivityPanel(),
    onAddWorkspace: () => ctx.showCreateWorkspaceModal(),
  });
}

// ── Messages ──

export function getMessageListProps(ctx: MountContext, messages: PlaintextMessage[], channelName: string, inThreadView: boolean, threadRoot?: PlaintextMessage | null) {
  return {
    messages, channelName,
    activeChannelId: ctx.state.activeChannelId,
    myPeerId: ctx.state.myPeerId,
    myDisplayName: ctx.getMyDisplayName(),
    inThreadView,
    threadRoot: threadRoot || null,
    frequentReactions: ctx.getFrequentReactions(),
    getThread: (channelId: string, messageId: string) => ctx.messageStore.getThread(channelId, messageId),
    getPeerAlias: (peerId: string) => ctx.getPeerAlias(peerId),
    isBot: (senderId: string) => {
      const ws = ctx.state.activeWorkspaceId ? ctx.workspaceManager.getWorkspace(ctx.state.activeWorkspaceId) : null;
      return ws?.members.find((m: any) => m.peerId === senderId)?.isBot === true;
    },
    onOpenThread: (messageId: string) => ctx.openThread(messageId),
    onToggleReaction: (messageId: string, emoji: string) => ctx.callbacks.toggleReaction?.(messageId, emoji),
    onRememberReaction: (emoji: string) => ctx.rememberReaction(emoji),
    onShowMessageInfo: (messageId: string) => ctx.showMessageInfo(messageId),
  };
}

export function mountMessages(ref: { current: SvelteRef }, ctx: MountContext): void {
  const listContainer = document.getElementById('messages-list')!;
  if (!listContainer) return;

  const channelName = getActiveChannelName(ctx);
  const messages = ctx.state.activeChannelId
    ? ctx.messageStore.getMessages(ctx.state.activeChannelId).filter((m: PlaintextMessage) => !m.threadId)
    : [];

  remount(ref, listContainer, MessageList, getMessageListProps(ctx, messages, channelName, false));
}

export function getActiveChannelName(ctx: MountContext): string {
  if (ctx.state.activeDirectConversationId) {
    const conv = ctx.cachedDirectConversations.find(c => c.id === ctx.state.activeDirectConversationId);
    return conv ? ctx.getPeerAlias(conv.contactPeerId) : 'this conversation';
  }
  const ws = ctx.state.activeWorkspaceId ? ctx.workspaceManager.getWorkspace(ctx.state.activeWorkspaceId) : null;
  const channel = ws && ctx.state.activeChannelId ? ctx.workspaceManager.getChannel(ws.id, ctx.state.activeChannelId) : null;
  return channel ? (channel.type === 'dm' ? channel.name : '#' + channel.name) : 'the channel';
}

// ── Search Panel ──

export function mountSearchPanel(ref: { current: SvelteRef }, ctx: MountContext): void {
  const container = document.getElementById('search-mount');
  if (!container) return;

  if (ref.current) {
    try { unmount(ref.current); } catch {}
    ref.current = null;
    container.innerHTML = '';
    return; // toggle off
  }

  remount(ref, container, SearchPanel, {
    myPeerId: ctx.state.myPeerId,
    myAlias: ctx.state.myAlias || 'You',
    onSearch: (query: string) => {
      const search = new MessageSearch(ctx.messageStore);
      return search.search(query, { channelId: ctx.state.activeChannelId || undefined, limit: 20 });
    },
    onScrollToMessage: (messageId: string) => ctx.scrollToMessageAndHighlight(messageId),
    onClose: () => {
      if (ref.current) { try { unmount(ref.current); } catch {} ref.current = null; }
      container.innerHTML = '';
    },
  });
}

// ── Activity Panel ──

export function mountActivityPanel(ref: { current: SvelteRef }, sidebar: HTMLElement, ctx: MountContext): void {
  remount(ref, sidebar, ActivityPanel, {
    items: ctx.callbacks.getActivityItems?.() || [],
    getPeerAlias: (peerId: string) => ctx.getPeerAlias(peerId),
    onClose: () => ctx.toggleActivityPanel(),
    onMarkAllRead: () => {
      ctx.callbacks.markAllActivityRead?.();
      // Will be refreshed by toggle
    },
    onMarkRead: (id: string) => ctx.callbacks.markActivityRead?.(id),
    onNavigate: (item: any) => {
      ctx.toggleActivityPanel(); // closes activity, restores sidebar

      const needsChannelSwitch = item.channelId && item.channelId !== ctx.state.activeChannelId;
      const needsThreadOpen = !!(item.threadId && item.threadId.trim());
      const needsThreadSwitch = needsThreadOpen && (!ctx.state.threadOpen || ctx.state.activeThreadId !== item.threadId);

      if (needsChannelSwitch) ctx.switchChannel(item.channelId);

      if (needsThreadOpen && needsThreadSwitch) {
        setTimeout(() => {
          ctx.openThread(item.threadId!);
          if (item.messageId) setTimeout(() => ctx.scrollToMessageAndHighlight(item.messageId, 'thread-messages'), 100);
        }, needsChannelSwitch ? 50 : 0);
      } else if (needsThreadOpen && !needsThreadSwitch) {
        if (item.messageId) ctx.scrollToMessageAndHighlight(item.messageId, 'thread-messages');
      } else if (item.messageId) {
        setTimeout(() => ctx.scrollToMessageAndHighlight(item.messageId, 'messages-list'), needsChannelSwitch ? 100 : 0);
      }

      ctx.updateChannelHeader();
      ctx.updateWorkspaceRail();
    },
  });
}

// ── Welcome Page ──

export function mountWelcome(ref: { current: SvelteRef }, container: HTMLElement, ctx: MountContext): void {
  remount(ref, container, WelcomePage, {
    onCreateWorkspace: () => ctx.showCreateWorkspaceModal(),
    onJoinWorkspace: () => {
      showJoinWorkspaceModal({
        parseInvite: (invite: string) => {
          if (invite.startsWith('http://') || invite.startsWith('https://')) {
            try {
              const parsed = InviteURI.decode(invite);
              if (parsed) return { code: parsed.workspaceName || '', peerId: parsed.peerId, inviteData: parsed };
            } catch {}
          }
          return { code: invite, error: undefined };
        },
        onJoin: (wsName: string, alias: string, peerId: string, inviteData?: any) => {
          ctx.state.myAlias = alias;
          ctx.callbacks.persistSetting('myAlias', alias);
          ctx.callbacks.joinWorkspace(wsName, alias, peerId, inviteData);
          ctx.showToast(`Joining workspace... connecting to ${peerId.slice(0, 8)}`);
        },
        onToast: (msg: string, type?: string) => ctx.showToast(msg, type as any),
      });
    },
    onScanQR: () => ctx.showScanQR(),
    onShowSettings: () => ctx.showSettings(),
    onRestoreSeed: () => ctx.callbacks.onSettingsAction?.('restoreSeed'),
  });
}

// ── Bind App Events ──

export function bindAppEvents(ctx: MountContext): void {
  // Thumbnail click -> open lightbox
  const handleThumbnailClick = async (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('attachment-thumbnail')) {
      const img = target as HTMLImageElement;
      const name = img.getAttribute('data-attachment-name') || '';
      const attachmentId = img.getAttribute('data-attachment-id') || '';
      ctx.openLightbox(img.src, name);
      if (attachmentId && ctx.callbacks.resolveAttachmentImageUrl) {
        const fullSrc = await ctx.callbacks.resolveAttachmentImageUrl(attachmentId);
        if (fullSrc && ctx.lightboxOpen) {
          ctx.lightboxSrc = fullSrc;
          ctx.mountLightbox();
        }
      }
    }
  };

  document.getElementById('messages-list')?.addEventListener('click', handleThumbnailClick);

  // Drag & drop
  const messagesArea = document.querySelector('.messages-area') as HTMLElement;
  if (messagesArea) {
    messagesArea.addEventListener('dragover', (e) => { e.preventDefault(); messagesArea.classList.add('drag-active'); });
    messagesArea.addEventListener('dragleave', (e) => {
      if (!messagesArea.contains(e.relatedTarget as Node)) messagesArea.classList.remove('drag-active');
    });
    messagesArea.addEventListener('drop', (e) => {
      e.preventDefault();
      messagesArea.classList.remove('drag-active');
      const files = Array.from(e.dataTransfer?.files || []);
      if (ctx.state.activeChannelId || ctx.state.activeDirectConversationId) {
        const dropTarget = e.target as HTMLElement | null;
        const target: 'main' | 'thread' = dropTarget?.closest?.('#thread-panel') ? 'thread' : 'main';
        addPendingAttachments(files, target);
      }
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (ctx.lightboxOpen) { ctx.closeLightbox(); return; }
      const autocomplete = document.getElementById('command-autocomplete') || document.getElementById('mention-autocomplete');
      if (autocomplete) { autocomplete.remove(); return; }
      const modal = document.querySelector('.modal-overlay');
      if (modal) { modal.remove(); return; }
      if (ctx.state.threadOpen) { ctx.closeThread(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const composeInput = document.getElementById('compose-input') as HTMLTextAreaElement;
      if (composeInput) { composeInput.focus(); if (!composeInput.value) composeInput.value = '/'; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); ctx.showSearchPanel(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
      e.preventDefault();
      const sidebar = document.getElementById('sidebar');
      sidebar?.classList.contains('open') ? ctx.closeMobileSidebar() : ctx.openMobileSidebar();
    }
  });
}

function addPendingAttachments(files: File[], target: 'main' | 'thread'): void {
  const fileInputId = target === 'thread' ? 'thread-file-input' : 'file-input';
  const fileInput = document.getElementById(fileInputId) as HTMLInputElement | null;
  if (fileInput) {
    const dt = new DataTransfer();
    for (const file of files) dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
