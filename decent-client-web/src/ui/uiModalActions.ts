import type { WorkspaceManager, InviteData, Contact, WorkspacePermissions } from '@decentchat/protocol';
import { InviteURI } from '@decentchat/protocol';
import type { AppState } from '../main';
import type { UICallbacks, WorkspaceInviteItem, WorkspaceInviteLists, WorkspaceMemberDirectoryView } from './types';
import { cachedData } from '../lib/stores/ui.svelte';
import { shellData } from '../lib/stores/shell.svelte';
import { showModal as svelteShowModal } from '../lib/components/shared/Modal.svelte';
import { showMessageInfoModal } from '../lib/components/modals/MessageInfoModal.svelte';
import { showChannelMembersModal as svelteShowChannelMembersModal } from '../lib/components/modals/ChannelMembersModal.svelte';
import { showWorkspaceMembersModal as svelteShowWorkspaceMembersModal } from '../lib/components/modals/WorkspaceMembersModal.svelte';
import { showWorkspaceSettingsModal as svelteShowWorkspaceSettingsModal } from '../lib/components/modals/WorkspaceSettingsModal.svelte';
import { showJoinWorkspaceModal as svelteShowJoinWorkspaceModal } from '../lib/components/modals/JoinWorkspaceModal.svelte';
import { showPeerSelectModal } from '../lib/components/modals/PeerSelectModal.svelte';
import { showAddContactModal as svelteShowAddContactModal } from '../lib/components/modals/AddContactModal.svelte';
import { showSettingsModal } from '../lib/components/modals/SettingsModal.svelte';
import { showInstallTeamTemplateModal as svelteShowInstallTeamTemplateModal } from '../lib/components/modals/installTeamTemplateModal';
import { canGenerateSeed, resolveSeedPhraseForSettings } from '../lib/identity/seedSettings';
import { filterMemberPickerPeers, searchMemberPickerPeers } from './memberPickerSearch';

interface QRFlowLike {
  showMyQR: (data: { publicKey: string; displayName: string; peerId: string }) => Promise<void>;
  showScanQR: () => Promise<void>;
  showSeedQR: (mnemonic: string, options?: { sourcePeerId?: string }) => Promise<void>;
  showRestoreSeed: () => Promise<void>;
}

interface ModalActionContext {
  state: AppState;
  workspaceManager: WorkspaceManager;
  callbacks: UICallbacks;
  qrFlow: QRFlowLike;
  showToast: (message: string, type?: 'info' | 'error' | 'success') => void;
  refreshContactsCache: () => Promise<void>;
  updateSidebar: (options?: { refreshContacts?: boolean }) => void;
  syncShellHeader: () => void;
  switchChannel: (channelId: string) => void;
  switchToDirectConversation: (conversationId: string) => void;
  renderApp: () => void;
  peerColor: (peerId: string) => string;
  peerStatusClass: (peerId: string) => string;
  peerStatusTitle: (peerId: string) => string;
  getPeerAlias: (peerId: string) => string;
  escapeHtml: (text: string) => string;
}

export interface ModalActions {
  showCreateWorkspaceModal: () => void;
  showJoinWorkspaceModal: () => void;
  showJoinWithInvite: (inviteCode: string, peerId: string, workspaceName: string, inviteData?: InviteData) => void;
  showConnectPeerModal: () => void;
  showCreateChannelModal: () => void;
  showCreateDMModal: () => void;
  showAddContactModal: () => void;
  showStartDirectMessageModal: () => void;
  showStartWorkspaceMemberDMModal: () => void;
  showMessageInfo: (messageId: string) => void;
  showChannelMembersModal: () => void;
  showWorkspaceMembersModal: () => void;
  showWorkspaceSettingsModal: () => void;
  showMyQR: () => void;
  showScanQR: () => void;
  showRestoreSeed: () => void;
  showSearchPanel: () => void;
  showSettings: () => void;
  showInstallTeamTemplateModal: () => void;
}

