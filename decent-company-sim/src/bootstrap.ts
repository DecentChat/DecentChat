import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { InviteURI, SeedPhraseManager } from 'decent-protocol';
import type { OpenClawConfigShape, OpenClawRouteBindingConfig, ResolvedDecentChatAccount } from './types.ts';
import { planCompanyAgentTopology } from './agent-topology.ts';
import { parseCompanyManifestFile } from './manifest.ts';

const DEFAULT_DATA_DIR = join(homedir(), '.openclaw', 'data', 'decentchat');

export interface CompanyBootstrapEmployee {
  employeeId: string;
  accountId: string;
  alias: string;
  title: string;
  teamId?: string;
  channels: string[];
  account: ResolvedDecentChatAccount;
}

export interface CompanyBootstrapPlan {
  companyId: string;
  companyName: string;
  workspaceName: string;
  channels: string[];
  employees: CompanyBootstrapEmployee[];
}

export interface CompanyBootstrapRuntimeResult {
  manifestPath: string;
  workspaceId: string;
  workspaceName: string;
  channelIds: Record<string, string>;
  memberPeerIds: Record<string, string>;
  accountIds: string[];
}


type WorkspaceBootstrapTarget = {
  workspaceId: string;
  inviteCode?: string;
  source: 'config' | 'invite' | 'derived';
};

export function resolveCompanyManifestPath(manifestPath: string): string {
  const trimmed = manifestPath.trim();
  if (!trimmed) {
    throw new Error('Company bootstrap manifest path is required');
  }
  return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasRouteBinding(params: {
  binding: OpenClawRouteBindingConfig;
  channel: string;
  accountId: string;
  agentId: string;
}): boolean {
  const type = typeof params.binding.type === 'string' ? params.binding.type : undefined;
  if (type && type !== 'route') return false;
  if (params.binding.agentId !== params.agentId) return false;

  const match = isRecord(params.binding.match) ? params.binding.match : undefined;
  return match?.channel === params.channel && match?.accountId === params.accountId;
}

export function assertCompanyBootstrapAgentInstallation(params: {
  manifestPath: string;
  cfg: OpenClawConfigShape;
}): void {
  const manifestPath = resolveCompanyManifestPath(params.manifestPath);
  const manifest = parseCompanyManifestFile(manifestPath);
  const topology = planCompanyAgentTopology({
    manifest,
    manifestPath,
  });

  const configuredAgents = new Set(
    (params.cfg.agents?.list ?? [])
      .map((entry) => (isRecord(entry) && typeof entry.id === 'string' ? entry.id : undefined))
      .filter((id): id is string => !!id?.trim()),
  );

  const missingAgents = topology.agents
    .filter((agent) => !configuredAgents.has(agent.agentId))
    .map((agent) => agent.agentId)
    .sort((a, b) => a.localeCompare(b));

  const bindings = Array.isArray(params.cfg.bindings)
    ? params.cfg.bindings
    : [];

  const missingBindings = topology.agents
    .flatMap((agent) => agent.bindings.map((binding) => ({
      channel: binding.channel,
      accountId: binding.accountId,
      agentId: agent.agentId,
    })))
    .filter((requiredBinding) => !bindings.some((binding) => hasRouteBinding({
      binding,
      channel: requiredBinding.channel,
      accountId: requiredBinding.accountId,
      agentId: requiredBinding.agentId,
    })))
    .map((requiredBinding) => `${requiredBinding.channel}:${requiredBinding.accountId}->${requiredBinding.agentId}`)
    .sort((a, b) => a.localeCompare(b));

  if (missingAgents.length === 0 && missingBindings.length === 0) {
    return;
  }

  const details: string[] = [];
  if (missingAgents.length > 0) {
    details.push(`missing agents.list entries: ${missingAgents.join(', ')}`);
  }
  if (missingBindings.length > 0) {
    details.push(`missing route bindings: ${missingBindings.join(', ')}`);
  }

  throw new Error(`Company bootstrap requires installed agent topology (${details.join('; ')})`);
}

function stableId(prefix: string, ...parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\x1f');
  }
  return `${prefix}-${hash.digest('hex').slice(0, 20)}`;
}

