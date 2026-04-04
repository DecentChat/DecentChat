<!--
  WorkspaceRail.svelte — Left icon strip (Discord/Slack-style workspace switcher).
  Replaces renderWorkspaceRailHTML() + bindWorkspaceRailEvents() in UIRenderer.
-->
<script lang="ts">
  import { escapeHtml } from '$lib/utils/peer';

  interface WorkspaceInfo {
    id: string;
    name: string;
  }

  interface Props {
    workspaces: WorkspaceInfo[];
    activeWorkspaceId: string | null;
    activityUnread: number;
    dmUnread: number;
    onSwitchToDMs: () => void;
    onSwitchWorkspace: (wsId: string) => void;
    onToggleActivity: () => void;
    onAddWorkspace: () => void;
    onJoinWorkspace?: () => void;
  }

  let {
    workspaces,
    activeWorkspaceId,
    activityUnread,
    dmUnread,
    onSwitchToDMs,
    onSwitchWorkspace,
    onToggleActivity,
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
    if (!target.closest('.ws-rail-add-wrap')) {
      showAddMenu = false;
    }
  }
</script>

<div class="ws-rail-icon {isInDMs ? 'active' : ''}" id="ws-rail-dms" title="Direct Messages"
  role="button" tabindex="0"
  onclick={onSwitchToDMs}
  onkeydown={(e) => e.key === 'Enter' && onSwitchToDMs()}
>
  DM
  {#if dmUnread > 0}
    <span class="activity-badge ws-rail-badge">
      {dmUnread > 99 ? '99+' : dmUnread}
    </span>
  {/if}
</div>
<div class="ws-rail-divider"></div>

{#each workspaces as ws (ws.id)}
  {@const isActive = ws.id === activeWorkspaceId && !isInDMs}
  {@const initial = ws.name.slice(0, 2).toUpperCase()}
  <div
    class="ws-rail-icon {isActive ? 'active' : ''}"
    data-ws-id={ws.id}
    title={ws.name}
    role="button"
    tabindex="0"
    onclick={() => onSwitchWorkspace(ws.id)}
    onkeydown={(e) => e.key === 'Enter' && onSwitchWorkspace(ws.id)}
  >
    {initial}
  </div>
{/each}

<div
  class="ws-rail-icon activity-btn"
  id="activity-btn"
  title="Activity"
  role="button"
  tabindex="0"
  onclick={onToggleActivity}
  onkeydown={(e) => e.key === 'Enter' && onToggleActivity()}
>
  🔔
  {#if activityUnread > 0}
    <span class="activity-badge ws-rail-badge">
      {activityUnread > 99 ? '99+' : activityUnread}
    </span>
  {/if}
</div>

{#if showAddMenu}
  <div class="ws-add-menu-backdrop" onclick={handleClickOutside} onkeydown={(e) => e.key === 'Escape' && handleClickOutside()} role="presentation"></div>
{/if}
<div class="ws-rail-add-wrap">
  <div
    class="ws-rail-icon ws-rail-add"
    id="ws-rail-add"
    title="Create or join workspace"
    role="button"
    tabindex="0"
    onclick={handleAddClick}
    onkeydown={(e) => e.key === 'Enter' && handleAddClick()}
  >
    +
  </div>
  {#if showAddMenu}
    <div class="ws-add-menu" role="menu">
      <button class="ws-add-menu-item" role="menuitem" onclick={handleCreate}>
        <span class="ws-add-menu-icon">+</span> Create workspace
      </button>
      <button class="ws-add-menu-item" role="menuitem" onclick={handleJoin}>
        <span class="ws-add-menu-icon">↓</span> Join workspace
      </button>
    </div>
  {/if}
</div>

<style>
  .ws-rail-add-wrap {
    position: relative;
  }
  .ws-add-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .ws-add-menu {
    position: absolute;
    left: calc(100% + 8px);
    bottom: 0;
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color, #3f4147);
    border-radius: 6px;
    padding: 4px;
    min-width: 180px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .ws-add-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
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
  .ws-add-menu-item:hover {
    background: var(--bg-hover, #35373c);
  }
  .ws-add-menu-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    font-weight: 700;
    color: var(--text-muted, #b5bac1);
  }
</style>
