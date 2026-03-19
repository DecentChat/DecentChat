import type { CompanyAgentTopologyPlan } from './agent-topology.ts';

export interface MaterializeCompanyOpenClawConfigParams<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  config: TConfig;
  topology: CompanyAgentTopologyPlan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findManagedEntryIndexes(params: {
  list: unknown[];
  predicate: (entry: unknown) => boolean;
}): number[] {
  const indexes: number[] = [];
  for (const [index, entry] of params.list.entries()) {
    if (params.predicate(entry)) {
      indexes.push(index);
    }
  }
  return indexes;
}

function removeIndexes(list: unknown[], indexes: number[]): unknown[] {
  const sorted = [...indexes].sort((a, b) => b - a);
  for (const index of sorted) {
    list.splice(index, 1);
  }
  return list;
}

function ensureManifestAccountsConfigured(params: {
  config: Record<string, unknown>;
  topology: CompanyAgentTopologyPlan;
}): void {
  const channels = isRecord(params.config.channels) ? params.config.channels : undefined;
  const decentchat = channels && isRecord(channels.decentchat) ? channels.decentchat : undefined;
  const accounts = decentchat && isRecord(decentchat.accounts) ? decentchat.accounts : undefined;

  const missingAccountIds = new Set<string>();
  for (const agent of params.topology.agents) {
    if (!accounts || !Object.prototype.hasOwnProperty.call(accounts, agent.accountId)) {
      missingAccountIds.add(agent.accountId);
    }
  }

  if (missingAccountIds.size === 0) {
    return;
  }

  const missingList = [...missingAccountIds].sort((a, b) => a.localeCompare(b)).join(', ');
  throw new Error(
    `Company manifest references DecentChat accountIds that are not configured under channels.decentchat.accounts: ${missingList}`,
  );
}

function isRouteBindingForKey(params: {
  binding: unknown;
  channel: string;
  accountId: string;
}): boolean {
  if (!isRecord(params.binding)) {
    return false;
  }

  const type = typeof params.binding.type === 'string' ? params.binding.type : undefined;
  if (type && type !== 'route') {
    return false;
  }

  const match = isRecord(params.binding.match) ? params.binding.match : undefined;
  return match?.channel === params.channel && match?.accountId === params.accountId;
}

export function materializeCompanyOpenClawConfig<TConfig extends Record<string, unknown>>(
  params: MaterializeCompanyOpenClawConfigParams<TConfig>,
): TConfig {
  ensureManifestAccountsConfigured({
    config: params.config,
    topology: params.topology,
  });

  const nextConfig: Record<string, unknown> = {
    ...params.config,
  };

  const existingAgents = isRecord(params.config.agents) ? params.config.agents : undefined;
  const agentsList = Array.isArray(existingAgents?.list)
    ? [...existingAgents.list]
    : [];

  for (const plannedAgent of params.topology.agents) {
    const managedIndexes = findManagedEntryIndexes({
      list: agentsList,
      predicate: (entry) => isRecord(entry) && entry.id === plannedAgent.agentId,
    });

    const currentEntry = managedIndexes.length > 0 && isRecord(agentsList[managedIndexes[0]!])
      ? agentsList[managedIndexes[0]!] as Record<string, unknown>
      : {};

    const nextEntry: Record<string, unknown> = {
      ...currentEntry,
      id: plannedAgent.agentId,
      workspace: plannedAgent.workspace.path,
    };

    if (managedIndexes.length === 0) {
      agentsList.push(nextEntry);
      continue;
    }

    agentsList[managedIndexes[0]!] = nextEntry;
    if (managedIndexes.length > 1) {
      removeIndexes(agentsList, managedIndexes.slice(1));
    }
  }

  nextConfig.agents = {
    ...(existingAgents ?? {}),
    list: agentsList,
  };

  const bindings = Array.isArray(params.config.bindings)
    ? [...params.config.bindings]
    : [];

  const plannedRouteByKey = new Map<string, { channel: string; accountId: string; agentId: string }>();
  for (const agent of params.topology.agents) {
    for (const binding of agent.bindings) {
      const key = `${binding.channel}:${binding.accountId}`;
      const existing = plannedRouteByKey.get(key);
      if (existing && existing.agentId !== agent.agentId) {
        throw new Error(
          `Company manifest produces conflicting bindings for ${key}: ${existing.agentId} vs ${agent.agentId}`,
        );
      }
      plannedRouteByKey.set(key, {
        channel: binding.channel,
        accountId: binding.accountId,
        agentId: agent.agentId,
      });
    }
  }

  for (const route of plannedRouteByKey.values()) {
    const managedIndexes = findManagedEntryIndexes({
      list: bindings,
      predicate: (entry) => isRouteBindingForKey({
        binding: entry,
        channel: route.channel,
        accountId: route.accountId,
      }),
    });

    const existingBinding = managedIndexes.length > 0 && isRecord(bindings[managedIndexes[0]!])
      ? bindings[managedIndexes[0]!] as Record<string, unknown>
      : {};
    const existingMatch = isRecord(existingBinding.match) ? existingBinding.match : {};

    const nextBinding: Record<string, unknown> = {
      ...existingBinding,
      type: 'route',
      agentId: route.agentId,
      match: {
        ...existingMatch,
        channel: route.channel,
        accountId: route.accountId,
      },
    };

    if (managedIndexes.length === 0) {
      bindings.push(nextBinding);
      continue;
    }

    bindings[managedIndexes[0]!] = nextBinding;
    if (managedIndexes.length > 1) {
      removeIndexes(bindings, managedIndexes.slice(1));
    }
  }

  nextConfig.bindings = bindings;

  return nextConfig as TConfig;
}
