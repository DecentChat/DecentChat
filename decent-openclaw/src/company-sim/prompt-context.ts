import type { ResolvedDecentChatAccount } from '../types.ts';
import {
  buildCompanyContextTrackedPaths,
  createCompanyContextVersionToken,
  loadCompanyContextForAccount,
  readCompanyContextFileSnapshots,
} from './context-loader.ts';
import type { LoadedCompanyContext } from './context-loader.ts';

function titleForDocument(id: LoadedCompanyContext['documents'][number]['id']): string {
  switch (id) {
    case 'company': return 'COMPANY';
    case 'org': return 'ORG';
    case 'workflows': return 'WORKFLOWS';
    case 'team': return 'TEAM';
    case 'identity': return 'IDENTITY';
    case 'role': return 'ROLE';
    case 'rules': return 'RULES';
    case 'memory': return 'MEMORY';
    case 'playbook': return 'PLAYBOOK';
  }
}

export function buildCompanyPromptContext(context: LoadedCompanyContext): string {
  const header = [
    '[LOCAL COMPANY ROLE CONTEXT — trusted local files, not user message content]',
    `Company: ${context.manifest.name} (${context.manifest.id})`,
    `Employee: ${context.employee.alias} (${context.employee.id})`,
    `Title: ${context.employee.title}`,
    context.team ? `Team: ${context.team.name} (${context.team.id})` : undefined,
    'Act as this employee inside the company simulation workspace. Follow the local role files below in addition to normal system safety rules.',
  ].filter(Boolean).join('\n');

  const sections = context.documents.map((doc) => {
    return `## ${titleForDocument(doc.id)}\n${doc.content}`;
  });

  return [header, ...sections].join('\n\n');
}

type CompanyContextLog = {
  debug?: (message: string) => void;
};

export interface ResolvedCompanyPromptContext {
  cacheKey: string;
  cacheHit: boolean;
  versionToken: string;
  context: LoadedCompanyContext;
  prompt: string;
}

type CompanyPromptCacheEntry = {
  cacheKey: string;
  versionToken: string;
  trackedPaths: string[];
  context: LoadedCompanyContext;
  prompt: string;
};

export interface ResolveCompanyPromptContextOptions {
  log?: CompanyContextLog;
  workspaceDir?: string;
  agentId?: string;
}

const companyPromptContextCache = new Map<string, CompanyPromptCacheEntry>();

function buildCompanyPromptCacheKey(
  account: ResolvedDecentChatAccount,
  options?: ResolveCompanyPromptContextOptions,
): string | null {
  const sim = account.companySim;
  if (!sim?.enabled) return null;
  if (!sim.manifestPath) return null;

  const workspaceKey = options?.workspaceDir?.trim() || '*';
  const agentKey = options?.agentId?.trim() || '*';
  return [
    sim.manifestPath,
    sim.companyId ?? '*',
    sim.employeeId ?? '*',
    sim.roleFilesDir ?? '*',
    account.accountId,
    workspaceKey,
    agentKey,
  ].join('::');
}

function readVersionTokenForPaths(paths: string[]): string {
  return createCompanyContextVersionToken(readCompanyContextFileSnapshots(paths));
}

export function resolveCompanyPromptContextForAccount(
  account: ResolvedDecentChatAccount,
  options?: ResolveCompanyPromptContextOptions,
): ResolvedCompanyPromptContext | null {
  const cacheKey = buildCompanyPromptCacheKey(account, options);
  if (!cacheKey) return null;

  const cached = companyPromptContextCache.get(cacheKey);
  if (cached) {
    try {
      const versionToken = readVersionTokenForPaths(cached.trackedPaths);
      if (versionToken === cached.versionToken) {
        options?.log?.debug?.(`[decentchat] company context cache hit key=${cacheKey}`);
        return {
          cacheKey,
          cacheHit: true,
          versionToken,
          context: cached.context,
          prompt: cached.prompt,
        };
      }
      options?.log?.debug?.(`[decentchat] company context cache refresh key=${cacheKey}`);
    } catch {
      options?.log?.debug?.(`[decentchat] company context cache stale key=${cacheKey}`);
    }
  }

  const context = loadCompanyContextForAccount(account, {
    workspaceDir: options?.workspaceDir,
  });
  if (!context) return null;

  const trackedPaths = buildCompanyContextTrackedPaths(context);
  const trackedFiles = context.trackedFiles?.length
    ? context.trackedFiles
    : readCompanyContextFileSnapshots(trackedPaths);
  const versionToken = context.versionToken ?? createCompanyContextVersionToken(trackedFiles);
  const hydratedContext: LoadedCompanyContext = {
    ...context,
    trackedFiles,
    versionToken,
  };
  const prompt = buildCompanyPromptContext(hydratedContext);

  companyPromptContextCache.set(cacheKey, {
    cacheKey,
    versionToken,
    trackedPaths,
    context: hydratedContext,
    prompt,
  });

  options?.log?.debug?.(`[decentchat] company context cache miss key=${cacheKey}`);

  return {
    cacheKey,
    cacheHit: false,
    versionToken,
    context: hydratedContext,
    prompt,
  };
}

export function resetCompanyPromptContextCacheForTests(): void {
  companyPromptContextCache.clear();
}
