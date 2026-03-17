<svelte:options runes={true} />

<script lang="ts">
  import ScreenHeader from '../components/ScreenHeader.svelte';
  import { activeWorkspaceId, workspaces } from '../stores/appState';
  import type { MobileController } from '../app/MobileController';

  type Props = {
    controller: MobileController | null;
  };

  let { controller }: Props = $props();

  let createOpen = $state(false);
  let workspaceName = $state('');
  let createError = $state<string | null>(null);
  let createBusy = $state(false);

  let joinOpen = $state(false);
  let joinInviteInput = $state('');
  let joinError = $state<string | null>(null);
  let joinBusy = $state(false);

  const workspaceCards = $derived.by(() =>
    $workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name || workspace.id.slice(0, 8),
      channelCount: workspace.channels.length,
      memberCount: workspace.members.length,
      active: workspace.id === $activeWorkspaceId,
    })),
  );

  const canCreate = $derived(!!controller && workspaceName.trim().length > 0 && !createBusy);
  const canJoin = $derived(!!controller && joinInviteInput.trim().length > 0 && !joinBusy);
  const isEmpty = $derived(workspaceCards.length === 0);

  function openWorkspace(workspaceId: string): void {
    if (controller) {
      controller.setActiveWorkspace(workspaceId);
      return;
    }

    activeWorkspaceId.set(workspaceId);
  }

  function openCreate(): void {
    createOpen = true;
    createError = null;
    workspaceName = '';
  }

  function closeCreate(): void {
    if (createBusy) return;
    createOpen = false;
    createError = null;
    workspaceName = '';
  }

  function openJoin(): void {
    joinOpen = true;
    joinError = null;
  }

  function closeJoin(): void {
    if (joinBusy) return;
    joinOpen = false;
    joinError = null;
    joinInviteInput = '';
  }

  async function createWorkspace(): Promise<void> {
    if (!controller || !workspaceName.trim() || createBusy) return;

    createBusy = true;
    createError = null;
    try {
      const workspace = await controller.createWorkspace(workspaceName.trim());
      if (!workspace) {
        createError = 'Failed to create workspace.';
        return;
      }
      createOpen = false;
      workspaceName = '';
      openWorkspace(workspace.id);
    } catch (error) {
      createError = (error as Error).message || 'Failed to create workspace.';
    } finally {
      createBusy = false;
    }
  }

  async function joinWorkspace(): Promise<void> {
    const invite = joinInviteInput.trim();
    if (!controller || !invite || joinBusy) return;

    joinBusy = true;
    joinError = null;
    try {
      const result = await controller.joinWorkspace(invite);
      if (!result.success) {
        joinError = result.error || 'Failed to join workspace.';
        return;
      }

      joinOpen = false;
      joinInviteInput = '';
    } catch (error) {
      joinError = (error as Error).message || 'Failed to join workspace.';
    } finally {
      joinBusy = false;
    }
  }
</script>

