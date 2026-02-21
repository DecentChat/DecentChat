import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { startDecentChatBridge } from "./monitor.js";
import type { ResolvedDecentChatAccount } from "./types.js";

const DecentChatConfigSchema = z
  .object({
    port: z.number().int().min(1024).max(65535).default(4242).optional(),
    secret: z.string().optional(),
    enabled: z.boolean().default(true).optional(),
    dmPolicy: z.enum(["open", "allowlist", "pairing", "disabled"]).default("open").optional(),
    channels: z.record(z.object({ requireMention: z.boolean().optional() })).optional(),
  })
  .passthrough();

function resolveDecentChatAccount(cfg: any, accountId?: string | null): ResolvedDecentChatAccount {
  const ch = cfg?.channels?.decentchat ?? {};
  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
    port: ch.port ?? 4242,
    secret: ch.secret,
    enabled: ch.enabled !== false,
    dmPolicy: ch.dmPolicy ?? "open",
    configured: true,
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
  capabilities: { chatTypes: ["direct", "group"] },
  reload: { configPrefixes: ["channels.decentchat"] },
  configSchema: buildChannelConfigSchema(DecentChatConfigSchema),

  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveDecentChatAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: () => true,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: true,
      port: account.port,
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

  groups: {
    resolveRequireMention: ({ cfg, groupId }) => {
      const chCfg = (cfg as any)?.channels?.decentchat;
      const grpCfg = chCfg?.channels?.[groupId] ?? chCfg?.channels?.["*"];
      return grpCfg?.requireMention ?? true;
    },
  },

  outbound: {
    deliveryMode: "direct",
    sendText: async () => ({ ok: true }),
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      port: 4242,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: true,
      running: snapshot.running ?? false,
      port: snapshot.port ?? 4242,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: true,
      running: runtime?.running ?? false,
      port: account.port,
      lastError: runtime?.lastError ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      ctx.setStatus({ accountId: ctx.accountId, running: false });
      return startDecentChatBridge({
        account: ctx.account,
        accountId: ctx.accountId,
        log: ctx.log,
        setStatus: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
        abortSignal: ctx.abortSignal,
      });
    },
  },
};
