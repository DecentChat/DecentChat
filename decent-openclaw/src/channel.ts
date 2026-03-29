import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChannelPlugin, ChannelSetupWizard, ChannelSetupInput, OpenClawConfig } from "openclaw/plugin-sdk";
import { createStandardChannelSetupStatus, patchTopLevelChannelConfigSection, createTopLevelChannelDmPolicy } from "openclaw/plugin-sdk/setup";
import { z } from "zod";

import { assertCompanyBootstrapAgentInstallation, ensureCompanyBootstrapRuntime, resolveCompanyManifestPath } from "@decentchat/company-sim";
import { SeedPhraseManager } from "@decentchat/protocol";
import { startDecentChatPeer } from "./monitor.js";
import { getActivePeer, listActivePeerAccountIds } from "./peer-registry.js";
import { buildDecentChatRuntimeBootstrapKey, invalidateDecentChatBootstrapKey, runDecentChatBootstrapOnce } from "./runtime.js";
import type { DecentChatChannelConfig, OpenClawConfigShape, ResolvedDecentChatAccount } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";
const DECENTCHAT_STARTUP_STAGGER_MS = 6_000;

function sanitizeDecentChatAccountPathSegment(accountId: string): string {
  const sanitized = accountId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return sanitized || DEFAULT_ACCOUNT_ID;
}

function resolveDecentChatDataDir(cfg: any, accountId: string, configuredDataDir: unknown): string | undefined {
  if (typeof configuredDataDir === "string" && configuredDataDir.trim()) {
    return configuredDataDir.trim();
  }

  const accountIds = listDecentChatAccountIds(cfg);
  if (accountIds.length === 1 && accountIds[0] === DEFAULT_ACCOUNT_ID && accountId === DEFAULT_ACCOUNT_ID) {
    return undefined;
  }

  return join(homedir(), ".openclaw", "data", "decentchat", sanitizeDecentChatAccountPathSegment(accountId));
}

function formatPairingApproveHint(channelId: string): string {
  return `Approve via: \`openclaw pairing list ${channelId}\` / \`openclaw pairing approve ${channelId} <code>\``;
}

function buildChannelConfigSchema(schema: z.ZodTypeAny): { schema: Record<string, unknown> } {
  const schemaWithJson = schema as z.ZodTypeAny & {
    toJSONSchema?: (opts?: { target?: string; unrepresentable?: string }) => Record<string, unknown>;
  };
  if (typeof schemaWithJson.toJSONSchema === "function") {
    return {
      schema: schemaWithJson.toJSONSchema({
        target: "draft-07",
        unrepresentable: "any",
      }),
    };
  }
  return {
    schema: {
      type: "object",
      additionalProperties: true,
    },
  };
}

const DecentChatConfigSchema = z.object({
  enabled: z.boolean().optional(),
  seedPhrase: z.string().optional(),
  signalingServer: z.string().optional(),
  invites: z.array(z.string()).optional(),
  alias: z.string().optional().default("DecentChat Bot"),
  dataDir: z.string().optional(),
  streamEnabled: z.boolean().optional().default(true),
  dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).optional().default("open"),
  defaultAccount: z.string().optional(),
  replyToMode: z.enum(["off", "first", "all"]).optional().default("all"),
  // Flattened from replyToModeByChatType object (Control UI can't render nested objects)
  replyToModeDirect: z.enum(["off", "first", "all"]).optional(),
  replyToModeGroup: z.enum(["off", "first", "all"]).optional(),
  replyToModeChannel: z.enum(["off", "first", "all"]).optional(),
  // Flattened from thread object
  threadHistoryScope: z.enum(["thread", "channel"]).optional().default("thread"),
  threadInheritParent: z.boolean().optional().default(false),
  threadInitialHistoryLimit: z.number().int().min(0).optional().default(20),
  companySimBootstrapEnabled: z.boolean().optional().default(false),
  companySimBootstrapMode: z.enum(["runtime", "off"]).optional().default("runtime"),
  companySimBootstrapManifestPath: z.string().optional(),
  companySimBootstrapTargetWorkspaceId: z.string().optional(),
  companySimBootstrapTargetInviteCode: z.string().optional(),
  // Legacy nested forms still accepted at runtime via passthrough
  // (resolveDecentChatAccount reads ch.replyToModeByChatType, ch.thread, ch.channels)
  // but excluded from schema so Control UI can render all fields cleanly.
}).passthrough();

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getDecentChatChannelConfig(cfg: any): DecentChatChannelConfig {
  const ch = cfg?.channels?.decentchat;
  return isRecord(ch) ? (ch as DecentChatChannelConfig) : {};
}

