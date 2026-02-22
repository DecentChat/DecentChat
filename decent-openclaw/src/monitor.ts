import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createReplyPrefixOptions, type OpenClawConfig } from "openclaw/plugin-sdk";
import { getDecentChatRuntime } from "./runtime.js";
import { setActivePeer } from "./peer-registry.js";
import type { ResolvedDecentChatAccount } from "./types.js";

type InboundAttachment = {
  id: string;
  name: string;
  type: string;
  size?: number;
  thumbnail?: string;
  width?: number;
  height?: number;
};

type PeerContext = {
  account: ResolvedDecentChatAccount;
  accountId: string;
  log?: {
    info: (s: string) => void;
    warn?: (s: string) => void;
    error?: (s: string) => void;
    debug?: (s: string) => void;
  };
  setStatus: (patch: Record<string, unknown>) => void;
  abortSignal?: AbortSignal;
};

export async function finalizePeerStream(params: {
  xenaPeer: {
    sendDirectStreamDone: (args: { peerId: string; messageId: string }) => Promise<void>;
    sendStreamDone: (args: { channelId: string; workspaceId: string; messageId: string }) => Promise<void>;
  };
  chatType: "direct" | "group";
  senderId: string;
  channelId: string;
  workspaceId: string;
  streamMessageId: string | null;
}): Promise<void> {
  if (!params.streamMessageId) return;

  if (params.chatType === "direct") {
    await params.xenaPeer.sendDirectStreamDone({
      peerId: params.senderId,
      messageId: params.streamMessageId,
    });
    return;
  }

  await params.xenaPeer.sendStreamDone({
    channelId: params.channelId,
    workspaceId: params.workspaceId,
    messageId: params.streamMessageId,
  });
}

export async function startDecentChatPeer(ctx: PeerContext): Promise<void> {
  const seedPhrase = ctx.account.seedPhrase?.trim();
  if (!seedPhrase) {
    throw new Error("DecentChat seed phrase is required: set channels.decentchat.seedPhrase");
  }

  return startNodePeerRuntime(ctx);
}

async function startNodePeerRuntime(ctx: PeerContext): Promise<void> {
  const { NodeXenaPeer } = await import("./peer/NodeXenaPeer.js");
  const core = getDecentChatRuntime();
  const TOOL_CALL_MISMATCH_RE = /^No tool call found for function call output with call_id\b/i;

  let xenaPeer: InstanceType<typeof NodeXenaPeer>;
  let finalizeStream: () => Promise<void> = async () => {};

  xenaPeer = new NodeXenaPeer({
    account: ctx.account,
    onIncomingMessage: async (params) => {
      let streamMessageId: string | null = null;
      let streamTimer: ReturnType<typeof setTimeout> | null = null;
      let streamedReply = '';

      finalizeStream = async () => {
        if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
        const mid = streamMessageId;
        streamMessageId = null;
        await finalizePeerStream({
          xenaPeer,
          chatType: params.chatType,
          senderId: params.senderId,
          channelId: params.channelId,
          workspaceId: params.workspaceId,
          streamMessageId: mid,
        });

        const finalReply = streamedReply.trim();
        streamedReply = '';
        if (!finalReply) {
          ctx.log?.warn?.('[decentchat] finalizeStream: empty final reply, skipping persistence');
          return;
        }

        // Persist assistant replies as normal messages too (stream UI can be ephemeral on refresh).
        try {
          const persistThreadId = params.chatType === 'direct'
            ? params.threadId
            : (params.threadId ?? params.messageId);

          if (params.chatType === 'direct') {
            await xenaPeer.sendDirectToPeer(params.senderId, finalReply, persistThreadId, params.messageId);
          } else {
            await xenaPeer.sendToChannel(params.channelId, finalReply, persistThreadId, params.messageId);
          }
          ctx.log?.info?.(`[decentchat] persisted assistant reply (${finalReply.length} chars) in ${params.chatType}`);
        } catch (err) {
          ctx.log?.error?.(`[decentchat] failed to persist assistant reply: ${String(err)}`);
        }
      };

      await processInboundMessage(
        {
          messageId: params.messageId,
          channelId: params.channelId,
          workspaceId: params.workspaceId,
          senderId: params.senderId,
          senderName: params.senderName,
          content: params.content,
          chatType: params.chatType,
          timestamp: params.timestamp,
          replyToId: params.replyToId,
          threadId: params.threadId,
        },
        ctx,
        core,
        async (replyText) => {
          if (TOOL_CALL_MISMATCH_RE.test(replyText.trim())) {
            ctx.log?.warn?.("[decentchat] suppressed tool-call mismatch error text");
            return;
          }

          // Avoid duplicate live renders (stream + final persisted message).
          // Buffer chunks and emit exactly one persisted reply at finalize.
          streamedReply += replyText;

          if (streamTimer) clearTimeout(streamTimer);
          streamTimer = setTimeout(() => { void finalizeStream(); }, 200);
        },
        undefined,
        params.attachments,
      );

      await finalizeStream();
    },
    onReply: () => { void finalizeStream(); },
    log: ctx.log,
  });

  await xenaPeer.start();
  setActivePeer(xenaPeer);
  ctx.setStatus({
    running: true,
    peerId: xenaPeer.peerId,
    lastError: null,
  });

  return new Promise<void>((resolve) => {
    const shutdown = () => {
      setActivePeer(null);
      xenaPeer.destroy();
      ctx.setStatus({ running: false });
      resolve();
    };

    if (ctx.abortSignal?.aborted) {
      shutdown();
      return;
    }

    ctx.abortSignal?.addEventListener("abort", shutdown);
  });
}

