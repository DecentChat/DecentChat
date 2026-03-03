import {
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  buildChannelConfigSchema,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { startDecentChatPeer } from "./monitor.js";
import { getActivePeer } from "./peer-registry.js";
import type { ResolvedDecentChatAccount } from "./types.js";

const DecentChatConfigSchema = z.object({
  enabled: z.boolean().optional(),
  seedPhrase: z.string().optional(),
  signalingServer: z.string().optional(),
  invites: z.array(z.string()).optional(),
  alias: z.string().optional().default("Xena AI"),
  dataDir: z.string().optional(),
  streamEnabled: z.boolean().optional().default(true),
  dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).optional().default("open"),
  replyToMode: z.enum(["off", "first", "all"]).optional().default("all"),
  // Flattened from replyToModeByChatType object (Control UI can't render nested objects)
  replyToModeDirect: z.enum(["off", "first", "all"]).optional(),
  replyToModeGroup: z.enum(["off", "first", "all"]).optional(),
  replyToModeChannel: z.enum(["off", "first", "all"]).optional(),
  // Flattened from thread object
  threadHistoryScope: z.enum(["thread", "channel"]).optional().default("thread"),
  threadInheritParent: z.boolean().optional().default(false),
  threadInitialHistoryLimit: z.number().int().min(0).optional().default(20),
  // Legacy nested forms still accepted at runtime via passthrough
  // (resolveDecentChatAccount reads ch.replyToModeByChatType, ch.thread, ch.channels)
  // but excluded from schema so Control UI can render all fields cleanly.
}).passthrough();


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

function resolveDecentChatAccount(cfg: any, accountId?: string | null): ResolvedDecentChatAccount {
  const ch = cfg?.channels?.decentchat ?? {};
  const seedPhrase = typeof ch.seedPhrase === "string" ? ch.seedPhrase : undefined;
  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
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
      direct: ch.replyToModeDirect ?? ch.replyToModeByChatType?.direct,
      group: ch.replyToModeGroup ?? ch.replyToModeByChatType?.group,
      channel: ch.replyToModeChannel ?? ch.replyToModeByChatType?.channel,
    },
    thread: {
      historyScope: ch.threadHistoryScope ?? ch.thread?.historyScope ?? "thread",
      inheritParent: ch.threadInheritParent ?? ch.thread?.inheritParent ?? false,
      initialHistoryLimit: ch.threadInitialHistoryLimit ?? ch.thread?.initialHistoryLimit ?? 20,
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
  };
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
      replyToMode: { label: "Reply-to mode", help: "off|first|all — controls thread reply behavior" },
      replyToModeDirect: { label: "Reply-to mode (DMs)", help: "Override for direct messages" },
      replyToModeGroup: { label: "Reply-to mode (Groups)", help: "Override for group chats" },
      replyToModeChannel: { label: "Reply-to mode (Channels)", help: "Override for channels" },
      threadHistoryScope: { label: "Thread history scope", help: "thread = isolated, channel = shared context", advanced: true },
      threadInheritParent: { label: "Thread inherit parent", help: "Thread sessions inherit parent channel context", advanced: true },
      threadInitialHistoryLimit: { label: "Thread initial history limit", help: "Messages to bootstrap in new thread sessions", advanced: true },

      invites: { label: "Invite URLs", advanced: true, help: "DecentChat invite URIs for workspaces to join on startup" },
    },
  },

  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveDecentChatAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      signalingServer: account.signalingServer,
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
    // Preserve real provider streaming: do not aggressively coalesce token deltas.
    blockStreamingCoalesceDefaults: { minChars: 1, idleMs: 0 },
  },

  groups: {
    resolveRequireMention: ({ cfg, groupId }) => {
      const chCfg = (cfg as any)?.channels?.decentchat;
      const grpCfg = chCfg?.channels?.[groupId] ?? chCfg?.channels?.["*"];
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
      const peer = getActivePeer();
      if (!peer) return { ok: false, error: new Error("DecentChat peer not running") };

      const { to, text, replyToId, threadId } = ctx;
      // Preserve thread context. Some surfaces provide only replyToId for thread replies.
      const threadIdStr = threadId != null
        ? String(threadId)
        : (replyToId != null ? String(replyToId) : undefined);

      try {
        if (to.startsWith("decentchat:channel:")) {
          // Group channel message: to = "decentchat:channel:<channelId>"
          const channelId = to.slice("decentchat:channel:".length);
          await peer.sendToChannel(channelId, text, threadIdStr, replyToId ?? undefined);
        } else {
          // Direct message: to = "decentchat:<peerId>" or just "<peerId>"
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
    self: async () => {
      const peer = getActivePeer();
      if (!peer?.peerId) return null;
      return {
        kind: "user" as const,
        id: peer.peerId,
        name: "Xena",
        handle: `decentchat:${peer.peerId}`,
      };
    },
    listPeers: async ({ query, limit }) => {
      const peer = getActivePeer();
      if (!peer) return [];
      return peer.listDirectoryPeersLive({ query, limit });
    },
    listPeersLive: async ({ query, limit }) => {
      const peer = getActivePeer();
      if (!peer) return [];
      return peer.listDirectoryPeersLive({ query, limit });
    },
    listGroups: async ({ query, limit }) => {
      const peer = getActivePeer();
      if (!peer) return [];
      return peer.listDirectoryGroupsLive({ query, limit });
    },
    listGroupsLive: async ({ query, limit }) => {
      const peer = getActivePeer();
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
