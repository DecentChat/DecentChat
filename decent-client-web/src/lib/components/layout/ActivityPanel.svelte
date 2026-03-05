<!--
  ActivityPanel.svelte — Activity feed showing thread replies and mentions.
  Replaces renderActivityPanelHTML + bindActivityPanelEvents from UIRenderer.
-->
<script lang="ts">
  import type { ActivityItem } from '../../types/activity';

  interface Props {
    items: ActivityItem[];
    getPeerAlias: (peerId: string) => string;
    onClose: () => void;
    onMarkAllRead: () => void;
    onMarkRead: (id: string) => void;
    onNavigate: (item: ActivityItem) => void;
  }

  let {
    items,
    getPeerAlias,
    onClose,
    onMarkAllRead,
    onMarkRead,
    onNavigate,
  }: Props = $props();

  let sortedItems = $derived([...items].sort((a, b) => b.timestamp - a.timestamp));
  let unreadItems = $derived(sortedItems.filter(i => !i.read));
  let readItems = $derived(sortedItems.filter(i => i.read));

  function relativeTime(ts: number): string {
    const diffMs = Date.now() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  }

  function handleClick(item: ActivityItem) {
    onMarkRead(item.id);
    onNavigate(item);
  }
</script>

<div class="activity-panel-header">
  <h3 class="activity-panel-title">🔔 Activity</h3>
  <div class="activity-panel-actions">
    {#if unreadItems.length > 0}
      <button class="activity-mark-all-btn" onclick={onMarkAllRead}>Mark all read</button>
    {/if}
    <button class="activity-close-btn" title="Close" onclick={onClose}>✕</button>
  </div>
</div>

{#if sortedItems.length === 0}
  <div class="activity-panel-empty">
    <div class="emoji">🔔</div>
    <p>No activity yet</p>
    <p class="text-muted">Thread replies and mentions will appear here.</p>
  </div>
{:else}
  <div class="activity-panel-list">
    {#if unreadItems.length > 0}
      <div class="activity-section-label">New</div>
      {#each unreadItems as item (item.id)}
        <button
          class="activity-row unread"
          onclick={() => handleClick(item)}
        >
          <div class="activity-row-top">
            <span class="activity-row-icon">{item.type === 'mention' ? '📣' : '💬'}</span>
            <span class="activity-actor">{getPeerAlias(item.actorId)}</span>
            <span class="activity-time">{relativeTime(item.timestamp)}</span>
          </div>
          <div class="activity-snippet">{item.snippet || 'New activity'}</div>
        </button>
      {/each}
    {/if}
    {#if readItems.length > 0}
      <div class="activity-section-label">Earlier</div>
      {#each readItems as item (item.id)}
        <button
          class="activity-row"
          onclick={() => handleClick(item)}
        >
          <div class="activity-row-top">
            <span class="activity-row-icon">{item.type === 'mention' ? '📣' : '💬'}</span>
            <span class="activity-actor">{getPeerAlias(item.actorId)}</span>
            <span class="activity-time">{relativeTime(item.timestamp)}</span>
          </div>
          <div class="activity-snippet">{item.snippet || 'New activity'}</div>
        </button>
      {/each}
    {/if}
  </div>
{/if}
