import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { createReplyPrefixOptions, type OpenClawConfig } from "openclaw/plugin-sdk";
import { getDecentChatRuntime } from "./runtime.js";
import type {
  InboundWireMessage,
  OutboundWireMessage,
  ResolvedDecentChatAccount,
  WireMessage,
} from "./types.js";

export async function startDecentChatBridge(ctx: {
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
}): Promise<void> {
  const core = getDecentChatRuntime();
  const port = ctx.account.port ?? 4242;
  const secret = ctx.account.secret;

  const authenticated = new Map<WebSocket, boolean>();

  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrades manually so error events stay on httpServer
  httpServer.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // Prevent unhandled 'error' events on either emitter from crashing the process
  httpServer.on("error", (err) => {
    ctx.log?.error?.(`[decentchat] server error: ${err.message}`);
  });
  wss.on("error", (err) => {
    ctx.log?.error?.(`[decentchat] wss error: ${err.message}`);
  });

  // Wait for the port to bind (or fail)
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
  ctx.setStatus({ running: true, port, lastError: null });

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

  // Keep the promise pending until the gateway signals us to stop.
  // Resolving = "channel exited" which triggers auto-restart.
  return new Promise<void>((resolve) => {
    const shutdown = () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      httpServer.close();
      ctx.setStatus({ running: false });
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
  const { messageId, channelId, senderId, senderName, content, chatType, timestamp } = msg;
  const rawBody = content?.trim() ?? "";
  if (!rawBody) {
    return;
  }

  const cfg = core.config.loadConfig() as OpenClawConfig;
  const channel = "decentchat";
  const peerId = chatType === "direct" ? senderId : channelId;

  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel,
    accountId: ctx.accountId,
    peer: { kind: chatType === "direct" ? "direct" : "group", id: peerId },
  });

  const fromLabel = chatType === "direct" ? senderName : `${senderName} in ${channelId}`;
  const storePath = core.channel.session.resolveStorePath(cfg.session?.store, { agentId: route.agentId });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "DecentChat",
    from: fromLabel,
    timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: chatType === "direct" ? `decentchat:${senderId}` : `decentchat:channel:${channelId}`,
    To: "decentchat:bot",
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: chatType === "direct" ? "direct" : "group",
    ConversationLabel: fromLabel,
    SenderName: senderName,
    SenderId: senderId,
    GroupSubject: chatType === "channel" ? channelId : undefined,
    Provider: channel,
    Surface: channel,
    MessageSid: messageId,
    Timestamp: timestamp,
    OriginatingChannel: channel,
    OriginatingTo: chatType === "direct" ? `decentchat:${senderId}` : `decentchat:channel:${channelId}`,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => ctx.log?.error?.(`[decentchat] session record error: ${String(err)}`),
  });

  send(ws, { type: "typing", channelId, messageId });

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
        send(ws, {
          type: "reply",
          inReplyToId: messageId,
          channelId,
          content: text,
          timestamp: Date.now(),
        });
      },
      onError: (err, info) => {
        ctx.log?.error?.(`[decentchat] ${info.kind} reply error: ${String(err)}`);
        send(ws, { type: "error", inReplyToId: messageId, reason: String(err) });
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