function inviteCodeForWorkspace(workspaceId: string): string {
  return createHash('sha256').update(workspaceId).digest('hex').slice(0, 8).toUpperCase();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}


function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseInviteWorkspaceContext(inviteUri: string): { workspaceId: string; inviteCode?: string } | undefined {
  const normalizedInvite = readNonEmptyString(inviteUri);
  if (!normalizedInvite) return undefined;

  try {
    const decoded = InviteURI.decode(normalizedInvite);
    const workspaceId = readNonEmptyString(decoded.workspaceId);
    if (!workspaceId) return undefined;
    return {
      workspaceId,
      inviteCode: readNonEmptyString(decoded.inviteCode),
    };
  } catch {
    return undefined;
  }
}

function resolveWorkspaceBootstrapTarget(plan: CompanyBootstrapPlan): WorkspaceBootstrapTarget {
  const configuredTargets = uniqueStrings(
    plan.employees
      .map((employee) => readNonEmptyString(employee.account.companySimBootstrap?.targetWorkspaceId) ?? '')
      .filter(Boolean),
  );

  if (configuredTargets.length > 1) {
    throw new Error(
      `Company bootstrap found conflicting target workspace ids across configured accounts: ${configuredTargets.join(', ')}`,
    );
  }

  if (configuredTargets.length === 1) {
    const configuredWorkspaceId = configuredTargets[0] as string;
    const configuredInviteCode = plan.employees
      .map((employee) => readNonEmptyString(employee.account.companySimBootstrap?.targetInviteCode))
      .find((value): value is string => Boolean(value));

    return {
      workspaceId: configuredWorkspaceId,
      ...(configuredInviteCode ? { inviteCode: configuredInviteCode } : {}),
      source: 'config',
    };
  }

  const inviteTargets = new Map<string, { workspaceId: string; inviteCode?: string }>();
  for (const employee of plan.employees) {
    for (const invite of employee.account.invites) {
      const parsedInvite = parseInviteWorkspaceContext(invite);
      if (!parsedInvite) continue;

      const existing = inviteTargets.get(parsedInvite.workspaceId);
      if (!existing) {
        inviteTargets.set(parsedInvite.workspaceId, parsedInvite);
      } else if (!existing.inviteCode && parsedInvite.inviteCode) {
        inviteTargets.set(parsedInvite.workspaceId, {
          workspaceId: existing.workspaceId,
          inviteCode: parsedInvite.inviteCode,
        });
      }
    }
  }

  if (inviteTargets.size === 1) {
    const inviteTarget = [...inviteTargets.values()][0];
    return {
      workspaceId: inviteTarget.workspaceId,
      ...(inviteTarget.inviteCode ? { inviteCode: inviteTarget.inviteCode } : {}),
      source: 'invite',
    };
  }

  return {
    workspaceId: stableId('ws', plan.companyId, plan.workspaceName),
    source: 'derived',
  };
}

function resolveCompanyWorkspaceRootFromAccount(account: ResolvedDecentChatAccount): string | undefined {
  const manifestPath = account.companySim?.manifestPath?.trim();
  if (!manifestPath) return undefined;

  const resolvedManifestPath = resolveCompanyManifestPath(manifestPath);
  const companyDir = dirname(resolvedManifestPath);
  const companySimsDir = dirname(companyDir);
  return dirname(companySimsDir);
}

function resolveAccountDataDir(account: ResolvedDecentChatAccount): string {
  if (!account.dataDir?.trim()) return DEFAULT_DATA_DIR;
  const trimmed = account.dataDir.trim();
  if (isAbsolute(trimmed)) return trimmed;

  const workspaceRootDir = resolveCompanyWorkspaceRootFromAccount(account);
  return resolve(workspaceRootDir ?? process.cwd(), trimmed);
}

function readWorkspaces(dataDir: string): any[] {
  const filePath = join(dataDir, 'workspaces.json');
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeWorkspaces(dataDir: string, workspaces: any[]): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'workspaces.json'), JSON.stringify(workspaces, null, 2), 'utf8');
}

