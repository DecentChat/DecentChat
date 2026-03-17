<svelte:options runes={true} />

<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    subtitle?: string;
    largeTitle?: boolean;
    onBack?: (() => void) | undefined;
    backLabel?: string;
    actions?: Snippet;
  };

  let {
    title,
    subtitle = '',
    largeTitle = false,
    onBack,
    backLabel = 'Back',
    actions
  }: Props = $props();
</script>

<header class="screen-header" data-large-title={largeTitle}>
  <div class="leading">
    {#if onBack}
      <button class="back-button" type="button" aria-label={backLabel} onclick={() => onBack?.()}>
        <span aria-hidden="true">‹</span>
      </button>
    {/if}

    <div class="titles">
      {#if subtitle}
        <p class="subtitle">{subtitle}</p>
      {/if}
      <h1>{title}</h1>
    </div>
  </div>

  <div class="actions">
    {@render actions?.()}
  </div>
</header>

<style>
  .screen-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: calc(var(--safe-top) + var(--space-2)) var(--space-4) var(--space-3);
    background: linear-gradient(to bottom, rgba(11, 20, 26, 0.98), rgba(11, 20, 26, 0.88));
    border-bottom: 1px solid rgba(32, 44, 51, 0.6);
    backdrop-filter: blur(20px);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  .leading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .back-button {
    width: var(--tap-target-min);
    height: var(--tap-target-min);
    min-height: var(--tap-target-min);
    border-radius: var(--radius-pill);
    border: none;
    background: transparent;
    color: var(--color-accent);
    font-size: 28px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .titles {
    min-width: 0;
  }

  .subtitle {
    margin: 0;
    font-size: 12px;
    line-height: 1.2;
    color: var(--color-text-muted);
  }

  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.02em;
    color: var(--color-text);
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .screen-header[data-large-title='true'] h1 {
    font-size: 30px;
    font-weight: 760;
    letter-spacing: -0.03em;
  }

  .actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .actions :global(button) {
    min-width: var(--tap-target-min);
    min-height: var(--tap-target-min);
    border: none;
    border-radius: var(--radius-pill);
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--color-accent);
    font-size: 15px;
    font-weight: 600;
  }
</style>
