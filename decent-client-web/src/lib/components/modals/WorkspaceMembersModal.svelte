<!--
  WorkspaceMembersModal.svelte — Workspace member management with promote/demote/remove.
  Replaces UIRenderer.showWorkspaceMembersModal().
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  interface CompanyProfile {
    automationKind?: string;
    roleTitle?: string;
    teamId?: string;
    managerPeerId?: string;
    avatarUrl?: string;
  }

  interface WorkspaceMember {
    peerId: string;
    name: string;
    role: string;
    isBot: boolean;
    isOnline: boolean;
    isYou: boolean;
    color: string;
    isHydrated?: boolean;
    companySim?: CompanyProfile;
  }

  interface WorkspaceMembersPagePayload {
    members: WorkspaceMember[];
    loadedCount: number;
    totalCount: number;
    hasMore: boolean;
  }

  interface WorkspaceMembersConfig {
    members: WorkspaceMember[];
    loadedCount?: number;
    totalCount?: number;
    hasMore?: boolean;
    presenceSummaryText?: string;
    isOwner: boolean;
    isAdminOrOwner: boolean;
    onRemove: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onBan: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onPromote: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onDemote: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onToast: (message: string, type?: string) => void;
    onRefresh: () => void;
    onLoadMore?: () => Promise<WorkspaceMembersPagePayload | null>;
  }

  export function showWorkspaceMembersModal(config: WorkspaceMembersConfig): void {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let instance: Record<string, any> | null = null;
    const cleanup = () => {
      if (instance) { unmount(instance); instance = null; }
      target.remove();
    };

    instance = mount(WorkspaceMembersModal, {
      target,
      props: { ...config, onClose: cleanup },
    });
  }

  import WorkspaceMembersModal from './WorkspaceMembersModal.svelte';
</script>

<script lang="ts">
  interface CompanyProfile {
    automationKind?: string;
    roleTitle?: string;
    teamId?: string;
    managerPeerId?: string;
    avatarUrl?: string;
  }

  interface WorkspaceMember {
    peerId: string;
    name: string;
    role: string;
    isBot: boolean;
    isOnline: boolean;
    isYou: boolean;
    color: string;
    isHydrated?: boolean;
    companySim?: CompanyProfile;
  }

  interface WorkspaceMembersPagePayload {
    members: WorkspaceMember[];
    loadedCount: number;
    totalCount: number;
    hasMore: boolean;
  }

  interface Props {
    members: WorkspaceMember[];
    loadedCount?: number;
    totalCount?: number;
    hasMore?: boolean;
    presenceSummaryText?: string;
    isOwner: boolean;
    isAdminOrOwner: boolean;
    onRemove: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onBan: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onPromote: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onDemote: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onToast: (message: string, type?: string) => void;
    onRefresh: () => void;
    onLoadMore?: () => Promise<WorkspaceMembersPagePayload | null>;
    onClose: () => void;
  }

  let {
    members: initialMembers,
    loadedCount,
    totalCount,
    hasMore = false,
    presenceSummaryText,
    isOwner,
    isAdminOrOwner,
    onRemove,
    onBan,
    onPromote,
    onDemote,
    onToast,
    onRefresh,
    onLoadMore,
    onClose,
  }: Props = $props();

  let members = $state(initialMembers);
  let loadingMore = $state(false);
  let visibleCount = $derived(members.length);
  let totalMemberCount = $derived(totalCount ?? visibleCount);

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  async function handleLoadMore() {
    if (!onLoadMore || loadingMore || !hasMore) return;
    loadingMore = true;
    try {
      const next = await onLoadMore();
      if (!next) return;
      members = next.members;
      loadedCount = next.loadedCount;
      totalCount = next.totalCount;
      hasMore = next.hasMore;
    } catch (err) {
      console.error('[WorkspaceMembersModal] load more failed', err);
      onToast('Failed to load more members', 'error');
    } finally {
      loadingMore = false;
    }
  }

  async function handleRemove(peerId: string, name: string) {
    if (!confirm(`Remove ${name} from workspace?`)) return;
    const res = await onRemove(peerId);
    if (!res.success) { onToast(res.error || 'Failed to remove member', 'error'); return; }
    members = members.filter(m => m.peerId !== peerId);
    onToast('Member removed', 'success');
    onRefresh();
  }

  async function handleBan(peerId: string, name: string) {
    if (!confirm(`Ban ${name} from this workspace for 24h?`)) return;
    const res = await onBan(peerId);
    if (!res.success) { onToast(res.error || 'Failed to ban member', 'error'); return; }
    members = members.filter(m => m.peerId !== peerId);
    onToast(`${name} banned for 24h`, 'success');
    onRefresh();
  }

  async function handlePromote(peerId: string, name: string) {
    const res = await onPromote(peerId);
    if (!res.success) { onToast(res.error || 'Failed to promote member', 'error'); return; }
    members = members.map(m => m.peerId === peerId ? { ...m, role: 'admin' } : m);
    onToast(`${name} promoted to Admin`, 'success');
    onRefresh();
  }

  async function handleDemote(peerId: string, name: string) {
    const res = await onDemote(peerId);
    if (!res.success) { onToast(res.error || 'Failed to demote member', 'error'); return; }
    members = members.map(m => m.peerId === peerId ? { ...m, role: 'member' } : m);
    onToast(`${name} demoted to Member`, 'success');
    onRefresh();
  }
