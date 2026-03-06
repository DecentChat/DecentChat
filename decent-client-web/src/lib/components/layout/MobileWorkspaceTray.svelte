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
  }

  let {
    workspaces,
    activeWorkspaceId,
    onSwitchToDMs,
    onSwitchWorkspace,
    onAddWorkspace,
  }: Props = $props();

  let isInDMs = $derived(activeWorkspaceId === null);
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

  <button
    type="button"
    class="mobile-workspace-chip mobile-workspace-add"
    data-testid="mobile-workspace-add"
    onclick={onAddWorkspace}
  >
    +
  </button>
</div>
