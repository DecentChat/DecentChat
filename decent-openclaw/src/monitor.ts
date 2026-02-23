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

type IncomingPeerMessage = {
  channelId: string;
  workspaceId: string;
  content: string;
  senderId: string;
  senderName: string;
  messageId: string;
  chatType: "channel" | "direct";
  timestamp: number;
  replyToId?: string;
  threadId?: string;
  attachments?: InboundAttachment[];
};

type StreamingPeerAdapter = {
  startStream: (args: {
    channelId: string;
    workspaceId: string;
    messageId: string;
    threadId?: string;
    replyToId?: string;
  }) => Promise<void>;
  startDirectStream: (args: { peerId: string; messageId: string }) => Promise<void>;
  sendStreamDelta: (args: {
    channelId: string;
    workspaceId: string;
    messageId: string;
    content: string;
  }) => Promise<void>;
  sendDirectStreamDelta: (args: {
    peerId: string;
    messageId: string;
    content: string;
  }) => Promise<void>;
  sendDirectStreamDone: (args: { peerId: string; messageId: string }) => Promise<void>;
  sendStreamDone: (args: { channelId: string; workspaceId: string; messageId: string }) => Promise<void>;
  sendDirectToPeer: (peerId: string, content: string, threadId?: string, replyToId?: string) => Promise<void>;
  sendToChannel: (channelId: string, content: string, threadId?: string, replyToId?: string) => Promise<void>;
  sendReadReceipt: (peerId: string, channelId: string, messageId: string) => Promise<void>;
  requestFullImage: (peerId: string, attachmentId: string) => Promise<Buffer | null>;
};

const TOOL_CALL_MISMATCH_RE = /^No tool call found for function call output with call_id\b/i;

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

