<script lang="ts">
  import type {
    CompanyTemplateDefinition,
    CompanyTemplateInstallPreviewMember,
    CompanyTemplateInstallResult,
    CompanyTemplateProvisioningMode,
    CompanyTemplateRoleAvatarStyle,
    CompanyTemplateRoleStatKey,
    CompanyTemplateRoleStats,
  } from '../../../ui/types';
  import { buildCompanyTemplatePreview, deriveRerolledAvatarSeed } from '../../company-sim/templateCatalog';

  interface Props {
    template: CompanyTemplateDefinition;
    answers: Record<string, string>;
    workspaceName?: string | null;
    installing?: boolean;
    installError?: string | null;
    installResult?: CompanyTemplateInstallResult | null;
    onChangeAnswers?: (next: Record<string, string>) => void;
    onBack?: () => void;
    onInstall?: (answers: Record<string, string>) => void | Promise<void>;
    onDone?: () => void;
  }

  const STAT_ORDER: CompanyTemplateRoleStatKey[] = ['planning', 'execution', 'quality', 'adaptability'];
  const STAT_LABELS: Record<CompanyTemplateRoleStatKey, string> = {
    planning: 'Planning',
    execution: 'Execution',
    quality: 'Quality',
    adaptability: 'Adaptability',
  };
  const FALLBACK_STATS: CompanyTemplateRoleStats = {
    planning: 56,
    execution: 56,
    quality: 56,
    adaptability: 56,
  };

  let {
    template,
    answers,
    workspaceName = null,
    installing = false,
    installError = null,
    installResult = null,
    onChangeAnswers,
    onBack,
    onInstall,
    onDone,
  }: Props = $props();

  let selectedRoleId = $state<string | null>(null);

  function readValue(questionId: string, fallback = ''): string {
    const value = answers[questionId];
    if (typeof value !== 'string') return fallback;
    return value;
  }

  function updateAnswer(questionId: string, value: string): void {
    const next = {
      ...answers,
      [questionId]: value,
    };
    onChangeAnswers?.(next);
  }

  function updateMemberAlias(member: CompanyTemplateInstallPreviewMember, alias: string): void {
    const roleDefinition = template.roles.find((role) => role.id === member.roleId);
    if (!roleDefinition) return;
    const answerKey = roleDefinition.aliasQuestionId ?? `alias:${roleDefinition.id}`;
    updateAnswer(answerKey, alias);
  }

  function rerollMemberAvatar(member: CompanyTemplateInstallPreviewMember): void {
    const answerKey = `avatarSeed:${member.roleId}`;
    const currentSeed = readValue(answerKey, member.avatar?.seed ?? `${template.id}:${member.roleId}`);
    const rerolled = deriveRerolledAvatarSeed(currentSeed, `${template.id}:${member.roleId}:${preview.companyName}`);
    updateAnswer(answerKey, rerolled);
  }

  const preview = $derived(buildCompanyTemplatePreview(template, answers, { workspaceName }));
  const selectedMember = $derived(preview.members.find((member) => member.roleId === selectedRoleId) ?? preview.members[0] ?? null);

  $effect(() => {
    if (!selectedRoleId && preview.members[0]) {
      selectedRoleId = preview.members[0].roleId;
      return;
    }

    if (selectedRoleId && !preview.members.some((member) => member.roleId === selectedRoleId)) {
      selectedRoleId = preview.members[0]?.roleId ?? null;
    }
  });

  const missingRequired = $derived(
    template.questions.some((question) => {
      if (!question.required) return false;
      const value = readValue(question.id, question.defaultValue ?? '');
      return !value.trim();
    }),
  );

  let advancedJson = $state('');
  let advancedJsonError = $state<string | null>(null);

  function exportSetupJson(): void {
    advancedJson = JSON.stringify({
      templateId: template.id,
      answers,
    }, null, 2);
    advancedJsonError = null;
  }

  function importSetupJson(): void {
    advancedJsonError = null;
    try {
      const parsed = JSON.parse(advancedJson || '{}') as {
        templateId?: string;
        answers?: Record<string, string>;
      };

      if (parsed.templateId && parsed.templateId !== template.id) {
        throw new Error(`Expected templateId ${template.id}, got ${parsed.templateId}`);
      }

      const nextAnswers: Record<string, string> = { ...answers };
      for (const question of template.questions) {
        const value = parsed.answers?.[question.id];
        if (typeof value === 'string') nextAnswers[question.id] = value;
      }
      for (const role of template.roles) {
        const avatarSeed = parsed.answers?.[`avatarSeed:${role.id}`];
        if (typeof avatarSeed === 'string') nextAnswers[`avatarSeed:${role.id}`] = avatarSeed;

        const aliasFallback = parsed.answers?.[`alias:${role.id}`];
        if (typeof aliasFallback === 'string') nextAnswers[`alias:${role.id}`] = aliasFallback;
      }
      onChangeAnswers?.(nextAnswers);
    } catch (error) {
      advancedJsonError = (error as Error).message;
    }
  }

  function normalizeTraits(member: CompanyTemplateInstallPreviewMember): string[] {
    if (member.traits && member.traits.length > 0) return member.traits;
    return ['Operational focus', 'Reliable collaborator'];
  }

  function normalizeStats(member: CompanyTemplateInstallPreviewMember): CompanyTemplateRoleStats {
    return {
      ...FALLBACK_STATS,
      ...(member.stats ?? {}),
    };
  }

  function initialsFor(member: CompanyTemplateInstallPreviewMember): string {
    const words = member.alias.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0][0]?.toUpperCase() ?? '?';
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }

  function avatarStyleLabel(style?: CompanyTemplateRoleAvatarStyle): string {
    if (!style) return 'Auto';
    return style[0].toUpperCase() + style.slice(1);
  }

  function provisioningLabel(mode: CompanyTemplateProvisioningMode): string {
    if (mode === 'runtime-provisioned') return 'Runtime provisioned';
    if (mode === 'config-provisioned') return 'Config provisioned';
    return 'Workspace shell only';
  }

  function provisioningState(mode: CompanyTemplateProvisioningMode): 'ready' | 'pending' {
    return mode === 'workspace-shell' ? 'pending' : 'ready';
  }

  async function installTeam(): Promise<void> {
    if (missingRequired || installing) return;
    await onInstall?.(answers);
  }
