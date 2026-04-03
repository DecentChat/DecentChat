<script lang="ts">
  interface WorkspaceInfo {
    id: string;
    name: string;
  }

  interface Props {
    workspaces: WorkspaceInfo[];
    activeWorkspaceId: string | null;
    onSwitchToDMs: () => void;
    onSwitchWorkspace: (wsId: string) => void;
    onAddWorkspace: () => void;
    onJoinWorkspace?: () => void;
  }

  let {
    workspaces,
    activeWorkspaceId,
    onSwitchToDMs,
    onSwitchWorkspace,
    onAddWorkspace,
    onJoinWorkspace,
  }: Props = $props();

  let isInDMs = $derived(activeWorkspaceId === null);
  let showAddMenu = $state(false);

  function handleAddClick() {
    if (onJoinWorkspace) {
      showAddMenu = !showAddMenu;
    } else {
      onAddWorkspace();
    }
  }

  function handleCreate() {
    showAddMenu = false;
    onAddWorkspace();
  }

  function handleJoin() {
    showAddMenu = false;
    onJoinWorkspace?.();
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.mobile-workspace-add-wrap')) {
      showAddMenu = false;
    }
  }
</script>

<div class="mobile-workspace-tray" data-testid="mobile-workspace-tray">
  <button
    type="button"
    class="mobile-workspace-chip {isInDMs ? 'active' : ''}"
    data-testid="mobile-workspace-dm"
    onclick={onSwitchToDMs}
  >
    DM
  </button>

  {#each workspaces as ws (ws.id)}
    {@const isActive = ws.id === activeWorkspaceId && !isInDMs}
    <button
      type="button"
      class="mobile-workspace-chip {isActive ? 'active' : ''}"
      data-testid="mobile-workspace-item"
      data-ws-id={ws.id}
      title={ws.name}
      onclick={() => onSwitchWorkspace(ws.id)}
    >
      {ws.name.slice(0, 2).toUpperCase()}
    </button>
  {/each}

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  {#if showAddMenu}
    <div class="mobile-add-menu-backdrop" onclick={handleClickOutside}></div>
  {/if}
  <div class="mobile-workspace-add-wrap">
    <button
      type="button"
      class="mobile-workspace-chip mobile-workspace-add"
      data-testid="mobile-workspace-add"
      onclick={handleAddClick}
    >
      +
    </button>
    {#if showAddMenu}
      <div class="mobile-add-menu" role="menu">
        <button class="mobile-add-menu-item" role="menuitem" onclick={handleCreate}>
          + Create workspace
        </button>
        <button class="mobile-add-menu-item" role="menuitem" onclick={handleJoin}>
          ↓ Join workspace
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .mobile-workspace-add-wrap {
    position: relative;
    display: inline-flex;
  }
  .mobile-add-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .mobile-add-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 6px;
    padding: 4px;
    min-width: 180px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .mobile-add-menu-item {
    display: block;
    width: 100%;
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: var(--text-primary, #dbdee1);
    font-size: 14px;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
  }
  .mobile-add-menu-item:hover {
    background: var(--bg-hover, #35373c);
  }
</style>
