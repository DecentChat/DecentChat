import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createReplyPrefixOptions, type OpenClawConfig } from "openclaw/plugin-sdk";
import { getDecentChatRuntime } from "./runtime.js";
import type {
  InboundWireMessage,
  OutboundWireMessage,
  ResolvedDecentChatAccount,
  WireMessage,
} from "./types.js";

type InboundAttachment = {
  id: string;
  name: string;
  type: string;
  size?: number;
  thumbnail?: string;
  width?: number;
  height?: number;
};

type BridgeContext = {
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

export async function startDecentChatBridge(ctx: BridgeContext): Promise<void> {
  if (ctx.account.mode === "peer") {
    if (!ctx.account.seedPhrase) {
      ctx.log?.warn?.("[decentchat] peer mode requested without seedPhrase; falling back to bridge mode");
    } else {
      try {
        return await startNodePeerMode(ctx);
      } catch (err) {
        ctx.log?.warn?.(`[decentchat] peer mode failed; falling back to bridge mode: ${String(err)}`);
      }
    }
  }

  return startBridgeMode(ctx);
}

async function startNodePeerMode(ctx: BridgeContext): Promise<void> {
  const { NodeXenaPeer } = await import("./peer/NodeXenaPeer.js");
  const core = getDecentChatRuntime();

  let xenaPeer: InstanceType<typeof NodeXenaPeer>;

  xenaPeer = new NodeXenaPeer({
    account: ctx.account,
    onIncomingMessage: async (params) => {
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
          await xenaPeer.sendMessage(
            params.channelId,
            params.workspaceId,
            replyText,
            params.threadId ?? undefined,
            params.messageId,
          );
        },
        undefined,
        params.attachments,
      );
    },
    onReply: () => {},
    log: ctx.log,
  });

  await xenaPeer.start();
  ctx.setStatus({
    running: true,
    mode: "peer",
    peerId: xenaPeer.peerId,
    lastError: null,
  });

  return new Promise<void>((resolve) => {
    const shutdown = () => {
      xenaPeer.destroy();
      ctx.setStatus({ running: false, mode: "peer" });
      resolve();
    };

    if (ctx.abortSignal?.aborted) {
      shutdown();
      return;
    }

    ctx.abortSignal?.addEventListener("abort", shutdown);
  });
}

async function startBridgeMode(ctx: BridgeContext): Promise<void> {
  const core = getDecentChatRuntime();
  const port = ctx.account.port ?? 4242;
  const secret = ctx.account.secret;

  const authenticated = new Map<WebSocket, boolean>();

  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  httpServer.on("error", (err) => {
    ctx.log?.error?.(`[decentchat] server error: ${err.message}`);
  });
  wss.on("error", (err) => {
    ctx.log?.error?.(`[decentchat] wss error: ${err.message}`);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.removeListener("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port);
  });

  ctx.log?.info(`[decentchat] WebSocket server listening on port ${port}`);
  ctx.setStatus({ running: true, mode: "bridge", port, lastError: null });

  wss.on("connection", (ws) => {
    authenticated.set(ws, !secret);

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        send(ws, { type: "pong" });
      }
    }, 30_000);

    ws.on("close", () => {
      authenticated.delete(ws);
      clearInterval(pingInterval);
    });

    ws.on("message", async (raw) => {
      let msg: InboundWireMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "ping") {
        send(ws, { type: "pong" });
        return;
      }

      if (msg.type === "auth") {
        if (!secret || msg.secret === secret) {
          authenticated.set(ws, true);
        }
        return;
      }

      if (!authenticated.get(ws)) {
        ctx.log?.warn?.("[decentchat] Unauthenticated client attempted to send message");
        return;
      }

      if (msg.type === "message") {
        await handleInboundMessage(ws, msg, ctx, core);
      }
    });

    ws.on("error", (err) => {
      ctx.log?.error?.(`[decentchat] WS error: ${err.message}`);
    });
  });

  return new Promise<void>((resolve) => {
    const shutdown = () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      httpServer.close();
      ctx.setStatus({ running: false, mode: "bridge" });
      ctx.log?.info("[decentchat] WebSocket server stopped");
      resolve();
    };

    ctx.abortSignal?.addEventListener("abort", shutdown);
  });
}

async function handleInboundMessage(
  ws: WebSocket,
  msg: WireMessage,
  ctx: { account: ResolvedDecentChatAccount; accountId: string; log?: any },
  core: ReturnType<typeof getDecentChatRuntime>,
): Promise<void> {
  send(ws, { type: "typing", channelId: msg.channelId, messageId: msg.messageId });

  await processInboundMessage(msg, ctx, core, async (text) => {
    send(ws, {
      type: "reply",
      inReplyToId: msg.messageId,
      channelId: msg.channelId,
      content: text,
      timestamp: Date.now(),
      threadId: msg.threadId,
    });
  }, (reason) => {
    send(ws, { type: "error", inReplyToId: msg.messageId, reason });
  }, Array.isArray((msg as WireMessage & { attachments?: InboundAttachment[] }).attachments)
    ? (msg as WireMessage & { attachments?: InboundAttachment[] }).attachments
    : undefined);
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
        await deliver(text);
      },
      onError: (err, info) => {
        const reason = String(err);
        ctx.log?.error?.(`[decentchat] ${info.kind} reply error: ${reason}`);
        onDeliverError?.(reason);
      },
    },
    replyOptions: { onModelSelected },
  });
}

function send(ws: WebSocket, msg: OutboundWireMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
