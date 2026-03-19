<script lang="ts">
  import type {
    CompanyTemplateDefinition,
    CompanyTemplateInstallResult,
  } from '../../../ui/types';
  import { buildCompanyTemplatePreview } from '../../company-sim/templateCatalog';

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

  const preview = $derived(buildCompanyTemplatePreview(template, answers, { workspaceName }));
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
    workspaceName = null,
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
      onChangeAnswers?.(nextAnswers);
    } catch (error) {
      advancedJsonError = (error as Error).message;
    }
  }

  async function installTeam(): Promise<void> {
    if (missingRequired || installing) return;
    await onInstall?.(answers);
  }
</script>

<div class="template-wizard" data-testid="template-wizard">
  {#if installResult}
    <section class="template-install-result" data-testid="template-install-result">
      <h3>{installResult.statusHeadline}</h3>
      <p><strong>{installResult.companyName}</strong> in workspace <strong>{installResult.workspaceName}</strong>.</p>
      <p class="install-status-detail">{installResult.statusDetail}</p>
      <ul>
        <li>Created channels in this workspace: {installResult.createdChannelNames.length}</li>
        <li>Provisioned accounts: {installResult.provisionedAccountIds.length}</li>
        <li>Online-ready accounts: {installResult.onlineReadyAccountIds.length}</li>
        <li>Planned roles: {installResult.members.length}</li>
      </ul>

      {#if installResult.manualActionItems.length > 0}
        <p class="install-manual-heading">Manual follow-up</p>
        <ul class="install-manual-actions" data-testid="template-install-manual-actions">
          {#each installResult.manualActionItems as actionItem}
            <li>{actionItem}</li>
          {/each}
        </ul>
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
          />
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
        <h4>Review</h4>
        <p><strong>Template:</strong> {template.label}</p>
        <p><strong>Company:</strong> {preview.companyName}</p>
        <p><strong>Workspace:</strong> {preview.workspaceName}</p>
        <p><strong>Scope:</strong> {preview.members.length} roles · {preview.channelNames.length} channels</p>
        <ul>
          {#each preview.members as member (member.roleId)}
            <li>{member.alias} — {member.roleTitle}</li>
          {/each}
        </ul>
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
    grid-template-columns: 1.3fr 1fr;
    gap: 16px;
  }

  .template-wizard-form,
  .template-review,
  .template-install-result {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 14px;
  }

  .template-wizard-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .template-wizard-header h3,
  .template-review h4,
  .template-install-result h3 {
    margin: 0;
  }

  .wizard-field {
    display: grid;
    gap: 6px;
    margin-bottom: 10px;
    font-size: 13px;
  }

  .wizard-field input {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text);
    padding: 8px 10px;
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
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    padding: 8px;
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
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text);
    padding: 8px;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 12px;
  }

  .wizard-error {
    color: var(--danger, #ff5d5d);
    margin: 8px 0 0;
    font-size: 12px;
  }

  .template-review p {
    margin: 0 0 8px;
    font-size: 13px;
  }

  .template-review ul,
  .template-install-result ul {
    margin: 8px 0 0;
    padding-left: 18px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .template-install-result p {
    margin: 8px 0 0;
  }

  .install-status-detail {
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .install-manual-heading {
    margin-top: 12px;
    font-weight: 600;
  }

  .install-manual-actions {
    margin-top: 6px;
  }

  .template-install-result button {
    margin-top: 12px;
  }

  @media (max-width: 900px) {
    .template-wizard-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