</script>

<div class="modal-overlay" onclick={handleOverlayClick} onkeydown={(e) => e.key === 'Escape' && onClose()} role="presentation">
  <div class="modal">
    <h2>Workspace Members</h2>
    <form onsubmit={(e) => { e.preventDefault(); onClose(); }}>
      <div class="form-group" style="margin-bottom: 8px;">
        <div id="members-count-label" style="font-size: 13px; color: var(--text-muted);">
          {#if hasMore && totalMemberCount > visibleCount}
            Showing {visibleCount} of {totalMemberCount} members
          {:else}
            {members.length} member{members.length === 1 ? '' : 's'}
          {/if}
        </div>
        {#if presenceSummaryText}
          <div style="font-size: 12px; color: var(--text-muted); opacity: 0.85; margin-top: 4px;">
            {presenceSummaryText}
          </div>
        {/if}
      </div>
      <div class="members-list">
        {#each members as member (member.peerId)}
          {@const hydratedMember = member.isHydrated !== false}
          {@const canRemove = isAdminOrOwner && hydratedMember && !member.isYou && member.role !== 'owner'}
          {@const canBan = isAdminOrOwner && hydratedMember && !member.isYou && member.role !== 'owner'}
          {@const canPromote = isOwner && hydratedMember && !member.isYou && member.role === 'member'}
          {@const canDemote = isOwner && hydratedMember && !member.isYou && member.role === 'admin'}
          {@const avatarUrl = member.companySim?.avatarUrl}
          {@const isCompanyAgent = member.companySim?.automationKind === 'openclaw-agent'}
          <div class="member-row">
            <div class="member-info">
              <div class="member-avatar{member.isBot ? ' bot-avatar' : ''}" style="background:{avatarUrl ? 'transparent' : member.color}">
                {#if avatarUrl}
                  <img src={avatarUrl} alt={member.name} class="member-avatar-image" />
                {:else}
                  {member.isBot ? '🤖' : member.name.charAt(0).toUpperCase()}
                {/if}
              </div>
              <div class="member-details">
                <div class="member-name-line">
                  <span class="member-name">{member.name}</span>
                  {#if isCompanyAgent}<span class="role-badge role-bot" title="OpenClaw Agent">AGENT</span>{/if}
                  {#if member.companySim?.roleTitle}<span class="role-badge" title={member.companySim.roleTitle}>{member.companySim.roleTitle}</span>{/if}
                  {#if !isCompanyAgent && member.isBot}<span class="role-badge role-bot" title="Bot">BOT</span>{/if}
                  {#if member.role === 'owner'}<span class="role-badge role-owner" title="Owner">Owner</span>{/if}
                  {#if member.role === 'admin'}<span class="role-badge role-admin" title="Admin">Admin</span>{/if}
                  {#if member.isYou}<span class="you-badge">you</span>{/if}
                </div>
                <span class="member-status {member.isOnline ? 'online' : 'offline'}">
                  {member.isOnline ? 'Online' : 'Offline'}
                  {#if member.companySim?.teamId}
                    · {member.companySim.teamId}
                  {/if}
                </span>
              </div>
            </div>
            <div class="member-actions">
              {#if canPromote}
                <button type="button" class="btn-action promote-btn" onclick={() => handlePromote(member.peerId, member.name)} title="Promote to Admin">Promote</button>
              {/if}
              {#if canDemote}
                <button type="button" class="btn-action demote-btn" onclick={() => handleDemote(member.peerId, member.name)} title="Demote to Member">Demote</button>
              {/if}
              {#if canBan}
                <button type="button" class="btn-action btn-danger ban-member-btn" onclick={() => handleBan(member.peerId, member.name)} title="Ban from workspace">Ban</button>
              {/if}
              {#if canRemove}
                <button type="button" class="btn-action btn-danger remove-member-btn" onclick={() => handleRemove(member.peerId, member.name)} title="Remove from workspace">Remove</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <div class="modal-actions">
        {#if hasMore && onLoadMore}
          <button type="button" class="btn-secondary" onclick={handleLoadMore} disabled={loadingMore}>
            {#if loadingMore}
              Loading more…
            {:else}
              Load more members
            {/if}
          </button>
        {/if}
        <button type="button" class="btn-secondary" onclick={onClose}>Close</button>
      </div>
    </form>
  </div>
</div>

<style>
  .member-avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }
</style>
