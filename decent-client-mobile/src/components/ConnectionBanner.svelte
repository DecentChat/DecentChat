<svelte:options runes={true} />

<script lang="ts">
  import { fly } from 'svelte/transition';

  type BannerState = 'connected' | 'idle' | 'connecting' | 'error';

  type Props = {
    state: BannerState;
  };

  let { state }: Props = $props();

  const visible = $derived(state !== 'connected' && state !== 'idle');
</script>

{#if visible}
  <div
    class="connection-banner"
    data-state={state}
    role="status"
    aria-live="polite"
    in:fly={{ y: -26, duration: 220, opacity: 0.4 }}
    out:fly={{ y: -26, duration: 180, opacity: 0.2 }}
  >
    <span class="signal" aria-hidden="true"></span>
    <span class="label">{state === 'connecting' ? 'Connecting...' : 'Connection issue'}</span>
    {#if state === 'connecting'}
      <span class="spinner" aria-hidden="true"></span>
    {/if}
  </div>
{/if}

<style>
  .connection-banner {
    position: absolute;
    top: calc(var(--safe-top) + 6px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    width: calc(100% - (var(--space-4) * 2));
    max-width: 460px;
    min-height: 38px;
    border-radius: var(--radius-pill);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    font-size: 13px;
    font-weight: 650;
    letter-spacing: 0.01em;
    border: 1px solid transparent;
    backdrop-filter: blur(10px);
    pointer-events: none;
  }

  .connection-banner[data-state='connecting'] {
    background: rgba(244, 190, 62, 0.18);
    border-color: rgba(244, 190, 62, 0.35);
    color: #ffd988;
  }

  .connection-banner[data-state='error'] {
    background: rgba(209, 95, 87, 0.2);
    border-color: rgba(209, 95, 87, 0.42);
    color: #ffc2bc;
  }

  .signal {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.9;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.85s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
