<!--
  WorkspaceSettingsModal.svelte — Workspace settings form (name, description, permissions, danger zone).
  Replaces UIRenderer.showWorkspaceSettingsModal().
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  interface WorkspaceSettingsConfig {
    name: string;
    description: string;
    isOwner: boolean;
    canLeave?: boolean;
    permissions: { whoCanCreateChannels: string; whoCanInviteMembers: string };
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
  interface Props {
    name: string;
    description: string;
    isOwner: boolean;
    canLeave?: boolean;
    permissions: { whoCanCreateChannels: string; whoCanInviteMembers: string };
    onSave: (data: { name: string; description: string; whoCanCreateChannels: string; whoCanInviteMembers: string }) => Promise<boolean>;
    onManageMembers: () => void;
    onDelete: () => Promise<void>;
    onLeave?: () => Promise<boolean>;
    onToast: (message: string, type?: string) => void;
    onClose: () => void;
  }

  let { name: initialName, description: initialDesc, isOwner, canLeave = false, permissions, onSave, onManageMembers, onDelete, onLeave, onToast, onClose }: Props = $props();

  let wsName = $state(initialName);
  let wsDescription = $state(initialDesc);
  let whoCanCreateChannels = $state(permissions.whoCanCreateChannels);
  let whoCanInviteMembers = $state(permissions.whoCanInviteMembers);

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
  <div class="modal">
    <h2>Workspace Settings</h2>
    <form onsubmit={handleSubmit}>
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
