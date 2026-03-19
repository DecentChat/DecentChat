<script lang="ts">
  import type {
    CompanyTemplateDefinition,
    CompanyTemplateInstallRequest,
    CompanyTemplateInstallResult,
  } from '../../../ui/types';
  import { buildCompanyTemplatePreview, listLocalCompanyTemplates } from '../../company-sim/templateCatalog';
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

  function sanitizeTemplate(template: CompanyTemplateDefinition): CompanyTemplateDefinition {
    return {
      ...template,
      roles: template.roles.map((role) => ({ ...role })),
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
    const defaults: Record<string, string> = {};
    for (const question of template.questions) {
      defaults[question.id] = question.defaultValue ?? '';
    }
    answers = defaults;
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
      <p class="modal-copy">Choose a team template and continue with setup.</p>
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
    width: min(960px, 94vw);
    max-width: 960px;
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

  .modal-copy {
    margin: 0 0 12px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .template-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
  }

  .wizard-error {
    color: var(--danger, #ff5d5d);
  }
</style>
