<svelte:options runes={true} />

<script lang="ts">
  import ScreenHeader from '../components/ScreenHeader.svelte';
  import { activeWorkspaceId, channels, workspaces } from '../stores/appState';
  import { recentCalls, type RecentCall } from '../stores/huddleState';
  import type { MobileController } from '../app/MobileController';

  type Props = {
    controller: MobileController | null;
  };

  let { controller }: Props = $props();

  const activeWorkspace = $derived(
    $workspaces.find((workspace) => workspace.id === $activeWorkspaceId) ?? null,
  );

  const defaultHuddleChannelId = $derived(
    $channels[0]?.id
      || (activeWorkspace ? `${activeWorkspace.id}:huddle` : ''),
  );

  async function startHuddle(): Promise<void> {
    if (!controller) return;

    const channelId = defaultHuddleChannelId || `huddle:${Date.now()}`;
    await controller.callManager.joinHuddle(channelId);
  }

  async function redial(call: RecentCall): Promise<void> {
    if (!controller) return;
    await controller.callManager.startCall(call.peerId);
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const today = new Date();

    if (date.toDateString() === today.toDateString()) {
      return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    }

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function getAvatarLabel(name: string): string {
    const trimmed = name.trim();
    return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
  }

  function getCallIcon(type: RecentCall['type']): string {
    if (type === 'outgoing') return '↗';
    return '↙';
  }

  function getCallTypeLabel(type: RecentCall['type']): string {
    if (type === 'outgoing') return 'Outgoing';
    if (type === 'incoming') return 'Incoming';
    return 'Missed';
  }
</script>

<section class="screen">
  <ScreenHeader title="Calls" largeTitle={true} />

  <div class="content">
    {#if $recentCalls.length === 0}
      <div class="empty-state">
        <p class="emoji" aria-hidden="true">📞</p>
        <p class="empty-title">No recent calls</p>
        <p class="empty-subtitle">Start a huddle to test your mic and network.</p>
      </div>
    {:else}
      <div class="calls-list" role="list">
        {#each $recentCalls as call, index (`${call.peerId}-${call.timestamp}-${index}`)}
          <button type="button" class="call-row" onclick={() => redial(call)}>
            <div class="avatar" aria-hidden="true">{getAvatarLabel(call.peerName)}</div>

            <div class="meta">
              <p class="name">{call.peerName}</p>
              <div class="subline" data-type={call.type}>
                <span class="call-icon" aria-hidden="true">{getCallIcon(call.type)}</span>
                <span>{getCallTypeLabel(call.type)}</span>
              </div>
            </div>

            <time>{formatTimestamp(call.timestamp)}</time>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <button class="fab" type="button" aria-label="Start huddle" onclick={startHuddle}>
    Start Huddle
  </button>
</section>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    background: var(--color-bg);
    position: relative;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: calc(var(--tabbar-height) + var(--space-6) + var(--safe-bottom));
  }

  .calls-list {
    display: flex;
    flex-direction: column;
  }

  .call-row {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--color-divider);
    background: transparent;
    min-height: 72px;
    padding: var(--space-3) var(--space-4);
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) auto;
    gap: var(--space-3);
    text-align: left;
    align-items: center;
  }

  .call-row:active {
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

  .meta {
    min-width: 0;
  }

  .name {
    margin: 0;
    color: var(--color-text);
    font-size: 17px;
    font-weight: 590;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subline {
    margin-top: var(--space-1);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-muted);
    font-size: 13px;
  }

  .subline[data-type='missed'] {
    color: #e06d65;
  }

  .call-icon {
    font-size: 15px;
    line-height: 1;
  }

  time {
    color: var(--color-text-muted);
    font-size: 12px;
    line-height: 1;
    align-self: start;
    padding-top: 6px;
  }

  .empty-state {
    height: 100%;
    min-height: 260px;
    display: grid;
    place-items: center;
    text-align: center;
    color: var(--color-text-muted);
    padding: var(--space-6) var(--space-4);
    align-content: center;
    gap: var(--space-3);
  }

  .emoji {
    margin: 0;
    font-size: 42px;
    line-height: 1;
  }

  .empty-title {
    margin: 0;
    font-size: 16px;
  }

  .empty-subtitle {
    margin: 0;
    max-width: 260px;
    font-size: 13px;
    line-height: 1.4;
  }

  .fab {
    position: absolute;
    right: var(--space-4);
    bottom: calc(var(--tabbar-height) + var(--space-4) + var(--safe-bottom));
    border: none;
    border-radius: var(--radius-pill);
    min-height: 48px;
    padding: 0 var(--space-5);
    background: var(--color-accent);
    color: var(--color-badge-text);
    font-size: 15px;
    font-weight: 700;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
  }

  .fab:active {
    transform: translateY(1px);
  }
</style>