export function createModalActions(ctx: ModalActionContext): ModalActions {
  const {
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
  } = ctx;

  type MemberPickerOption = {
    peerId: string;
    name: string;
    statusClass: string;
    statusTitle: string;
    disabled?: boolean;
  };

  const memberPickerLoadInFlight = new Map<string, Promise<void>>();

  const mapDirectoryMemberPickerOptions = (members: WorkspaceMemberDirectoryView['members']): MemberPickerOption[] =>
    members
      .filter((member) => !member.isYou)
      .map((member) => ({
        peerId: member.peerId,
        name: member.alias || getPeerAlias(member.peerId),
        statusClass: peerStatusClass(member.peerId),
        statusTitle: peerStatusTitle(member.peerId),
        disabled: member.allowWorkspaceDMs === false,
      }));

  const getWorkspaceMemberPickerOptions = (workspaceId: string): MemberPickerOption[] => {
    const ws = workspaceManager.getWorkspace(workspaceId);
    if (!ws) return [];

    const directoryView = callbacks.getWorkspaceMemberDirectory?.(workspaceId);
    if (directoryView && (directoryView.members.length > 0 || directoryView.hasMore)) {
      return mapDirectoryMemberPickerOptions(directoryView.members);
    }

    return ws.members
      .filter((member: import('@decentchat/protocol').WorkspaceMember) => member.peerId !== state.myPeerId)
      .map((member: import('@decentchat/protocol').WorkspaceMember) => ({
        peerId: member.peerId,
        name: member.alias,
        statusClass: peerStatusClass(member.peerId),
        statusTitle: peerStatusTitle(member.peerId),
        disabled: member.allowWorkspaceDMs === false,
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

  const loadNextDirectoryPageForMemberPicker = async (workspaceId: string): Promise<void> => {
    const existing = memberPickerLoadInFlight.get(workspaceId);
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

    memberPickerLoadInFlight.set(workspaceId, run);
    try {
      await run;
    } finally {
      memberPickerLoadInFlight.delete(workspaceId);
    }
  };

  function showModal(
    title: string,
    bodyHTML: string,
    onSubmit: (form: HTMLFormElement) => boolean | void | Promise<boolean | void>,
    options?: {
      submitLabel?: string;
      cancelLabel?: string;
      submitClassName?: string;
      cancelClassName?: string;
    },
  ): HTMLDivElement {
    return svelteShowModal(title, bodyHTML, onSubmit, options);
  }

  function showCreateWorkspaceModal(): void {
    showModal(
      'Create private group',
      `<p class="modal-intro">Create a private group chat and jump straight into <code>#general</code>.</p>
       <p class="modal-trust-note">No email required. Your group stays private by default.</p>
       <div class="workspace-create-next-steps"><strong>Ready right away</strong><ul><li>Your group opens in <code>#general</code>.</li><li>Your invite link and QR code are ready to share.</li></ul></div>
       <div class="form-group"><label>Group name <span class="modal-label-meta">(required)</span></label><input type="text" name="name" placeholder="e.g. Design team" required autofocus /><small class="modal-help">Visible to everyone you invite to this group.</small></div>
       <div class="form-group"><label>Your display name <span class="modal-label-meta">(required)</span></label><input type="text" name="alias" placeholder="Your name" required autocapitalize="words" /><small class="modal-help">This is the name people see on your messages. You can change it later.</small></div>`,
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
        const nextStepHint = 'Send your first message or invite people with a link or QR code.';
        showToast(`Private group \"${name}\" is ready. ${nextStepHint}`, 'success');
      },
      {
        submitLabel: 'Create private group',
        cancelLabel: 'Cancel',
        submitClassName: 'create-workspace-submit',
        cancelClassName: 'create-workspace-cancel',
      },
    );
  }

  function showJoinWithInvite(inviteCode: string, peerId: string, workspaceName: string, inviteData?: InviteData): void {
    showModal(
      `Join ${workspaceName || 'Workspace'}`,
      `<input type="hidden" name="peerId" value="${peerId}" />
       ${workspaceName ? `<p style="color: var(--text-muted); margin-bottom: 16px; font-size: 15px;">You've been invited to <strong>${escapeHtml(workspaceName)}</strong></p>` : ''}
       <div class="form-group"><label>Your name in this workspace</label><input type="text" name="alias" placeholder="Enter your name" required autofocus /></div>
       <div class="form-group"><label style="display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" name="allowWorkspaceDMs" checked /> <span>Allow direct messages from workspace members</span></label></div>`,
      (form) => {
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        const allowWorkspaceDMs = (form.elements.namedItem('allowWorkspaceDMs') as HTMLInputElement | null)?.checked ?? true;
        if (!alias) return;
        state.myAlias = alias;
        callbacks.persistSetting('myAlias', alias);
        callbacks.joinWorkspace(workspaceName || inviteCode, alias, peerId, inviteData, { allowWorkspaceDMs });
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
      onJoin: (
        wsName: string,
        alias: string,
        peerId: string,
        inviteDataParam?: any,
        options?: { allowWorkspaceDMs?: boolean },
      ) => {
        state.myAlias = alias;
        callbacks.persistSetting('myAlias', alias);
        callbacks.joinWorkspace(wsName, alias, peerId, inviteDataParam, options);
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
      (m: import('@decentchat/protocol').WorkspaceMember) => m.peerId !== state.myPeerId,
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

  function showStartWorkspaceMemberDMModal(): void {
    if (!state.activeWorkspaceId) {
      showStartDirectMessageModal();
      return;
    }

    const workspaceId = state.activeWorkspaceId;
    const ws = workspaceManager.getWorkspace(workspaceId);
    if (!ws) return;

    void callbacks.prefetchWorkspaceMemberDirectory?.(workspaceId);

    const initialPeers = getWorkspaceMemberPickerOptions(workspaceId);
    const initialDirectoryView = callbacks.getWorkspaceMemberDirectory?.(workspaceId);
    if (initialPeers.length === 0 && !(initialDirectoryView?.hasMore ?? false)) {
      showToast('No other members in workspace yet. Invite someone first!', 'error');
      return;
    }

    showPeerSelectModal({
      title: 'Message Workspace Member',
      label: 'Search workspace members',
      peers: initialPeers,
      searchPlaceholder: 'Search workspace members by name or peer ID…',
      emptyStateText: 'No workspace members match your search',
      searchPeers: async (query: string, limit: number) => {
        const directoryView = callbacks.getWorkspaceMemberDirectory?.(workspaceId);
        const usingDirectory = Boolean(directoryView && (directoryView.members.length > 0 || directoryView.hasMore));

        if (!usingDirectory) {
          return filterMemberPickerPeers(getWorkspaceMemberPickerOptions(workspaceId), query, limit);
        }

        return searchMemberPickerPeers(
          {
            getMembers: () => getWorkspaceMemberPickerOptions(workspaceId),
            getLoadedCount: () => callbacks.getWorkspaceMemberDirectory?.(workspaceId)?.loadedCount ?? 0,
            hasMore: () => Boolean(callbacks.getWorkspaceMemberDirectory?.(workspaceId)?.hasMore),
            loadNextPage: () => loadNextDirectoryPageForMemberPicker(workspaceId),
          },
          query,
          limit,
        );
      },
      onSelect: (peerId: string) => {
        callbacks.startDirectMessage?.(peerId, { sourceWorkspaceId: workspaceId }).then(async (conv) => {
          await refreshContactsCache();
          switchToDirectConversation(conv.id);
        }).catch((err: any) => {
          const message = err?.message || 'Could not start DM';
          showToast(message, 'error');
        });
      },
    });
  }

  function showMessageInfo(messageId: string): void {
    const info = callbacks.getMessageReceiptInfo?.(messageId);
    if (!info) { showToast('Message info unavailable', 'error'); return; }
    showMessageInfoModal(info);
  }

  const formatPresenceSummary = (
    workspaceId: string,
    channelId?: string | null,
    directoryView?: WorkspaceMemberDirectoryView,
  ): string | undefined => {
    if (!callbacks.getPresenceScopeState) return undefined;
    const presence = callbacks.getPresenceScopeState(workspaceId, channelId);
    if (!presence) return undefined;

    const parts: string[] = [];
    if (presence.onlineCount !== null) {
      parts.push(`${presence.onlineCount} online`);
    }

    if (presence.sampledPeerCount > 0) {
      const sampled = `${presence.sampledPeerCount}${presence.hasMore ? '+' : ''}`;
      parts.push(`${sampled} sampled`);
      if (presence.loadedPages > 0) {
        parts.push(`${presence.loadedPages} page${presence.loadedPages === 1 ? '' : 's'}`);
      }
    }

    if (directoryView && directoryView.loadedCount > 0) {
      const roster = `${directoryView.loadedCount}${directoryView.hasMore ? '+' : ''}`;
      parts.push(`${roster} roster loaded`);
    }

    return parts.length > 0 ? `Presence: ${parts.join(' · ')}` : undefined;
  };

  function showChannelMembersModal(): void {
    if (!state.activeWorkspaceId || !state.activeChannelId) return;
    const ws = workspaceManager.getWorkspace(state.activeWorkspaceId);
    const channel = ws ? workspaceManager.getChannel(ws.id, state.activeChannelId) : null;
    if (!ws || !channel) return;

    const isPublicWorkspaceChannel = channel.type === 'channel' && channel.accessPolicy?.mode === 'public-workspace';
    void callbacks.prefetchWorkspaceMemberDirectory?.(ws.id);

    const mapDirectoryMembers = (members: WorkspaceMemberDirectoryView['members']) =>
      members.map((member) => ({
        peerId: member.peerId,
        name: member.alias || getPeerAlias(member.peerId),
        isOnline: member.isOnline,
        isYou: member.isYou,
        isBot: member.isBot,
        color: peerColor(member.peerId),
        companySim: (member as any).companySim,
      }));

    const directoryView = callbacks.getWorkspaceMemberDirectory?.(ws.id);
    const presenceSummaryText = formatPresenceSummary(ws.id, state.activeChannelId, directoryView);

    const fallbackMembers = ws.members
      .filter((member) => channel.members.includes(member.peerId))
      .map((member) => ({
        peerId: member.peerId,
        name: getPeerAlias(member.peerId),
        isOnline: state.connectedPeers.has(member.peerId) || member.peerId === state.myPeerId,
        isYou: member.peerId === state.myPeerId,
        isBot: !!(member as any).isBot,
        color: peerColor(member.peerId),
        companySim: (member as any).companySim,
      }));

    const usingDirectoryState = isPublicWorkspaceChannel && (
      (directoryView?.members.length ?? 0) > 0 || (directoryView?.hasMore ?? false)
    );

    svelteShowChannelMembersModal({
      channelName: channel.name,
      members: usingDirectoryState ? mapDirectoryMembers(directoryView?.members || []) : fallbackMembers,
      loadedCount: usingDirectoryState ? (directoryView?.loadedCount ?? 0) : fallbackMembers.length,
      totalCount: usingDirectoryState ? (directoryView?.totalCount ?? fallbackMembers.length) : fallbackMembers.length,
      hasMore: usingDirectoryState ? (directoryView?.hasMore ?? false) : false,
      presenceSummaryText,
      onLoadMore: usingDirectoryState
        ? async () => {
            const nextDirectoryView = callbacks.loadMoreWorkspaceMemberDirectory
              ? await callbacks.loadMoreWorkspaceMemberDirectory(ws.id)
              : await (async () => {
                  await callbacks.prefetchWorkspaceMemberDirectory?.(ws.id);
                  return callbacks.getWorkspaceMemberDirectory?.(ws.id) || null;
                })();

            if (!nextDirectoryView) return null;

            if (callbacks.loadMorePresenceScope) {
              void callbacks.loadMorePresenceScope(ws.id, channel.id);
            }

            return {
              members: mapDirectoryMembers(nextDirectoryView.members),
              loadedCount: nextDirectoryView.loadedCount,
              totalCount: nextDirectoryView.totalCount,
              hasMore: nextDirectoryView.hasMore,
            };
          }
        : undefined,
      onToast: (msg: string, type?: string) => showToast(msg, type as any),
    });
  }

  function showWorkspaceMembersModal(): void {
    if (!state.activeWorkspaceId) return;
    const ws = workspaceManager.getWorkspace(state.activeWorkspaceId);
    if (!ws) return;

    void callbacks.prefetchWorkspaceMemberDirectory?.(ws.id);

    const mapDirectoryMembers = (members: WorkspaceMemberDirectoryView['members']) => {
      const currentWorkspace = workspaceManager.getWorkspace(ws.id) || ws;
      const hydratedPeerIds = new Set(currentWorkspace.members.map((member) => member.peerId));

      return members.map((member) => ({
        peerId: member.peerId,
        name: member.alias || getPeerAlias(member.peerId),
        role: member.role,
        isBot: member.isBot,
        isOnline: member.isOnline,
        isYou: member.isYou,
        color: member.isBot ? '#7c3aed' : peerColor(member.peerId),
        companySim: (member as any).companySim,
        // Moderation controls still require hydrated member records in workspace-state.
        isHydrated: member.isYou || hydratedPeerIds.has(member.peerId),
      }));
    };

    const directoryView = callbacks.getWorkspaceMemberDirectory?.(ws.id);
    const presenceSummaryText = formatPresenceSummary(ws.id, state.activeChannelId, directoryView);
    const mappedDirectoryMembers = mapDirectoryMembers(directoryView?.members || []);

    const fallbackMembers = ws.members.map(member => ({
      peerId: member.peerId,
      name: getPeerAlias(member.peerId),
      role: member.role,
      isBot: !!member.isBot,
      isOnline: state.connectedPeers.has(member.peerId) || member.peerId === state.myPeerId,
      isYou: member.peerId === state.myPeerId,
      color: member.isBot ? '#7c3aed' : peerColor(member.peerId),
      companySim: (member as any).companySim,
      isHydrated: true,
    }));

    const usingDirectoryState = mappedDirectoryMembers.length > 0 || (directoryView?.hasMore ?? false);

    const myMember = ws.members.find(m => m.peerId === state.myPeerId);
    const myRole = myMember?.role || 'member';
    const isOwner = myRole === 'owner' || ws.createdBy === state.myPeerId || workspaceManager.isOwner(ws.id, state.myPeerId);
    const isAdminOrOwner = isOwner || myRole === 'admin' || workspaceManager.isAdmin(ws.id, state.myPeerId);

    svelteShowWorkspaceMembersModal({
      members: usingDirectoryState ? mappedDirectoryMembers : fallbackMembers,
      loadedCount: usingDirectoryState ? (directoryView?.loadedCount ?? mappedDirectoryMembers.length) : fallbackMembers.length,
      totalCount: usingDirectoryState ? (directoryView?.totalCount ?? mappedDirectoryMembers.length) : fallbackMembers.length,
      hasMore: usingDirectoryState ? (directoryView?.hasMore ?? false) : false,
      presenceSummaryText,
      isOwner,
      isAdminOrOwner,
      onRemove: async (peerId: string) => {
        if (!callbacks.removeWorkspaceMember) return { success: false, error: 'Not available' };
        return callbacks.removeWorkspaceMember(peerId);
      },
      onBan: async (peerId: string) => {
        if (!callbacks.banWorkspaceMember) return { success: false, error: 'Not available' };
        // Default temporary ban for 24h in v1 UX.
        return callbacks.banWorkspaceMember(peerId, { durationMs: 24 * 60 * 60 * 1000, reason: 'Removed by admin' });
      },
      onPromote: async (peerId: string) => {
        if (!callbacks.promoteMember) return { success: false, error: 'Not available' };
        return callbacks.promoteMember(peerId, 'admin');
      },
      onDemote: async (peerId: string) => {
        if (!callbacks.demoteMember) return { success: false, error: 'Not available' };
        return callbacks.demoteMember(peerId);
      },
      onLoadMore: usingDirectoryState
        ? async () => {
            const nextDirectoryView = callbacks.loadMoreWorkspaceMemberDirectory
              ? await callbacks.loadMoreWorkspaceMemberDirectory(ws.id)
              : await (async () => {
                  await callbacks.prefetchWorkspaceMemberDirectory?.(ws.id);
                  return callbacks.getWorkspaceMemberDirectory?.(ws.id) || null;
                })();

            if (!nextDirectoryView) return null;

            if (callbacks.loadMorePresenceScope && state.activeChannelId) {
              void callbacks.loadMorePresenceScope(ws.id, state.activeChannelId);
            }

            return {
              members: mapDirectoryMembers(nextDirectoryView.members),
              loadedCount: nextDirectoryView.loadedCount,
              totalCount: nextDirectoryView.totalCount,
              hasMore: nextDirectoryView.hasMore,
            };
          }
        : undefined,
      onToast: (msg: string, type?: string) => showToast(msg, type as any),
      onRefresh: () => { updateSidebar(); syncShellHeader(); },
    });
  }

  function showWorkspaceSettingsModal(): void {
    if (!state.activeWorkspaceId) return;
    const ws = workspaceManager.getWorkspace(state.activeWorkspaceId);
    if (!ws) return;

    const isOwner = workspaceManager.isOwner(ws.id, state.myPeerId);
    const isAdminOrOwner = workspaceManager.isAdmin(ws.id, state.myPeerId);
    const canCreateInvites = workspaceManager.canInviteMembers(ws.id, state.myPeerId);
    const perms = ws.permissions ?? { whoCanCreateChannels: 'everyone', whoCanInviteMembers: 'everyone' };

    type InviteListViewItem = WorkspaceInviteItem & { inviterLabel?: string };
    type InviteListView = { active: InviteListViewItem[]; revoked: InviteListViewItem[] };

    const formatInviter = (inviterId?: string): string | undefined => {
      if (!inviterId) return undefined;
      const member = ws.members.find((m) => m.peerId === inviterId);
      if (member?.alias) return member.alias;
      const alias = getPeerAlias(inviterId);
      return alias || inviterId.slice(0, 8);
    };

    const buildInviteView = (): InviteListView => {
      const raw: WorkspaceInviteLists = callbacks.listWorkspaceInvites?.(ws.id) || { active: [], revoked: [] };
      const mapItem = (invite: WorkspaceInviteItem): InviteListViewItem => ({
        ...invite,
        inviterLabel: formatInviter(invite.inviterId),
      });
      return {
        active: raw.active.map(mapItem),
        revoked: raw.revoked.map(mapItem),
      };
    };

    svelteShowWorkspaceSettingsModal({
      name: ws.name,
      description: ws.description || '',
      isOwner,
      canLeave: !isOwner,
      permissions: { whoCanCreateChannels: perms.whoCanCreateChannels, whoCanInviteMembers: perms.whoCanInviteMembers },
      inviteLists: buildInviteView(),
      canCreateInvites,
      canRevokeInvites: isAdminOrOwner,
      onRefreshInvites: async () => buildInviteView(),
      onCreateInvite: async (permanent: boolean) => {
        if (!canCreateInvites) {
          showToast('You do not have permission to create invites in this workspace', 'error');
          return buildInviteView();
        }

        const url = await callbacks.generateInviteURL?.(ws.id, { permanent });
        if (!url) {
          showToast('Failed to generate invite link', 'error');
          return buildInviteView();
        }

        try {
          await navigator.clipboard.writeText(url);
          showToast(permanent ? 'Permanent invite created and copied!' : 'Invite link created and copied!', 'success');
        } catch {
          showToast('Invite created. Copy failed — check browser clipboard permission.', 'info');
        }

        return buildInviteView();
      },
      onCopyInvite: async (inviteId: string) => {
        const raw = callbacks.listWorkspaceInvites?.(ws.id) || { active: [], revoked: [] };
        const invite = [...raw.active, ...raw.revoked].find((entry) => entry.inviteId === inviteId);
        if (!invite?.url) {
          showToast('Invite URL unavailable for this entry (legacy invite)', 'error');
          return false;
        }

        await navigator.clipboard.writeText(invite.url);
        showToast('Invite link copied!', 'success');
        return true;
      },
      onRevokeInvite: async (inviteId: string) => {
        if (!isAdminOrOwner) {
          showToast('Only admins and owners can revoke invites', 'error');
          return buildInviteView();
        }

        const result = await callbacks.revokeWorkspaceInvite?.(inviteId);
        if (!result) {
          showToast('Invite revocation is not available in this client build', 'error');
          return buildInviteView();
        }

        if (!result.success) {
          showToast(result.error || 'Failed to revoke invite', 'error');
          return buildInviteView();
        }

        if (result.alreadyRevoked) {
          showToast(`Invite ${result.inviteId || inviteId} is already revoked`, 'info');
        } else {
          showToast(`Invite ${result.inviteId || inviteId} revoked`, 'success');
        }

        return buildInviteView();
      },
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
      onLeave: async () => {
        const result = await callbacks.leaveWorkspace?.(ws.id);
        if (result?.success) {
          showToast('You left the workspace', 'success');
          state.activeWorkspaceId = null;
          state.activeChannelId = null;
          renderApp();
          return true;
        }
        showToast(result?.error || 'Failed to leave workspace', 'error');
        return false;
      },
      onToast: (msg: string, type?: string) => showToast(msg, type as any),
    });
  }

  function showMyQR(): void {
    const publicKey = callbacks.getMyPublicKey?.();
    if (!publicKey) { showToast('Public key not available yet', 'error'); return; }
    void qrFlow.showMyQR({
      publicKey,
      displayName: state.myAlias || state.myPeerId.slice(0, 8),
      peerId: state.myPeerId,
    });
  }

  function showScanQR(): void {
    void qrFlow.showScanQR();
  }

  function showRestoreSeed(): void {
    void qrFlow.showRestoreSeed();
  }

  function showSearchPanel(): void {
    shellData.search.open = !shellData.search.open;
    shellData.search.myPeerId = state.myPeerId;
    shellData.search.myAlias = state.myAlias || 'You';
  }

  function showSettings(): void {
    const wsId = state.activeWorkspaceId;
    void showSettingsModal({
      getSettings: async () => {
        const settings = {
          ...await (callbacks.getSettings?.() || {}),
        } as Record<string, unknown>;
        const currentSeed = await callbacks.getCurrentSeed?.();
        return {
          ...settings,
          seedPhrase: resolveSeedPhraseForSettings(settings.seedPhrase as string | null | undefined, currentSeed),
          myPeerId: state.myPeerId,
          myAlias: state.myAlias,
          activeWorkspaceId: wsId,
          workspaceAlias: wsId ? (state.workspaceAliases?.[wsId] || '') : '',
        };
      },
      saveSetting: async (key: string, value: unknown) => {
        if (key === 'workspaceAlias' && wsId) { callbacks.setWorkspaceAlias?.(wsId, value as string); return; }
        if (key === 'myAlias' && typeof value === 'string' && value.trim()) { state.myAlias = value.trim(); }
        await callbacks.persistSetting(key, value);
        if (key === 'showLiveReconnectActivity') { updateSidebar(); }
      },
      onAction: async (action: string) => {
        if (action === 'generateSeed') {
          const currentSeed = await callbacks.getCurrentSeed?.();
          if (!canGenerateSeed(currentSeed)) {
            showToast('Seed phrase already exists for this device. Use Transfer instead.', 'info');
            return;
          }
          await callbacks.onSettingsAction?.(action);
        } else if (action === 'seed-transfer') {
          const seed = await callbacks.getCurrentSeed?.();
          if (seed) {
            await qrFlow.showSeedQR(seed, { sourcePeerId: state.myPeerId || undefined });
          } else {
            showToast('No seed phrase found for this device', 'error');
          }
        }
      },
    });
  }

  function showInstallTeamTemplateModal(): void {
    if (!state.activeWorkspaceId) {
      showToast('Open a workspace before installing an AI team.', 'error');
      return;
    }

    svelteShowInstallTeamTemplateModal({
      workspaceId: state.activeWorkspaceId,
      workspaceName: workspaceManager.getWorkspace(state.activeWorkspaceId)?.name ?? null,
      listTemplates: callbacks.listCompanyTemplates,
      installTemplate: callbacks.installCompanyTemplate,
      onInstalled: async () => {
        updateSidebar();
        syncShellHeader();
      },
      onToast: showToast,
    });
  }

  return {
    showCreateWorkspaceModal,
    showJoinWorkspaceModal,
    showJoinWithInvite,
    showConnectPeerModal,
    showCreateChannelModal,
    showCreateDMModal,
    showAddContactModal,
    showStartDirectMessageModal,
    showStartWorkspaceMemberDMModal,
    showMessageInfo,
    showChannelMembersModal,
    showWorkspaceMembersModal,
    showWorkspaceSettingsModal,
    showMyQR,
    showScanQR,
    showRestoreSeed,
    showSearchPanel,
    showSettings,
    showInstallTeamTemplateModal,
  };
}
