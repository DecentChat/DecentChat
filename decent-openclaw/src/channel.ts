import {
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import { startDecentChatBridge } from "./monitor.js";
import type { ResolvedDecentChatAccount } from "./types.js";

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
  capabilities: { chatTypes: ["direct", "group"] },
  reload: { configPrefixes: ["channels.decentchat"] },

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
