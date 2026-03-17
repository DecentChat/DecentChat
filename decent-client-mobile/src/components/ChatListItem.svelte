<svelte:options runes={true} />

<script lang="ts">
  import { hapticLightImpact } from '../native/plugins';

  type Props = {
    name: string;
    preview: string;
    time: string;
    avatar?: string;
    unreadCount?: number;
    onOpen?: (() => void) | undefined;
  };

  let {
    name,
    preview,
    time,
    avatar = name.slice(0, 1),
    unreadCount = 0,
    onOpen
  }: Props = $props();

  const hasUnread = $derived(unreadCount > 0);

  function handleOpen(): void {
    void hapticLightImpact();
    onOpen?.();
  }
</script>

<button type="button" class="chat-list-item" onclick={handleOpen}>
  <div class="avatar" aria-hidden="true">{avatar}</div>

  <div class="content">
    <div class="top-row">
      <p class="name">{name}</p>
      <time>{time}</time>
    </div>

    <div class="bottom-row">
      <p class="preview">{preview}</p>
      {#if hasUnread}
        <span class="badge" aria-label={`${unreadCount} unread messages`}>{unreadCount}</span>
      {/if}
    </div>
  </div>
</button>

<style>
  .chat-list-item {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--color-divider);
    background: transparent;
    min-height: 72px;
    padding: var(--space-3) var(--space-4);
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: var(--space-3);
    text-align: left;
  }

  .chat-list-item:active {
    background: rgba(255, 255, 255, 0.05);
  }

  .avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: linear-gradient(145deg, #2a3d47, #1d2a31);
    color: #d7dce0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .content {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-1);
  }

  .top-row,
  .bottom-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .name,
  .preview,
  time {
    margin: 0;
  }

  .name {
    font-size: 17px;
    line-height: 1.25;
    font-weight: 590;
    letter-spacing: -0.01em;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  time {
    flex-shrink: 0;
    color: var(--color-text-muted);
    font-size: 12px;
    line-height: 1;
  }

  .preview {
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    flex-shrink: 0;
    min-width: 22px;
    height: 22px;
    padding: 0 7px;
    border-radius: var(--radius-pill);
    background: var(--color-accent);
    color: var(--color-badge-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
  }
</style>