<section class="screen">
  <ScreenHeader title="Workspaces" largeTitle={true}>
    {#snippet actions()}
      <button type="button" aria-label="Create workspace" onclick={openCreate}>＋</button>
    {/snippet}
  </ScreenHeader>

  <div class="content">
    {#if isEmpty && !createOpen && !joinOpen}
      <section class="starter-card" aria-label="Get started with workspaces">
        <p class="eyebrow">First steps</p>
        <h2>Start your first workspace</h2>
        <p class="starter-copy">
          Create your own workspace, or join an existing one with an invite link or code.
        </p>

        <div class="starter-actions">
          <button type="button" class="primary" onclick={openCreate}>Create workspace</button>
          <button type="button" class="ghost" onclick={openJoin}>Join with invite</button>
        </div>
      </section>
    {:else}
      <div class="quick-actions" aria-label="Workspace actions">
        <button type="button" class="primary" onclick={openCreate}>Create workspace</button>
        <button type="button" class="ghost" onclick={openJoin}>Join with invite</button>
      </div>
    {/if}

    {#if createOpen}
      <section class="panel" aria-label="Create workspace panel">
        <div class="panel-header">
          <div>
            <h3>Create workspace</h3>
            <p>Start a new space and invite people in later.</p>
          </div>
          <button type="button" class="close" aria-label="Close create workspace" onclick={closeCreate}>✕</button>
        </div>

        <label class="field" for="workspace-name-input">
          <span>Workspace name</span>
          <input
            id="workspace-name-input"
            type="text"
            placeholder="Workspace name"
            bind:value={workspaceName}
            maxlength="48"
          />
        </label>

        <div class="panel-actions">
          <button type="button" class="ghost" onclick={closeCreate}>Cancel</button>
          <button type="button" class="primary" disabled={!canCreate} onclick={() => void createWorkspace()}>
            {createBusy ? 'Creating…' : 'Create'}
          </button>
        </div>

        {#if createError}
          <p class="error" role="status">{createError}</p>
        {/if}
      </section>
    {/if}

    {#if joinOpen}
      <section class="panel" aria-label="Join workspace panel">
        <div class="panel-header">
          <div>
            <h3>Join workspace</h3>
            <p>Paste a DecentChat invite link or invite code.</p>
          </div>
          <button type="button" class="close" aria-label="Close join workspace" onclick={closeJoin}>✕</button>
        </div>

        <label class="field" for="join-workspace-input">
          <span>Invite link or code</span>
          <input
            id="join-workspace-input"
            type="text"
            placeholder="Paste invite link or code"
            bind:value={joinInviteInput}
          />
        </label>

        <div class="panel-actions">
          <button type="button" class="ghost" onclick={closeJoin}>Cancel</button>
          <button type="button" class="primary" disabled={!canJoin} onclick={() => void joinWorkspace()}>
            {joinBusy ? 'Joining…' : 'Join workspace'}
          </button>
        </div>

        {#if joinError}
          <p class="error" role="status">{joinError}</p>
        {/if}
      </section>
    {/if}

    {#if workspaceCards.length > 0}
      {#each workspaceCards as workspace (workspace.id)}
        <article class="workspace-card" data-active={workspace.active}>
          <header>
            <h2>{workspace.name}</h2>
            <button type="button" onclick={() => openWorkspace(workspace.id)}>
              {workspace.active ? 'Active' : 'Open'}
            </button>
          </header>

          <p class="meta">
            <span>{workspace.channelCount} channels</span>
            <span>•</span>
            <span>{workspace.memberCount} members</span>
          </p>
        </article>
      {/each}
    {/if}
  </div>
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
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    overflow-y: auto;
  }

  .starter-card,
  .panel,
  .workspace-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-soft);
  }

  .starter-card {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  .eyebrow {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-accent);
  }

  .starter-card h2,
  .panel-header h3,
  .workspace-card h2 {
    margin: 0;
    color: var(--color-text);
    letter-spacing: -0.02em;
  }

  .starter-copy,
  .panel-header p,
  .meta {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1.45;
  }

  .quick-actions,
  .starter-actions,
  .panel-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .panel {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .close {
    width: 34px;
    height: 34px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-elevated);
    color: var(--color-text-muted);
    flex: 0 0 auto;
  }

  .field {
    display: grid;
    gap: var(--space-2);
    font-size: 13px;
    color: var(--color-text-muted);
  }

  .field input {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-elevated);
    min-height: 44px;
    padding: 0 var(--space-3);
    font-size: 15px;
    color: var(--color-text);
  }

  .primary,
  .ghost {
    min-height: 44px;
    border-radius: var(--radius-md);
    font-size: 14px;
    font-weight: 700;
    padding: 0 var(--space-3);
  }

  .primary {
    border: 1px solid rgba(108, 92, 231, 0.6);
    background: var(--color-accent);
    color: var(--color-badge-text);
  }

  .ghost {
    border: 1px solid var(--color-border);
    background: var(--color-surface-elevated);
    color: var(--color-text);
  }

  .primary:disabled,
  .ghost:disabled {
    opacity: 0.45;
  }

  .error {
    margin: 0;
    color: #ff8f86;
    font-size: 13px;
  }

  .workspace-card {
    padding: var(--space-4);
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .workspace-card[data-active='true'] {
    border-color: rgba(108, 92, 231, 0.55);
    background: rgba(108, 92, 231, 0.08);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  header button {
    min-height: 32px;
    border: 1px solid rgba(108, 92, 231, 0.35);
    border-radius: var(--radius-pill);
    background: var(--color-accent-soft);
    color: var(--color-accent);
    padding: 0 var(--space-3);
    font-size: 13px;
    font-weight: 650;
  }

  .workspace-card[data-active='true'] header button {
    border-color: rgba(108, 92, 231, 0.55);
  }
</style>
