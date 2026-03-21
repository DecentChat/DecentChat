import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveDecentChatAccount } from "./channel.js";
import { getDecentChatRuntime } from "./runtime.js";
import { resolveCompanyPromptContextForAccount } from "./company-sim/prompt-context.js";
import { resolveThreadRoutingStateUpdate, type CompanyThreadRoutingState } from "./company-sim/thread-routing-state.js";
import { decideCompanyParticipation } from "./company-sim/router.js";
import { setActivePeer } from "./peer-registry.js";
import type { ResolvedDecentChatAccount } from "./types.js";

type ReplyPrefixOptions = {
  responsePrefix?: string;
  enableSlackInteractiveReplies?: boolean;
  responsePrefixContextProvider?: (ctx: Record<string, unknown>) => string | undefined;
  onModelSelected?: (modelCtx: { provider?: string; model?: string }) => void;
};

let cachedCreateReplyPrefixOptions:
  | ((params: { cfg: OpenClawConfig; agentId: string; channel: string; accountId: string }) => ReplyPrefixOptions)
  | null
  | undefined;

async function resolveReplyPrefixOptions(params: {
  cfg: OpenClawConfig;
  agentId: string;
  channel: string;
  accountId: string;
}): Promise<ReplyPrefixOptions> {
  if (cachedCreateReplyPrefixOptions === undefined) {
    try {
      const sdk = await import("openclaw/plugin-sdk") as {
        createReplyPrefixOptions?: (params: {
          cfg: OpenClawConfig;
          agentId: string;
          channel: string;
          accountId: string;
        }) => ReplyPrefixOptions;
      };
      cachedCreateReplyPrefixOptions = typeof sdk.createReplyPrefixOptions === "function"
        ? sdk.createReplyPrefixOptions
        : null;
    } catch {
      cachedCreateReplyPrefixOptions = null;
    }
  }

  if (!cachedCreateReplyPrefixOptions) {
    return {};
  }

  return cachedCreateReplyPrefixOptions(params);
}


function isCompanySimChannelMuted(account: ResolvedDecentChatAccount | undefined, chatType: IncomingPeerMessage['chatType'], channelId: string): boolean {
  if (!account?.companySim?.enabled) return false;
  if (chatType === 'direct') return false;
  const silentChannelIds = account.companySim.silentChannelIds;
  if (!Array.isArray(silentChannelIds) || silentChannelIds.length === 0) return false;

  return silentChannelIds.some((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) return false;
    return trimmed === channelId || trimmed === `decentchat:channel:${channelId}`;
  });
}

function resolveAgentWorkspaceDir(cfg: OpenClawConfig, agentId: string): string | undefined {
  const agentList = (cfg as any)?.agents?.list;
  if (!Array.isArray(agentList)) return undefined;

  const entry = agentList.find((candidate: any) => candidate && typeof candidate === "object" && candidate.id === agentId);
  if (!entry) return undefined;

  const workspace = (entry as any).workspace;
  if (typeof workspace !== "string") return undefined;

  const trimmed = workspace.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type InboundAttachment = {
  id: string;
  name: string;
  type: string;
  size?: number;
  thumbnail?: string;
  width?: number;
  height?: number;
};

type ThreadHistoryEntry = {
  id: string;
  senderId: string;
  content: string;
  timestamp: number;
};

type AssistantModelMeta = {
  modelId?: string;
  modelName?: string;
  modelAlias?: string;
  modelLabel?: string;
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
    model?: AssistantModelMeta;
  }) => Promise<void>;
  startDirectStream: (args: { peerId: string; messageId: string; model?: AssistantModelMeta }) => Promise<void>;
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
  sendTyping?: (args: { channelId: string; workspaceId: string; typing: boolean }) => Promise<void>;
  sendDirectToPeer: (peerId: string, content: string, threadId?: string, replyToId?: string, messageId?: string, model?: AssistantModelMeta) => Promise<void>;
  sendToChannel: (channelId: string, content: string, threadId?: string, replyToId?: string, messageId?: string, model?: AssistantModelMeta) => Promise<void>;
  persistMessageLocally: (channelId: string, workspaceId: string, content: string, threadId?: string, replyToId?: string, messageId?: string, model?: AssistantModelMeta) => Promise<void>;
  sendReadReceipt: (peerId: string, channelId: string, messageId: string) => Promise<void>;
  requestFullImage: (peerId: string, attachmentId: string) => Promise<Buffer | null>;
  getThreadHistory?: (args: {
    channelId: string;
    threadId: string;
    limit: number;
    excludeMessageId?: string;
  }) => Promise<ThreadHistoryEntry[]> | ThreadHistoryEntry[];
};

