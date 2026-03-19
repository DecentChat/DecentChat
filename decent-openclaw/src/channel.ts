import { createHash } from "node:crypto";
import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { z } from "zod";

import { assertCompanyBootstrapAgentInstallation, ensureCompanyBootstrapRuntime, resolveCompanyManifestPath } from "./company-sim/bootstrap.js";
import { startDecentChatPeer } from "./monitor.js";
import { getActivePeer } from "./peer-registry.js";
import { buildDecentChatRuntimeBootstrapKey, runDecentChatBootstrapOnce } from "./runtime.js";
import type { DecentChatChannelConfig, OpenClawConfigShape, ResolvedDecentChatAccount } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";

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
  alias: z.string().optional().default("Xena AI"),
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

  return {
    ...base,
    ...(accountCfg ?? {}),
    channels: mergeObject(base.channels, accountCfg?.channels),
    replyToModeByChatType: mergeObject(base.replyToModeByChatType, accountCfg?.replyToModeByChatType),
    thread: mergeObject(base.thread, accountCfg?.thread),
    huddle: mergeObject(base.huddle, accountCfg?.huddle),
    companySim: mergeObject(base.companySim, accountCfg?.companySim),
    companySimBootstrap: mergeObject(base.companySimBootstrap, accountCfg?.companySimBootstrap),
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

export function looksLikeDecentChatTargetId(raw: string, normalized?: string): boolean {
  const value = (normalized ?? raw).trim();
  if (!value) return false;
  return value.startsWith("decentchat:channel:") || value.startsWith("decentchat:");
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
    alias: ch.alias ?? "Xena AI",
    dataDir: ch.dataDir,
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
      alias: { label: "Bot Display Name", placeholder: "Xena AI" },
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
      hint: "<peerId|channel:<id>|decentchat:channel:<id>>",
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
        await bootstrapDecentChatCompanySimForStartup({
          cfg: ctx.cfg,
          accountId: ctx.accountId,
          account: ctx.account,
          log: ctx.log,
        });

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