export async function relayInboundMessageToPeer(params: {
  incoming: IncomingPeerMessage;
  ctx: Pick<PeerContext, "account" | "accountId" | "log">;
  core: ReturnType<typeof getDecentChatRuntime>;
  xenaPeer: StreamingPeerAdapter;
  onFinalizeReady?: (finalize: () => Promise<void>) => void;
}): Promise<void> {
  const { incoming, ctx, core, xenaPeer } = params;
  let streamMessageId: string | null = null;
  let streamTimer: ReturnType<typeof setTimeout> | null = null;
  let streamedReply = "";
  let streamChunkCount = 0;
  const streamEnabled = ctx.account.streamEnabled !== false;
  let finalizeInFlight: Promise<void> | null = null;

  const finalizeStream = async () => {
    if (finalizeInFlight) {
      await finalizeInFlight;
      return;
    }

    finalizeInFlight = (async () => {
      if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = null;
      }

      const mid = streamMessageId;
      streamMessageId = null;
      await finalizePeerStream({
        xenaPeer,
        chatType: incoming.chatType === "direct" ? "direct" : "group",
        senderId: incoming.senderId,
        channelId: incoming.channelId,
        workspaceId: incoming.workspaceId,
        streamMessageId: mid,
      });

      const finalReply = streamedReply.trim();
      ctx.log?.info?.(`[decentchat] stream telemetry: enabled=${streamEnabled} chunks=${streamChunkCount} finalChars=${finalReply.length}`);
      streamedReply = "";
      streamChunkCount = 0;
      if (!finalReply) {
        ctx.log?.warn?.("[decentchat] finalizeStream: empty final reply, skipping persistence");
        return;
      }

      // When live streaming is enabled, the streamed message is already persisted by the web client
      // as it receives deltas. Sending a second "normal" message here causes duplicates.
      if (streamEnabled) {
        return;
      }

      // Fallback persistence for non-stream mode.
      try {
        const persistThreadId = incoming.chatType === "direct"
          ? incoming.threadId
          : (incoming.threadId ?? incoming.messageId);

        if (incoming.chatType === "direct") {
          await xenaPeer.sendDirectToPeer(incoming.senderId, finalReply, persistThreadId, incoming.messageId);
        } else {
          await xenaPeer.sendToChannel(incoming.channelId, finalReply, persistThreadId, incoming.messageId);
        }
        ctx.log?.info?.(`[decentchat] persisted assistant reply (${finalReply.length} chars) in ${incoming.chatType}`);
      } catch (err) {
        ctx.log?.error?.(`[decentchat] failed to persist assistant reply: ${String(err)}`);
      }
    })();

    try {
      await finalizeInFlight;
    } finally {
      finalizeInFlight = null;
    }
  };

  params.onFinalizeReady?.(finalizeStream);

  // Request full-quality images for attachments before processing
  const imageAttachments = (incoming.attachments ?? []).filter(
    (att): att is InboundAttachment & { id: string; type: "image" } =>
      att.type === "image" && typeof att.id === "string"
  );

  const fullImageBuffers: Map<string, Buffer> = new Map();
  if (imageAttachments.length > 0) {
    ctx.log?.info?.(`[decentchat] requesting ${imageAttachments.length} full-quality image(s) from ${incoming.senderId.slice(0, 8)}`);
    const imageRequests = imageAttachments.map(async (att) => {
      const buffer = await xenaPeer.requestFullImage(incoming.senderId, att.id);
      if (buffer) {
        fullImageBuffers.set(att.id, buffer);
        ctx.log?.info?.(`[decentchat] received full image ${att.id.slice(0, 8)} (${buffer.length} bytes)`);
      } else {
        ctx.log?.warn?.(`[decentchat] failed to get full image ${att.id.slice(0, 8)}, will use thumbnail`);
      }
    });
    await Promise.all(imageRequests);
  }

  await processInboundMessage(
    {
      messageId: incoming.messageId,
      channelId: incoming.channelId,
      workspaceId: incoming.workspaceId,
      senderId: incoming.senderId,
      senderName: incoming.senderName,
      content: incoming.content,
      chatType: incoming.chatType,
      timestamp: incoming.timestamp,
      replyToId: incoming.replyToId,
      threadId: incoming.threadId,
    },
    { accountId: ctx.accountId, log: ctx.log },
    core,
    xenaPeer,
    async (replyText) => {
      if (TOOL_CALL_MISMATCH_RE.test(replyText.trim())) {
        ctx.log?.warn?.("[decentchat] suppressed tool-call mismatch error text");
        return;
      }

      // Real streaming path: forward provider chunks immediately (if enabled).
      streamedReply += replyText;
      streamChunkCount += 1;
      ctx.log?.info?.(`[decentchat] deliver #${streamChunkCount}: +${replyText.length} chars, total=${streamedReply.length}`);

      if (streamEnabled) {
        if (!streamMessageId) {
          streamMessageId = randomUUID();
          // Always reply in a thread (Slack-bot style): use the existing thread root,
          // or create a new thread under the inbound message.
          const outThreadId = incoming.chatType === "direct"
            ? undefined
            : (incoming.threadId ?? incoming.messageId);
          if (incoming.chatType === "direct") {
            await xenaPeer.startDirectStream({ peerId: incoming.senderId, messageId: streamMessageId });
          } else {
            await xenaPeer.startStream({
              channelId: incoming.channelId,
              workspaceId: incoming.workspaceId,
              messageId: streamMessageId,
              threadId: outThreadId,
              replyToId: incoming.messageId,
            });
          }
        }

        // Send cumulative content so receiver's replace-rendering shows progressive growth.
        // Fallback smoothing: if provider gives a single big block, emit small progressive
        // deltas so UX still looks like streaming (similar to TUI typing feel).
        const sendDelta = async (content: string) => {
          if (incoming.chatType === "direct") {
            await xenaPeer.sendDirectStreamDelta({ peerId: incoming.senderId, messageId: streamMessageId, content });
          } else {
            await xenaPeer.sendStreamDelta({
              channelId: incoming.channelId,
              workspaceId: incoming.workspaceId,
              messageId: streamMessageId,
              content,
            });
          }
        };

        await sendDelta(streamedReply);
      }

      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = setTimeout(() => { void finalizeStream(); }, 200);
    },
    undefined,
    incoming.attachments,
    fullImageBuffers,
    { streamEnabled },
  );

  await finalizeStream();
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

  let xenaPeer: InstanceType<typeof NodeXenaPeer>;
  let finalizeStream: () => Promise<void> = async () => {};

  xenaPeer = new NodeXenaPeer({
    account: ctx.account,
    onIncomingMessage: async (params) => {
      await relayInboundMessageToPeer({
        incoming: params,
        ctx,
        core,
        xenaPeer,
        onFinalizeReady: (nextFinalize) => {
          finalizeStream = nextFinalize;
        },
      });
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
  xenaPeer: Pick<StreamingPeerAdapter, "sendReadReceipt"> | { sendReadReceipt?: (peerId: string, channelId: string, messageId: string) => Promise<void> },
  deliver: (text: string) => Promise<void>,
  onDeliverError?: (reason: string) => void,
  attachments?: InboundAttachment[],
  fullImageBuffers?: Map<string, Buffer>,
  options?: { streamEnabled?: boolean },
): Promise<void> {
  let rawBody = msg.content?.trim() ?? "";

  const mediaPaths: string[] = [];
  const imageAttachments = (attachments ?? []).filter((att) => att.type === "image");

  if (imageAttachments.length > 0) {
    const inboundMediaDir = path.join(os.homedir(), ".openclaw", "media", "inbound");
    fs.mkdirSync(inboundMediaDir, { recursive: true });

    for (const attachment of imageAttachments) {
      try {
        const filePath = path.join(inboundMediaDir, `${randomUUID()}.jpg`);

        // Prefer full-quality image if available
        const fullBuffer = fullImageBuffers?.get(attachment.id);
        if (fullBuffer) {
          fs.writeFileSync(filePath, fullBuffer);
          ctx.log?.info?.(`[decentchat] saved full-quality image ${attachment.id.slice(0, 8)} (${fullBuffer.length} bytes)`);
        } else if (attachment.thumbnail) {
          // Fallback to thumbnail
          fs.writeFileSync(filePath, Buffer.from(attachment.thumbnail, "base64"));
          ctx.log?.info?.(`[decentchat] saved thumbnail for ${attachment.id.slice(0, 8)} (fallback)`);
        } else {
          continue; // Skip if no image data available
        }

        mediaPaths.push(filePath);
      } catch (err) {
        ctx.log?.warn?.(`[decentchat] failed to persist image for ${attachment.id}: ${String(err)}`);
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

  let streamingActive = false;
  let lastPartialLength = 0;

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
        // When real streaming is active (onPartialReply), tokens are already delivered.
        // The deliver callback only fires for the final aggregated text — skip it to avoid duplicates.
        // (Same pattern as Slack native streaming: stream IS the delivery.)
        if (options?.streamEnabled && streamingActive) {
          ctx.log?.info?.(`[decentchat] deliver: skipping (stream active, ${text.length} chars)`);
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
    replyOptions: {
      onModelSelected,
      suppressToolErrorWarnings: true,
      // Real token-level streaming: onPartialReply fires with each LLM token delta.
      // We forward these directly to the P2P stream protocol for live rendering.
      // NOTE: When onPartialReply is active, the dispatcherOptions.deliver callback
      // must NOT also accumulate text — it should only finalize the stream.
      onPartialReply: options?.streamEnabled
        ? async (payload) => {
            const fullText = (payload as any).text;
            if (!fullText) return;
            streamingActive = true;
            // onPartialReply gives CUMULATIVE text, not delta.
            // Extract only the new portion before passing to deliver (which accumulates).
            const delta = fullText.slice(lastPartialLength);
            lastPartialLength = fullText.length;
            if (delta) await deliver(delta);
          }
        : undefined,
      // Disable block streaming chunker — we handle streaming ourselves via onPartialReply.
      disableBlockStreaming: options?.streamEnabled,
    },
  });

  await xenaPeer.sendReadReceipt?.(msg.senderId, msg.channelId, msg.messageId);
}

