import { SeedPhraseManager } from '@decentchat/protocol';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';


import { loadCompanyContextForEmployee, type CompanyContextDocumentId } from './context-loader.ts';
import { parseCompanyManifestFile } from './manifest.ts';
import { buildCompanyPromptContext, titleForCompanyContextDocument } from './prompt-context.ts';
import { decideCompanyParticipation, describeCompanyRoutingDecision } from './router.ts';
import type { CompanyEmployeeConfig, CompanyManifest } from './types.ts';

export interface CompanySimControlDocRecord {
  id: string;
  relativePath: string;
  absolutePath: string;
  label: string;
  kind: 'company' | 'team' | 'employee';
  required: boolean;
  exists: boolean;
  usedByEmployeeIds: string[];
  teamId?: string;
  employeeId?: string;
  documentId?: CompanyContextDocumentId;
}

export interface CompanySimControlEmployeeRecord {
  id: string;
  accountId: string;
  alias: string;
  title: string;
  teamId?: string;
  managerEmployeeId?: string;
  channels: string[];
  participation: CompanyEmployeeConfig['participation'];
  silentChannelIds: string[];
  effectiveDocPaths: string[];
}

export interface CompanySimControlTeamRecord {
  id: string;
  name: string;
  managerEmployeeId?: string;
  memberEmployeeIds: string[];
  docPath: string;
  docExists: boolean;
}

export interface CompanySimControlChannelRecord {
  name: string;
  memberEmployeeIds: string[];
  mutedEmployeeIds: string[];
}

export interface CompanySimControlProvisioningState {
  bootstrapEnabled: boolean;
  bootstrapMode: 'runtime' | 'off' | null;
  manifestPath: string;
  targetWorkspaceId?: string;
  targetInviteCode?: string;
  configuredAccountIds: string[];
  missingAccountIds: string[];
  onlineReadyAccountIds: string[];
  manualActionRequiredAccountIds: string[];
}

export interface CompanySimControlOverview {
  workspaceId: string;
  workspaceName?: string;
  companyId: string;
  companyName: string;
  manifestPath: string;
  companyDirPath: string;
  counts: {
    employees: number;
    teams: number;
    channels: number;
    docs: number;
  };
  sourceState: 'ready' | 'warning';
  generatedState: 'ready' | 'warning';
  liveState: 'ready' | 'warning';
  warnings: string[];
}

export interface CompanySimControlState {
  overview: CompanySimControlOverview;
  teams: CompanySimControlTeamRecord[];
  employees: CompanySimControlEmployeeRecord[];
  channels: CompanySimControlChannelRecord[];
  docs: CompanySimControlDocRecord[];
  provisioning: CompanySimControlProvisioningState;
}

export interface CompanySimControlDocumentResult {
  doc: CompanySimControlDocRecord;
  content: string;
}

export interface CompanySimEmployeeContextSection {
  id: CompanyContextDocumentId;
  title: string;
  relativePath: string;
  content: string;
}

export interface CompanySimEmployeeContextResult {
  employeeId: string;
  alias: string;
  sections: CompanySimEmployeeContextSection[];
  prompt: string;
}

export interface CompanySimRoutingPreviewEntry {
  employeeId: string;
  alias: string;
  title: string;
  teamId?: string;
  shouldRespond: boolean;
  reason: ReturnType<typeof decideCompanyParticipation>['reason'];
  preferredReply: 'channel' | 'thread';
  explanation: string;
}

export interface CompanySimRoutingPreviewResult {
  workspaceId: string;
  companyId: string;
  chatType: 'direct' | 'channel';
  channelNameOrId?: string;
  text: string;
  threadId?: string;
  responders: CompanySimRoutingPreviewEntry[];
  suppressed: CompanySimRoutingPreviewEntry[];
}

export interface CompanySimControlPlaneParams {
  workspaceId: string;
  workspaceName?: string;
  loadConfig: () => Record<string, unknown>;
}

export interface CompanySimControlDocumentParams extends CompanySimControlPlaneParams {
  relativePath: string;
}