const TOOL_CALL_MISMATCH_RE = /^No tool call found for function call output with call_id\b/i;

/**
 * Thread affinity tracker — remembers the last active thread per sender per channel.
 *
 * When a message arrives without threadId (e.g., sent from the main channel input
 * instead of the thread panel), we check if the sender had recent thread activity
 * in this channel. If so, we route to that thread instead of creating a new one.
 *
 * This prevents session fragmentation when the client loses thread panel state
 * (page reload, navigation, etc.) while the user intends to continue the same thread.
 */
const THREAD_AFFINITY_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface ThreadAffinityEntry {
  threadId: string;
  updatedAt: number;
}

const threadAffinityMap = new Map<string, ThreadAffinityEntry>();
const threadRoutingStateMap = new Map<string, CompanyThreadRoutingState & { updatedAt: number }>();

function threadAffinityKey(channelId: string, senderId: string): string {
  return `${channelId}:${senderId}`;
}

function updateThreadAffinity(channelId: string, senderId: string, threadId: string): void {
  const key = threadAffinityKey(channelId, senderId);
  threadAffinityMap.set(key, { threadId, updatedAt: Date.now() });
}

function getThreadAffinity(channelId: string, senderId: string): string | null {
  const key = threadAffinityKey(channelId, senderId);
  const entry = threadAffinityMap.get(key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > THREAD_AFFINITY_TTL_MS) {
    threadAffinityMap.delete(key);
    return null;
  }
  return entry.threadId;
}

function threadRoutingStateKey(channelId: string, threadRef: string): string {
  return `${channelId}:${threadRef}`;
}

function updateThreadRoutingState(channelId: string, threadRef: string, state: CompanyThreadRoutingState): void {
  const key = threadRoutingStateKey(channelId, threadRef);
  threadRoutingStateMap.set(key, { ...state, updatedAt: Date.now() });
}

function getThreadRoutingState(channelId: string, threadRef: string): CompanyThreadRoutingState | null {
  const key = threadRoutingStateKey(channelId, threadRef);
  const entry = threadRoutingStateMap.get(key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > THREAD_AFFINITY_TTL_MS) {
    threadRoutingStateMap.delete(key);
    return null;
  }
  return { assignedEmployeeId: entry.assignedEmployeeId, source: entry.source };
}

export function resetThreadRoutingStateForTests(): void {
  threadAffinityMap.clear();
  threadRoutingStateMap.clear();
}

