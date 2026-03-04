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
    onSwitchToDMs: () => void;
    onSwitchWorkspace: (wsId: string) => void;
    onToggleActivity: () => void;
    onAddWorkspace: () => void;
  }

  let {
    workspaces,
    activeWorkspaceId,
    activityUnread,
    onSwitchToDMs,
    onSwitchWorkspace,
    onToggleActivity,
    onAddWorkspace,
  }: Props = $props();

  let isInDMs = $derived(activeWorkspaceId === null);
</script>

<div class="ws-rail-icon {isInDMs ? 'active' : ''}" id="ws-rail-dms" title="Direct Messages"
  role="button" tabindex="0"
  onclick={onSwitchToDMs}
  onkeydown={(e) => e.key === 'Enter' && onSwitchToDMs()}
>
  DM
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

<div
  class="ws-rail-icon ws-rail-add"
  id="ws-rail-add"
  title="Create or join workspace"
  role="button"
  tabindex="0"
  onclick={onAddWorkspace}
  onkeydown={(e) => e.key === 'Enter' && onAddWorkspace()}
>
  +
</div>
