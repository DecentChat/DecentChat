<script lang="ts">
  import { shellData } from '../../stores/shell.svelte';
  import { companySimStore, setCompanySimSection, loadCompanySimState } from '../../company-sim/store.svelte';
  import CompanySimSidebar from './CompanySimSidebar.svelte';
  import CompanySimOverview from './CompanySimOverview.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  async function refresh(): Promise<void> {
    if (!companySimStore.activeWorkspaceId) return;
    try {
      await loadCompanySimState(companySimStore.activeWorkspaceId);
    } catch {
      // error already stored in state
    }
  }

  function sectionLabel(section: typeof companySimStore.activeSection): string {
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

<section class="company-sim-panel" data-testid="company-sim-panel">
  <header class="company-sim-header">
    <div>
      <p class="company-sim-kicker">Company Sim</p>
      <h2>{companySimStore.state?.overview.companyName || shellData.companySim.workspaceName || 'Company Sim'}</h2>
      <p class="company-sim-subtitle">{companySimStore.state?.overview.workspaceName || shellData.companySim.workspaceName || companySimStore.activeWorkspaceId || ''}</p>
    </div>
    <div class="company-sim-actions">
      <button type="button" class="btn-secondary" onclick={refresh} disabled={companySimStore.loading}>Refresh</button>
      <button type="button" class="btn-secondary" onclick={onClose}>Back to chat</button>
    </div>
  </header>

  <div class="company-sim-layout">
    <CompanySimSidebar activeSection={companySimStore.activeSection} onSelect={setCompanySimSection} />

    <div class="company-sim-content">
      {#if companySimStore.loading && !companySimStore.state}
        <div class="company-sim-empty-state">
          <h3>Loading company sim…</h3>
        </div>
      {:else if companySimStore.error && !companySimStore.state}
        <div class="company-sim-empty-state" data-testid="company-sim-error">
          <h3>Could not load Company Sim</h3>
          <p>{companySimStore.error}</p>
        </div>
      {:else if companySimStore.state}
        {#if companySimStore.activeSection === 'overview'}
          <CompanySimOverview state={companySimStore.state} />
        {:else}
          <div class="company-sim-empty-state">
            <h3>{sectionLabel(companySimStore.activeSection)}</h3>
            <p>This section lands in the next slice. Overview is live now.</p>
          </div>
        {/if}
      {:else}
        <div class="company-sim-empty-state">
          <h3>No company sim selected</h3>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .company-sim-panel {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    height: 100%;
    padding: 18px;
    gap: 16px;
    background:
      radial-gradient(120% 160% at 100% -10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 42%),
      linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 92%, #000 8%), var(--bg-primary));
  }

  .company-sim-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
  }

  .company-sim-kicker {
    margin: 0 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .company-sim-header h2 {
    margin: 0;
    font-size: 32px;
  }

  .company-sim-subtitle {
    margin: 6px 0 0;
    color: var(--text-secondary);
  }

  .company-sim-actions {
    display: flex;
    gap: 10px;
  }

  .company-sim-layout {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    min-height: 0;
    flex: 1;
    border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    border-radius: 20px;
    overflow: hidden;
    background: color-mix(in srgb, var(--bg-primary) 95%, transparent);
  }

  .company-sim-content {
    padding: 18px;
    overflow: auto;
  }

  .company-sim-empty-state {
    border: 1px dashed color-mix(in srgb, var(--border) 86%, transparent);
    border-radius: 18px;
    padding: 24px;
    background: color-mix(in srgb, var(--bg-secondary) 70%, transparent);
  }

  .company-sim-empty-state h3,
  .company-sim-empty-state p {
    margin: 0;
  }

  .company-sim-empty-state p {
    margin-top: 8px;
    color: var(--text-secondary);
  }

  @media (max-width: 900px) {
    .company-sim-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
