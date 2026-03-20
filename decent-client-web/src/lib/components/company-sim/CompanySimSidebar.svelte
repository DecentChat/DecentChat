<script lang="ts">
  import type { CompanySimSection } from '../../company-sim/types';

  interface Props {
    activeSection: CompanySimSection;
    onSelect: (section: CompanySimSection) => void;
  }

  let { activeSection, onSelect }: Props = $props();
  const sections: CompanySimSection[] = ['overview', 'docs', 'people', 'channels', 'provisioning', 'sandbox'];

  function labelFor(section: CompanySimSection): string {
    switch (section) {
      case 'overview': return 'Overview';
      case 'docs': return 'Docs';
      case 'people': return 'People';
      case 'channels': return 'Channels';
      case 'provisioning': return 'Provisioning';
      case 'sandbox': return 'Sandbox';
    }
  }
</script>

<nav class="company-sim-sidebar" aria-label="Company Sim sections">
  {#each sections as section (section)}
    <button
      type="button"
      class:active={section === activeSection}
      onclick={() => onSelect(section)}
    >
      {labelFor(section)}
    </button>
  {/each}
</nav>

<style>
  .company-sim-sidebar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-right: 1px solid var(--border);
    min-width: 180px;
    background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
  }

  .company-sim-sidebar button {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    background: transparent;
    color: var(--text-primary);
    padding: 10px 12px;
    border-radius: 12px;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }

  .company-sim-sidebar button.active {
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-primary));
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  }
</style>
