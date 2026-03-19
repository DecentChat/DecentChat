import type { CompanyTemplateProvisioningMode } from '../../ui/types';

export interface CompanyTemplateInstallStatusInput {
  provisioningMode: CompanyTemplateProvisioningMode;
  provisionedAccountIds: string[];
  onlineReadyAccountIds: string[];
  manualActionRequiredAccountIds: string[];
  manualActionItems?: string[];
}

export interface CompanyTemplateInstallStatus {
  statusHeadline: string;
  statusDetail: string;
  manualActionItems: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function describeCompanyTemplateInstallStatus(
  input: CompanyTemplateInstallStatusInput,
): CompanyTemplateInstallStatus {
  const providedManualActions = unique(input.manualActionItems ?? []);

  if (input.provisioningMode === 'runtime-provisioned') {
    const manualActionItems = providedManualActions.length > 0
      ? providedManualActions
      : (input.manualActionRequiredAccountIds.length > 0
        ? [
          `Fix invalid seed phrases for: ${input.manualActionRequiredAccountIds.join(', ')}.`,
        ]
        : []);

    const statusDetail = input.onlineReadyAccountIds.length > 0
      ? `Provisioned ${input.provisionedAccountIds.length} account(s); ${input.onlineReadyAccountIds.length} account(s) validated as online-ready.`
      : 'Runtime bridge reported completion, but no online-ready accounts were confirmed.';

    return {
      statusHeadline: manualActionItems.length > 0
        ? '⚠️ Provisioned with manual follow-up required'
        : '✅ Provisioned and runtime-applied',
      statusDetail,
      manualActionItems,
    };
  }

  if (input.provisioningMode === 'config-provisioned') {
    const manualActionItems = providedManualActions.length > 0
      ? providedManualActions
      : [
        'Restart/reload OpenClaw so runtime bootstrap applies the new company manifest.',
      ];

    if (input.manualActionRequiredAccountIds.length > 0) {
      manualActionItems.push(
        `Fix invalid seed phrases for: ${input.manualActionRequiredAccountIds.join(', ')}.`,
      );
    }

    return {
      statusHeadline: '⚠️ Provisioned into config (runtime apply pending)',
      statusDetail: `Provisioned ${input.provisionedAccountIds.length} account(s) into OpenClaw config. Accounts come online after runtime apply/restart.`,
      manualActionItems: unique(manualActionItems),
    };
  }

  return {
    statusHeadline: '⚠️ Runtime provisioning pending',
    statusDetail: 'Created local workspace channels only. Real employee accounts/agents were not provisioned by this client.',
    manualActionItems: providedManualActions.length > 0
      ? providedManualActions
      : [
        'Run the decent-openclaw company template installer to provision real accounts/agents.',
        'Apply/restart OpenClaw runtime so provisioned accounts can bootstrap and appear online.',
      ],
  };
}
