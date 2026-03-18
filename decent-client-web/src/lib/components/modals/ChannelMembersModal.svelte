<!--
  ChannelMembersModal.svelte — Shows channel member list.
  Replaces UIRenderer.showChannelMembersModal().
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

  interface ChannelMember {
    peerId: string;
    name: string;
    isOnline: boolean;
    isYou: boolean;
    isBot: boolean;
    color: string;
    companySim?: CompanyProfile;
  }

  interface ChannelMembersPagePayload {
    members: ChannelMember[];
    loadedCount: number;
    totalCount: number;
    hasMore: boolean;
  }

  interface ChannelMembersConfig {
    channelName: string;
    members: ChannelMember[];
    loadedCount?: number;
    totalCount?: number;
    hasMore?: boolean;
    presenceSummaryText?: string;
    onLoadMore?: () => Promise<ChannelMembersPagePayload | null>;
    onToast?: (message: string, type?: string) => void;
  }

  export function showChannelMembersModal(config: ChannelMembersConfig): void {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let instance: Record<string, any> | null = null;
    const cleanup = () => {
      if (instance) { unmount(instance); instance = null; }
      target.remove();
    };

    instance = mount(ChannelMembersModal, {
      target,
      props: { ...config, onClose: cleanup },
    });
  }

  import ChannelMembersModal from './ChannelMembersModal.svelte';
</script>

<script lang="ts">
  interface CompanyProfile {
    automationKind?: string;
    roleTitle?: string;
    teamId?: string;
    managerPeerId?: string;
    avatarUrl?: string;
  }

  interface ChannelMember {
    peerId: string;
    name: string;
    isOnline: boolean;
    isYou: boolean;
    isBot: boolean;
    color: string;
    companySim?: CompanyProfile;
  }

  interface ChannelMembersPagePayload {
    members: ChannelMember[];
    loadedCount: number;
    totalCount: number;
    hasMore: boolean;
  }

  interface Props {
    channelName: string;
    members: ChannelMember[];
    loadedCount?: number;
    totalCount?: number;
    hasMore?: boolean;
    presenceSummaryText?: string;
    onLoadMore?: () => Promise<ChannelMembersPagePayload | null>;
    onToast?: (message: string, type?: string) => void;
    onClose: () => void;
  }

  let {
    channelName,
    members: initialMembers,
    loadedCount,
    totalCount,
    hasMore = false,
    presenceSummaryText,
    onLoadMore,
    onToast,
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
      console.error('[ChannelMembersModal] load more failed', err);
      onToast?.('Failed to load more members', 'error');
    } finally {
      loadingMore = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleOverlayClick}>
  <div class="modal">
    <h2>Channel Members · #{channelName}</h2>
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
                  {#if isCompanyAgent}<span class="you-badge">AGENT</span>{/if}
                  {#if member.companySim?.roleTitle}<span class="member-role-inline">{member.companySim.roleTitle}</span>{/if}
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

  .member-role-inline {
    font-size: 12px;
    color: var(--text-muted);
    margin-left: 6px;
  }
</style>
