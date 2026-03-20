<script lang="ts">
  import type {
    CompanyTemplateDefinition,
    CompanyTemplateInstallRequest,
    CompanyTemplateInstallResult,
  } from '../../../ui/types';
  import { buildCompanyTemplatePreview, buildTemplateDefaultAnswers, listLocalCompanyTemplates } from '../../company-sim/templateCatalog';
  import TemplateCard from '../company-sim/TemplateCard.svelte';
  import TemplateWizard from '../company-sim/TemplateWizard.svelte';

  interface Props {
    workspaceId: string | null;
    workspaceName?: string | null;
    listTemplates?: () => Promise<CompanyTemplateDefinition[]> | CompanyTemplateDefinition[];
    installTemplate?: (request: CompanyTemplateInstallRequest) => Promise<CompanyTemplateInstallResult>;
    onInstalled?: (result: CompanyTemplateInstallResult) => void | Promise<void>;
    onToast?: (message: string, type?: 'info' | 'error' | 'success') => void;
    onClose: () => void;
  }

  let {
    workspaceId,
    workspaceName,
    listTemplates,
    installTemplate,
    onInstalled,
    onToast,
    onClose,
  }: Props = $props();

  let templates = $state<CompanyTemplateDefinition[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let selectedTemplateId = $state<string | null>(null);
  let answers = $state<Record<string, string>>({});

  let installing = $state(false);
  let installError = $state<string | null>(null);
  let installResult = $state<CompanyTemplateInstallResult | null>(null);

  let selectedTemplate = $derived(
    selectedTemplateId
      ? templates.find((template) => template.id === selectedTemplateId) ?? null
      : null,
  );

  const totalRoleCount = $derived(templates.reduce((sum, template) => sum + template.roles.length, 0));
  const totalChannelPresetCount = $derived(templates.reduce((sum, template) => sum + template.channels.length, 0));

  function sanitizeTemplate(template: CompanyTemplateDefinition): CompanyTemplateDefinition {
    return {
      ...template,
      roles: template.roles.map((role) => ({
        ...role,
        profile: role.profile
          ? {
            ...role.profile,
            traitPool: [...(role.profile.traitPool ?? [])],
            statPreset: role.profile.statPreset ? { ...role.profile.statPreset } : undefined,
            avatar: role.profile.avatar ? { ...role.profile.avatar } : undefined,
          }
          : undefined,
      })),
      channels: [...template.channels],
      questions: template.questions
        .filter((question) => question.id !== 'workspaceName')
        .map((question) => ({ ...question })),
    };
  }

  function closeOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') onClose();
  }

  $effect(() => {
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  });

  $effect(() => {
    (async () => {
      loading = true;
      loadError = null;
      try {
        const loaded = listTemplates
          ? await listTemplates()
          : listLocalCompanyTemplates();
        templates = loaded.map((template) => sanitizeTemplate(template));
      } catch (error) {
        loadError = (error as Error).message;
      } finally {
        loading = false;
      }
    })();
  });

  function pickTemplate(templateId: string): void {
    selectedTemplateId = templateId;
    installResult = null;
    installError = null;
    const template = templates.find((candidate) => candidate.id === templateId);
    if (!template) return;
    answers = buildTemplateDefaultAnswers(template);
  }

  async function install(installAnswers: Record<string, string>): Promise<void> {
    if (!selectedTemplate) return;
    if (!workspaceId) {
      installError = 'No active workspace selected. Open a workspace first.';
      return;
    }

    installing = true;
    installError = null;
    try {
      let result: CompanyTemplateInstallResult;

      if (installTemplate) {
        result = await installTemplate({
          templateId: selectedTemplate.id,
          workspaceId,
          answers: installAnswers,
        });
      } else {
        const preview = buildCompanyTemplatePreview(selectedTemplate, installAnswers, { workspaceName });
        result = {
          templateId: selectedTemplate.id,
          templateLabel: selectedTemplate.label,
          workspaceId,
          workspaceName: preview.workspaceName,
          companyName: preview.companyName,
          createdChannelNames: preview.channelNames.slice(1),
          createdMemberPeerIds: [],
          channelNames: preview.channelNames,
          members: preview.members,
          provisioningMode: 'workspace-shell',
          statusHeadline: '⚠️ Runtime provisioning pending',
          statusDetail: 'Created local workspace channels only. Real employee accounts/agents were not provisioned by this client.',
          createdAccountIds: [],
          provisionedAccountIds: [],
          onlineReadyAccountIds: [],
          manualActionRequiredAccountIds: [],
          manualActionItems: [
            'Run the decent-openclaw company template installer to provision real accounts/agents.',
            'Apply/restart OpenClaw runtime so provisioned accounts can bootstrap and appear online.',
          ],
        };
      }

      installResult = result;
      await onInstalled?.(result);
      const toastMessage = result.provisioningMode === 'runtime-provisioned'
        ? `Installed ${result.templateLabel} team.`
        : `Prepared ${result.templateLabel} team setup.`;
      onToast?.(toastMessage, result.provisioningMode === 'runtime-provisioned' ? 'success' : 'info');
    } catch (error) {
      installError = (error as Error).message;
    } finally {
      installing = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={(event) => event.target === event.currentTarget && onClose()}>
  <div class="modal install-team-template-modal">
    <div class="modal-header-row">
      <h2>Install AI Team</h2>
      <button class="thread-close" id="install-team-close" onclick={onClose}>✕</button>
    </div>

    {#if loading}
      <p>Loading templates…</p>
    {:else if loadError}
      <p class="wizard-error">Failed to load templates: {loadError}</p>
    {:else if !selectedTemplate}
      <section class="template-selection-shell">
        <div>
          <p class="selection-kicker">Company simulator</p>
          <h3>Assemble your launch crew</h3>
          <p class="modal-copy">Choose a team template, tune the roster, and deploy a game-like AI squad into the current workspace.</p>
        </div>
        <div class="selection-metrics" aria-label="Template metrics">
          <article>
            <span>Templates</span>
            <strong>{templates.length}</strong>
          </article>
          <article>
            <span>Roles ready</span>
            <strong>{totalRoleCount}</strong>
          </article>
          <article>
            <span>Channel presets</span>
            <strong>{totalChannelPresetCount}</strong>
          </article>
        </div>
      </section>

      <div class="template-card-grid">
        {#each templates as template (template.id)}
          <TemplateCard template={template} onChoose={pickTemplate} />
        {/each}
      </div>
    {:else}
      <TemplateWizard
        template={selectedTemplate}
        answers={answers}
        workspaceName={workspaceName}
        installing={installing}
        installError={installError}
        installResult={installResult}
        onChangeAnswers={(next) => { answers = next; }}
        onBack={() => { selectedTemplateId = null; installError = null; installResult = null; }}
        onInstall={install}
        onDone={onClose}
      />
    {/if}
  </div>
</div>

<style>
  .install-team-template-modal {
    width: min(980px, 94vw);
    max-width: 980px;
  }

  .modal-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .modal-header-row h2 {
    margin: 0;
  }

  .template-selection-shell {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    margin-bottom: 12px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
    border-radius: var(--radius-md, var(--radius-lg));
    background:
      radial-gradient(120% 170% at 100% -12%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 42%),
      linear-gradient(165deg, color-mix(in srgb, var(--bg-primary) 90%, #000 10%), var(--bg-primary));
  }

  .selection-kicker {
    margin: 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .template-selection-shell h3 {
    margin: 4px 0 0;
  }

  .modal-copy {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.45;
    max-width: 56ch;
  }

  .selection-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(88px, 1fr));
    gap: 8px;
    min-width: 286px;
  }

  .selection-metrics article {
    border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    border-radius: var(--radius-sm, 8px);
    padding: 8px;
    background: color-mix(in srgb, var(--bg-secondary) 74%, transparent);
    display: grid;
    gap: 4px;
  }

  .selection-metrics span {
    font-size: 11px;
    color: var(--text-muted);
  }

  .selection-metrics strong {
    color: var(--text);
    font-size: 17px;
  }

  .template-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }

  .wizard-error {
    color: var(--danger, #ff5d5d);
  }

  @media (max-width: 860px) {
    .template-selection-shell {
      grid-template-columns: 1fr;
    }

    .selection-metrics {
      min-width: 0;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 620px) {
    .selection-metrics {
      grid-template-columns: 1fr;
    }
  }
</style>
