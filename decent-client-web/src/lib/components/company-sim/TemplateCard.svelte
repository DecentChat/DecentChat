<script lang="ts">
  import type { CompanyTemplateDefinition, CompanyTemplateRoleAvatarStyle } from '../../../ui/types';
  import { buildCompanyTemplatePreview, buildTemplateDefaultAnswers } from '../../company-sim/templateCatalog';
  import { buildPolicyRecommendationViewModel } from '../../company-sim/policyPresentation';

  interface Props {
    template: CompanyTemplateDefinition;
    selected?: boolean;
    onChoose?: (templateId: string) => void;
  }

  let { template, selected = false, onChoose }: Props = $props();

  const defaultAnswers = $derived(buildTemplateDefaultAnswers(template));
  const preview = $derived(buildCompanyTemplatePreview(template, defaultAnswers));
  const benchmarkVm = $derived(buildPolicyRecommendationViewModel(template.benchmarkSuite, defaultAnswers.communicationPolicy));

  function initialsFor(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }

  function styleLabel(style?: CompanyTemplateRoleAvatarStyle): string {
    if (!style) return 'Auto';
    return style[0].toUpperCase() + style.slice(1);
  }
</script>

<article class="template-card" data-testid={`template-card-${template.id}`} data-selected={selected ? 'true' : 'false'}>
  <header class="template-card-header">
    <div class="template-card-title-wrap">
      <span class="template-card-icon" aria-hidden="true">{template.icon || '🤖'}</span>
      <div class="title-copy">
        <h3>{template.label}</h3>
        <p>{template.description}</p>
      </div>
    </div>
    <div class="template-card-badges">
      <span class="template-badge">{template.roles.length} roles</span>
      <span class="template-badge">{template.channels.length} channels</span>
      {#if benchmarkVm}
        <span class="template-badge template-badge-accent">Recommended: {benchmarkVm.recommendedLabel}</span>
      {/if}
    </div>
  </header>

  <section class="template-team-preview" aria-label={`${template.label} team preview`}>
    <header class="team-preview-head">
      <span>Crew preview</span>
      <strong>{preview.members.length} operatives</strong>
    </header>

    <div class="template-team-portraits" aria-hidden="true">
      {#each preview.members.slice(0, 4) as member, index (member.roleId)}
        <span
          class="portrait"
          data-style={member.avatar?.style ?? 'auto'}
          title={`${member.alias} · ${styleLabel(member.avatar?.style)}`}
          style={`--avatar-index:${index}; --avatar-accent:${member.avatar?.accent ?? 'var(--accent)'}`}
        >
          {#if member.avatar?.dataUrl}
            <img src={member.avatar.dataUrl} alt="" loading="lazy" decoding="async" />
          {:else}
            <strong>{initialsFor(member.alias)}</strong>
          {/if}
        </span>
      {/each}
    </div>

    <ul class="template-team-roles">
      {#each preview.members.slice(0, 3) as member (member.roleId)}
        <li>
          <div>
            <span class="role-name">{member.alias}</span>
            <span class="role-title">{member.roleTitle}</span>
          </div>
          <span class="role-style">{styleLabel(member.avatar?.style)}</span>
        </li>
      {/each}
    </ul>
  </section>

  <div class="template-card-meta">
    <span>{template.questions.length} setup questions</span>
    <span>{preview.channelNames.join(' · ')}</span>
  </div>

  {#if benchmarkVm}
    <div class="template-policy-preview">
      <strong>{benchmarkVm.summary}</strong>
      <span>{benchmarkVm.explainer}</span>
    </div>
  {/if}

  <button class="btn-primary" type="button" onclick={() => onChoose?.(template.id)}>
    Choose template
  </button>
</article>

<style>
  .template-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background:
      radial-gradient(120% 160% at 100% -12%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 46%),
      radial-gradient(80% 90% at -20% 110%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 58%),
      linear-gradient(168deg, color-mix(in srgb, var(--bg-secondary) 93%, #000 7%), var(--bg-secondary));
    border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
    border-radius: var(--radius-lg);
    padding: 14px;
    min-height: 100%;
    transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
    overflow: hidden;
  }

  .template-card::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  .template-card:hover,
  .template-card:focus-within {
    border-color: color-mix(in srgb, var(--accent) 65%, var(--border));
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.28), 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent);
    transform: translateY(-2px);
  }

  .template-card-header {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .template-card-title-wrap {
    display: flex;
    gap: 10px;
    min-width: 0;
  }

  .template-card-icon {
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
  }

  .title-copy {
    min-width: 0;
  }

  h3 {
    margin: 0;
    font-size: 16px;
  }

  .title-copy p {
    margin: 4px 0 0;
    color: var(--text-muted);
    line-height: 1.45;
    font-size: 12px;
  }

  .template-card-badges {
    display: grid;
    align-content: flex-start;
    justify-items: end;
    gap: 6px;
    flex-shrink: 0;
  }

  .template-badge {
    font-size: 11px;
    color: color-mix(in srgb, var(--text-muted) 84%, var(--text));
    border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    border-radius: 999px;
    padding: 2px 8px;
    background: color-mix(in srgb, var(--bg-primary) 75%, transparent);
  }

  .template-badge-accent {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text);
  }

  .template-policy-preview {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
    padding: 10px;
    border-radius: var(--radius-md, 12px);
    background: color-mix(in srgb, var(--bg-primary) 78%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  }

  .template-policy-preview strong {
    color: var(--text);
    font-size: 12px;
  }

  .template-team-preview {
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
    border-radius: var(--radius-md, 12px);
    padding: 10px;
    display: grid;
    gap: 8px;
  }

  .team-preview-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .team-preview-head strong {
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
    font-size: 12px;
  }

  .template-team-portraits {
    display: flex;
    align-items: center;
    min-height: 38px;
    padding-left: 2px;
  }

  .portrait {
    position: relative;
    display: inline-flex;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--avatar-accent) 74%, var(--border));
    box-shadow: 0 6px 14px color-mix(in srgb, var(--avatar-accent) 22%, transparent);
    margin-left: calc(var(--avatar-index) * -10px);
    background: linear-gradient(160deg, color-mix(in srgb, var(--avatar-accent) 35%, var(--bg-primary)), var(--bg-secondary));
    align-items: center;
    justify-content: center;
  }

  .portrait::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
  }

  .portrait img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .portrait strong {
    font-size: 12px;
    letter-spacing: 0.02em;
    color: var(--text);
  }

  .template-team-roles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }

  .template-team-roles li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .template-team-roles li > div {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .role-name {
    color: var(--text);
    font-weight: 600;
  }

  .role-title {
    color: var(--text-muted);
    font-size: 11px;
  }

  .role-style {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-muted);
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    border-radius: 999px;
    padding: 2px 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .template-card-meta {
    display: grid;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .template-card[data-selected='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 48%, transparent);
  }

  button {
    align-self: flex-start;
  }
</style>