function resolveThreadSessionKeys(params: {
  baseSessionKey: string;
  threadId?: string | null;
  parentSessionKey?: string;
}): { sessionKey: string; parentSessionKey?: string } {
  const threadId = (params.threadId ?? "").trim();
  if (!threadId) {
    return { sessionKey: params.baseSessionKey, parentSessionKey: undefined };
  }
  return {
    sessionKey: `${params.baseSessionKey}:thread:${threadId.toLowerCase()}`,
    parentSessionKey: params.parentSessionKey,
  };
}

async function processInboundMessage(
  msg: {
    messageId: string;
    channelId: string;
    workspaceId: string;
    senderId: string;
    senderName: string;
    content: string;
    chatType: "channel" | "direct";
    timestamp: number;
    replyToId?: string;
    threadId?: string;
  },
  ctx: { accountId: string; log?: any },
  core: ReturnType<typeof getDecentChatRuntime>,
  deliver: (text: string) => Promise<void>,
  onDeliverError?: (reason: string) => void,
  attachments?: InboundAttachment[],
): Promise<void> {
  let rawBody = msg.content?.trim() ?? "";
  const thumbnailAttachments = (attachments ?? []).filter(
    (attachment): attachment is InboundAttachment & { thumbnail: string } =>
      attachment.type === "image" && typeof attachment.thumbnail === "string" && attachment.thumbnail.length > 0,
  );

  const mediaPaths: string[] = [];
  if (thumbnailAttachments.length > 0) {
    const inboundMediaDir = path.join(os.homedir(), ".openclaw", "media", "inbound");
    fs.mkdirSync(inboundMediaDir, { recursive: true });
    for (const attachment of thumbnailAttachments) {
      try {
        const filePath = path.join(inboundMediaDir, `${randomUUID()}.jpg`);
        fs.writeFileSync(filePath, Buffer.from(attachment.thumbnail, "base64"));
        mediaPaths.push(filePath);
      } catch (err) {
        ctx.log?.warn?.(`[decentchat] failed to persist inbound thumbnail for ${attachment.id}: ${String(err)}`);
      }
    }
  }

  if (!rawBody && attachments && attachments.length > 0) {
    const imageLabels = attachments
      .filter((attachment) => attachment.type === "image")
      .map((attachment, index) => {
        const name = attachment.name?.trim();
        return name ? `[Image: ${name}]` : `[Image ${index + 1}]`;
      });
    if (imageLabels.length > 0) {
      rawBody = imageLabels.join("\n");
    }
  }

  if (!rawBody && mediaPaths.length === 0) {
    return;
  }

  const cfg = core.config.loadConfig() as OpenClawConfig;
  const channel = "decentchat";
  const peerId = msg.chatType === "direct"
    ? msg.senderId
    : `${msg.workspaceId}:${msg.channelId}`;

  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel,
    accountId: ctx.accountId,
    peer: { kind: msg.chatType === "direct" ? "direct" : "group", id: peerId },
  });

  const baseSessionKey = route.sessionKey;
  const isThreadReply = Boolean(msg.threadId && msg.threadId !== msg.messageId);
  const threadKeys = resolveThreadSessionKeys({
    baseSessionKey,
    threadId: isThreadReply ? msg.threadId : undefined,
    parentSessionKey: isThreadReply ? baseSessionKey : undefined,
  });
  const sessionKey = threadKeys.sessionKey;

  const fromLabel = msg.chatType === "direct" ? msg.senderName : `${msg.senderName} in ${msg.channelId}`;
  const storePath = core.channel.session.resolveStorePath(cfg.session?.store, { agentId: route.agentId });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey,
  });

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "DecentChat",
    from: fromLabel,
    timestamp: msg.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const mediaType = mediaPaths.length > 0 ? "image/jpeg" : undefined;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: msg.chatType === "direct" ? `decentchat:${msg.senderId}` : `decentchat:channel:${msg.channelId}`,
    To: "decentchat:bot",
    SessionKey: sessionKey,
    AccountId: route.accountId,
    ChatType: msg.chatType === "direct" ? "direct" : "group",
    ConversationLabel: fromLabel,
    SenderName: msg.senderName,
    SenderId: msg.senderId,
    GroupSubject: msg.chatType === "channel" ? msg.channelId : undefined,
    Provider: channel,
    Surface: channel,
    MessageSid: msg.messageId,
    Timestamp: msg.timestamp,
    OriginatingChannel: channel,
    OriginatingTo: msg.chatType === "direct" ? `decentchat:${msg.senderId}` : `decentchat:channel:${msg.channelId}`,
    ReplyToId: isThreadReply ? msg.threadId : undefined,
    MessageThreadId: isThreadReply ? msg.threadId : undefined,
    ParentSessionKey: threadKeys.parentSessionKey,
    IsFirstThreadTurn: isThreadReply && !previousTimestamp ? true : undefined,
    MediaPath: mediaPaths[0],
    MediaType: mediaType,
    MediaPaths: mediaPaths.length > 1 ? mediaPaths : undefined,
    MediaTypes: mediaPaths.length > 1 ? mediaPaths.map(() => "image/jpeg") : undefined,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => ctx.log?.error?.(`[decentchat] session record error: ${String(err)}`),
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId: route.agentId,
    channel,
    accountId: ctx.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        const text = (payload as any).text;
        if (!text) {
          return;
        }
        // Drop upstream tool-call mismatch errors from being posted into chat.
        if (/^No tool call found for function call output with call_id\b/i.test(text.trim())) {
          ctx.log?.warn?.("[decentchat] suppressed tool-call mismatch error text");
          return;
        }
        await deliver(text);
      },
      onError: (err, info) => {
        const reason = String(err);
        ctx.log?.error?.(`[decentchat] ${info.kind} reply error: ${reason}`);
        onDeliverError?.(reason);
      },
    },
    replyOptions: { onModelSelected, suppressToolErrorWarnings: true },
  });
}
