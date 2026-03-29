<!--
  WorkspaceSettingsModal.svelte — Workspace settings form (name, description, permissions, danger zone).
  Replaces UIRenderer.showWorkspaceSettingsModal().
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  interface WorkspaceInviteView {
    inviteId: string;
    inviteCode?: string;
    url?: string;
    createdAt?: number;
    expiresAt?: number;
    inviterId?: string;
    inviterLabel?: string;
    permanent: boolean | null;
    revoked: boolean;
    revokedAt?: number;
  }

  interface WorkspaceSettingsConfig {
    name: string;
    description: string;
    isOwner: boolean;
    canLeave?: boolean;
    permissions: { whoCanCreateChannels: string; whoCanInviteMembers: string };
    inviteLists?: { active: WorkspaceInviteView[]; revoked: WorkspaceInviteView[] };
    canCreateInvites?: boolean;
    canRevokeInvites?: boolean;
    onCreateInvite?: (permanent: boolean) => Promise<{ active: WorkspaceInviteView[]; revoked: WorkspaceInviteView[] }>;
    onCopyInvite?: (inviteId: string) => Promise<boolean>;
    onRevokeInvite?: (inviteId: string) => Promise<{ active: WorkspaceInviteView[]; revoked: WorkspaceInviteView[] }>;
    onRefreshInvites?: () => Promise<{ active: WorkspaceInviteView[]; revoked: WorkspaceInviteView[] }>;
    onSave: (data: { name: string; description: string; whoCanCreateChannels: string; whoCanInviteMembers: string }) => Promise<boolean>;
    onManageMembers: () => void;
    onDelete: () => Promise<void>;
    onLeave?: () => Promise<boolean>;
    onToast: (message: string, type?: string) => void;
  }

  export function showWorkspaceSettingsModal(config: WorkspaceSettingsConfig): void {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let instance: Record<string, any> | null = null;
    const cleanup = () => {
      if (instance) { unmount(instance); instance = null; }
      target.remove();
    };

    instance = mount(WorkspaceSettingsModal, {
      target,
      props: { ...config, onClose: cleanup },
    });
  }

  import WorkspaceSettingsModal from './WorkspaceSettingsModal.svelte';
</script>