function formatThreadHistoryContent(content: string, maxChars = 220): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "[empty]";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 1))}…`;
}

function logThreadRouteDecision(
  log: { info?: (s: string) => void; debug?: (s: string) => void } | undefined,
  params: {
    chatType: "direct" | "channel";
    replyToMode: "off" | "first" | "all";
    historyScope: "thread" | "channel";
    mode: "thread" | "base";
    candidateThreadId?: string;
    derivedThreadId?: string;
    sessionKey: string;
    previousTimestampPresent: boolean;
    bootstrapReason: "enabled" | "not-thread" | "not-first-turn" | "limit-zero";
    initialHistoryLimit: number;
  },
): void {
  const message = [
    "[decentchat] route",
    `chatType=${params.chatType}`,
    `replyToMode=${params.replyToMode}`,
    `historyScope=${params.historyScope}`,
    `mode=${params.mode}`,
    `candidateThread=${params.candidateThreadId || "-"}`,
    `thread=${params.derivedThreadId || "-"}`,
    `session=${params.sessionKey}`,
    `hasSessionHistory=${params.previousTimestampPresent ? "yes" : "no"}`,
    `bootstrap=${params.bootstrapReason}`,
    `initialHistoryLimit=${params.initialHistoryLimit}`,
  ].join(" ");

  if (log?.debug) {
    log.debug(message);
    return;
  }
  log?.info?.(message);
}

function normalizeModelMeta(selection?: { provider?: string; model?: string }): AssistantModelMeta | undefined {
  if (!selection?.model && !selection?.provider) return undefined;

  const rawModel = String(selection?.model ?? "").trim();
  const rawProvider = String(selection?.provider ?? "").trim();
  const providerPrefix = rawProvider ? `${rawProvider}/` : "";

  let modelName = rawModel;
  if (providerPrefix && rawModel.startsWith(providerPrefix)) {
    modelName = rawModel.slice(providerPrefix.length);
  } else if (rawModel.includes("/")) {
    modelName = rawModel.split("/").pop() || rawModel;
  }

  const modelId = rawProvider && modelName ? `${rawProvider}/${modelName}` : (rawModel || undefined);
  const modelLabel = modelName || rawModel || undefined;

  if (!modelLabel && !modelId) return undefined;

  return {
    modelId,
    modelName: modelName || undefined,
    modelLabel,
  };
}

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
  let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let streamedReply = "";
  let streamChunkCount = 0;
  const STREAM_COALESCE_MS = 120;
  let selectedModel: AssistantModelMeta | undefined;
  const streamEnabled = ctx.account.streamEnabled !== false;
  let finalizeInFlight: Promise<void> | null = null;
  let processingComplete = false; // Guard: prevent idle timer from finalizing mid-response
  let lastSentStreamContent = "";
  let typingActive = false;

  const setTyping = async (typing: boolean) => {
    if (incoming.chatType === 'direct') return;
    if (!xenaPeer.sendTyping) return;
    if (typingActive == typing) return;
    typingActive = typing;
    try {
      await xenaPeer.sendTyping({ channelId: incoming.channelId, workspaceId: incoming.workspaceId, typing });
    } catch (err) {
      ctx.log?.warn?.(`[decentchat] typing ${typing ? 'start' : 'stop'} failed: ${String(err)}`);
    }
  };

  const flushBufferedStream = async () => {
    const content = streamedReply;
    if (!streamEnabled || !streamMessageId) return;
    if (!content.trim()) return;
    if (content === lastSentStreamContent) return;

    if (incoming.chatType === "direct") {
      await xenaPeer.sendDirectStreamDelta({
        peerId: incoming.senderId,
        messageId: streamMessageId,
        content,
      });
    } else {
      await xenaPeer.sendStreamDelta({
        channelId: incoming.channelId,
        workspaceId: incoming.workspaceId,
        messageId: streamMessageId,
        content,
      });
    }

    lastSentStreamContent = content;
    await setTyping(false);
  };

  const scheduleBufferedStreamFlush = () => {
    if (streamFlushTimer) return;
    streamFlushTimer = setTimeout(() => {
      streamFlushTimer = null;
      void flushBufferedStream().catch((err) => {
        ctx.log?.warn?.(`[decentchat] buffered stream flush failed: ${String(err)}`);
      });
    }, STREAM_COALESCE_MS);
  };

  const finalizeStream = async () => {
    // Ignore idle-timer finalize calls while LLM is still generating
    if (!processingComplete && streamMessageId) return;
    if (finalizeInFlight) {
      await finalizeInFlight;
      return;
    }

    finalizeInFlight = (async () => {
      if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = null;
      }
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }

      const mid = streamMessageId;
      streamMessageId = null;

      const finalReply = streamedReply.trim();
      ctx.log?.info?.(`[decentchat] stream telemetry: enabled=${streamEnabled} chunks=${streamChunkCount} finalChars=${finalReply.length}`);
      streamedReply = "";
      streamChunkCount = 0;
      // keep lastSentStreamContent until finalize reliability guard evaluates

      // Reliability guard: push one final full delta before stream-done, but only
      // when it adds new visible content compared to the last emitted delta.
      if (mid && streamEnabled && finalReply && finalReply !== lastSentStreamContent) {
        try {
          if (incoming.chatType === "direct") {
            await xenaPeer.sendDirectStreamDelta({
              peerId: incoming.senderId,
              messageId: mid,
              content: finalReply,
            });
          } else {
            await xenaPeer.sendStreamDelta({
              channelId: incoming.channelId,
              workspaceId: incoming.workspaceId,
              messageId: mid,
              content: finalReply,
            });
          }
          lastSentStreamContent = finalReply;
          await setTyping(false);
        } catch (err) {
          ctx.log?.warn?.(`[decentchat] finalizeStream final-delta failed: ${String(err)}`);
        }
      }

      await finalizePeerStream({
        xenaPeer,
        chatType: incoming.chatType === "direct" ? "direct" : "group",
        senderId: incoming.senderId,
        channelId: incoming.channelId,
        workspaceId: incoming.workspaceId,
        streamMessageId: mid,
      });

      if (!finalReply) {
        ctx.log?.warn?.("[decentchat] finalizeStream: empty final reply, skipping persistence");
        return;
      }

      const persistThreadId = incoming.chatType === "direct"
        ? incoming.threadId
        : (incoming.threadId ?? incoming.messageId);

      // Always send one canonical final message envelope, even after streaming.
      // It reuses the stream message ID so receivers can dedupe/update instead of
      // rendering a duplicate bubble, and it covers peers that missed live stream events.
      try {
        if (incoming.chatType === "direct") {
          await xenaPeer.sendDirectToPeer(
            incoming.senderId,
            finalReply,
            persistThreadId,
            incoming.messageId,
            mid ?? undefined,
            selectedModel,
          );
        } else {
          await xenaPeer.sendToChannel(
            incoming.channelId,
            finalReply,
            persistThreadId,
            incoming.messageId,
            mid ?? undefined,
            selectedModel,
          );
        }
        ctx.log?.info?.(
          `[decentchat] persisted assistant reply (${finalReply.length} chars) in ${incoming.chatType}${mid && streamEnabled ? ' via stream-finalize' : ''}`,
        );
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

  await setTyping(true);

  try {
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
    { accountId: ctx.accountId, account: ctx.account, log: ctx.log },
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

      const hasVisibleContent = streamedReply.trim().length > 0;

      if (streamEnabled && hasVisibleContent) {
        if (!streamMessageId) {
          streamMessageId = randomUUID();
          // Always reply in a thread (Slack-bot style): use the existing thread root,
          // or create a new thread under the inbound message.
          const outThreadId = incoming.chatType === "direct"
            ? undefined
            : (incoming.threadId ?? incoming.messageId);
          if (incoming.chatType === "direct") {
            await xenaPeer.startDirectStream({ peerId: incoming.senderId, messageId: streamMessageId, model: selectedModel });
          } else {
            await xenaPeer.startStream({
              channelId: incoming.channelId,
              workspaceId: incoming.workspaceId,
              messageId: streamMessageId,
              threadId: outThreadId,
              replyToId: incoming.messageId,
              model: selectedModel,
            });
          }
        }

        if (streamedReply !== lastSentStreamContent) {
          scheduleBufferedStreamFlush();
        }
      }

      if (hasVisibleContent) {
        if (streamTimer) clearTimeout(streamTimer);
        streamTimer = setTimeout(() => { void finalizeStream(); }, 200);
      }
    },
    undefined,
    incoming.attachments,
    fullImageBuffers,
    {
      streamEnabled,
      onModelResolved: (model) => {
        selectedModel = model;
      },
    },
  );

    processingComplete = true;

    await finalizeStream();
  } finally {
    await setTyping(false);
  }
}


type DecentChatNodePeerCtor = new (...args: any[]) => {
  start: () => Promise<void>;
  stop: () => void | Promise<void>;
  sendMessage: (...args: any[]) => Promise<any>;
  markRead?: (...args: any[]) => Promise<any>;
  listDirectory?: (...args: any[]) => Promise<any>;
};

let decentChatNodePeerCtorPromise: Promise<DecentChatNodePeerCtor> | null = null;

async function loadDecentChatNodePeerCtor(): Promise<DecentChatNodePeerCtor> {
  if (!decentChatNodePeerCtorPromise) {
    decentChatNodePeerCtorPromise = import('./peer/NodeXenaPeer.js').then((mod) => {
      const candidate = (mod as any).DecentChatNodePeer
        ?? (mod as any).NodeXenaPeer
        ?? ((mod as any).default && ((mod as any).default.DecentChatNodePeer ?? (mod as any).default.NodeXenaPeer))
        ?? (typeof (mod as any).default === 'function' ? (mod as any).default : undefined);

      if (typeof candidate !== 'function') {
        const keys = mod && typeof mod === 'object' ? Object.keys(mod as object).join(', ') : typeof mod;
        throw new Error(`DecentChat node peer constructor export missing (module keys: ${keys})`);
      }
      return candidate as DecentChatNodePeerCtor;
    });
  }
  return decentChatNodePeerCtorPromise;
}

export async function startDecentChatPeer(ctx: PeerContext): Promise<void> {
  const seedPhrase = ctx.account.seedPhrase?.trim();
  if (!seedPhrase) {
    throw new Error("DecentChat seed phrase is required: set channels.decentchat.seedPhrase");
  }

  return startNodePeerRuntime(ctx);
}

async function startNodePeerRuntime(ctx: PeerContext): Promise<void> {
  const core = getDecentChatRuntime();
  const DecentChatNodePeer = await loadDecentChatNodePeerCtor();

  let xenaPeer: InstanceType<DecentChatNodePeerCtor>;
  let finalizeStream: () => Promise<void> = async () => {};

  const openClawWorkspaceRoot = process.env.OPENCLAW_WORKSPACE_DIR?.trim()
    || path.join(os.homedir(), '.openclaw', 'workspace');

  xenaPeer = new DecentChatNodePeer({
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
    companyTemplateControl: {
      loadConfig: () => core.config.loadConfig() as Record<string, unknown>,
      writeConfigFile: async (config) => {
        await core.config.writeConfigFile(config);
      },
      workspaceRootDir: openClawWorkspaceRoot,
      companySimsRootDir: path.join(openClawWorkspaceRoot, 'company-sims'),
    },
    onHuddleTranscription: async (text, peerId, channelId, senderName) => {
      // Route voice transcription through the standard LLM pipeline,
      // but capture the response text instead of sending it over the data channel.
      return new Promise<string | undefined>((resolve) => {
        let response = '';
        const syntheticMsg = {
          messageId: randomUUID(),
          channelId: channelId || 'huddle',
          workspaceId: '',
          senderId: peerId,
          senderName,
          content: `[VOICE HUDDLE — reply in 1-2 short sentences max, conversational tone, no markdown/emoji]\n${text}`,
          chatType: 'direct' as const,
          timestamp: Date.now(),
        };

        processInboundMessage(
          syntheticMsg,
          { accountId: ctx.accountId, account: ctx.account, log: ctx.log },
          core,
          {
            sendReadReceipt: async () => {},
          },
          async (replyText) => {
            response += replyText;
          },
          (reason) => {
            ctx.log?.error?.(`[huddle-llm] error: ${reason}`);
            resolve(undefined);
          },
        ).then(() => {
          resolve(response.trim() || undefined);
        }).catch((err) => {
          ctx.log?.error?.(`[huddle-llm] pipeline error: ${String(err)}`);
          resolve(undefined);
        });
      });
    },
    log: ctx.log,
  });

  await xenaPeer.start();
  setActivePeer(xenaPeer, ctx.accountId);
  ctx.setStatus({
    running: true,
    peerId: xenaPeer.peerId,
    lastError: null,
  });

  return new Promise<void>((resolve) => {
    const shutdown = () => {
      setActivePeer(null, ctx.accountId);
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

export function resolveDecentThreadingFlags(cfg: OpenClawConfig, chatType?: "direct" | "group" | "channel"): {
  replyToMode: "off" | "first" | "all";
  historyScope: "thread" | "channel";
  inheritParent: boolean;
  initialHistoryLimit: number;
} {
  const ch = (cfg as any)?.channels?.decentchat ?? {};
  const globalReplyToMode = (ch.replyToMode === "off" || ch.replyToMode === "first" || ch.replyToMode === "all")
    ? ch.replyToMode
    : "all";
  const byType = ch.replyToModeByChatType ?? {};
  const directMode = (byType.direct === "off" || byType.direct === "first" || byType.direct === "all") ? byType.direct : undefined;
  const groupMode = (byType.group === "off" || byType.group === "first" || byType.group === "all") ? byType.group : undefined;
  const channelMode = (byType.channel === "off" || byType.channel === "first" || byType.channel === "all") ? byType.channel : undefined;

  let replyToMode = globalReplyToMode;
  if (chatType === "direct") {
    replyToMode = directMode ?? globalReplyToMode;
  } else if (chatType === "group") {
    replyToMode = groupMode ?? channelMode ?? globalReplyToMode;
  } else if (chatType === "channel") {
    replyToMode = channelMode ?? groupMode ?? globalReplyToMode;
  }
  const historyScope = (ch.thread?.historyScope === "channel" || ch.thread?.historyScope === "thread")
    ? ch.thread.historyScope
    : "thread";
  const inheritParent = ch.thread?.inheritParent === true;
  const initialHistoryLimitRaw = ch.thread?.initialHistoryLimit;
  const initialHistoryLimit = Number.isFinite(initialHistoryLimitRaw)
    ? Math.max(0, Math.floor(initialHistoryLimitRaw))
    : 20;
  return { replyToMode, historyScope, inheritParent, initialHistoryLimit };
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
  ctx: { accountId: string; account?: ResolvedDecentChatAccount; log?: any },
  core: ReturnType<typeof getDecentChatRuntime>,
  xenaPeer: Pick<StreamingPeerAdapter, "sendReadReceipt" | "getThreadHistory"> | {
    resolveChannelNameById?: (channelId: string) => string | undefined;
    sendReadReceipt?: (peerId: string, channelId: string, messageId: string) => Promise<void>;
    getThreadHistory?: (args: {
      channelId: string;
      threadId: string;
      limit: number;
      excludeMessageId?: string;
    }) => Promise<ThreadHistoryEntry[]> | ThreadHistoryEntry[];
  },
  deliver: (text: string) => Promise<void>,
  onDeliverError?: (reason: string) => void,
  attachments?: InboundAttachment[],
  fullImageBuffers?: Map<string, Buffer>,
  options?: {
    streamEnabled?: boolean;
    onModelResolved?: (model: AssistantModelMeta | undefined) => void;
  },
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
  const effectiveAccount = resolveDecentChatAccount(cfg, ctx.accountId);

  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel,
    accountId: ctx.accountId,
    peer: { kind: msg.chatType === "direct" ? "direct" : "group", id: peerId },
  });

  if (isCompanySimChannelMuted(effectiveAccount, msg.chatType, msg.channelId)) {
    ctx.log?.info?.(`[decentchat] company routing: silent account=${ctx.accountId} reason=muted-channel channel=${msg.channelId}`);
    await xenaPeer.sendReadReceipt?.(msg.senderId, msg.channelId, msg.messageId);
    return;
  }

  const agentWorkspaceDir = resolveAgentWorkspaceDir(cfg, route.agentId);

  let companyContext = null;
  let companyContextPrefix = "";
  if (ctx.account?.companySim?.enabled) {
    try {
      const resolvedCompanyPrompt = resolveCompanyPromptContextForAccount(ctx.account, {
        log: ctx.log,
        workspaceDir: agentWorkspaceDir,
        agentId: route.agentId,
      });
      if (resolvedCompanyPrompt) {
        companyContext = resolvedCompanyPrompt.context;
        companyContextPrefix = resolvedCompanyPrompt.prompt;
      }
    } catch (err) {
      ctx.log?.warn?.(`[decentchat] company context load failed for ${ctx.account.accountId}: ${String(err)}`);
    }
  }
  const channelName = msg.chatType === "channel"
    ? (xenaPeer.resolveChannelNameById?.(msg.channelId) ?? msg.channelId)
    : undefined;
  const routingThreadRef = (msg.threadId ?? msg.replyToId ?? '').trim();
  const currentThreadRoutingState = routingThreadRef
    ? getThreadRoutingState(msg.channelId, routingThreadRef)
    : null;
  if (companyContext && routingThreadRef) {
    const threadRoutingUpdate = resolveThreadRoutingStateUpdate({
      manifest: companyContext.manifest,
      text: rawBody,
    });
    if (threadRoutingUpdate) {
      updateThreadRoutingState(msg.channelId, routingThreadRef, threadRoutingUpdate);
    }
  }
  const participationDecision = decideCompanyParticipation({
    context: companyContext,
    chatType: msg.chatType === "direct" ? "direct" : "channel",
    channelNameOrId: channelName,
    text: rawBody,
    threadId: msg.threadId ?? msg.replyToId,
    threadAssignedEmployeeId: currentThreadRoutingState?.assignedEmployeeId,
  });
  if (!participationDecision.shouldRespond) {
    ctx.log?.info?.(`[decentchat] company routing: silent account=${ctx.accountId} reason=${participationDecision.reason} channel=${channelName ?? msg.channelId}`);
    await xenaPeer.sendReadReceipt?.(msg.senderId, msg.channelId, msg.messageId);
    return;
  }
  const threadingFlags = resolveDecentThreadingFlags(cfg, msg.chatType === "direct" ? "direct" : "channel");

  const baseSessionKey = route.sessionKey;
  // Thread-aware session routing (parallelism):
  // - prefer explicit threadId (from thread panel)
  // - fallback to replyToId ONLY when auto-threading is not active
  const explicitThreadId = (msg.threadId ?? "").trim();
  const fallbackThreadId = (msg.replyToId ?? "").trim();

  // Only use replyToId as thread fallback when explicit threadId is absent.
  let candidateThreadId = explicitThreadId || fallbackThreadId;

  // Thread affinity: when a message arrives without explicit thread metadata in a
  // group channel, check if this sender was recently active in a thread. If so,
  // route to that thread instead of creating a brand-new auto-thread. This keeps
  // the session stable when the client loses thread panel state (page reload, UI
  // reset, etc.) and matches user intent more often than spawning a fresh thread.
  let affinityApplied = false;
  if (!candidateThreadId && msg.chatType !== "direct" && threadingFlags.replyToMode === "all") {
    const affinityThreadId = getThreadAffinity(msg.channelId, msg.senderId);
    if (affinityThreadId) {
      candidateThreadId = affinityThreadId;
      affinityApplied = true;
      ctx.log?.info?.(`[decentchat] thread-affinity: sender=${msg.senderId.slice(0, 8)} → thread=${affinityThreadId.slice(0, 8)} (channel=${msg.channelId.slice(0, 8)})`);
    }
  }

  // Auto-thread eligible: channel message without explicit thread context or
  // affinity match when replyToMode=all. In this mode each top-level message gets
  // its own parallel session.
  const autoThreadEligible = !candidateThreadId && msg.chatType !== "direct" && threadingFlags.replyToMode === "all";

  // When auto-thread eligible, use the message's own ID as the thread so
  // it gets a unique parallel session and the reply appears as a thread reply.
  const autoThreadId = autoThreadEligible ? msg.messageId : "";

  // Slack-compatible knobs:
  // - replyToMode=off => never route per-thread
  // - thread.historyScope=channel => keep base channel session
  const threadingDisabled = threadingFlags.replyToMode === "off" || threadingFlags.historyScope === "channel";
  const derivedThreadId = threadingDisabled ? "" : (candidateThreadId || autoThreadId);
  const isThreadReply = Boolean(derivedThreadId && (derivedThreadId !== msg.messageId || autoThreadId));

  const threadKeys = resolveThreadSessionKeys({
    baseSessionKey,
    threadId: isThreadReply ? derivedThreadId : undefined,
    parentSessionKey: isThreadReply && threadingFlags.inheritParent ? baseSessionKey : undefined,
  });
  const sessionKey = threadKeys.sessionKey;

  // Update thread affinity for this sender so future messages without threadId
  // can be routed to the same thread (within the TTL window).
  // Skip for auto-thread messages: affinity is not consulted in auto-thread mode,
  // so updating it would only pollute the map with per-message thread IDs.
  if (isThreadReply && !autoThreadEligible && msg.chatType !== "direct" && derivedThreadId) {
    updateThreadAffinity(msg.channelId, msg.senderId, derivedThreadId);
  }

  const fromLabel = msg.chatType === "direct" ? msg.senderName : `${msg.senderName} in ${msg.channelId}`;
  const storePath = core.channel.session.resolveStorePath(cfg.session?.store, { agentId: route.agentId });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey,
  });
  // Bootstrap context only for genuine reply-based thread entry on the first turn.
  // Auto-threaded top-level channel messages must start clean (Slack-like), or they
  // inherit stale base-channel context into a brand-new thread session.
  const shouldBootstrapFromBase = isThreadReply
    && !previousTimestamp
    && !autoThreadEligible
    && threadingFlags.initialHistoryLimit > 0;
  const bootstrapParentSessionKey = shouldBootstrapFromBase ? baseSessionKey : undefined;
  const effectiveParentSessionKey = threadKeys.parentSessionKey ?? bootstrapParentSessionKey;

  const bootstrapReason = !isThreadReply
    ? "not-thread"
    : previousTimestamp
      ? "not-first-turn"
      : autoThreadEligible
        ? "auto-thread-clean"
        : threadingFlags.initialHistoryLimit <= 0
          ? "limit-zero"
          : "enabled";
  logThreadRouteDecision(ctx.log, {
    chatType: msg.chatType,
    replyToMode: threadingFlags.replyToMode,
    historyScope: threadingFlags.historyScope,
    mode: isThreadReply ? "thread" : "base",
    candidateThreadId,
    derivedThreadId,
    sessionKey,
    previousTimestampPresent: Boolean(previousTimestamp),
    bootstrapReason,
    initialHistoryLimit: threadingFlags.initialHistoryLimit,
  });

  let threadContextPrefix = "";
  let threadHistoryCount = 0;
  const shouldBootstrapThreadHistory = isThreadReply && !previousTimestamp && threadingFlags.initialHistoryLimit > 0;
  if (shouldBootstrapThreadHistory && xenaPeer.getThreadHistory) {
    try {
      const history = await Promise.resolve(
        xenaPeer.getThreadHistory({
          channelId: msg.channelId,
          threadId: derivedThreadId,
          limit: threadingFlags.initialHistoryLimit,
          excludeMessageId: msg.messageId,
        }),
      );
      if (history.length > 0) {
        const lines = history.map((entry) => {
          const senderLabel = entry.senderId === msg.senderId
            ? msg.senderName
            : entry.senderId.slice(0, 8);
          return `- ${senderLabel}: ${formatThreadHistoryContent(entry.content)}`;
        });
        threadContextPrefix = `[Thread context: last ${history.length} messages]\n${lines.join("\n")}`;
        threadHistoryCount = history.length;
        ctx.log?.debug?.(`[decentchat] thread-bootstrap thread=${derivedThreadId} fetched=${history.length} limit=${threadingFlags.initialHistoryLimit}`);
      }
    } catch (err) {
      ctx.log?.warn?.(`[decentchat] thread history bootstrap failed: ${String(err)}`);
    }
  }

  if (shouldBootstrapThreadHistory && !xenaPeer.getThreadHistory) {
    ctx.log?.warn?.("[decentchat] thread history bootstrap requested but adapter does not expose getThreadHistory");
  }

  const contextPrefixes = [companyContextPrefix, threadContextPrefix].filter((value) => value && value.trim().length > 0);
  const contextPrefix = contextPrefixes.join("\n\n");
  const bodySource = contextPrefix ? `${contextPrefix}\n\n${rawBody}` : rawBody;
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "DecentChat",
    from: fromLabel,
    timestamp: msg.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: bodySource,
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
    ReplyToId: isThreadReply ? derivedThreadId : undefined,
    MessageThreadId: isThreadReply ? derivedThreadId : undefined,
    ParentSessionKey: effectiveParentSessionKey,
    IsFirstThreadTurn: isThreadReply && !previousTimestamp ? true : undefined,
    ThreadBootstrapHistoryCount: threadHistoryCount > 0 ? threadHistoryCount : undefined,
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

  const { onModelSelected, ...prefixOptions } = await resolveReplyPrefixOptions({
    cfg,
    agentId: route.agentId,
    channel,
    accountId: ctx.accountId,
  });

  const onModelSelectedWithCapture = (modelCtx: { provider?: string; model?: string }) => {
    const normalized = normalizeModelMeta(modelCtx);
    options?.onModelResolved?.(normalized);
    onModelSelected?.(modelCtx as any);
  };

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
      onModelSelected: onModelSelectedWithCapture,
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
