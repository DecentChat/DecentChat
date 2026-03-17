<svelte:options runes={true} />

<script lang="ts">
  import ScreenHeader from '../components/ScreenHeader.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import { activeWorkspaceId, myAlias, myPeerId, workspaces } from '../stores/appState';
  import { OnboardingController } from '../app/OnboardingController';
  import type { MobileController } from '../app/MobileController';

  type Props = {
    controller: MobileController | null;
    onDeleteAccount?: (() => void | Promise<void>) | undefined;
  };

  let { controller, onDeleteAccount }: Props = $props();

  const onboardingController = new OnboardingController();

  let createWorkspaceInput = $state('');
  let createInFlight = $state(false);
  let createFeedback = $state<{ kind: 'success' | 'error'; message: string } | null>(null);

  let joinInviteInput = $state('');
  let joinInFlight = $state(false);
  let joinFeedback = $state<{ kind: 'success' | 'error'; message: string } | null>(null);

  let showSeedPhrase = $state(false);
  let revealSeedDialogOpen = $state(false);
  let deleteDialogOpen = $state(false);

  const resolvedAlias = $derived($myAlias || onboardingController.getAlias() || 'No alias set');
  const resolvedPeerId = $derived($myPeerId ?? '');
  const truncatedPeerId = $derived(
    resolvedPeerId ? `${resolvedPeerId.slice(0, 8)}…${resolvedPeerId.slice(-4)}` : 'Not connected yet',
  );

  const workspaceList = $derived.by(() =>
    $workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name || workspace.id.slice(0, 8),
      members: workspace.members.length,
      channels: workspace.channels.length,
      active: workspace.id === $activeWorkspaceId,
    })),
  );

  const versionLabel = import.meta.env.VITE_APP_VERSION || '0.1.0';

  const canCreateWorkspace = $derived(!!controller && createWorkspaceInput.trim().length > 0 && !createInFlight);
  const canJoinWorkspace = $derived(!!controller && joinInviteInput.trim().length > 0 && !joinInFlight);
  const currentSeedPhrase = $derived(showSeedPhrase ? onboardingController.getSeedPhrase() : null);

  async function copyPeerId(): Promise<void> {
    if (!resolvedPeerId) return;

    try {
      await navigator.clipboard.writeText(resolvedPeerId);
      joinFeedback = {
        kind: 'success',
        message: 'Peer ID copied.',
      };
    } catch {
      joinFeedback = {
        kind: 'error',
        message: 'Failed to copy peer ID.',
      };
    }
  }

  function promptSeedPhraseReveal(): void {
    revealSeedDialogOpen = true;
  }

  function revealSeedPhrase(): void {
    revealSeedDialogOpen = false;
    showSeedPhrase = true;
  }

  async function createWorkspace(): Promise<void> {
    const name = createWorkspaceInput.trim();
    if (!name || !controller || createInFlight) return;

    createFeedback = null;
    createInFlight = true;

    try {
      const workspace = await controller.createWorkspace(name);
      if (workspace) {
        createWorkspaceInput = '';
        createFeedback = {
          kind: 'success',
          message: 'Workspace created.',
        };
      } else {
        createFeedback = {
          kind: 'error',
          message: 'Failed to create workspace.',
        };
      }
    } catch {
      createFeedback = {
        kind: 'error',
        message: 'Failed to create workspace.',
      };
    } finally {
      createInFlight = false;
    }
  }

  async function joinWorkspace(): Promise<void> {
    const invite = joinInviteInput.trim();
    if (!invite || !controller || joinInFlight) return;

    joinFeedback = null;
    joinInFlight = true;

    try {
      const result = await controller.joinWorkspace(invite);
      if (result.success) {
        joinInviteInput = '';
        joinFeedback = {
          kind: 'success',
          message: 'Workspace joined.',
        };
      } else {
        joinFeedback = {
          kind: 'error',
          message: result.error || 'Failed to join workspace.',
        };
      }
    } catch {
      joinFeedback = {
        kind: 'error',
        message: 'Failed to join workspace.',
      };
    } finally {
      joinInFlight = false;
    }
  }

  async function confirmDeleteAccount(): Promise<void> {
    deleteDialogOpen = false;
    await onDeleteAccount?.();
  }