export interface CompanySimControlDocumentWriteParams extends CompanySimControlDocumentParams {
  content: string;
}

export interface CompanySimRoutingPreviewParams extends CompanySimControlPlaneParams {
  chatType: 'direct' | 'channel';
  channelNameOrId?: string;
  text: string;
  threadId?: string;
}

export interface CompanySimEmployeeContextParams extends CompanySimControlPlaneParams {
  employeeId: string;
}

interface ResolvedControlTarget {
  manifestPath: string;
  companyDirPath: string;
  manifest: CompanyManifest;
  channelConfig: Record<string, unknown>;
  accounts: Record<string, unknown>;
  bootstrapEnabled: boolean;
  bootstrapMode: 'runtime' | 'off' | null;
  targetWorkspaceId?: string;
  targetInviteCode?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function getDecentChatChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const channels = isRecord(config.channels) ? config.channels : {};
  return isRecord(channels.decentchat) ? channels.decentchat : {};
}

function getBootstrapConfig(channelConfig: Record<string, unknown>): {
  enabled: boolean;
  mode: 'runtime' | 'off' | null;
  manifestPath?: string;
  targetWorkspaceId?: string;
  targetInviteCode?: string;
} {
  const nested = isRecord(channelConfig.companySimBootstrap) ? channelConfig.companySimBootstrap : {};
  const enabled = channelConfig.companySimBootstrapEnabled === true || nested.enabled === true;
  const modeRaw = readNonEmptyString(channelConfig.companySimBootstrapMode) ?? readNonEmptyString(nested.mode);
  const mode = modeRaw === 'off' ? 'off' : (modeRaw === 'runtime' ? 'runtime' : null);
  const manifestPath = readNonEmptyString(channelConfig.companySimBootstrapManifestPath)
    ?? readNonEmptyString(nested.manifestPath);
  const targetWorkspaceId = readNonEmptyString(channelConfig.companySimBootstrapTargetWorkspaceId)
    ?? readNonEmptyString(nested.targetWorkspaceId);
  const targetInviteCode = readNonEmptyString(channelConfig.companySimBootstrapTargetInviteCode)
    ?? readNonEmptyString(nested.targetInviteCode);
  return { enabled, mode, manifestPath, targetWorkspaceId, targetInviteCode };
}