export function listDecentChatAccountIds(cfg: any): string[] {
  const channelCfg = getDecentChatChannelConfig(cfg);
  const accounts = channelCfg.accounts;
  if (!isRecord(accounts)) return [DEFAULT_ACCOUNT_ID];
  const ids = Object.keys(accounts).map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return [DEFAULT_ACCOUNT_ID];
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultDecentChatAccountId(cfg: any): string {
  const channelCfg = getDecentChatChannelConfig(cfg);
  const ids = listDecentChatAccountIds(cfg);
  const preferred = typeof channelCfg.defaultAccount === "string" ? channelCfg.defaultAccount.trim() : "";
  if (preferred && ids.includes(preferred)) return preferred;
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function listDecentChatStartupAccountIds(cfg: any): string[] {
  const ids = listDecentChatAccountIds(cfg);
  if (!ids.includes(DEFAULT_ACCOUNT_ID)) {
    return ids;
  }

  return [
    DEFAULT_ACCOUNT_ID,
    ...ids.filter((accountId) => accountId !== DEFAULT_ACCOUNT_ID),
  ];
}

export function resolveDecentChatStartupDelayMs(cfg: any, accountId?: string | null): number {
  const resolvedAccountId = accountId?.trim() || resolveDefaultDecentChatAccountId(cfg);
  const startupOrder = listDecentChatStartupAccountIds(cfg);
  const startupIndex = startupOrder.indexOf(resolvedAccountId);
  if (startupIndex <= 0) {
    return 0;
  }

  return startupIndex * DECENTCHAT_STARTUP_STAGGER_MS;
}

async function waitForDecentChatStartupSlot(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(new Error("DecentChat startup aborted"));
    };

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }

    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function buildCompanyBootstrapRuntimeScope(cfg: any, manifestPath: string): string {
  const accounts = listDecentChatAccountIds(cfg).map((accountId) => {
    const account = resolveDecentChatAccount(cfg, accountId);
    const bootstrap = account.companySimBootstrap;
    return {
      accountId,
      seedFingerprint: account.seedPhrase
        ? createHash('sha256').update(account.seedPhrase).digest('hex').slice(0, 16)
        : '',
      dataDir: account.dataDir?.trim() ?? '',
      companySimManifestPath: account.companySim?.manifestPath?.trim() ?? '',
      invites: normalizeStringList(account.invites),
      bootstrap: bootstrap ? {
        enabled: bootstrap.enabled !== false,
        mode: bootstrap.mode,
        manifestPath: bootstrap.manifestPath?.trim() ?? '',
        targetWorkspaceId: bootstrap.targetWorkspaceId?.trim() ?? '',
        targetInviteCode: bootstrap.targetInviteCode?.trim() ?? '',
      } : null,
    };
  });

  return createHash('sha256')
    .update(JSON.stringify({ manifestPath, accounts }))
    .digest('hex')
    .slice(0, 20);
}

function mergeObject<T extends Record<string, any> | undefined>(base: T, override: T): T | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  } as T;
}

function resolveRawDecentChatAccountConfig(cfg: any, accountId?: string | null): DecentChatChannelConfig {
  const channelCfg = getDecentChatChannelConfig(cfg);
  const resolvedAccountId = (accountId?.trim() || resolveDefaultDecentChatAccountId(cfg));
  const accounts = isRecord(channelCfg.accounts) ? channelCfg.accounts : undefined;
  const accountCfg = accounts && isRecord(accounts[resolvedAccountId])
    ? accounts[resolvedAccountId] as DecentChatChannelConfig
    : undefined;

  const {
    accounts: _accounts,
    defaultAccount: _defaultAccount,
    ...base
  } = channelCfg;
  const inheritRootStartupConfig = !accounts || resolvedAccountId === DEFAULT_ACCOUNT_ID;

  return {
    ...base,
    ...(accountCfg ?? {}),
    invites: inheritRootStartupConfig ? (accountCfg?.invites ?? base.invites) : accountCfg?.invites,
    channels: mergeObject(base.channels, accountCfg?.channels),
    replyToModeByChatType: mergeObject(base.replyToModeByChatType, accountCfg?.replyToModeByChatType),
    thread: mergeObject(base.thread, accountCfg?.thread),
    huddle: mergeObject(base.huddle, accountCfg?.huddle),
    companySim: mergeObject(base.companySim, accountCfg?.companySim),
    companySimBootstrap: mergeObject(
      inheritRootStartupConfig ? base.companySimBootstrap : undefined,
      accountCfg?.companySimBootstrap,
    ),
    companySimBootstrapEnabled: inheritRootStartupConfig
      ? (accountCfg?.companySimBootstrapEnabled ?? base.companySimBootstrapEnabled)
      : accountCfg?.companySimBootstrapEnabled,
    companySimBootstrapMode: inheritRootStartupConfig
      ? (accountCfg?.companySimBootstrapMode ?? base.companySimBootstrapMode)
      : accountCfg?.companySimBootstrapMode,
    companySimBootstrapManifestPath: inheritRootStartupConfig
      ? (accountCfg?.companySimBootstrapManifestPath ?? base.companySimBootstrapManifestPath)
      : accountCfg?.companySimBootstrapManifestPath,
    companySimBootstrapTargetWorkspaceId: inheritRootStartupConfig
      ? (accountCfg?.companySimBootstrapTargetWorkspaceId ?? base.companySimBootstrapTargetWorkspaceId)
      : accountCfg?.companySimBootstrapTargetWorkspaceId,
    companySimBootstrapTargetInviteCode: inheritRootStartupConfig
      ? (accountCfg?.companySimBootstrapTargetInviteCode ?? base.companySimBootstrapTargetInviteCode)
      : accountCfg?.companySimBootstrapTargetInviteCode,
  };
}

export function normalizeDecentChatMessagingTarget(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;

  if (value.startsWith("decentchat:channel:")) {
    const channelId = value.slice("decentchat:channel:".length).trim();
    return channelId ? `decentchat:channel:${channelId}` : undefined;
  }

  if (value.startsWith("channel:")) {
    const channelId = value.slice("channel:".length).trim();
    return channelId ? `decentchat:channel:${channelId}` : undefined;
  }

  if (value.startsWith("decentchat:")) {
    const rest = value.slice("decentchat:".length).trim();
    if (!rest) return undefined;
    if (rest.startsWith("channel:")) {
      const channelId = rest.slice("channel:".length).trim();
      return channelId ? `decentchat:channel:${channelId}` : undefined;
    }
    return `decentchat:${rest}`;
  }

  return `decentchat:${value}`;
}

