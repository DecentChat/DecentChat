<!--
  HuddleBar.svelte — Huddle (voice call) UI bar + join banner.
  Replaces updateHuddleUI + bindHuddleEvents from UIRenderer.
-->
<script lang="ts">
  import { peerColor } from '$lib/utils/peer';
  import { escapeHtml } from '$lib/utils/peer';

  interface HuddleParticipant {
    peerId: string;
    displayName: string;
    muted: boolean;
    speaking: boolean;
    audioLevel?: number;
    botStatus?: string;
  }

  interface Props {
    state: 'inactive' | 'in-call' | 'available' | 'joining';
    muted: boolean;
    participants: HuddleParticipant[];
    onToggleMute: () => void;
    onLeave: () => void;
    onJoin: () => void;
  }

  let {
    state: huddleState,
    muted,
    participants,
    onToggleMute,
    onLeave,
    onJoin,
  }: Props = $props();

  const statusIcons: Record<string, string> = {
    listening: '🎧',
    hearing: '👂',
    transcribing: '⏳',
    thinking: '🤔',
    speaking: '🗣️',
    interrupted: '✋',
  };
</script>

{#if huddleState === 'available'}
  <div class="huddle-join-banner" id="huddle-join-banner">
    <span class="huddle-join-icon">🟢</span>
    <span class="huddle-join-text">Huddle in progress</span>
    <button class="huddle-join-btn" id="huddle-join-btn" onclick={onJoin}>Join</button>
  </div>
{/if}

{#if huddleState === 'in-call'}
  <div class="huddle-bar" id="huddle-bar">
    <div class="huddle-bar-info">
      <span class="huddle-icon">🟢</span>
      <span class="huddle-label">Huddle</span>
      <div class="huddle-participants" id="huddle-participants">
        {#each participants as p (p.peerId)}
          {@const initials = p.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          {@const color = peerColor(p.peerId)}
          <span
            class="huddle-avatar"
            class:speaking={p.speaking}
            style="background:{color};{p.speaking && p.audioLevel ? `--audio-level: ${p.audioLevel}` : ''}"
            title="{p.displayName}{p.muted ? ' 🔇' : ''}"
          >
            {initials}
            {#if p.botStatus}
              <span class="huddle-bot-status" data-status={p.botStatus}>{statusIcons[p.botStatus] || ''}</span>
            {/if}
          </span>
        {/each}
      </div>
    </div>
    <div class="huddle-bar-controls">
      <button class="huddle-mute-btn" id="huddle-mute-btn" title="Mute/Unmute" onclick={onToggleMute}>
        {muted ? '🔇' : '🎤'}
      </button>
      <button class="huddle-leave-btn" id="huddle-leave-btn" title="Leave Huddle" onclick={onLeave}>📵</button>
    </div>
  </div>
{/if}
