import { createHash, createHmac } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { SeedPhraseManager } from 'decent-protocol';

import {
  planCompanyAgentTopology,
  type CompanyAgentTopologyPlan,
} from './agent-topology.ts';
import { materializeCompanyOpenClawConfig } from './openclaw-config.ts';
import {
  compileCompanyTemplateToManifest,
  type CompanyTemplateRoleOverrides,
  type CompanyTemplateRoleSelection,
} from './template-compiler.ts';
import type { CompanySimTemplate } from './template-registry.ts';
import type { CompanyTemplateQuestionValue } from './template-types.ts';
import type { CompanyManifest } from './types.ts';
import {
  scaffoldCompanyAgentWorkspaces,
  type CompanyAgentWorkspaceScaffoldResult,
} from './workspace-scaffold.ts';

export interface InstallCompanyTemplateParams<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  template: CompanySimTemplate;
  config: TConfig;
  answers?: Record<string, CompanyTemplateQuestionValue>;
  roleSelection?: CompanyTemplateRoleSelection;
  roleOverrides?: Record<string, CompanyTemplateRoleOverrides>;
  companyId?: string;
  targetWorkspaceId?: string;
  targetInviteCode?: string;
  workspaceRootDir?: string;
  companySimsRootDir?: string;
}

export interface CompanyTemplateInstallSummary {
  companyId: string;
  companyDirPath: string;
  manifestPath: string;
  createdAgentIds: string[];
  createdAccountIds: string[];
  provisionedAccountIds: string[];
  onlineReadyAccountIds: string[];
  manualActionRequiredAccountIds: string[];
  createdChannels: string[];
}

export interface InstallCompanyTemplateResult<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  manifest: CompanyManifest;
  manifestPath: string;
  companyDirPath: string;
  topology: CompanyAgentTopologyPlan;
  workspaceScaffold: CompanyAgentWorkspaceScaffoldResult[];
  config: TConfig;
  summary: CompanyTemplateInstallSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function writeFileEnsured(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function copyFileEnsured(sourcePath: string, targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}

function buildMemoryMd(params: { alias: string; title: string; employeeId: string }): string {
  return [
    '# MEMORY.md',
    '',
    `- Employee: ${params.alias}`,
    `- Role: ${params.title}`,
    `- Employee ID: ${params.employeeId}`,
    '',
    'Add running notes, useful context, and follow-ups for this role here.',
  ].join('\n');
}

function buildPlaybookMd(params: { alias: string; title: string }): string {
  return [
    '# PLAYBOOK.md',
    '',
    `## ${params.alias} (${params.title})`,
    '',
    '- Track active priorities for this role.',
    '- Escalate blockers quickly.',
    '- Align decisions with COMPANY.md, ORG.md, and WORKFLOWS.md.',
  ].join('\n');
}

function materializeCompanyTemplateFiles(params: {
  template: CompanySimTemplate;
  manifest: CompanyManifest;
  companyDirPath: string;
  manifestPath: string;
}): void {
  copyFileEnsured(params.template.assets.companyMdPath, join(params.companyDirPath, 'COMPANY.md'));
  copyFileEnsured(params.template.assets.orgMdPath, join(params.companyDirPath, 'ORG.md'));
  copyFileEnsured(params.template.assets.workflowsMdPath, join(params.companyDirPath, 'WORKFLOWS.md'));
  writeFileEnsured(params.manifestPath, stringifyYaml(params.manifest));

  for (const employee of params.manifest.employees) {
    const roleAssets = params.template.assets.employees[employee.id];
    if (!roleAssets) {
      throw new Error(`Template ${params.template.id} is missing role assets for employee id: ${employee.id}`);
    }

    const employeeDir = join(params.companyDirPath, 'employees', employee.id);

    copyFileEnsured(roleAssets.identityMdPath, join(employeeDir, 'IDENTITY.md'));
    copyFileEnsured(roleAssets.roleMdPath, join(employeeDir, 'ROLE.md'));
    copyFileEnsured(roleAssets.rulesMdPath, join(employeeDir, 'RULES.md'));

    const memoryPath = join(employeeDir, 'MEMORY.md');
    if (!existsSync(memoryPath)) {
      writeFileEnsured(memoryPath, buildMemoryMd({
        alias: employee.alias,
        title: employee.title,
        employeeId: employee.id,
      }));
    }

    const playbookPath = join(employeeDir, 'PLAYBOOK.md');
    if (!existsSync(playbookPath)) {
      writeFileEnsured(playbookPath, buildPlaybookMd({
        alias: employee.alias,
        title: employee.title,
      }));
    }
  }
}

function collectConfiguredAgentIds(config: Record<string, unknown>): Set<string> {
  const agentList = isRecord(config.agents) && Array.isArray(config.agents.list)
    ? config.agents.list
    : [];

  const out = new Set<string>();
  for (const entry of agentList) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) continue;
    out.add(id);
  }
  return out;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