function resolveManifestPathFromAccounts(accounts: Record<string, unknown>): string | undefined {
  const manifestPaths = uniqueSorted(
    Object.values(accounts)
      .map((account) => (isRecord(account) && isRecord(account.companySim) ? account.companySim : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .filter((entry) => entry.enabled !== false)
      .map((entry) => readNonEmptyString(entry.manifestPath) ?? '')
      .filter(Boolean),
  );

  if (manifestPaths.length === 1) {
    return manifestPaths[0];
  }

  return undefined;
}

function resolveControlTarget(params: CompanySimControlPlaneParams): ResolvedControlTarget {
  const config = params.loadConfig();
  const channelConfig = getDecentChatChannelConfig(config);
  const accounts = isRecord(channelConfig.accounts) ? channelConfig.accounts : {};
  const bootstrap = getBootstrapConfig(channelConfig);

  if (bootstrap.targetWorkspaceId && bootstrap.targetWorkspaceId !== params.workspaceId) {
    throw new Error(`No company sim is bound to workspace ${params.workspaceId}`);
  }

  const manifestPath = bootstrap.manifestPath ?? resolveManifestPathFromAccounts(accounts);
  if (!manifestPath) {
    throw new Error(`No company sim manifest is configured for workspace ${params.workspaceId}`);
  }

  const manifest = parseCompanyManifestFile(manifestPath);
  return {
    manifestPath,
    companyDirPath: dirname(manifestPath),
    manifest,
    channelConfig,
    accounts,
    bootstrapEnabled: bootstrap.enabled,
    bootstrapMode: bootstrap.mode,
    targetWorkspaceId: bootstrap.targetWorkspaceId,
    targetInviteCode: bootstrap.targetInviteCode,
  };
}

function rel(companyDirPath: string, absolutePath: string): string {
  return relative(companyDirPath, absolutePath).split(sep).join('/');
}

function buildDocInventory(target: ResolvedControlTarget): CompanySimControlDocRecord[] {
  const allEmployeeIds = target.manifest.employees.map((employee) => employee.id);
  const docs: CompanySimControlDocRecord[] = [];

  const pushDoc = (record: Omit<CompanySimControlDocRecord, 'exists'>) => {
    docs.push({
      ...record,
      exists: existsSync(record.absolutePath),
    });
  };

  for (const [documentId, filename, label] of [
    ['company', 'COMPANY.md', 'Company'],
    ['communication', 'COMMUNICATION.md', 'Communication'],
    ['org', 'ORG.md', 'Org'],
    ['workflows', 'WORKFLOWS.md', 'Workflows'],
  ] as const) {
    const absolutePath = join(target.companyDirPath, filename);
    pushDoc({
      id: filename,
      relativePath: filename,
      absolutePath,
      label,
      kind: 'company',
      required: true,
      usedByEmployeeIds: allEmployeeIds,
      documentId,
    });
  }

  for (const team of target.manifest.teams) {
    const absolutePath = join(target.companyDirPath, 'teams', `${team.id}.md`);
    pushDoc({
      id: `teams/${team.id}.md`,
      relativePath: `teams/${team.id}.md`,
      absolutePath,
      label: `${team.name} Team`,
      kind: 'team',
      required: false,
      usedByEmployeeIds: target.manifest.employees.filter((employee) => employee.teamId === team.id).map((employee) => employee.id),
      teamId: team.id,
      documentId: 'team',
    });
  }

  for (const employee of target.manifest.employees) {
    for (const [documentId, filename, label] of [
      ['identity', 'IDENTITY.md', 'Identity'],
      ['role', 'ROLE.md', 'Role'],
      ['rules', 'RULES.md', 'Rules'],
      ['memory', 'MEMORY.md', 'Memory'],
      ['playbook', 'PLAYBOOK.md', 'Playbook'],
    ] as const) {
      const absolutePath = join(target.companyDirPath, 'employees', employee.id, filename);
      pushDoc({
        id: `employees/${employee.id}/${filename}`,
        relativePath: `employees/${employee.id}/${filename}`,
        absolutePath,
        label: `${employee.alias} ${label}`,
        kind: 'employee',
        required: true,
        usedByEmployeeIds: [employee.id],
        employeeId: employee.id,
        documentId,
      });
    }
  }

  return docs;
}

function getAccountConfig(accounts: Record<string, unknown>, accountId: string): Record<string, unknown> | null {
  const account = accounts[accountId];
  return isRecord(account) ? account : null;
}

function getSilentChannelIds(account: Record<string, unknown> | null): string[] {
  const companySim = isRecord(account?.companySim) ? account?.companySim : null;
  return Array.isArray(companySim?.silentChannelIds)
    ? uniqueSorted(companySim.silentChannelIds.map((value) => String(value ?? '')))
    : [];
}

function buildProvisioningState(target: ResolvedControlTarget): CompanySimControlProvisioningState {
  const seedManager = new SeedPhraseManager();
  const configuredAccountIds: string[] = [];
  const missingAccountIds: string[] = [];
  const onlineReadyAccountIds: string[] = [];
  const manualActionRequiredAccountIds: string[] = [];

  for (const employee of target.manifest.employees) {
    const account = getAccountConfig(target.accounts, employee.accountId);
    if (!account) {
      missingAccountIds.push(employee.accountId);
      continue;
    }

    configuredAccountIds.push(employee.accountId);
    const seedPhrase = readNonEmptyString(account.seedPhrase);
    if (seedPhrase && seedManager.validate(seedPhrase).valid) {
      onlineReadyAccountIds.push(employee.accountId);
    } else {
      manualActionRequiredAccountIds.push(employee.accountId);
    }
  }

  return {
    bootstrapEnabled: target.bootstrapEnabled,
    bootstrapMode: target.bootstrapMode,
    manifestPath: target.manifestPath,
    ...(target.targetWorkspaceId ? { targetWorkspaceId: target.targetWorkspaceId } : {}),
    ...(target.targetInviteCode ? { targetInviteCode: target.targetInviteCode } : {}),
    configuredAccountIds: uniqueSorted(configuredAccountIds),
    missingAccountIds: uniqueSorted(missingAccountIds),
    onlineReadyAccountIds: uniqueSorted(onlineReadyAccountIds),
    manualActionRequiredAccountIds: uniqueSorted(manualActionRequiredAccountIds),
  };
}

function resolveControlDoc(target: ResolvedControlTarget, relativePath: string): CompanySimControlDocRecord {
  const normalized = relativePath.trim().replace(/\\/g, '/');
  const docs = buildDocInventory(target);
  const found = docs.find((doc) => doc.relativePath === normalized);
  if (!found) {
    throw new Error(`Unknown company sim doc: ${relativePath}`);
  }
  return found;
}

function assertDocWithinCompanyRoot(companyDirPath: string, absolutePath: string): void {
  const resolvedRoot = resolve(companyDirPath);
  const resolvedPath = resolve(absolutePath);
  if (!(resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`))) {
    throw new Error(`Resolved doc path escapes company root: ${absolutePath}`);
  }
}

export function getCompanySimControlState(params: CompanySimControlPlaneParams): CompanySimControlState {
  const target = resolveControlTarget(params);
  const docs = buildDocInventory(target);
  const provisioning = buildProvisioningState(target);

  const employees: CompanySimControlEmployeeRecord[] = target.manifest.employees.map((employee) => {
    const account = getAccountConfig(target.accounts, employee.accountId);
    const effectiveDocPaths = docs
      .filter((doc) => doc.usedByEmployeeIds.includes(employee.id))
      .map((doc) => doc.relativePath);

    return {
      id: employee.id,
      accountId: employee.accountId,
      alias: employee.alias,
      title: employee.title,
      ...(employee.teamId ? { teamId: employee.teamId } : {}),
      ...(employee.managerEmployeeId ? { managerEmployeeId: employee.managerEmployeeId } : {}),
      channels: [...employee.channels],
      participation: { ...employee.participation },
      silentChannelIds: getSilentChannelIds(account),
      effectiveDocPaths,
    };
  });

  const teams: CompanySimControlTeamRecord[] = target.manifest.teams.map((team) => ({
    id: team.id,
    name: team.name,
    ...(team.managerEmployeeId ? { managerEmployeeId: team.managerEmployeeId } : {}),
    memberEmployeeIds: target.manifest.employees.filter((employee) => employee.teamId === team.id).map((employee) => employee.id),
    docPath: `teams/${team.id}.md`,
    docExists: docs.some((doc) => doc.relativePath === `teams/${team.id}.md` && doc.exists),
  }));

  const channels: CompanySimControlChannelRecord[] = target.manifest.workspace.channels.map((channelName) => ({
    name: channelName,
    memberEmployeeIds: target.manifest.employees.filter((employee) => employee.channels.includes(channelName)).map((employee) => employee.id),
    mutedEmployeeIds: employees.filter((employee) => employee.silentChannelIds.includes(channelName)).map((employee) => employee.id),
  }));

  const warnings = uniqueSorted([
    ...docs.filter((doc) => doc.required && !doc.exists).map((doc) => `Missing required doc: ${doc.relativePath}`),
    ...provisioning.missingAccountIds.map((accountId) => `Missing configured account: ${accountId}`),
    ...provisioning.manualActionRequiredAccountIds.map((accountId) => `Manual action required for account: ${accountId}`),
    ...(!provisioning.bootstrapEnabled ? ['Company bootstrap is not enabled in OpenClaw config'] : []),
  ]);

  const sourceState = warnings.some((warning) => warning.startsWith('Missing required doc')) ? 'warning' : 'ready';
  const generatedState = provisioning.missingAccountIds.length > 0 ? 'warning' : 'ready';
  const liveState = provisioning.manualActionRequiredAccountIds.length > 0 ? 'warning' : 'ready';

  return {
    overview: {
      workspaceId: params.workspaceId,
      ...(params.workspaceName ? { workspaceName: params.workspaceName } : {}),
      companyId: target.manifest.id,
      companyName: target.manifest.name,
      manifestPath: target.manifestPath,
      companyDirPath: target.companyDirPath,
      counts: {
        employees: employees.length,
        teams: teams.length,
        channels: channels.length,
        docs: docs.length,
      },
      sourceState,
      generatedState,
      liveState,
      warnings,
    },
    teams,
    employees,
    channels,
    docs,
    provisioning,
  };
}

export function readCompanySimControlDocument(params: CompanySimControlDocumentParams): CompanySimControlDocumentResult {
  const target = resolveControlTarget(params);
  const doc = resolveControlDoc(target, params.relativePath);
  assertDocWithinCompanyRoot(target.companyDirPath, doc.absolutePath);

  return {
    doc,
    content: readFileSync(doc.absolutePath, 'utf8'),
  };
}

export function writeCompanySimControlDocument(params: CompanySimControlDocumentWriteParams): CompanySimControlDocumentResult {
  const target = resolveControlTarget(params);
  const doc = resolveControlDoc(target, params.relativePath);
  assertDocWithinCompanyRoot(target.companyDirPath, doc.absolutePath);

  mkdirSync(dirname(doc.absolutePath), { recursive: true });
  writeFileSync(doc.absolutePath, params.content, 'utf8');

  return {
    doc: {
      ...doc,
      exists: true,
    },
    content: params.content,
  };
}

export function getCompanySimEmployeeContext(params: CompanySimEmployeeContextParams): CompanySimEmployeeContextResult {
  const target = resolveControlTarget(params);
  const employee = target.manifest.employees.find((entry) => entry.id === params.employeeId);
  if (!employee) {
    throw new Error(`Unknown company employee: ${params.employeeId}`);
  }

  const context = loadCompanyContextForEmployee({
    manifestPath: target.manifestPath,
    employeeId: employee.id,
  });

  const sections = context.documents.map((doc) => ({
    id: doc.id,
    title: titleForCompanyContextDocument(doc.id),
    relativePath: rel(target.companyDirPath, doc.path),
    content: doc.content,
  }));

  return {
    employeeId: employee.id,
    alias: employee.alias,
    sections,
    prompt: buildCompanyPromptContext(context),
  };
}

export function previewCompanySimRouting(params: CompanySimRoutingPreviewParams): CompanySimRoutingPreviewResult {
  const target = resolveControlTarget(params);
  const entries = target.manifest.employees.map((employee) => {
    const team = employee.teamId
      ? target.manifest.teams.find((entry) => entry.id === employee.teamId)
      : undefined;

    const decision = decideCompanyParticipation({
      context: {
        manifestPath: target.manifestPath,
        companyDir: target.companyDirPath,
        manifest: target.manifest,
        employee,
        team,
        documents: [],
      },
      chatType: params.chatType,
      channelNameOrId: params.channelNameOrId,
      text: params.text,
      threadId: params.threadId,
    });

    return {
      employeeId: employee.id,
      alias: employee.alias,
      title: employee.title,
      ...(employee.teamId ? { teamId: employee.teamId } : {}),
      shouldRespond: decision.shouldRespond,
      reason: decision.reason,
      preferredReply: decision.preferredReply,
      explanation: describeCompanyRoutingDecision(decision, employee),
    } satisfies CompanySimRoutingPreviewEntry;
  });

  return {
    workspaceId: params.workspaceId,
    companyId: target.manifest.id,
    chatType: params.chatType,
    ...(params.channelNameOrId ? { channelNameOrId: params.channelNameOrId } : {}),
    text: params.text,
    ...(params.threadId ? { threadId: params.threadId } : {}),
    responders: entries.filter((entry) => entry.shouldRespond).sort((a, b) => a.employeeId.localeCompare(b.employeeId)),
    suppressed: entries.filter((entry) => !entry.shouldRespond).sort((a, b) => a.employeeId.localeCompare(b.employeeId)),
  };
}
