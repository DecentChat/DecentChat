<script lang="ts">
  import type { CompanySimState } from '../../../ui/types';

  interface Props {
    state: CompanySimState;
  }

  let { state }: Props = $props();

  const cards = $derived([
    { key: 'employees', label: 'Employees', value: state.overview.counts.employees },
    { key: 'teams', label: 'Teams', value: state.overview.counts.teams },
    { key: 'channels', label: 'Channels', value: state.overview.counts.channels },
    { key: 'docs', label: 'Docs', value: state.overview.counts.docs },
    { key: 'provisioned', label: 'Provisioned', value: state.provisioning.configuredAccountIds.length },
    { key: 'online-ready', label: 'Online-ready', value: state.provisioning.onlineReadyAccountIds.length },
  ]);

  function toneLabel(value: CompanySimState['overview']['sourceState']): string {
    return value === 'warning' ? 'Warning' : value === 'ready' ? 'Ready' : 'Unknown';
  }
</script>

<section class="company-sim-overview">
  <div class="status-strip" aria-label="Company Sim status">
    <div class="status-pill" data-testid="company-sim-status-source" data-state={state.overview.sourceState}>
      <span>Source</span>
      <strong>{toneLabel(state.overview.sourceState)}</strong>
    </div>
    <div class="status-pill" data-testid="company-sim-status-generated" data-state={state.overview.generatedState}>
      <span>Generated</span>
      <strong>{toneLabel(state.overview.generatedState)}</strong>
    </div>
    <div class="status-pill" data-testid="company-sim-status-live" data-state={state.overview.liveState}>
      <span>Live</span>
      <strong>{toneLabel(state.overview.liveState)}</strong>
    </div>
  </div>

  <div class="overview-grid">
    {#each cards as card (card.key)}
      <article class="overview-card" data-testid={`company-sim-overview-card-${card.key}`}>
        <span>{card.label}</span>
        <strong>{card.value}</strong>
      </article>
    {/each}
  </div>

  <section class="overview-meta">
    <article>
      <h3>Workspace</h3>
      <p>{state.overview.workspaceName ?? state.overview.workspaceId}</p>
    </article>
    <article>
      <h3>Manifest</h3>
      <p>{state.overview.manifestPath}</p>
    </article>
  </section>

  <section class="warnings-panel" data-testid="company-sim-warnings">
    <h3>Warnings</h3>
    {#if state.overview.warnings.length > 0}
      <ul>
        {#each state.overview.warnings as warning (warning)}
          <li>{warning}</li>
        {/each}
      </ul>
    {:else}
      <p>No current warnings.</p>
    {/if}
  </section>
</section>

<style>
  .company-sim-overview {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .status-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .status-pill {
    min-width: 140px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    background: color-mix(in srgb, var(--bg-secondary) 86%, transparent);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .status-pill[data-state='ready'] strong { color: #4cc38a; }
  .status-pill[data-state='warning'] strong { color: #ffb454; }
  .status-pill span {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }

  .overview-card,
  .overview-meta article,
  .warnings-panel {
    border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    background: color-mix(in srgb, var(--bg-secondary) 86%, transparent);
    border-radius: 16px;
    padding: 16px;
  }

  .overview-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .overview-card span,
  .overview-meta h3,
  .warnings-panel h3 {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .overview-card strong {
    font-size: 32px;
    line-height: 1;
  }

  .overview-meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  .overview-meta p,
  .warnings-panel p,
  .warnings-panel ul {
    margin: 8px 0 0;
  }

  .warnings-panel ul {
    padding-left: 18px;
  }
</style>