type SeedPhraseManagerWithInternals = SeedPhraseManager & {
  entropyToMnemonic?: (entropy: Uint8Array) => string;
};

function listConfiguredSeedPhrases(config: Record<string, unknown>): string[] {
  const channels = isRecord(config.channels) ? config.channels : undefined;
  const decentchat = channels && isRecord(channels.decentchat) ? channels.decentchat : undefined;
  if (!decentchat) return [];

  const seedPhrases: string[] = [];

  const channelSeedPhrase = readNonEmptyString(decentchat.seedPhrase);
  if (channelSeedPhrase) seedPhrases.push(channelSeedPhrase);

  const accounts = isRecord(decentchat.accounts) ? decentchat.accounts : undefined;
  if (accounts) {
    for (const account of Object.values(accounts)) {
      if (!isRecord(account)) continue;
      const seedPhrase = readNonEmptyString(account.seedPhrase);
      if (seedPhrase) seedPhrases.push(seedPhrase);
    }
  }

  return uniqueSorted(seedPhrases);
}

function buildProvisioningSalt(params: {
  config: Record<string, unknown>;
  manifest: CompanyManifest;
  manifestPath: string;
  companyDirPath: string;
}): string {
  const hash = createHash('sha256');
  hash.update('company-sim-account-provisioning:v1\n');
  hash.update(params.manifest.id);
  hash.update('\n');

  const configuredSeedPhrases = listConfiguredSeedPhrases(params.config);
  if (configuredSeedPhrases.length > 0) {
    hash.update('seed-material\n');
    for (const seedPhrase of configuredSeedPhrases) {
      hash.update(seedPhrase);
      hash.update('\n');
    }
  } else {
    hash.update('manifest-path-fallback\n');
    hash.update(params.manifestPath);
    hash.update('\n');
    hash.update(params.companyDirPath);
    hash.update('\n');
  }

  return hash.digest('hex');
}

function deriveDeterministicSeedPhrase(params: {
  seedManager: SeedPhraseManager;
  provisioningSalt: string;
  manifest: CompanyManifest;
  employeeId: string;
  accountId: string;
}): string {
  const entropy = createHmac('sha256', params.provisioningSalt)
    .update('company-sim-account:v1\n')
    .update(params.manifest.id)
    .update('\n')
    .update(params.employeeId)
    .update('\n')
    .update(params.accountId)
    .digest()
    .subarray(0, 16);

  const seedManagerWithInternals = params.seedManager as SeedPhraseManagerWithInternals;
  if (typeof seedManagerWithInternals.entropyToMnemonic !== 'function') {
    throw new Error('SeedPhraseManager entropy encoder unavailable for deterministic account provisioning');
  }

  return seedManagerWithInternals.entropyToMnemonic(new Uint8Array(entropy));
}

function isSeedPhraseValid(seedManager: SeedPhraseManager, seedPhrase: string | undefined): boolean {
  if (!seedPhrase) return false;
  return seedManager.validate(seedPhrase).valid;
}