</script>

<section class="screen">
  <ScreenHeader title="You" largeTitle={true} />

  <div class="content">
    <section class="profile" aria-label="Profile">
      <div class="avatar" aria-hidden="true">{resolvedAlias.slice(0, 1).toUpperCase()}</div>
      <div class="identity-meta">
        <h2>{resolvedAlias}</h2>
        <p>{truncatedPeerId}</p>
      </div>
    </section>

    <section class="section" aria-label="Identity settings">
      <h3>Identity</h3>
      <div class="list">
        <button type="button" class="list-item" onclick={promptSeedPhraseReveal}>
          <span>View seed phrase</span>
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" class="list-item" onclick={() => void copyPeerId()}>
          <span>Copy peer ID</span>
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {#if currentSeedPhrase}
        <div class="seed-phrase" role="status">
          <p>{currentSeedPhrase}</p>
          <button type="button" onclick={() => (showSeedPhrase = false)}>Hide</button>
        </div>
      {:else if showSeedPhrase}
        <div class="seed-phrase" role="status">
          <p>No seed phrase is currently available on this device.</p>
          <button type="button" onclick={() => (showSeedPhrase = false)}>Close</button>
        </div>
      {/if}
    </section>

    <section class="section" aria-label="Workspaces">
      <h3>Workspaces</h3>
      <div class="list">
        {#if workspaceList.length === 0}
          <p class="empty">No joined workspaces yet.</p>
        {:else}
          {#each workspaceList as workspace (workspace.id)}
            <article class="workspace-item" data-active={workspace.active}>
              <h4>{workspace.name}</h4>
              <p>{workspace.channels} channels • {workspace.members} members</p>
            </article>
          {/each}
        {/if}
      </div>

      <label class="join-field" for="create-workspace-input">
        <span>Create workspace</span>
        <input
          id="create-workspace-input"
          type="text"
          placeholder="Workspace name"
          bind:value={createWorkspaceInput}
        />
      </label>

      <button type="button" class="join-button" disabled={!canCreateWorkspace} onclick={() => void createWorkspace()}>
        {createInFlight ? 'Creating…' : 'Create workspace'}
      </button>

      {#if createFeedback}
        <p class="feedback" data-kind={createFeedback.kind}>{createFeedback.message}</p>
      {/if}

      <label class="join-field" for="join-workspace-input">
        <span>Join workspace</span>
        <input
          id="join-workspace-input"
          type="text"
          placeholder="Paste invite link or code"
          bind:value={joinInviteInput}
        />
      </label>

      <button type="button" class="join-button" disabled={!canJoinWorkspace} onclick={() => void joinWorkspace()}>
        {joinInFlight ? 'Joining…' : 'Join workspace'}
      </button>

      {#if joinFeedback}
        <p class="feedback" data-kind={joinFeedback.kind}>{joinFeedback.message}</p>
      {/if}
    </section>

    <section class="section" aria-label="App information">
      <h3>App</h3>
      <div class="list app-meta">
        <p><strong>About DecentChat</strong></p>
        <p>Peer-to-peer encrypted messaging for direct, server-light communication.</p>
        <p>Version {versionLabel}</p>
      </div>
    </section>

    <section class="section danger" aria-label="Danger zone">
      <h3>Danger zone</h3>
      <button type="button" class="danger-button" onclick={() => (deleteDialogOpen = true)}>
        Delete account
      </button>
    </section>
  </div>

  <ConfirmDialog
    open={revealSeedDialogOpen}
    title="Reveal seed phrase?"
    message="Anyone with this phrase can access your account. Make sure nobody is watching your screen."
    confirmLabel="Reveal"
    cancelLabel="Cancel"
    onConfirm={revealSeedPhrase}
    onCancel={() => (revealSeedDialogOpen = false)}
  />

  <ConfirmDialog
    open={deleteDialogOpen}
    title="Delete this account?"
    message="This will remove your identity from this device and return to onboarding."
    confirmLabel="Delete"
    cancelLabel="Cancel"
    destructive={true}
    onConfirm={confirmDeleteAccount}
    onCancel={() => (deleteDialogOpen = false)}
  />
</section>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    background: var(--color-bg);
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    align-content: start;
    gap: var(--space-4);
    padding: var(--space-4);
    padding-bottom: calc(var(--space-5) + var(--safe-bottom));
  }

  .profile {
    display: grid;
    grid-template-columns: 68px 1fr;
    align-items: center;
    gap: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    padding: var(--space-4);
  }

  .avatar {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    background: linear-gradient(160deg, var(--color-accent), #5a4bd1);
    display: grid;
    place-items: center;
    font-size: 28px;
    font-weight: 800;
    color: var(--color-badge-text);
  }

  .identity-meta h2,
  .identity-meta p {
    margin: 0;
  }

  .identity-meta h2 {
    font-size: 20px;
    letter-spacing: -0.02em;
  }

  .identity-meta p {
    margin-top: 4px;
    color: var(--color-text-muted);
    font-size: 13px;
  }

  .section {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    overflow: hidden;
  }

  h3 {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
  }

  .list {
    display: grid;
  }

  .list-item {
    width: 100%;
    min-height: 50px;
    border: none;
    border-bottom: 1px solid var(--color-divider);
    background: transparent;
    padding: 0 var(--space-4);
    display: flex;
    align-items: center;
    justify-content: space-between;
    text-align: left;
    color: var(--color-text);
    font-size: 15px;
  }

  .list-item:last-child {
    border-bottom: none;
  }

  .list-item span:last-child {
    color: var(--color-text-muted);
    font-size: 20px;
    line-height: 1;
  }

  .seed-phrase {
    border-top: 1px solid var(--color-border);
    background: rgba(108, 92, 231, 0.08);
    padding: var(--space-3) var(--space-4);
    display: grid;
    gap: var(--space-2);
  }

  .seed-phrase p {
    margin: 0;
    color: var(--color-text);
    font-size: 14px;
    line-height: 1.5;
  }

  .seed-phrase button {
    justify-self: start;
    min-height: 32px;
    border-radius: var(--radius-pill);
    border: 1px solid rgba(134, 150, 160, 0.4);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 700;
    padding: 0 var(--space-3);
  }

  .workspace-item {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-divider);
  }

  .workspace-item:last-child {
    border-bottom: none;
  }

  .workspace-item[data-active='true'] h4 {
    color: var(--color-accent);
  }

  .workspace-item h4,
  .workspace-item p {
    margin: 0;
  }

  .workspace-item h4 {
    font-size: 15px;
    color: var(--color-text);
  }

  .workspace-item p {
    margin-top: 4px;
    color: var(--color-text-muted);
    font-size: 13px;
  }

  .empty {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 14px;
    padding: var(--space-3) var(--space-4);
  }

  .join-field {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) 0;
    color: var(--color-text-muted);
    font-size: 13px;
  }

  .join-field input {
    min-height: 44px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: #17242c;
    color: var(--color-text);
    padding: 0 var(--space-3);
    font-size: 14px;
  }

  .join-button {
    margin: var(--space-3) var(--space-4) var(--space-3);
    min-height: 44px;
    border-radius: var(--radius-md);
    border: none;
    background: var(--color-accent);
    color: var(--color-badge-text);
    font-size: 14px;
    font-weight: 700;
  }

  .join-button:disabled {
    opacity: 0.45;
  }

  .feedback {
    margin: 0;
    padding: 0 var(--space-4) var(--space-3);
    font-size: 13px;
  }

  .feedback[data-kind='success'] {
    color: var(--color-success);
  }

  .feedback[data-kind='error'] {
    color: #ff8c8c;
  }

  .app-meta {
    gap: 6px;
    padding: var(--space-3) var(--space-4);
  }

  .app-meta p {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .app-meta strong {
    color: var(--color-text);
  }

  .danger {
    border-color: rgba(208, 69, 69, 0.42);
  }

  .danger-button {
    width: calc(100% - (var(--space-4) * 2));
    min-height: 44px;
    margin: var(--space-3) var(--space-4) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid rgba(208, 69, 69, 0.52);
    background: rgba(208, 69, 69, 0.15);
    color: #ffb9b9;
    font-size: 14px;
    font-weight: 700;
  }
</style>