<script lang="ts">
  interface WorkspaceInviteView {
    inviteId: string;
    inviteCode?: string;
    url?: string;
    createdAt?: number;
    expiresAt?: number;
    inviterId?: string;
    inviterLabel?: string;
    permanent: boolean | null;
    revoked: boolean;
    revokedAt?: number;
  }

  interface Props {
    name: string;
    description: string;
    isOwner: boolean;
    canLeave?: boolean;
    permissions: { whoCanCreateChannels: string; whoCanInviteMembers: string };
    inviteLists?: { active: WorkspaceInviteView[]; revoked: WorkspaceInviteView[] };
    canCreateInvites?: boolean;
    canRevokeInvites?: boolean;
    onCreateInvite?: (permanent: boolean) => Promise<{ active: WorkspaceInviteView[]; revoked: WorkspaceInviteView[] }>;
    onCopyInvite?: (inviteId: string) => Promise<boolean>;
    onRevokeInvite?: (inviteId: string) => Promise<{ active: WorkspaceInviteView[]; revoked: WorkspaceInviteView[] }>;
    onRefreshInvites?: () => Promise<{ active: WorkspaceInviteView[]; revoked: WorkspaceInviteView[] }>;
    onSave: (data: { name: string; description: string; whoCanCreateChannels: string; whoCanInviteMembers: string }) => Promise<boolean>;
    onManageMembers: () => void;
    onDelete: () => Promise<void>;
    onLeave?: () => Promise<boolean>;
    onToast: (message: string, type?: string) => void;
    onClose: () => void;
  }

  let {
    name: initialName,
    description: initialDesc,
    isOwner,
    canLeave = false,
    permissions,
    inviteLists = { active: [], revoked: [] },
    canCreateInvites = false,
    canRevokeInvites = false,
    onCreateInvite,
    onCopyInvite,
    onRevokeInvite,
    onRefreshInvites,
    onSave,
    onManageMembers,
    onDelete,
    onLeave,
    onToast,
    onClose,
  }: Props = $props();

  let wsName = $state(initialName);
  let wsDescription = $state(initialDesc);
  let whoCanCreateChannels = $state(permissions.whoCanCreateChannels);
  let whoCanInviteMembers = $state(permissions.whoCanInviteMembers);

  let activeInvites = $state(inviteLists.active);
  let revokedInvites = $state(inviteLists.revoked);
  let inviteBusy = $state(false);
  let inviteBusyId = $state<string | null>(null);

  function applyInvites(next?: { active: WorkspaceInviteView[]; revoked: WorkspaceInviteView[] }) {
    if (!next) return;
    activeInvites = next.active;
    revokedInvites = next.revoked;
  }

  function formatTimestamp(ts?: number): string {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  }

  function formatInviteType(invite: WorkspaceInviteView): string {
    if (invite.permanent === true) return 'Permanent';
    if (invite.permanent === false) return 'Expiring';
    return 'Legacy';
  }

  function formatExpires(invite: WorkspaceInviteView): string {
    if (invite.permanent === true) return 'Never';
    if (!invite.expiresAt) return 'Unknown';
    if (invite.expiresAt <= Date.now()) return `Expired (${formatTimestamp(invite.expiresAt)})`;
    return formatTimestamp(invite.expiresAt);
  }

  async function refreshInvites() {
    if (!onRefreshInvites) return;
    inviteBusy = true;
    try {
      applyInvites(await onRefreshInvites());
    } finally {
      inviteBusy = false;
    }
  }

  async function handleCreateInvite(permanent: boolean) {
    if (!onCreateInvite || inviteBusy) return;
    inviteBusy = true;
    try {
      applyInvites(await onCreateInvite(permanent));
    } finally {
      inviteBusy = false;
    }
  }

  async function handleCopyInvite(inviteId: string) {
    if (!onCopyInvite) return;
    inviteBusyId = inviteId;
    try {
      await onCopyInvite(inviteId);
    } finally {
      inviteBusyId = null;
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!onRevokeInvite || inviteBusy) return;
    inviteBusy = true;
    inviteBusyId = inviteId;
    try {
      applyInvites(await onRevokeInvite(inviteId));
    } finally {
      inviteBusy = false;
      inviteBusyId = null;
    }
  }

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

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!wsName.trim()) return;
    const success = await onSave({
      name: wsName.trim(),
      description: wsDescription.trim(),
      whoCanCreateChannels,
      whoCanInviteMembers,
    });
    if (success) onClose();
  }

  function handleManageMembers() {
    onClose();
    onManageMembers();
  }

  async function handleDelete() {
    const confirmed = confirm(`Delete "${wsName}"? This cannot be undone.`);
    if (!confirmed) return;
    const secondConfirm = confirm(`Are you sure? All channels and messages will be lost.`);
    if (!secondConfirm) return;
    await onDelete();
    onClose();
  }

  async function handleLeave() {
    if (!onLeave) return;
    const confirmed = confirm(`Leave "${wsName}"? Your local workspace data will be deleted on this device.`);
    if (!confirmed) return;
    const success = await onLeave();
    if (success) onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleOverlayClick}>
  <div class="modal workspace-settings-modal">
    <div class="settings-header">
      <h2>Workspace Settings</h2>
      <button type="button" class="thread-close" id="workspace-settings-close" onclick={onClose}>✕</button>
    </div>
    <form class="workspace-settings-form" onsubmit={handleSubmit}>
      <div class="form-group">
        <label for="ws-name">Workspace Name</label>
        <input type="text" id="ws-name" bind:value={wsName} required />
      </div>
      <div class="form-group">
        <label for="ws-desc">Description</label>
        <textarea id="ws-desc" rows="2" placeholder="What's this workspace about?" bind:value={wsDescription}></textarea>
      </div>
      <div class="form-group">
        <label for="ws-create-channels">Who can create channels?</label>
        <select id="ws-create-channels" class="modal-select" bind:value={whoCanCreateChannels}>
          <option value="everyone">Everyone</option>
          <option value="admins">Admins only</option>
        </select>
      </div>
      <div class="form-group">
        <label for="ws-invite-members">Who can invite members?</label>
        <select id="ws-invite-members" class="modal-select" bind:value={whoCanInviteMembers}>
          <option value="everyone">Everyone</option>
          <option value="admins">Admins only</option>
        </select>
      </div>
      <div class="form-group">
        <div class="invites-header">
          <div class="invites-label">Invites</div>
          <div class="invites-toolbar">
            {#if onRefreshInvites}
              <button type="button" class="btn-secondary invite-tool-btn" disabled={inviteBusy} onclick={refreshInvites}>Refresh</button>
            {/if}
            {#if canCreateInvites}
              <button type="button" class="btn-secondary invite-tool-btn" disabled={inviteBusy} onclick={() => handleCreateInvite(false)}>New expiring</button>
              <button type="button" class="btn-secondary invite-tool-btn" disabled={inviteBusy} onclick={() => handleCreateInvite(true)}>New permanent</button>
            {/if}
          </div>
        </div>

        {#if activeInvites.length === 0 && revokedInvites.length === 0}
          <div class="invites-empty">No invites created yet.</div>
        {/if}

        {#if activeInvites.length > 0}
          <div class="invites-group-title">Active ({activeInvites.length})</div>
          {#each activeInvites as invite (invite.inviteId)}
            <div class="invite-item">
              <div class="invite-top-row">
                <code>{invite.inviteId}</code>
                <span class="invite-type-chip">{formatInviteType(invite)}</span>
              </div>
              <div class="invite-meta">Inviter: {invite.inviterLabel || invite.inviterId || 'Unknown'}</div>
              <div class="invite-meta">Expires: {formatExpires(invite)}</div>
              <div class="invite-meta">Created: {formatTimestamp(invite.createdAt)}</div>
              <div class="invite-meta">State: Active</div>
              <div class="invite-actions">
                <button type="button" class="btn-secondary invite-action-btn" disabled={inviteBusyId === invite.inviteId} onclick={() => handleCopyInvite(invite.inviteId)}>Copy link</button>
                {#if canRevokeInvites}
                  <button type="button" class="btn-danger invite-action-btn" disabled={inviteBusyId === invite.inviteId || inviteBusy} onclick={() => handleRevokeInvite(invite.inviteId)}>Revoke</button>
                {/if}
              </div>
            </div>
          {/each}
        {/if}

        {#if revokedInvites.length > 0}
          <div class="invites-group-title" style="margin-top: 10px;">Revoked ({revokedInvites.length})</div>
          {#each revokedInvites as invite (invite.inviteId)}
            <div class="invite-item revoked">
              <div class="invite-top-row">
                <code>{invite.inviteId}</code>
                <span class="invite-type-chip revoked-chip">Revoked</span>
              </div>
              <div class="invite-meta">Type: {formatInviteType(invite)}</div>
              <div class="invite-meta">Inviter: {invite.inviterLabel || invite.inviterId || 'Unknown'}</div>
              <div class="invite-meta">Expires: {formatExpires(invite)}</div>
              <div class="invite-meta">Revoked at: {formatTimestamp(invite.revokedAt)}</div>
              <div class="invite-actions">
                <button type="button" class="btn-secondary invite-action-btn" disabled={inviteBusyId === invite.inviteId || !invite.url} onclick={() => handleCopyInvite(invite.inviteId)}>Copy link</button>
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <div class="form-group">
        <button type="button" class="btn-secondary" style="width:100%;" onclick={handleManageMembers}>Manage Members</button>
      </div>
      <div class="form-group" style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
        {#if isOwner}
          <button type="button" class="btn-danger" style="width:100%;" onclick={handleDelete}>Delete Workspace</button>
        {:else if canLeave}
          <button type="button" class="btn-danger" style="width:100%;" onclick={handleLeave}>Leave Workspace</button>
        {/if}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>
  </div>
</div>

<style>
  .btn-danger {
    padding: 10px 20px;
    background: rgba(214, 48, 49, 0.12);
    color: #ff7675;
    border: 1px solid rgba(214, 48, 49, 0.45);
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-danger:hover {
    background: rgba(214, 48, 49, 0.22);
  }

  .invites-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }

  .invites-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .invites-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }

  .invite-tool-btn {
    padding: 6px 10px;
    font-size: 12px;
  }

  .invites-empty {
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    padding: 10px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .invites-group-title {
    margin: 8px 0 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .invite-item {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px;
    margin-bottom: 8px;
    background: var(--bg-secondary);
  }

  .invite-item.revoked {
    opacity: 0.88;
  }

  .invite-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 4px;
  }

  .invite-top-row code {
    font-size: 12px;
    color: var(--text);
    word-break: break-all;
  }

  .invite-type-chip {
    font-size: 11px;
    border-radius: 999px;
    padding: 2px 8px;
    background: rgba(108, 92, 231, 0.15);
    color: var(--text);
    white-space: nowrap;
  }

  .revoked-chip {
    background: rgba(214, 48, 49, 0.2);
    color: #ff7675;
  }

  .invite-meta {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 1px;
  }

  .invite-actions {
    margin-top: 8px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .invite-action-btn {
    padding: 6px 10px;
    font-size: 12px;
  }
</style>
