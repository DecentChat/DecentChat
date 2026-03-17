<svelte:options runes={true} />

<script lang="ts">
  import { hapticLightImpact } from '../native/plugins';

  export type MobileTab = {
    id: string;
    label: string;
    icon: string;
  };

  type Props = {
    tabs: MobileTab[];
    activeTab: string;
    onSelect?: ((tabId: string) => void) | undefined;
  };

  let { tabs, activeTab, onSelect }: Props = $props();

  function handleSelect(tabId: string): void {
    if (tabId !== activeTab) {
      void hapticLightImpact();
    }

    onSelect?.(tabId);
  }
</script>

<nav class="tab-bar" aria-label="Primary">
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      class="tab-button"
      data-active={tab.id === activeTab}
      aria-current={tab.id === activeTab ? 'page' : undefined}
      onclick={() => handleSelect(tab.id)}
    >
      <span class="icon" aria-hidden="true">{tab.icon}</span>
      <span class="label">{tab.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tab-bar {
    position: sticky;
    bottom: 0;
    z-index: 40;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-1);
    min-height: var(--tabbar-height);
    padding: var(--space-1) calc(var(--space-2) + var(--safe-right))
      max(var(--space-1), var(--safe-bottom)) calc(var(--space-2) + var(--safe-left));
    border-top: 1px solid rgba(32, 44, 51, 0.95);
    background: rgba(17, 27, 33, 0.95);
    backdrop-filter: blur(18px);
  }

  .tab-button {
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-muted);
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: var(--tap-target-min);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    transition: background-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
  }

  .tab-button[data-active='true'] {
    color: var(--color-text);
    background: rgba(255, 255, 255, 0.08);
  }

  .tab-button[data-active='true'] .label {
    color: var(--color-accent);
  }

  .tab-button:active {
    transform: scale(0.98);
    background: var(--color-surface-pressed);
  }

  .icon {
    font-size: 18px;
    line-height: 1;
  }

  .label {
    line-height: 1;
  }
</style>
