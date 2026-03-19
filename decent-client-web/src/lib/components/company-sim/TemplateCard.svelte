<script lang="ts">
  import type { CompanyTemplateDefinition } from '../../../ui/types';

  interface Props {
    template: CompanyTemplateDefinition;
    selected?: boolean;
    onChoose?: (templateId: string) => void;
  }

  let { template, selected = false, onChoose }: Props = $props();
</script>

<article class="template-card" data-testid={`template-card-${template.id}`} data-selected={selected ? 'true' : 'false'}>
  <header class="template-card-header">
    <div class="template-card-title-wrap">
      <span class="template-card-icon" aria-hidden="true">{template.icon || '🤖'}</span>
      <h3>{template.label}</h3>
    </div>
    <span class="template-badge">{template.roles.length} roles</span>
  </header>

  <p class="template-card-description">{template.description}</p>

  <div class="template-card-meta">
    <span>{template.channels.length} channels</span>
    <span>{template.questions.length} setup questions</span>
  </div>

  <button class="btn-primary" type="button" onclick={() => onChoose?.(template.id)}>
    Choose template
  </button>
</article>

<style>
  .template-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 14px;
  }

  .template-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .template-card-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .template-card-icon {
    font-size: 20px;
  }

  h3 {
    margin: 0;
    font-size: 16px;
  }

  .template-badge {
    font-size: 11px;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .template-card-description {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.4;
    font-size: 13px;
  }

  .template-card-meta {
    display: flex;
    gap: 14px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .template-card[data-selected='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  }

  button {
    align-self: flex-start;
  }
</style>