function ensureDecentChatAccounts<TConfig extends Record<string, unknown>>(params: {
  config: TConfig;
  manifest: CompanyManifest;
  manifestPath: string;
  companyDirPath: string;
  targetWorkspaceId?: string;
  targetInviteCode?: string;
}): {
  config: TConfig;
  createdAccountIds: string[];
  provisionedAccountIds: string[];
  onlineReadyAccountIds: string[];
  manualActionRequiredAccountIds: string[];
} {
  const nextConfig: Record<string, unknown> = {
    ...params.config,
  };

  const channels = isRecord(params.config.channels)
    ? { ...params.config.channels }
    : {};

  const existingDecentChat = isRecord(channels.decentchat)
    ? channels.decentchat
    : {};

  const decentchat: Record<string, unknown> = {
    ...existingDecentChat,
  };

  const existingAccounts = isRecord(existingDecentChat.accounts)
    ? existingDecentChat.accounts
    : {};

  const accounts: Record<string, unknown> = {
    ...existingAccounts,
  };

  const seedManager = new SeedPhraseManager();
  const provisioningSalt = buildProvisioningSalt({
    config: params.config,
    manifest: params.manifest,
    manifestPath: params.manifestPath,
    companyDirPath: params.companyDirPath,
  });

  const createdAccountIds: string[] = [];
  const provisionedAccountIds: string[] = [];
  const onlineReadyAccountIds: string[] = [];
  const manualActionRequiredAccountIds: string[] = [];

  for (const employee of params.manifest.employees) {
    const existingAccount = isRecord(accounts[employee.accountId])
      ? accounts[employee.accountId] as Record<string, unknown>
      : undefined;

    if (!existingAccount) {
      createdAccountIds.push(employee.accountId);
    }

    const existingCompanySim = isRecord(existingAccount?.companySim)
      ? existingAccount.companySim
      : {};

    const roleFilesDir = join(params.companyDirPath, 'employees', employee.id);

    const existingSeedPhrase = readNonEmptyString(existingAccount?.seedPhrase);
    const seedPhrase = existingSeedPhrase
      ?? deriveDeterministicSeedPhrase({
        seedManager,
        provisioningSalt,
        manifest: params.manifest,
        employeeId: employee.id,
        accountId: employee.accountId,
      });

    if (!existingSeedPhrase) {
      provisionedAccountIds.push(employee.accountId);
    }

    if (isSeedPhraseValid(seedManager, seedPhrase)) {
      onlineReadyAccountIds.push(employee.accountId);
    } else {
      manualActionRequiredAccountIds.push(employee.accountId);
    }

    accounts[employee.accountId] = {
      ...(existingAccount ?? {}),
      seedPhrase,
      alias: typeof existingAccount?.alias === 'string' && existingAccount.alias.trim()
        ? existingAccount.alias
        : employee.alias,
      dataDir: typeof existingAccount?.dataDir === 'string' && existingAccount.dataDir.trim()
        ? existingAccount.dataDir
        : resolve(params.companyDirPath, '..', '..', '.company-sim', 'accounts', params.manifest.id, employee.accountId),
      companySim: {
        ...existingCompanySim,
        enabled: typeof existingCompanySim.enabled === 'boolean'
          ? existingCompanySim.enabled
          : true,
        manifestPath: typeof existingCompanySim.manifestPath === 'string' && existingCompanySim.manifestPath.trim()
          ? existingCompanySim.manifestPath
          : params.manifestPath,
        companyId: typeof existingCompanySim.companyId === 'string' && existingCompanySim.companyId.trim()
          ? existingCompanySim.companyId
          : params.manifest.id,
        employeeId: typeof existingCompanySim.employeeId === 'string' && existingCompanySim.employeeId.trim()
          ? existingCompanySim.employeeId
          : employee.id,
        roleFilesDir: typeof existingCompanySim.roleFilesDir === 'string' && existingCompanySim.roleFilesDir.trim()
          ? existingCompanySim.roleFilesDir
          : roleFilesDir,
      },
    };
  }

  const existingBootstrap = isRecord(existingDecentChat.companySimBootstrap)
    ? existingDecentChat.companySimBootstrap
    : {};

  const bootstrapEnabledRaw = (decentchat as any).companySimBootstrapEnabled ?? existingBootstrap.enabled;
  const bootstrapModeRaw = (decentchat as any).companySimBootstrapMode ?? existingBootstrap.mode;
  const bootstrapManifestPathRaw = (decentchat as any).companySimBootstrapManifestPath ?? existingBootstrap.manifestPath;
  const bootstrapTargetWorkspaceIdRaw = (decentchat as any).companySimBootstrapTargetWorkspaceId ?? existingBootstrap.targetWorkspaceId;
  const bootstrapTargetInviteCodeRaw = (decentchat as any).companySimBootstrapTargetInviteCode ?? existingBootstrap.targetInviteCode;

  const bootstrapEnabled = bootstrapEnabledRaw === undefined
    ? true
    : bootstrapEnabledRaw !== false;

  const bootstrapMode = bootstrapModeRaw === 'off'
    ? 'off'
    : 'runtime';

  const bootstrapManifestPath = readNonEmptyString(bootstrapManifestPathRaw) ?? params.manifestPath;
  const bootstrapTargetWorkspaceId = readNonEmptyString(params.targetWorkspaceId)
    ?? readNonEmptyString(bootstrapTargetWorkspaceIdRaw);
  const bootstrapTargetInviteCode = readNonEmptyString(params.targetInviteCode)
    ?? readNonEmptyString(bootstrapTargetInviteCodeRaw);

  decentchat.accounts = accounts;
  decentchat.companySimBootstrap = {
    ...existingBootstrap,
    enabled: bootstrapEnabled,
    mode: bootstrapMode,
    manifestPath: bootstrapManifestPath,
    ...(bootstrapTargetWorkspaceId ? { targetWorkspaceId: bootstrapTargetWorkspaceId } : {}),
    ...(bootstrapTargetInviteCode ? { targetInviteCode: bootstrapTargetInviteCode } : {}),
  };

  if ((decentchat as any).companySimBootstrapEnabled === undefined) {
    (decentchat as any).companySimBootstrapEnabled = bootstrapEnabled;
  }
  if ((decentchat as any).companySimBootstrapMode === undefined) {
    (decentchat as any).companySimBootstrapMode = bootstrapMode;
  }
  if (!readNonEmptyString((decentchat as any).companySimBootstrapManifestPath)) {
    (decentchat as any).companySimBootstrapManifestPath = bootstrapManifestPath;
  }
  if (bootstrapTargetWorkspaceId) {
    (decentchat as any).companySimBootstrapTargetWorkspaceId = bootstrapTargetWorkspaceId;
  }
  if (bootstrapTargetInviteCode) {
    (decentchat as any).companySimBootstrapTargetInviteCode = bootstrapTargetInviteCode;
  }

  channels.decentchat = decentchat;
  nextConfig.channels = channels;

  return {
    config: nextConfig as TConfig,
    createdAccountIds: uniqueSorted(createdAccountIds),
    provisionedAccountIds: uniqueSorted(provisionedAccountIds),
    onlineReadyAccountIds: uniqueSorted(onlineReadyAccountIds),
    manualActionRequiredAccountIds: uniqueSorted(manualActionRequiredAccountIds),
  };
}

