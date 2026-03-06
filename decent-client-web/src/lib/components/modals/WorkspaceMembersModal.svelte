<!--
  WorkspaceMembersModal.svelte — Workspace member management with promote/demote/remove.
  Replaces UIRenderer.showWorkspaceMembersModal().
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  interface WorkspaceMember {
    peerId: string;
    name: string;
    role: string;
    isBot: boolean;
    isOnline: boolean;
    isYou: boolean;
    color: string;
  }

  interface WorkspaceMembersConfig {
    members: WorkspaceMember[];
    isOwner: boolean;
    isAdminOrOwner: boolean;
    onRemove: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onPromote: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onDemote: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onToast: (message: string, type?: string) => void;
    onRefresh: () => void;
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
  interface Props {
    members: WorkspaceMember[];
    isOwner: boolean;
    isAdminOrOwner: boolean;
    onRemove: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onPromote: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onDemote: (peerId: string) => Promise<{ success: boolean; error?: string }>;
    onToast: (message: string, type?: string) => void;
    onRefresh: () => void;
    onClose: () => void;
  }

  let { members: initialMembers, isOwner, isAdminOrOwner, onRemove, onPromote, onDemote, onToast, onRefresh, onClose }: Props = $props();

  let members = $state(initialMembers);

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

  function roleBadge(role: string, isBot: boolean): string {
    let badges = '';
    if (isBot) badges += 'BOT';
    return badges;
  }

  async function handleRemove(peerId: string, name: string) {
    if (!confirm(`Remove ${name} from workspace?`)) return;
    const res = await onRemove(peerId);
    if (!res.success) { onToast(res.error || 'Failed to remove member', 'error'); return; }
    members = members.filter(m => m.peerId !== peerId);
    onToast('Member removed', 'success');
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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleOverlayClick}>
  <div class="modal">
    <h2>Workspace Members</h2>
    <form onsubmit={(e) => { e.preventDefault(); onClose(); }}>
      <div class="form-group" style="margin-bottom: 8px;">
        <div id="members-count-label" style="font-size: 13px; color: var(--text-muted);">{members.length} member{members.length === 1 ? '' : 's'}</div>
      </div>
      <div class="members-list">
        {#each members as member (member.peerId)}
          {@const canRemove = isAdminOrOwner && !member.isYou && member.role !== 'owner'}
          {@const canPromote = isOwner && !member.isYou && member.role === 'member'}
          {@const canDemote = isOwner && !member.isYou && member.role === 'admin'}
          <div class="member-row">
            <div class="member-info">
              <div class="member-avatar{member.isBot ? ' bot-avatar' : ''}" style="background:{member.color}">
                {member.isBot ? '🤖' : member.name.charAt(0).toUpperCase()}
              </div>
              <div class="member-details">
                <div class="member-name-line">
                  <span class="member-name">{member.name}</span>
                  {#if member.isBot}<span class="role-badge role-bot" title="Bot">BOT</span>{/if}
                  {#if member.role === 'owner'}<span class="role-badge role-owner" title="Owner">Owner</span>{/if}
                  {#if member.role === 'admin'}<span class="role-badge role-admin" title="Admin">Admin</span>{/if}
                  {#if member.isYou}<span class="you-badge">you</span>{/if}
                </div>
                <span class="member-status {member.isOnline ? 'online' : 'offline'}">
                  {member.isOnline ? 'Online' : 'Offline'}
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
              {#if canRemove}
                <button type="button" class="btn-action btn-danger remove-member-btn" onclick={() => handleRemove(member.peerId, member.name)} title="Remove from workspace">Remove</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick={onClose}>Close</button>
      </div>
    </form>
  </div>
</div>
