import {
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  buildChannelConfigSchema,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { startDecentChatBridge } from "./monitor.js";
import { getActivePeer } from "./peer-registry.js";
import type { ResolvedDecentChatAccount } from "./types.js";

const DecentChatConfigSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["bridge", "peer"]).optional().default("peer"),
  port: z.number().int().positive().optional().default(4242),
  secret: z.string().optional(),
  seedPhrase: z.string().optional(),
  signalingServer: z.string().optional(),
  invites: z.array(z.string()).optional(),
  alias: z.string().optional().default("Xena AI"),
  dataDir: z.string().optional(),
  dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).optional().default("open"),
  channels: z.record(z.string(), z.object({
    requireMention: z.boolean().optional(),
  }).optional()).optional(),
});

function resolveDecentChatAccount(cfg: any, accountId?: string | null): ResolvedDecentChatAccount {
  const ch = cfg?.channels?.decentchat ?? {};
  const mode: "bridge" | "peer" = ch.mode ?? "peer";
  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
    port: ch.port ?? 4242,
    secret: ch.secret,
    enabled: ch.enabled !== false,
    dmPolicy: ch.dmPolicy ?? "open",
    configured: !!ch.seedPhrase || mode !== "peer",
    seedPhrase: ch.seedPhrase,
    signalingServer: ch.signalingServer ?? "https://decentchat.app/peerjs",
    invites: ch.invites ?? [],
    alias: ch.alias ?? "Xena AI",
    dataDir: ch.dataDir,
    mode,
  };
}

export const decentChatPlugin: ChannelPlugin<ResolvedDecentChatAccount> = {
  id: "decentchat",
  meta: {
    id: "decentchat",
    label: "DecentChat",
    selectionLabel: "DecentChat (P2P)",
    docsPath: "/channels/decentchat",
    blurb: "P2P encrypted chat via DecentChat WebSocket bridge.",
    aliases: ["decent", "decentchat"],
  },
  capabilities: { chatTypes: ["direct", "group", "thread"] },
  reload: { configPrefixes: ["channels.decentchat"] },
  configSchema: {
    ...buildChannelConfigSchema(DecentChatConfigSchema),
    uiHints: {
      enabled: { label: "Enabled" },
      mode: { label: "Mode", help: "peer: join P2P network directly; bridge: relay via WebSocket" },
      seedPhrase: { label: "Seed Phrase (12 words)", sensitive: true, help: "BIP39 seed phrase — determines your bot's identity on the network" },
      secret: { label: "Bridge Secret", sensitive: true, help: "Shared secret for WebSocket bridge authentication (bridge mode only)" },
      port: { label: "Bridge Port", placeholder: "4242", advanced: true, help: "Local WebSocket port (bridge mode only)" },
      signalingServer: { label: "Signaling Server", placeholder: "https://decentchat.app/peerjs", advanced: true },
      alias: { label: "Bot Display Name", placeholder: "Xena AI" },
      dataDir: { label: "Data Directory", advanced: true, help: "Path for persistent peer storage (peer mode only)" },
      dmPolicy: { label: "DM Policy" },
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
      port: account.port,
      mode: account.mode,
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
    resolveReplyToMode: () => "all",
    allowExplicitReplyTagsWhenOff: true,
  },

  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 80, idleMs: 200 },
  },

  groups: {
    resolveRequireMention: ({ cfg, groupId }) => {
      const chCfg = (cfg as any)?.channels?.decentchat;
      const grpCfg = chCfg?.channels?.[groupId] ?? chCfg?.channels?.["*"];
      return grpCfg?.requireMention ?? true;
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

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      port: 4242,
      mode: "peer",
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      port: snapshot.port ?? 4242,
      mode: snapshot.mode ?? "peer",
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      port: account.port,
      mode: runtime?.mode ?? account.mode,
      lastError: runtime?.lastError ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      ctx.setStatus({
        accountId: ctx.accountId,
        running: false,
        configured: ctx.account.configured,
        mode: ctx.account.mode,
        port: ctx.account.port,
      });
      await startDecentChatBridge({
        account: ctx.account,
        accountId: ctx.accountId,
        log: ctx.log,
        setStatus: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
        abortSignal: ctx.abortSignal,
      });
    },
  },
};