</script>

<div class="template-wizard" data-testid="template-wizard">
  {#if installResult}
    <section class="template-install-result" data-testid="template-install-result">
      <header class="result-hero" data-state={provisioningState(installResult.provisioningMode)}>
        <p class="result-kicker">Deployment report</p>
        <h3>{installResult.statusHeadline}</h3>
        <p class="result-copy">
          <strong>{installResult.companyName}</strong> staged in <strong>{installResult.workspaceName}</strong>
        </p>
        <p class="install-status-detail">{installResult.statusDetail}</p>
        <div class="result-mode-row">
          <span class="result-mode-pill">{provisioningLabel(installResult.provisioningMode)}</span>
          <span class="result-template-pill">{installResult.templateLabel}</span>
        </div>
      </header>

      <section class="result-metrics" aria-label="Install metrics">
        <article>
          <span>Channels created</span>
          <strong>{installResult.createdChannelNames.length}</strong>
        </article>
        <article>
          <span>Accounts provisioned</span>
          <strong>{installResult.provisionedAccountIds.length}</strong>
        </article>
        <article>
          <span>Online-ready</span>
          <strong>{installResult.onlineReadyAccountIds.length}</strong>
        </article>
        <article>
          <span>Crew roles</span>
          <strong>{installResult.members.length}</strong>
        </article>
      </section>

      {#if installResult.members.length > 0}
        <section class="install-result-roster" aria-label="Installed team roster">
          <header class="install-result-roster-head">
            <h4>Crew manifest</h4>
            <p>Your configured roster is preserved below for quick verification.</p>
          </header>

          <div class="install-result-grid">
            {#each installResult.members as member (member.roleId)}
              {@const stats = normalizeStats(member)}
              <article
                class="result-roster-card"
                data-style={member.avatar?.style ?? 'helm'}
                style={`--avatar-accent:${member.avatar?.accent ?? 'var(--accent)'}`}
              >
                <div class="result-avatar">
                  {#if member.avatar?.dataUrl}
                    <img src={member.avatar.dataUrl} alt={`${member.alias} avatar`} loading="lazy" decoding="async" />
                  {:else}
                    <strong>{initialsFor(member)}</strong>
                  {/if}
                </div>
                <div class="result-card-main">
                  <div class="result-title-row">
                    <p class="result-name">{member.alias}</p>
                    <span class="result-style">{avatarStyleLabel(member.avatar?.style)}</span>
                  </div>
                  <p class="result-role">{member.roleTitle}{member.archetype ? ` · ${member.archetype}` : ''}</p>
                  <div class="result-traits">
                    {#each normalizeTraits(member).slice(0, 3) as trait (trait)}
                      <span>{trait}</span>
                    {/each}
                  </div>
                  <div class="result-stat-row">
                    {#each STAT_ORDER as key (key)}
                      <span>{STAT_LABELS[key]} {stats[key]}</span>
                    {/each}
                  </div>
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/if}

      {#if installResult.manualActionItems.length > 0}
        <section class="install-manual-panel" data-testid="template-install-manual-actions">
          <p class="install-manual-heading">Manual follow-up</p>
          <ul class="install-manual-actions">
            {#each installResult.manualActionItems as actionItem}
              <li>{actionItem}</li>
            {/each}
          </ul>
        </section>
      {/if}

      <button class="btn-primary" type="button" onclick={() => onDone?.()}>Done</button>
    </section>
  {:else}
    <div class="template-wizard-layout">
      <section class="template-wizard-form">
        <header class="template-wizard-header">
          <button type="button" class="btn-secondary" onclick={() => onBack?.()}>← Back</button>
          <h3>{template.label} setup</h3>
        </header>

        {#each template.questions as question (question.id)}
          <label class="wizard-field">
            <span>{question.label}</span>
            <input
              type="text"
              value={readValue(question.id, question.defaultValue ?? '')}
              placeholder={question.placeholder ?? ''}
              oninput={(event) => updateAnswer(question.id, (event.currentTarget as HTMLInputElement).value)}
              required={question.required === true}
              aria-label={question.label}
            />
            {#if question.description}
              <small>{question.description}</small>
            {/if}
          </label>
        {/each}

        {#if installError}
          <p class="wizard-error">{installError}</p>
        {/if}

        <details class="wizard-advanced" open>
          <summary>Advanced export/import</summary>
          <div class="wizard-advanced-actions">
            <button class="btn-secondary" type="button" onclick={exportSetupJson}>Export setup JSON</button>
            <button class="btn-secondary" type="button" onclick={importSetupJson}>Import setup JSON</button>
          </div>
          <textarea
            data-testid="template-json-editor"
            value={advancedJson}
            oninput={(event) => { advancedJson = (event.currentTarget as HTMLTextAreaElement).value; }}
            placeholder="Paste setup JSON here"
          ></textarea>
          {#if advancedJsonError}
            <p class="wizard-error">{advancedJsonError}</p>
          {/if}
        </details>

        <div class="wizard-actions">
          <button class="btn-primary" type="button" onclick={installTeam} disabled={missingRequired || installing}>
            {installing ? 'Installing…' : 'Install Team'}
          </button>
        </div>
      </section>

      <aside class="template-review" data-testid="template-review-summary">
        <header class="review-header">
          <h4>Roster Preview</h4>
          <p><strong>Template:</strong> {template.label}</p>
          <p><strong>Company:</strong> {preview.companyName}</p>
          <p><strong>Workspace:</strong> {preview.workspaceName}</p>
          <p><strong>Scope:</strong> {preview.members.length} roles · {preview.channelNames.length} channels</p>
        </header>

        <section class="roster-focus-panel" data-testid="template-roster-focus" aria-live="polite">
          {#if selectedMember}
            <div class="focus-avatar" style={`--avatar-accent:${selectedMember.avatar?.accent ?? 'var(--accent)'}`}>
              {#if selectedMember.avatar?.dataUrl}
                <img src={selectedMember.avatar.dataUrl} alt={`${selectedMember.alias} avatar`} loading="lazy" decoding="async" />
              {:else}
                <strong>{initialsFor(selectedMember)}</strong>
              {/if}
            </div>
            <div class="focus-copy">
              <div class="focus-title-row">
                <strong>{selectedMember.alias}</strong>
                <span>{selectedMember.roleTitle}</span>
              </div>
              <p>{selectedMember.bioLine}</p>
              <div class="focus-traits">
                {#each normalizeTraits(selectedMember).slice(0, 2) as trait (trait)}
                  <span>{trait}</span>
                {/each}
              </div>
            </div>
          {/if}
        </section>

        <section class="roster-grid" data-testid="template-roster-preview">
          {#each preview.members as member (member.roleId)}
            {@const stats = normalizeStats(member)}
            {@const isSelected = member.roleId === selectedRoleId}
            <article
              class="roster-card"
              data-selected={isSelected ? 'true' : 'false'}
              data-style={member.avatar?.style ?? 'helm'}
              data-testid={`template-roster-card-${member.roleId}`}
              style={`--avatar-accent:${member.avatar?.accent ?? 'var(--accent)'}`}
            >
              <header class="roster-card-head">
                <div class="roster-card-tags">
                  <button
                    type="button"
                    class="roster-focus-button"
                    aria-pressed={isSelected}
                    onclick={() => { selectedRoleId = member.roleId; }}
                  >
                    {isSelected ? 'Focused' : 'Focus'}
                  </button>
                  {#if member.channelAffinity}
                    <span class="roster-channel">#{member.channelAffinity}</span>
                  {/if}
                </div>
                <span class="roster-style">{avatarStyleLabel(member.avatar?.style)}</span>
              </header>

              <div class="roster-profile-row">
                <div class="roster-avatar">
                  {#if member.avatar?.dataUrl}
                    <img src={member.avatar.dataUrl} alt={`${member.alias} avatar`} loading="lazy" decoding="async" />
                  {:else}
                    <strong>{initialsFor(member)}</strong>
                  {/if}
                </div>

                <div class="roster-identity">
                  <label>
                    <span class="sr-only">Alias for {member.roleTitle}</span>
                    <input
                      class="roster-alias-input"
                      type="text"
                      value={member.alias}
                      aria-label={`Alias for ${member.roleTitle}`}
                      onfocus={() => { selectedRoleId = member.roleId; }}
                      oninput={(event) => updateMemberAlias(member, (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <p class="roster-role-line">{member.roleTitle} · {member.archetype ?? 'Specialist'}</p>
                  <p class="roster-bio">{member.bioLine}</p>
                </div>
              </div>

              <div class="roster-traits">
                {#each normalizeTraits(member) as trait (trait)}
                  <span>{trait}</span>
                {/each}
              </div>

              <div class="roster-stats" aria-label={`Stats for ${member.alias}`}>
                {#each STAT_ORDER as key (key)}
                  <div class="stat-row">
                    <span>{STAT_LABELS[key]}</span>
                    <div class="stat-track" role="progressbar" aria-label={`${STAT_LABELS[key]} stat`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={stats[key]}>
                      <div class="stat-fill" style={`width:${stats[key]}%`}></div>
                    </div>
                    <strong>{stats[key]}</strong>
                  </div>
                {/each}
              </div>

              <div class="roster-actions">
                <button type="button" class="btn-secondary" onclick={() => rerollMemberAvatar(member)}>
                  Reroll avatar
                </button>
              </div>
            </article>
          {/each}
        </section>
      </aside>
    </div>
  {/if}
</div>

<style>
  .template-wizard {
    margin-top: 8px;
  }

  .template-wizard-layout {
    display: grid;
    grid-template-columns: 1.03fr 1.42fr;
    gap: 16px;
  }

  .template-wizard-form,
  .template-review,
  .template-install-result {
    background:
      linear-gradient(165deg, color-mix(in srgb, var(--bg-secondary) 92%, #000 8%), var(--bg-secondary));
    border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
    border-radius: var(--radius-lg);
    padding: 14px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }

  .template-wizard-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .template-wizard-header h3,
  .template-review h4,
  .template-install-result h3,
  .install-result-roster-head h4 {
    margin: 0;
  }

  .wizard-field {
    display: grid;
    gap: 6px;
    margin-bottom: 10px;
    font-size: 13px;
  }

  .wizard-field input,
  .roster-alias-input,
  .wizard-advanced textarea {
    border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    border-radius: var(--radius-sm, 8px);
    background: color-mix(in srgb, var(--bg-primary) 86%, #000 14%);
    color: var(--text);
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }

  .wizard-field input {
    padding: 8px 10px;
  }

  .wizard-field input:focus-visible,
  .roster-alias-input:focus-visible,
  .wizard-advanced textarea:focus-visible,
  .roster-focus-button:focus-visible {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 62%, var(--border));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 24%, transparent);
  }

  .wizard-field small {
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.4;
  }

  .wizard-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }

  .wizard-advanced {
    margin-top: 10px;
    border: 1px dashed color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: var(--radius-sm, 8px);
    padding: 8px;
    background: color-mix(in srgb, var(--bg-primary) 38%, transparent);
  }

  .wizard-advanced summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--text-muted);
  }

  .wizard-advanced-actions {
    display: flex;
    gap: 8px;
    margin: 8px 0;
    flex-wrap: wrap;
  }

  .wizard-advanced textarea {
    width: 100%;
    min-height: 120px;
    padding: 8px;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 12px;
  }

  .wizard-error {
    color: var(--danger, #ff5d5d);
    margin: 8px 0 0;
    font-size: 12px;
  }

  .review-header {
    margin-bottom: 10px;
  }

  .review-header p {
    margin: 5px 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .roster-focus-panel {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    background:
      radial-gradient(140% 140% at 100% 0%, color-mix(in srgb, var(--accent) 15%, transparent), transparent 52%),
      linear-gradient(150deg, color-mix(in srgb, var(--bg-primary) 90%, #000 10%), var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
    border-radius: var(--radius-md, var(--radius-lg));
    padding: 10px;
    margin-bottom: 10px;
  }

  .focus-avatar,
  .roster-avatar,
  .result-avatar {
    width: 58px;
    height: 58px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--avatar-accent) 72%, var(--border));
    background: linear-gradient(145deg, color-mix(in srgb, var(--avatar-accent) 36%, var(--bg-primary)), var(--bg-secondary));
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 6px 14px color-mix(in srgb, var(--avatar-accent) 20%, transparent);
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .focus-avatar img,
  .roster-avatar img,
  .result-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .focus-avatar strong,
  .roster-avatar strong,
  .result-avatar strong {
    color: var(--text);
    font-size: 18px;
  }

  .focus-copy {
    min-width: 0;
  }

  .focus-title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
  }

  .focus-title-row strong {
    font-size: 14px;
    color: var(--text);
  }

  .focus-title-row span {
    color: var(--text-muted);
  }

  .focus-copy p {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .focus-traits {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .focus-traits span,
  .roster-traits span,
  .result-traits span {
    border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
    border-radius: 999px;
    padding: 2px 7px;
    font-size: 11px;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
  }

  .roster-grid {
    display: grid;
    gap: 10px;
    max-height: 64vh;
    overflow-y: auto;
    padding-right: 2px;
  }

  .roster-card {
    border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
    border-radius: var(--radius-md, var(--radius-lg));
    padding: 10px;
    background:
      radial-gradient(120% 170% at 100% -10%, color-mix(in srgb, var(--avatar-accent) 20%, transparent), transparent 40%),
      linear-gradient(156deg, color-mix(in srgb, var(--bg-primary) 88%, #000 12%), var(--bg-primary));
    transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
  }

  .roster-card:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.24);
  }

  .roster-card[data-selected='true'] {
    border-color: color-mix(in srgb, var(--accent) 72%, var(--border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent), 0 10px 22px rgba(0, 0, 0, 0.24);
  }

  .roster-card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .roster-card-tags {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .roster-focus-button {
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 999px;
    font-size: 11px;
    padding: 3px 9px;
    color: var(--text);
    background: color-mix(in srgb, var(--bg-secondary) 76%, transparent);
    cursor: pointer;
  }

  .roster-focus-button[aria-pressed='true'] {
    border-color: color-mix(in srgb, var(--accent) 72%, var(--border));
    color: color-mix(in srgb, var(--accent) 64%, var(--text));
  }

  .roster-channel,
  .roster-style,
  .result-style {
    font-size: 10px;
    color: var(--text-muted);
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: 999px;
    padding: 2px 7px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .roster-style,
  .result-style {
    color: color-mix(in srgb, var(--text) 70%, var(--accent));
  }

  .roster-profile-row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
  }

  .roster-identity {
    min-width: 0;
  }

  .roster-alias-input {
    width: 100%;
    padding: 7px 8px;
    font-size: 14px;
    font-weight: 600;
  }

  .roster-role-line {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .roster-bio {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .roster-traits,
  .result-traits {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .roster-stats {
    margin-top: 8px;
    display: grid;
    gap: 6px;
  }

  .stat-row {
    display: grid;
    grid-template-columns: 82px 1fr 32px;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .stat-track {
    height: 7px;
    background: color-mix(in srgb, var(--bg-secondary) 66%, #000 34%);
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    overflow: hidden;
  }

  .stat-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 66%, #38ded3), color-mix(in srgb, var(--accent) 52%, #f4e18d));
  }

  .stat-row strong {
    color: var(--text);
    text-align: right;
    font-size: 11px;
  }

  .roster-actions {
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }

  .result-hero {
    border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-radius: var(--radius-md, var(--radius-lg));
    padding: 12px;
    background:
      radial-gradient(120% 170% at 100% -12%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 40%),
      linear-gradient(160deg, color-mix(in srgb, var(--bg-primary) 88%, #000 12%), var(--bg-primary));
  }

  .result-hero[data-state='ready'] {
    border-color: color-mix(in srgb, var(--accent) 58%, var(--border));
  }

  .result-hero[data-state='pending'] {
    border-color: color-mix(in srgb, #f0ad4e 42%, var(--border));
  }

  .result-kicker {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 11px;
    color: var(--text-muted);
  }

  .result-copy,
  .install-status-detail {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .result-mode-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .result-mode-pill,
  .result-template-pill {
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 11px;
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    background: color-mix(in srgb, var(--bg-secondary) 74%, transparent);
  }

  .result-mode-pill {
    color: color-mix(in srgb, var(--text) 72%, var(--accent));
  }

  .result-template-pill {
    color: var(--text-muted);
  }

  .result-metrics {
    margin-top: 10px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .result-metrics article {
    border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    border-radius: var(--radius-sm, 8px);
    padding: 8px;
    background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
    display: grid;
    gap: 4px;
  }

  .result-metrics span {
    font-size: 11px;
    color: var(--text-muted);
  }

  .result-metrics strong {
    font-size: 18px;
    color: var(--text);
  }

  .install-result-roster {
    margin-top: 12px;
    display: grid;
    gap: 10px;
  }

  .install-result-roster-head p {
    margin: 5px 0 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .install-result-grid {
    display: grid;
    gap: 8px;
  }

  .result-roster-card {
    border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
    border-radius: var(--radius-md, var(--radius-lg));
    background:
      radial-gradient(130% 180% at 100% -18%, color-mix(in srgb, var(--avatar-accent) 24%, transparent), transparent 44%),
      color-mix(in srgb, var(--bg-primary) 88%, #000 12%);
    padding: 9px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
  }

  .result-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .result-card-main {
    min-width: 0;
  }

  .result-name {
    margin: 0;
    font-weight: 600;
    font-size: 13px;
  }

  .result-role {
    margin: 3px 0 0;
    font-size: 12px;
    color: var(--text-muted);
  }

  .result-stat-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .install-manual-panel {
    margin-top: 12px;
    border: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
    border-radius: var(--radius-sm, 8px);
    padding: 10px;
    background: color-mix(in srgb, var(--bg-primary) 42%, transparent);
  }

  .install-manual-heading {
    margin: 0;
    font-weight: 600;
  }

  .install-manual-actions {
    margin: 6px 0 0;
    padding-left: 18px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .template-install-result > button {
    margin-top: 12px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 980px) {
    .template-wizard-layout {
      grid-template-columns: 1fr;
    }

    .roster-grid {
      max-height: none;
    }

    .result-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .roster-focus-panel,
    .roster-profile-row,
    .result-roster-card {
      grid-template-columns: 1fr;
    }

    .focus-avatar,
    .roster-avatar,
    .result-avatar {
      width: 68px;
      height: 68px;
    }

    .stat-row {
      grid-template-columns: 74px 1fr 30px;
    }

    .result-metrics {
      grid-template-columns: 1fr;
    }
  }
</style>