export function buildCompanyBootstrapPlan(params: {
  manifestPath: string;
  resolveAccount: (accountId: string) => ResolvedDecentChatAccount;
  accountIds?: string[];
}): CompanyBootstrapPlan {
  const manifest = parseCompanyManifestFile(params.manifestPath);
  const accountIdSet = params.accountIds ? new Set(params.accountIds.map((id) => id.trim()).filter(Boolean)) : null;
  const missingAccountIds = new Set<string>();

  const employees: CompanyBootstrapEmployee[] = [];
  for (const employee of manifest.employees) {
    if (accountIdSet && !accountIdSet.has(employee.accountId)) {
      missingAccountIds.add(employee.accountId);
      continue;
    }

    const account = params.resolveAccount(employee.accountId);
    if (!account.configured) {
      missingAccountIds.add(employee.accountId);
      continue;
    }

    employees.push({
      employeeId: employee.id,
      accountId: employee.accountId,
      alias: employee.alias,
      title: employee.title,
      teamId: employee.teamId,
      channels: employee.channels,
      account,
    });
  }

  if (missingAccountIds.size > 0) {
    const missingList = [...missingAccountIds].sort((a, b) => a.localeCompare(b)).join(', ');
    throw new Error(`Company bootstrap requires configured accounts for employees: ${missingList}`);
  }

  return {
    companyId: manifest.id,
    companyName: manifest.name,
    workspaceName: manifest.workspace.name,
    channels: manifest.workspace.channels,
    employees,
  };
}