const DECENTCHAT_CHANNEL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECENTCHAT_PEER_ID_RE = /^[0-9a-f]{18}$/i;
const DECENTCHAT_TEST_PEER_ID_RE = /^peer-[a-z0-9-]+$/i;

type DecentChatTargetCandidate = {
  kind: "user" | "group";
  id: string;
  name?: string;
  handle?: string;
  rank?: number;
};

type DecentChatResolvedTarget = {
  to: string;
  kind: "user" | "group" | "channel";
  display?: string;
  source: "normalized" | "directory";
};

function looksLikeBareDecentChatPeerId(value: string): boolean {
  return DECENTCHAT_PEER_ID_RE.test(value) || DECENTCHAT_TEST_PEER_ID_RE.test(value);
}

function normalizeDecentChatLookupValue(value: string | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase()
    .replace(/^decentchat:channel:/, "")
    .replace(/^decentchat:/, "")
    .replace(/^channel:/, "")
    .replace(/^[@#]/, "")
    .trim();
}

function scoreDecentChatTargetCandidate(candidate: DecentChatTargetCandidate, query: string): number {
  const fields = [candidate.name, candidate.handle, candidate.id];
  let best = -1;
  for (const field of fields) {
    const normalizedField = normalizeDecentChatLookupValue(field);
    if (!normalizedField) continue;
    if (normalizedField === query) return 300;
    if (normalizedField.startsWith(query)) best = Math.max(best, 200);
    else if (normalizedField.includes(query)) best = Math.max(best, 100);
  }
  return best;
}

function pickUniqueDecentChatCandidate(candidates: DecentChatTargetCandidate[], query: string): DecentChatTargetCandidate | null {
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreDecentChatTargetCandidate(candidate, query) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || (b.candidate.rank ?? 0) - (a.candidate.rank ?? 0) || (a.candidate.name ?? a.candidate.id).localeCompare(b.candidate.name ?? b.candidate.id));

  if (scored.length === 0) return null;
  const bestScore = scored[0]?.score ?? -1;
  const best = scored.filter((item) => item.score == bestScore);
  if (best.length !== 1) return null;
  return best[0]?.candidate ?? null;
}

function buildDecentChatResolvedTarget(candidate: DecentChatTargetCandidate): DecentChatResolvedTarget {
  return {
    to: candidate.kind === "group"
      ? (candidate.id.startsWith("decentchat:channel:") ? candidate.id : `decentchat:channel:${candidate.id}`)
      : (candidate.id.startsWith("decentchat:") ? candidate.id : `decentchat:${candidate.id}`),
    kind: candidate.kind,
    display: candidate.name ?? candidate.handle ?? candidate.id,
    source: "directory",
  };
}

function resolveDecentChatTargetFromActivePeer(raw: string, accountId?: string | null, preferredKind?: "user" | "group" | "channel"): DecentChatResolvedTarget | null {
  const query = normalizeDecentChatLookupValue(raw);
  if (!query) return null;

  const peer = getActivePeer(accountId?.trim() || DEFAULT_ACCOUNT_ID);
  if (!peer) return null;

  const peerMatches = peer.listDirectoryPeersLive({ query, limit: 50 }) as DecentChatTargetCandidate[];
  const groupMatches = peer.listDirectoryGroupsLive({ query, limit: 50 }) as DecentChatTargetCandidate[];

  const userCandidate = pickUniqueDecentChatCandidate(peerMatches, query);
  const groupCandidate = pickUniqueDecentChatCandidate(groupMatches, query);

  if (preferredKind === "user") return userCandidate ? buildDecentChatResolvedTarget(userCandidate) : null;
  if (preferredKind === "group" || preferredKind === "channel") return groupCandidate ? buildDecentChatResolvedTarget(groupCandidate) : null;

  if (userCandidate && !groupCandidate) return buildDecentChatResolvedTarget(userCandidate);
  if (groupCandidate && !userCandidate) return buildDecentChatResolvedTarget(groupCandidate);
  if (userCandidate && groupCandidate) return buildDecentChatResolvedTarget(userCandidate);
  return null;
}

async function resolveDecentChatTarget(params: {
  accountId?: string | null;
  input: string;
  normalized: string;
  preferredKind?: "user" | "group" | "channel";
}): Promise<DecentChatResolvedTarget | null> {
  const rawValue = params.input.trim();
  if (!rawValue) return null;

  if (rawValue.startsWith("channel:")) {
    const channelId = rawValue.slice("channel:".length).trim();
    return channelId ? { to: `decentchat:channel:${channelId}`, kind: "group", display: channelId, source: "normalized" } : null;
  }

  if (rawValue.startsWith("decentchat:channel:")) {
    const channelId = rawValue.slice("decentchat:channel:".length).trim();
    return channelId ? { to: `decentchat:channel:${channelId}`, kind: "group", display: channelId, source: "normalized" } : null;
  }

  if (rawValue.startsWith("decentchat:")) {
    const rest = rawValue.slice("decentchat:".length).trim();
    if (!rest) return null;
    if (rest.startsWith("channel:")) {
      const channelId = rest.slice("channel:".length).trim();
      return channelId ? { to: `decentchat:channel:${channelId}`, kind: "group", display: channelId, source: "normalized" } : null;
    }
    return { to: `decentchat:${rest}`, kind: "user", display: rest, source: "normalized" };
  }

  if (DECENTCHAT_CHANNEL_ID_RE.test(rawValue)) {
    return { to: `decentchat:channel:${rawValue}`, kind: "group", display: rawValue, source: "normalized" };
  }

  if (looksLikeBareDecentChatPeerId(rawValue)) {
    return { to: `decentchat:${rawValue}`, kind: "user", display: rawValue, source: "normalized" };
  }

  return resolveDecentChatTargetFromActivePeer(rawValue, params.accountId, params.preferredKind);
}

export function looksLikeDecentChatTargetId(raw: string, normalized?: string): boolean {
  const rawValue = raw.trim();
  const normalizedValue = (normalized ?? raw).trim();
  if (!rawValue && !normalizedValue) return false;

  if (rawValue.startsWith("channel:")) return true;
  if (rawValue.startsWith("decentchat:channel:")) return true;
  if (rawValue.startsWith("decentchat:")) return true;

  if (DECENTCHAT_CHANNEL_ID_RE.test(rawValue)) return true;
  if (looksLikeBareDecentChatPeerId(rawValue)) return true;

  const accountIds = listActivePeerAccountIds();
  if (accountIds.length === 0) return false;
  return accountIds.some((accountId) => !!resolveDecentChatTargetFromActivePeer(rawValue, accountId));
}

export function resolveDecentChatAccount(cfg: any, accountId?: string | null): ResolvedDecentChatAccount {
  const ch = resolveRawDecentChatAccountConfig(cfg, accountId);
  const resolvedAccountId = accountId?.trim() || resolveDefaultDecentChatAccountId(cfg);
  const seedPhrase = typeof ch.seedPhrase === "string" ? ch.seedPhrase : undefined;
  const bootstrapEnabledRaw = (ch as any).companySimBootstrapEnabled ?? ch.companySimBootstrap?.enabled;
  const bootstrapModeRaw = (ch as any).companySimBootstrapMode ?? ch.companySimBootstrap?.mode;
  const bootstrapManifestPathRaw = (ch as any).companySimBootstrapManifestPath ?? ch.companySimBootstrap?.manifestPath;
  const bootstrapTargetWorkspaceIdRaw = (ch as any).companySimBootstrapTargetWorkspaceId ?? ch.companySimBootstrap?.targetWorkspaceId;
  const bootstrapTargetInviteCodeRaw = (ch as any).companySimBootstrapTargetInviteCode ?? ch.companySimBootstrap?.targetInviteCode;
  const hasBootstrapConfig = bootstrapEnabledRaw !== undefined
    || bootstrapModeRaw !== undefined
    || typeof bootstrapManifestPathRaw === "string"
    || typeof bootstrapTargetWorkspaceIdRaw === "string"
    || typeof bootstrapTargetInviteCodeRaw === "string";

  return {
    accountId: resolvedAccountId,
    enabled: ch.enabled !== false,
    dmPolicy: ch.dmPolicy ?? "open",
    configured: !!seedPhrase?.trim(),
    seedPhrase,
    signalingServer: ch.signalingServer ?? "https://decentchat.app/peerjs",
    invites: ch.invites ?? [],
    alias: ch.alias ?? "DecentChat Bot",
    dataDir: resolveDecentChatDataDir(cfg, resolvedAccountId, ch.dataDir),
    streamEnabled: ch.streamEnabled !== false,
    replyToMode: ch.replyToMode ?? "all",
    replyToModeByChatType: {
      direct: (ch as any).replyToModeDirect ?? ch.replyToModeByChatType?.direct,
      group: (ch as any).replyToModeGroup ?? ch.replyToModeByChatType?.group,
      channel: (ch as any).replyToModeChannel ?? ch.replyToModeByChatType?.channel,
    },
    thread: {
      historyScope: (ch as any).threadHistoryScope ?? ch.thread?.historyScope ?? "thread",
      inheritParent: (ch as any).threadInheritParent ?? ch.thread?.inheritParent ?? false,
      initialHistoryLimit: (ch as any).threadInitialHistoryLimit ?? ch.thread?.initialHistoryLimit ?? 20,
    },
    huddle: ch.huddle ? {
      enabled: ch.huddle.enabled,
      autoJoin: ch.huddle.autoJoin,
      sttEngine: ch.huddle.sttEngine,
      whisperModel: ch.huddle.whisperModel,
      sttLanguage: ch.huddle.sttLanguage,
      sttApiKey: ch.huddle.sttApiKey,
      ttsVoice: ch.huddle.ttsVoice,
      vadSilenceMs: ch.huddle.vadSilenceMs,
      vadThreshold: ch.huddle.vadThreshold,
    } : undefined,
    companySim: ch.companySim ? {
      enabled: ch.companySim.enabled !== false,
      manifestPath: ch.companySim.manifestPath,
      companyId: ch.companySim.companyId,
      employeeId: ch.companySim.employeeId,
      roleFilesDir: ch.companySim.roleFilesDir,
      silentChannelIds: Array.isArray(ch.companySim.silentChannelIds)
        ? normalizeStringList(ch.companySim.silentChannelIds.filter((value): value is string => typeof value === 'string'))
        : undefined,
    } : undefined,
    companySimBootstrap: hasBootstrapConfig ? {
      enabled: bootstrapEnabledRaw !== false,
      mode: bootstrapModeRaw === "off" ? "off" : "runtime",
      manifestPath: typeof bootstrapManifestPathRaw === "string" ? bootstrapManifestPathRaw : undefined,
      targetWorkspaceId: typeof bootstrapTargetWorkspaceIdRaw === "string" && bootstrapTargetWorkspaceIdRaw.trim()
        ? bootstrapTargetWorkspaceIdRaw.trim()
        : undefined,
      targetInviteCode: typeof bootstrapTargetInviteCodeRaw === "string" && bootstrapTargetInviteCodeRaw.trim()
        ? bootstrapTargetInviteCodeRaw.trim()
        : undefined,
    } : undefined,
  };
}

function getPeerForContext(cfg: any, accountId?: string | null) {
  const resolvedAccountId = accountId?.trim() || resolveDefaultDecentChatAccountId(cfg);
  return getActivePeer(resolvedAccountId);
}

export async function bootstrapDecentChatCompanySimForStartup(params: {
  cfg: any;
  accountId: string;
  account: ResolvedDecentChatAccount;
  log?: { info?: (message: string) => void; warn?: (message: string) => void; error?: (message: string) => void };
}): Promise<void> {
  const bootstrap = params.account.companySimBootstrap;
  if (!bootstrap?.enabled || bootstrap.mode === "off") return;

  const manifestPath = bootstrap.manifestPath?.trim();
  if (!manifestPath) {
    throw new Error(`Company bootstrap is enabled for account ${params.accountId} but companySimBootstrapManifestPath is missing`);
  }

  const resolvedManifestPath = resolveCompanyManifestPath(manifestPath);
  const runtimeScope = buildCompanyBootstrapRuntimeScope(params.cfg, resolvedManifestPath);

  await runDecentChatBootstrapOnce(buildDecentChatRuntimeBootstrapKey(resolvedManifestPath, runtimeScope), async () => {
    assertCompanyBootstrapAgentInstallation({
      manifestPath: resolvedManifestPath,
      cfg: params.cfg as OpenClawConfigShape,
    });

    await ensureCompanyBootstrapRuntime({
      manifestPath: resolvedManifestPath,
      accountIds: listDecentChatAccountIds(params.cfg),
      resolveAccount: (accountId) => resolveDecentChatAccount(params.cfg, accountId),
      log: params.log,
    });
  });
}

// ---------------------------------------------------------------------------
// Setup wizard (powers `openclaw configure`)
// ---------------------------------------------------------------------------

const CHANNEL = "decentchat";

let _seedPhraseManager: InstanceType<typeof SeedPhraseManager> | undefined;
function getSeedPhraseManager() {
  if (!_seedPhraseManager) _seedPhraseManager = new SeedPhraseManager();
  return _seedPhraseManager;
}

function validateSeedPhrase(mnemonic: string): string | undefined {
  const result = getSeedPhraseManager().validate(mnemonic);
  if (!result.valid) return result.error ?? "Invalid seed phrase";
  return undefined;
}

const decentChatSetupWizard: ChannelSetupWizard = {
  channel: CHANNEL,

  resolveAccountIdForConfigure: () => DEFAULT_ACCOUNT_ID,
  resolveShouldPromptAccountIds: () => false,

  status: createStandardChannelSetupStatus({
    channelLabel: "DecentChat",
    configuredLabel: "configured",
    unconfiguredLabel: "needs seed phrase",
    configuredHint: "configured",
    unconfiguredHint: "needs seed phrase",
    configuredScore: 1,
    unconfiguredScore: 0,
    includeStatusLine: true,
    resolveConfigured: ({ cfg }) => resolveDecentChatAccount(cfg).configured,
    resolveExtraStatusLines: ({ cfg }) => {
      const account = resolveDecentChatAccount(cfg);
      const lines: string[] = [];
      if (account.alias) lines.push(`Alias: ${account.alias}`);
      if (account.invites.length > 0) lines.push(`Invites: ${account.invites.length}`);
      return lines;
    },
  }),

  introNote: {
    title: "DecentChat setup",
    lines: [
      "DecentChat is a P2P encrypted messaging network.",
      "Your bot needs a 12-word BIP39 seed phrase to create its identity.",
      "You can generate a new one here or paste an existing one.",
    ],
  },

  stepOrder: "credentials-first",

  prepare: async ({ cfg, accountId, prompter }) => {
    const account = resolveDecentChatAccount(cfg, accountId);
    if (account.configured) return;

    const generateNew = await prompter.confirm({
      message: "Generate a new DecentChat identity?",
      initialValue: true,
    });

    if (generateNew) {
      const { mnemonic } = getSeedPhraseManager().generate();
      await prompter.note(
        [
          `Your new seed phrase:`,
          ``,
          `  ${mnemonic}`,
          ``,
          `Write this down and store it somewhere safe.`,
          `This is the only way to recover your bot's identity.`,
        ].join("\n"),
        "New identity generated",
      );
      // Write seedPhrase directly into cfg so it's persisted immediately.
      // The OpenClaw wizard framework skips applySet when shouldPrompt
      // returns false, so credentialValues alone won't reach the config file.
      const updatedCfg = patchTopLevelChannelConfigSection({
        cfg,
        channel: CHANNEL,
        enabled: true,
        patch: { seedPhrase: mnemonic },
      });
      return {
        cfg: updatedCfg,
        credentialValues: { privateKey: mnemonic },
      };
    }

    return;
  },

  credentials: [
    {
      inputKey: "privateKey" as keyof ChannelSetupInput,
      providerHint: CHANNEL,
      credentialLabel: "seed phrase",
      helpTitle: "DecentChat seed phrase",
      helpLines: [
        "A 12-word BIP39 mnemonic that determines your bot's identity on the network.",
        "All encryption keys are derived from this phrase.",
      ],
      envPrompt: "DECENTCHAT_SEED_PHRASE detected. Use env var?",
      keepPrompt: "Seed phrase already configured. Keep it?",
      inputPrompt: "DecentChat seed phrase (12 words)",
      preferredEnvVar: "DECENTCHAT_SEED_PHRASE",

      allowEnv: ({ accountId }) => accountId === DEFAULT_ACCOUNT_ID,

      inspect: ({ cfg, accountId }) => {
        const account = resolveDecentChatAccount(cfg, accountId);
        return {
          accountConfigured: account.configured,
          hasConfiguredValue: !!account.seedPhrase?.trim(),
          resolvedValue: account.seedPhrase?.trim(),
          envValue: process.env.DECENTCHAT_SEED_PHRASE?.trim(),
        };
      },

      shouldPrompt: ({ credentialValues, state }) => {
        // Skip the prompt if prepare() already generated a seed phrase
        if (credentialValues.privateKey?.trim()) return false;
        if (state.hasConfiguredValue) return false;
        return true;
      },

      applyUseEnv: async ({ cfg }) =>
        patchTopLevelChannelConfigSection({
          cfg,
          channel: CHANNEL,
          enabled: true,
          clearFields: ["seedPhrase"],
          patch: {},
        }),

      applySet: async ({ cfg, resolvedValue }) =>
        patchTopLevelChannelConfigSection({
          cfg,
          channel: CHANNEL,
          enabled: true,
          patch: { seedPhrase: resolvedValue },
        }),
    },
  ],

  textInputs: [
    {
      inputKey: "name" as keyof ChannelSetupInput,
      message: "Bot display name",
      placeholder: "DecentChat Bot",
      required: false,
      helpTitle: "Bot display name",
      helpLines: ["The name other users see when your bot sends messages."],

      currentValue: ({ cfg, accountId }) => {
        const account = resolveDecentChatAccount(cfg, accountId);
        return account.alias !== "DecentChat Bot" ? account.alias : undefined;
      },

      initialValue: () => "DecentChat Bot",

      applySet: async ({ cfg, value }) =>
        patchTopLevelChannelConfigSection({
          cfg,
          channel: CHANNEL,
          enabled: true,
          patch: { alias: value.trim() || "DecentChat Bot" },
        }),
    },
    {
      inputKey: "url" as keyof ChannelSetupInput,
      message: "Invite URL to join a workspace (optional)",
      placeholder: "decentchat://invite/...",
      required: false,
      applyEmptyValue: false,
      helpTitle: "DecentChat invite URL",
      helpLines: [
        "Paste an invite link to automatically join a workspace on startup.",
        "You can add more later in the config file.",
        "Leave blank to skip.",
      ],

      currentValue: ({ cfg, accountId }) => {
        const account = resolveDecentChatAccount(cfg, accountId);
        return account.invites.length > 0 ? account.invites[0] : undefined;
      },

      keepPrompt: (value) => `Invite URL set (${value}). Keep it?`,

      applySet: async ({ cfg, value }) => {
        const trimmed = value.trim();
        if (!trimmed) return cfg;
        // Merge with existing invites, avoiding duplicates
        const existing: string[] = (cfg as any)?.channels?.decentchat?.invites ?? [];
        const merged = [...new Set([...existing, trimmed])];
        return patchTopLevelChannelConfigSection({
          cfg,
          channel: CHANNEL,
          enabled: true,
          patch: { invites: merged },
        });
      },
    },
  ],

  completionNote: {
    title: "DecentChat ready",
    lines: [
      "Your bot will connect to the DecentChat P2P network on next startup.",
      "Run `openclaw start` to bring it online.",
    ],
  },

  dmPolicy: createTopLevelChannelDmPolicy({
    label: "DecentChat",
    channel: CHANNEL,
    policyKey: `channels.${CHANNEL}.dmPolicy`,
    allowFromKey: `channels.${CHANNEL}.allowFrom`,
    getCurrent: (cfg) => (cfg as any)?.channels?.decentchat?.dmPolicy ?? "open",
  }),

  disable: (cfg) =>
    patchTopLevelChannelConfigSection({
      cfg,
      channel: CHANNEL,
      patch: { enabled: false },
    }),
};

const decentChatSetupAdapter = {
  resolveAccountId: () => DEFAULT_ACCOUNT_ID,

  validateInput: ({ input }: { cfg: OpenClawConfig; accountId: string; input: ChannelSetupInput }) => {
    const typedInput = input as ChannelSetupInput & { privateKey?: string };
    if (!typedInput.useEnv) {
      const seedPhrase = typedInput.privateKey?.trim();
      if (!seedPhrase) return "DecentChat requires a seed phrase.";
      const error = validateSeedPhrase(seedPhrase);
      if (error) return error;
    }
    return null;
  },

  applyAccountConfig: ({ cfg, input }: { cfg: OpenClawConfig; accountId: string; input: ChannelSetupInput }) => {
    const typedInput = input as ChannelSetupInput & { privateKey?: string };
    const patch: Record<string, unknown> = {};

    if (typedInput.useEnv) {
      // Clear stored seed phrase, will read from env at runtime
    } else if (typedInput.privateKey?.trim()) {
      patch.seedPhrase = typedInput.privateKey.trim();
    }

    if ((typedInput as any).name?.trim()) {
      patch.alias = (typedInput as any).name.trim();
    }

    if ((typedInput as any).url?.trim()) {
      const existing: string[] = (cfg as any)?.channels?.decentchat?.invites ?? [];
      const invite = (typedInput as any).url.trim();
      patch.invites = [...new Set([...existing, invite])];
    }

    return patchTopLevelChannelConfigSection({
      cfg,
      channel: CHANNEL,
      enabled: true,
      clearFields: typedInput.useEnv ? ["seedPhrase"] : undefined,
      patch,
    });
  },
};

export const decentChatPlugin: ChannelPlugin<ResolvedDecentChatAccount> = {
  id: "decentchat",
  meta: {
    id: "decentchat",
    label: "DecentChat",
    selectionLabel: "DecentChat (P2P)",
    docsPath: "/channels/decentchat",
    blurb: "P2P encrypted chat via DecentChat.",
    aliases: ["decent", "decentchat"],
  },
  capabilities: { chatTypes: ["direct", "group", "thread"], threads: true, media: true },
  reload: { configPrefixes: ["channels.decentchat"] },
  configSchema: {
    ...buildChannelConfigSchema(DecentChatConfigSchema),
    uiHints: {
      enabled: { label: "Enabled" },
      seedPhrase: { label: "Seed Phrase (12 words)", sensitive: true, help: "BIP39 seed phrase — determines your bot's identity on the network" },
      signalingServer: { label: "Signaling Server", placeholder: "https://decentchat.app/peerjs", advanced: true },
      alias: { label: "Bot Display Name", placeholder: "DecentChat Bot" },
      dataDir: { label: "Data Directory", advanced: true, help: "Path for persistent peer storage" },
      streamEnabled: { label: "Enable streaming", help: "Stream token deltas to peers in real time" },
      dmPolicy: { label: "DM Policy" },
      defaultAccount: { label: "Default account", advanced: true, help: "Preferred DecentChat account id when multiple accounts are configured" },
      replyToMode: { label: "Reply-to mode", help: "off|first|all — controls thread reply behavior" },
      replyToModeDirect: { label: "Reply-to mode (DMs)", help: "Override for direct messages" },
      replyToModeGroup: { label: "Reply-to mode (Groups)", help: "Override for group chats" },
      replyToModeChannel: { label: "Reply-to mode (Channels)", help: "Override for channels" },
      threadHistoryScope: { label: "Thread history scope", help: "thread = isolated, channel = shared context", advanced: true },
      threadInheritParent: { label: "Thread inherit parent", help: "Thread sessions inherit parent channel context", advanced: true },
      threadInitialHistoryLimit: { label: "Thread initial history limit", help: "Messages to bootstrap in new thread sessions", advanced: true },
      companySimBootstrapEnabled: { label: "Company bootstrap enabled", advanced: true },
      companySimBootstrapMode: { label: "Company bootstrap mode", advanced: true, help: "runtime = materialize company workspace on account startup" },
      companySimBootstrapManifestPath: { label: "Company manifest path", advanced: true, help: "Path to company.yaml (supports relative paths from current working directory)" },
      companySimBootstrapTargetWorkspaceId: { label: "Company target workspace id", advanced: true, help: "Pinned workspace id for runtime company bootstrap membership" },
      companySimBootstrapTargetInviteCode: { label: "Company target invite code", advanced: true, help: "Pinned invite code for runtime company bootstrap membership" },
      invites: { label: "Invite URLs", advanced: true, help: "DecentChat invite URIs for workspaces to join on startup" },
    },
  },

  setup: decentChatSetupAdapter,
  setupWizard: decentChatSetupWizard,

  config: {
    listAccountIds: (cfg) => listDecentChatAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveDecentChatAccount(cfg, accountId),
    defaultAccountId: (cfg) => resolveDefaultDecentChatAccountId(cfg),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      signalingServer: account.signalingServer,
      companySim: account.companySim?.enabled ? {
        companyId: account.companySim.companyId,
        employeeId: account.companySim.employeeId,
      } : undefined,
      companySimBootstrap: account.companySimBootstrap?.enabled ? {
        mode: account.companySimBootstrap.mode,
        manifestPath: account.companySimBootstrap.manifestPath,
        targetWorkspaceId: account.companySimBootstrap.targetWorkspaceId,
        targetInviteCode: account.companySimBootstrap.targetInviteCode,
      } : undefined,
    }),
  },

  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.dmPolicy ?? "open",
      allowFrom: [],
      policyPath: "channels.decentchat.dmPolicy",
      allowFromPath: "channels.decentchat.allowFrom",
      approveHint: formatPairingApproveHint("decentchat"),
      normalizeEntry: (raw: string) => raw.trim(),
    }),
  },

  threading: {
    resolveReplyToMode: ({ cfg, accountId, chatType }) => {
      const account = resolveDecentChatAccount(cfg, accountId);
      if (chatType === "direct") {
        return account.replyToModeByChatType.direct ?? account.replyToMode;
      }
      if (chatType === "group") {
        return account.replyToModeByChatType.group ?? account.replyToModeByChatType.channel ?? account.replyToMode;
      }
      if (chatType === "channel") {
        return account.replyToModeByChatType.channel ?? account.replyToModeByChatType.group ?? account.replyToMode;
      }
      return account.replyToMode;
    },
    allowExplicitReplyTagsWhenOff: true,
  },

  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1, idleMs: 0 },
  },

  groups: {
    resolveRequireMention: ({ cfg, groupId }) => {
      const chCfg = resolveRawDecentChatAccountConfig(cfg);
      const grpCfg = chCfg.channels?.[groupId] ?? chCfg.channels?.["*"];
      return grpCfg?.requireMention ?? true;
    },
  },

  messaging: {
    normalizeTarget: normalizeDecentChatMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeDecentChatTargetId,
      hint: "<peerId|channel:<id>|decentchat:channel:<id>|peer alias>",
      resolveTarget: async ({ accountId, input, normalized, preferredKind }) => resolveDecentChatTarget({
        accountId,
        input,
        normalized,
        preferredKind: preferredKind as "user" | "group" | "channel" | undefined,
      }),
    },
  },

  outbound: {
    deliveryMode: "direct",
    sendText: async (ctx) => {
      const peer = getPeerForContext(ctx.cfg, ctx.accountId);
      if (!peer) return { ok: false, error: new Error("DecentChat peer not running") };

      const { to, text, replyToId, threadId } = ctx;
      const threadIdStr = threadId != null
        ? String(threadId)
        : (replyToId != null ? String(replyToId) : undefined);

      try {
        if (to.startsWith("decentchat:channel:")) {
          const channelId = to.slice("decentchat:channel:".length);
          await peer.sendToChannel(channelId, text, threadIdStr, replyToId ?? undefined);
        } else {
          const peerId = to.startsWith("decentchat:") ? to.slice("decentchat:".length) : to;
          await peer.sendDirectToPeer(peerId, text, threadIdStr, replyToId ?? undefined);
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
  },

  directory: {
    self: async ({ cfg, accountId }) => {
      const account = resolveDecentChatAccount(cfg, accountId);
      const peer = getPeerForContext(cfg, accountId);
      if (!peer?.peerId) return null;
      return {
        kind: "user" as const,
        id: peer.peerId,
        name: account.alias,
        handle: `decentchat:${peer.peerId}`,
      };
    },
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const peer = getPeerForContext(cfg, accountId);
      if (!peer) return [];
      return peer.listDirectoryPeersLive({ query, limit });
    },
    listPeersLive: async ({ cfg, accountId, query, limit }) => {
      const peer = getPeerForContext(cfg, accountId);
      if (!peer) return [];
      return peer.listDirectoryPeersLive({ query, limit });
    },
    listGroups: async ({ cfg, accountId, query, limit }) => {
      const peer = getPeerForContext(cfg, accountId);
      if (!peer) return [];
      return peer.listDirectoryGroupsLive({ query, limit });
    },
    listGroupsLive: async ({ cfg, accountId, query, limit }) => {
      const peer = getPeerForContext(cfg, accountId);
      if (!peer) return [];
      return peer.listDirectoryGroupsLive({ query, limit });
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastError: runtime?.lastError ?? null,
      companySim: account.companySim?.enabled ? {
        companyId: account.companySim.companyId,
        employeeId: account.companySim.employeeId,
      } : undefined,
      companySimBootstrap: account.companySimBootstrap?.enabled ? {
        mode: account.companySimBootstrap.mode,
        manifestPath: account.companySimBootstrap.manifestPath,
        targetWorkspaceId: account.companySimBootstrap.targetWorkspaceId,
        targetInviteCode: account.companySimBootstrap.targetInviteCode,
      } : undefined,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      ctx.setStatus({
        accountId: ctx.accountId,
        running: false,
        configured: ctx.account.configured,
      });
      try {
        // Invalidate bootstrap guard so re-bootstrap runs on gateway restart.
        // Without this, the module-level `bootstrapCompleted` Set would skip
        // bootstrap on the second startAccount call within the same process.
        const bootstrap = ctx.account.companySimBootstrap;
        if (bootstrap?.enabled && bootstrap.mode !== "off") {
          const manifestPath = bootstrap.manifestPath?.trim();
          if (manifestPath) {
            const resolvedManifestPath = resolveCompanyManifestPath(manifestPath);
            const runtimeScope = buildCompanyBootstrapRuntimeScope(ctx.cfg, resolvedManifestPath);
            invalidateDecentChatBootstrapKey(buildDecentChatRuntimeBootstrapKey(resolvedManifestPath, runtimeScope));
          }
        }

        await bootstrapDecentChatCompanySimForStartup({
          cfg: ctx.cfg,
          accountId: ctx.accountId,
          account: ctx.account,
          log: ctx.log,
        });

        const startupDelayMs = resolveDecentChatStartupDelayMs(ctx.cfg, ctx.accountId);
        if (startupDelayMs > 0) {
          ctx.log?.info?.(`[${ctx.accountId}] startup stagger ${startupDelayMs}ms`);
          await waitForDecentChatStartupSlot(startupDelayMs, ctx.abortSignal);
        }

        await startDecentChatPeer({
          account: ctx.account,
          accountId: ctx.accountId,
          log: ctx.log,
          setStatus: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
          abortSignal: ctx.abortSignal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.setStatus({ accountId: ctx.accountId, running: false, lastError: message });
        throw err;
      }
    },
  },
};