export function installCompanyTemplate<TConfig extends Record<string, unknown>>(
  params: InstallCompanyTemplateParams<TConfig>,
): InstallCompanyTemplateResult<TConfig> {
  const manifest = compileCompanyTemplateToManifest({
    template: params.template,
    answers: params.answers,
    roleSelection: params.roleSelection,
    roleOverrides: params.roleOverrides,
    companyId: params.companyId,
  });

  const workspaceRootDir = resolve(params.workspaceRootDir ?? process.cwd());
  const companySimsRootDir = resolve(params.companySimsRootDir ?? join(workspaceRootDir, 'company-sims'));
  const companyDirPath = resolve(companySimsRootDir, manifest.id);
  const manifestPath = join(companyDirPath, 'company.yaml');

  materializeCompanyTemplateFiles({
    template: params.template,
    manifest,
    companyDirPath,
    manifestPath,
  });

  const topology = planCompanyAgentTopology({
    manifest,
    manifestPath,
    workspaceRootDir,
  });

  const existingAgentIds = collectConfiguredAgentIds(params.config);

  const accountMaterialization = ensureDecentChatAccounts({
    config: params.config,
    manifest,
    manifestPath,
    companyDirPath,
    targetWorkspaceId: params.targetWorkspaceId,
    targetInviteCode: params.targetInviteCode,
  });

  const mergedConfig = materializeCompanyOpenClawConfig({
    config: accountMaterialization.config,
    topology,
  });

  const workspaceScaffold = scaffoldCompanyAgentWorkspaces(topology);

  const createdAgentIds = uniqueSorted(
    topology.agents
      .map((agent) => agent.agentId)
      .filter((agentId) => !existingAgentIds.has(agentId)),
  );

  const summary: CompanyTemplateInstallSummary = {
    companyId: manifest.id,
    companyDirPath,
    manifestPath,
    createdAgentIds,
    createdAccountIds: accountMaterialization.createdAccountIds,
    provisionedAccountIds: accountMaterialization.provisionedAccountIds,
    onlineReadyAccountIds: accountMaterialization.onlineReadyAccountIds,
    manualActionRequiredAccountIds: accountMaterialization.manualActionRequiredAccountIds,
    createdChannels: uniqueSorted(manifest.workspace.channels),
  };

  return {
    manifest,
    manifestPath,
    companyDirPath,
    topology,
    workspaceScaffold,
    config: mergedConfig,
    summary,
  };
}