export async function ensureCompanyBootstrapRuntime(params: {
  manifestPath: string;
  resolveAccount: (accountId: string) => ResolvedDecentChatAccount;
  accountIds?: string[];
  log?: { info?: (message: string) => void };
}): Promise<CompanyBootstrapRuntimeResult> {
  const manifestPath = resolveCompanyManifestPath(params.manifestPath);
  const plan = buildCompanyBootstrapPlan({
    manifestPath,
    resolveAccount: params.resolveAccount,
    accountIds: params.accountIds,
  });

  const workspaceTarget = resolveWorkspaceBootstrapTarget(plan);
  const workspaceId = workspaceTarget.workspaceId;
  const derivedWorkspaceId = stableId('ws', plan.companyId, plan.workspaceName);
  const staleSyntheticWorkspaceId = workspaceTarget.source !== 'derived' && derivedWorkspaceId !== workspaceId
    ? derivedWorkspaceId
    : undefined;
  const workspaceChannels = uniqueStrings(plan.channels);
  const channelIds = Object.fromEntries(
    workspaceChannels.map((channelName) => [channelName, stableId('ch', workspaceId, channelName)]),
  );

  const seedManager = new SeedPhraseManager();
  const identities = await Promise.all(plan.employees.map(async (employee) => {
    const seedPhrase = employee.account.seedPhrase?.trim();
    if (!seedPhrase) {
      throw new Error(`Company bootstrap requires seed phrase for account ${employee.accountId}`);
    }
    const keys = await seedManager.deriveKeys(seedPhrase);
    const peerId = await seedManager.derivePeerId(seedPhrase);
    const spki = await crypto.subtle.exportKey('spki', keys.ecdhKeyPair.publicKey);
    const publicKey = Buffer.from(spki).toString('base64');
    return {
      ...employee,
      peerId,
      publicKey,
    };
  }));

  const ownerPeerId = identities[0]?.peerId;
  if (!ownerPeerId) {
    throw new Error('Company bootstrap manifest has no employees');
  }

  const channelMembershipByName = new Map<string, string[]>();
  for (const channelName of workspaceChannels) {
    const members = identities
      .filter((employee) => employee.channels.includes(channelName))
      .map((employee) => employee.peerId);
    channelMembershipByName.set(channelName, uniqueStrings(members));
  }

  for (const identity of identities) {
    const dataDir = resolveAccountDataDir(identity.account);
    let workspaces = readWorkspaces(dataDir);

    if (staleSyntheticWorkspaceId) {
      workspaces = workspaces.filter(
        (workspace) => !(workspace && typeof workspace === 'object' && workspace.id === staleSyntheticWorkspaceId),
      );
    }

    const workspaceById = workspaces.find((workspace) => workspace && typeof workspace === 'object' && workspace.id === workspaceId);
    const workspaceByName = workspaceTarget.source === 'derived'
      ? workspaces
        .filter((workspace) => workspace && typeof workspace === 'object' && workspace.name === plan.workspaceName)
        .sort((a, b) => Number(a?.createdAt ?? 0) - Number(b?.createdAt ?? 0))[0]
      : undefined;

    const workspace = workspaceById ?? workspaceByName ?? {
      id: workspaceId,
      name: plan.workspaceName,
      inviteCode: workspaceTarget.inviteCode ?? inviteCodeForWorkspace(workspaceId),
      createdBy: ownerPeerId,
      createdAt: Date.now(),
      members: [],
      channels: [],
      permissions: {
        whoCanCreateChannels: 'everyone',
        whoCanInviteMembers: 'everyone',
        revokedInviteIds: [],
      },
      bans: [],
    };

    if (!Array.isArray(workspace.members)) workspace.members = [];
    if (!Array.isArray(workspace.channels)) workspace.channels = [];
    if (!readNonEmptyString(workspace.inviteCode)) {
      workspace.inviteCode = workspaceTarget.inviteCode ?? inviteCodeForWorkspace(workspaceId);
    }

    const memberByPeerId = new Map<string, any>();
    for (const member of workspace.members) {
      if (!member || typeof member !== 'object' || typeof member.peerId !== 'string') continue;
      if (!memberByPeerId.has(member.peerId)) {
        memberByPeerId.set(member.peerId, member);
      }
    }

    for (const employee of identities) {
      const existing = memberByPeerId.get(employee.peerId) ?? {
        peerId: employee.peerId,
        joinedAt: Date.now(),
      };
      existing.alias = employee.alias;
      existing.publicKey = employee.publicKey;
      existing.role = existing.role ?? (employee.peerId === ownerPeerId ? 'owner' : 'member');
      existing.isBot = true;
      existing.companySim = {
        automationKind: 'openclaw-agent',
        roleTitle: employee.title,
        teamId: employee.teamId,
      };
      memberByPeerId.set(employee.peerId, existing);
    }
    workspace.members = [...memberByPeerId.values()];

    for (const channelName of workspaceChannels) {
      const channelId = channelIds[channelName];
      const existingChannel = workspace.channels.find((channel: any) => channel?.id === channelId)
        ?? workspace.channels.find((channel: any) => channel?.name === channelName && channel?.type === 'channel');

      const channel = existingChannel ?? {
        id: channelId,
        workspaceId: workspace.id,
        name: channelName,
        type: 'channel',
        members: [],
        createdBy: ownerPeerId,
        createdAt: Date.now(),
      };

      channel.id = channel.id ?? channelId;
      channel.workspaceId = workspace.id;
      channel.name = channelName;
      channel.type = 'channel';

      const existingMembers = Array.isArray(channel.members) ? channel.members : [];
      const joinedMembers = channelMembershipByName.get(channelName) ?? [];
      const memberSet = new Set<string>(existingMembers.filter((memberId: unknown): memberId is string => typeof memberId === 'string'));
      for (const memberId of joinedMembers) memberSet.add(memberId);
      channel.members = [...memberSet];
      channel.accessPolicy = {
        mode: 'explicit',
        explicitMemberPeerIds: [...memberSet],
      };

      if (!existingChannel) {
        workspace.channels.push(channel);
      }
    }

    const workspaceIndex = workspaces.findIndex((existingWorkspace) => existingWorkspace?.id === workspace.id);
    if (workspaceIndex >= 0) {
      workspaces[workspaceIndex] = workspace;
    } else {
      workspaces.push(workspace);
    }

    writeWorkspaces(dataDir, workspaces);
  }

  const memberPeerIds = Object.fromEntries(identities.map((employee) => [employee.accountId, employee.peerId]));

  params.log?.info?.(
    `[decentchat] company bootstrap ready company=${plan.companyId} workspace=${workspaceId} accounts=${identities.length}`,
  );

  return {
    manifestPath,
    workspaceId,
    workspaceName: plan.workspaceName,
    channelIds,
    memberPeerIds,
    accountIds: identities.map((identity) => identity.accountId),
  };
}
