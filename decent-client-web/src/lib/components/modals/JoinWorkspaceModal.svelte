<!--
  JoinWorkspaceModal.svelte — Join workspace form with invite link parsing and clipboard auto-detect.
  Replaces UIRenderer.showJoinWorkspaceModal().
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  interface JoinWorkspaceConfig {
    parseInvite: (invite: string) => { code: string; peerId?: string; inviteData?: any; error?: string };
    onJoin: (
      invite: string,
      alias: string,
      peerId: string,
      inviteData?: any,
      options?: { allowWorkspaceDMs?: boolean },
    ) => void;
    onToast: (message: string, type?: string) => void;
  }

  export function showJoinWorkspaceModal(config: JoinWorkspaceConfig): void {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let instance: Record<string, any> | null = null;
    const cleanup = () => {
      if (instance) { unmount(instance); instance = null; }
      target.remove();
    };

    instance = mount(JoinWorkspaceModal, {
      target,
      props: { ...config, onClose: cleanup },
    });
  }

  import JoinWorkspaceModal from './JoinWorkspaceModal.svelte';
</script>

<script lang="ts">
  interface Props {
    parseInvite: (invite: string) => { code: string; peerId?: string; inviteData?: any; error?: string };
    onJoin: (
      invite: string,
      alias: string,
      peerId: string,
      inviteData?: any,
      options?: { allowWorkspaceDMs?: boolean },
    ) => void;
    onToast: (message: string, type?: string) => void;
    onClose: () => void;
  }

  let { parseInvite, onJoin, onToast, onClose }: Props = $props();

  let invite = $state('');
  let alias = $state('');
  let workspacePreview = $state('');
  let showPreview = $state(false);
  let autofillHint = $state(false);
  let autofilled = $state(false);
  let allowWorkspaceDMs = $state(true);

  let overlayEl: HTMLDivElement | undefined = $state();
  let aliasInput: HTMLInputElement | undefined = $state();

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

  // Focus first input
  $effect(() => {
    if (overlayEl) {
      setTimeout(() => {
        overlayEl?.querySelector('input')?.focus();
      }, 50);
    }
  });

  // Clipboard auto-detect
  $effect(() => {
    if (!overlayEl) return;
    if (navigator.clipboard?.readText) {
      navigator.clipboard.readText()
        .then((text) => {
          const clipboardText = text.trim();
          if (!clipboardText || invite.trim()) return;

          const parsed = parseInvite(clipboardText);
          if (parsed.error || !parsed.inviteData) return;

          invite = clipboardText;
          autofilled = true;
          autofillHint = true;
          updatePreview();

          setTimeout(() => {
            aliasInput?.focus();
            aliasInput?.select();
          }, 90);
        })
        .catch(() => {});
    }
  });

  function updatePreview() {
    const parsed = parseInvite(invite.trim());
    const name = parsed.inviteData?.workspaceName?.trim();
    if (name) {
      workspacePreview = name;
      showPreview = true;
    } else {
      workspacePreview = '';
      showPreview = false;
    }
  }

  function handleInviteInput() {
    autofilled = false;
    autofillHint = false;
    updatePreview();
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!invite.trim() || !alias.trim()) return;

    const parsed = parseInvite(invite.trim());
    if (parsed.error) {
      onToast(parsed.error, 'error');
      return;
    }

    let peerId = parsed.peerId;
    if (!peerId) {
      const peerInput = prompt('Enter the Peer ID of someone in the workspace:');
      if (!peerInput) return;
      peerId = peerInput.trim();
    }

    if (!peerId) {
      onToast('Invite link missing peer info — ask the inviter for an updated link', 'error');
      return;
    }

    const wsName = parsed.inviteData?.workspaceName || parsed.code;
    onJoin(wsName, alias.trim(), peerId, parsed.inviteData, { allowWorkspaceDMs });
    onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" bind:this={overlayEl} onclick={handleOverlayClick}>
  <div class="modal">
    <button type="button" class="modal-close-button" aria-label="Close join workspace dialog" onclick={onClose}>×</button>
    <h2>Join workspace</h2>
    <p class="modal-intro">Paste the invite you received to join a workspace. You can change your display name later.</p>
    <form onsubmit={handleSubmit}>
      <div class="form-group">
        <label for="join-invite">Invite link or code</label>
        <input
          type="text"
          id="join-invite"
          name="invite"
          class="invite-input{autofilled ? ' invite-autofilled' : ''}"
          placeholder="ABCD-1234 or paste the full invite link"
          required
          bind:value={invite}
          oninput={handleInviteInput}
        />
        <small style="color: var(--text-muted); margin-top: 4px; display: block;">
          Paste the short code or full invite link you received
        </small>
        {#if autofillHint}
          <small class="invite-autofill-hint invite-autofill-hint-visible">
            ✅ We found an invite in your clipboard and pasted it here for you.
          </small>
        {/if}
      </div>
      {#if showPreview}
        <div class="form-group">
          <label for="join-workspace-preview">Workspace</label>
          <input id="join-workspace-preview" type="text" value={workspacePreview} readonly class="workspace-preview-pop" />
        </div>
      {/if}
      <div class="form-group">
        <label for="join-alias">Your display name</label>
        <input
          type="text"
          id="join-alias"
          name="alias"
          class="join-alias-input"
          placeholder="Your name"
          required
          bind:this={aliasInput}
          bind:value={alias}
        />
        <small class="modal-help">This is how people in the workspace will see you. You can change it later.</small>
      </div>
      <div class="form-group">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" name="allowWorkspaceDMs" bind:checked={allowWorkspaceDMs} />
          <span>Allow direct messages from workspace members</span>
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
        <button type="submit" class="btn-primary">Join</button>
      </div>
    </form>
  </div>
</div>
