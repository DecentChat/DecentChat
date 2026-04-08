// MUST be first — installs RTCPeerConnection globals
import './peer/polyfill.js';

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DecentChatNodePeer } from './peer/DecentChatNodePeer.js';
import type { ResolvedDecentChatAccount } from './types.js';

// Tune PeerTransport heartbeat timings for interactive chat use.
// Defaults are 30s ping / 20s pong / 2 missed = ~100s to detect a dead
// WebRTC data channel, which is way too slow when the user is actively
// waiting for a reply. Override via the static properties (supported
// because the class uses writable configurable property descriptors).
import { PeerTransport as _PT } from '@decentchat/transport-webrtc';
try {
  // Use defaults — aggressive heartbeat tuning was killing working connections
  // when traffic bursts (streaming protocol, sync floods) saturated the data
  // channel and pongs queued behind data messages.
  // Defaults: 30s ping / 20s pong / 2 missed = ~100s detection.
  console.log('[decent-hermes-bridge] PeerTransport heartbeat: defaults (30s/20s/2)');
} catch (err) {
  console.warn('[decent-hermes-bridge] Could not tune PeerTransport heartbeat:', err);
}

export interface BridgeConfig {
  seedPhrase: string;
  signalingServer?: string;
  dataDir?: string;
  alias?: string;
  invites?: string[];
  // Voice/huddle config
  huddleEnabled?: boolean;
  huddleAutoJoin?: boolean;
  sttEngine?: 'whisper-cpp' | 'whisper-python' | 'openai' | 'groq' | 'gemini';
  whisperModel?: string;
  sttLanguage?: string;
  sttApiKey?: string;
  ttsEngine?: 'elevenlabs' | 'gemini';
  ttsModel?: string;
  ttsApiKey?: string;
  ttsVoice?: string;
  vadSilenceMs?: number;
  vadThreshold?: number;
  // Called when voice transcription needs an LLM response
  // Returns the reply text (or undefined to skip TTS)
  onVoiceTranscription?: (text: string, chatId: string, senderName: string) => Promise<string | undefined>;
}

export interface IncomingMessage {
  id: string;
  chatId: string;       // "{workspaceId}:{channelId}" or "dm:{peerId}"
  senderId: string;
  senderAlias: string;
  body: string;
  timestamp: number;
  chatType: 'direct' | 'channel';
  isGroup: boolean;
  workspaceId: string;
  voiceInput?: boolean; // true if this was transcribed from voice
  threadId?: string;
  replyToId?: string;
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    size?: number;
    thumbnail?: string;
    width?: number;
    height?: number;
  }>;
}

type StreamModelMeta = {
  modelId?: string;
  modelName?: string;
  modelAlias?: string;
  modelLabel?: string;
};

type ActiveStreamState = {
  chatId: string;
  isDirect: boolean;
  peerId?: string;
  channelId: string;
  workspaceId: string;
  threadId?: string;
  replyToId?: string;
  model?: StreamModelMeta;
  chunks: string[];
};

export class DecentHermesPeer {
  private peer: DecentChatNodePeer | null = null;
  private config: BridgeConfig;
  private messageBuffer: IncomingMessage[] = [];
  private connected = false;
  private alias: string;
  private dataDir: string;
  private activeStreams = new Map<string, ActiveStreamState>();

  // ── Signaling-state tracking ─────────────────────────────────────────────
  // We mirror the underlying PeerTransport's signaling state here so that
  // `isConnected()` (and therefore the bridge's `/health` endpoint) reports
  // the *actual* transport state instead of the bridge process's "I once
  // managed to call start() successfully" liveness. Without this, a stuck
  // PeerJS signaling drop in Node leaves /health forever returning
  // {"connected": true} while no peers can actually reach us.
  private hasSignalingState = false;
  private anySignalingConnected = false;
  private signalingDownSince: number | null = null;
  private signalingStuckLastLogAt = 0;
  private signalingWatchdog: ReturnType<typeof setInterval> | null = null;
  // After signaling has been fully down for this long with no recovery, the
  // bridge logs a loud SOS once per minute. We deliberately do NOT call
  // `process.exit` here: the bridge is not currently supervised by anything
  // that would respawn it, so dying would be worse than zombieing.
  private static readonly SIGNALING_STUCK_THRESHOLD_MS = 10 * 60 * 1000;
  private static readonly SIGNALING_WATCHDOG_INTERVAL_MS = 30_000;
  private static readonly SIGNALING_STUCK_LOG_INTERVAL_MS = 60_000;

  constructor(config: BridgeConfig) {
    this.config = config;
    this.alias = config.alias ?? 'Hermes Agent';
    this.dataDir = config.dataDir ?? join(homedir(), '.hermes', 'decentchat', 'data');
    mkdirSync(this.dataDir, { recursive: true });
  }

  async start(): Promise<void> {
    const account: ResolvedDecentChatAccount = {
      accountId: 'default',
      enabled: true,
      dmPolicy: 'open',
      configured: true,
      seedPhrase: this.config.seedPhrase,
      signalingServer: this.config.signalingServer ?? 'https://0.peerjs.com/',
      invites: this.config.invites ?? [],
      alias: this.alias,
      dataDir: this.dataDir,
      streamEnabled: true,
      replyToMode: 'all',
      replyToModeByChatType: {},
      thread: { historyScope: 'thread', inheritParent: false, initialHistoryLimit: 20 },
      huddle: this.config.huddleEnabled !== false ? {
        enabled: true,
        autoJoin: this.config.huddleAutoJoin ?? true,
        sttEngine: this.config.sttEngine ?? 'whisper-cpp',
        whisperModel: this.config.whisperModel,
        sttLanguage: this.config.sttLanguage,
        sttApiKey: this.config.sttApiKey,
        ttsEngine: this.config.ttsEngine,
        ttsModel: this.config.ttsModel,
        ttsApiKey: this.config.ttsApiKey,
        ttsVoice: this.config.ttsVoice,
        vadSilenceMs: this.config.vadSilenceMs,
        vadThreshold: this.config.vadThreshold,
      } : undefined,
    };

    this.peer = new DecentChatNodePeer({
      account,
      onIncomingMessage: async (params) => {
        // Always log the arrival at the bridge→agent seam so operators can
        // distinguish "message never reached the bridge" from "message
        // reached the bridge but was filtered out". Previously a channel
        // post with no @mention was silently dropped here, making it
        // impossible to tell the bridge and the agent apart when debugging
        // "I sent a message and got no reply" reports.
        const decision = this.shouldForwardIncomingMessage({
          chatType: params.chatType,
          content: params.content,
          channelId: params.channelId,
          threadId: params.threadId,
        });
        const previewLen = Math.min(params.content.length, 80);
        const preview = params.content.slice(0, previewLen).replace(/\s+/g, ' ');
        const forwardTag = decision.reason
          ? `${decision.forward}(${decision.reason})`
          : String(decision.forward);
        console.log(
          `[decent-hermes-peer] inbound message ` +
          `chatType=${params.chatType} ` +
          `from=${(params.senderName || params.senderId).slice(0, 24)} ` +
          `chan=${(params.channelId || '').slice(0, 8)} ` +
          `ws=${(params.workspaceId || '').slice(0, 8)} ` +
          `thread=${(params.threadId || '').slice(0, 8)} ` +
          `len=${params.content.length} ` +
          `forward=${forwardTag}` +
          (!decision.forward
            ? ` reason=channel_post_without_mention (mention @${this.alias || 'Xena'} to get a reply, or reply inside a thread she's in)`
            : '') +
          ` text="${preview}${params.content.length > previewLen ? '…' : ''}"`
        );
        if (!decision.forward) {
          return;
        }
        const chatId = params.chatType === 'direct'
          ? `dm:${params.senderId}`
          : `${params.workspaceId}:${params.channelId}`;
        this.messageBuffer.push({
          id: params.messageId,
          chatId,
          senderId: params.senderId,
          senderAlias: params.senderName,
          body: params.content,
          timestamp: params.timestamp,
          chatType: params.chatType,
          isGroup: params.chatType === 'channel',
          workspaceId: params.workspaceId,
          // Forward thread/reply info so the Hermes adapter can build a
          // per-thread session_key (enabling parallel conversations).
          threadId: params.threadId,
          replyToId: params.replyToId,
          attachments: params.attachments,
        });
      },
      onReply: () => {},
      onHuddleTranscription: this.config.onVoiceTranscription
        ? async (text, peerId, channelId, senderName) => {
            const chatId = `voice:${channelId}`;
            // Also emit as a regular message so Python adapter sees it
            this.messageBuffer.push({
              id: randomUUID(),
              chatId,
              senderId: peerId,
              senderAlias: senderName,
              body: text,
              timestamp: Date.now(),
              chatType: 'channel',
              isGroup: true,
              workspaceId: channelId,
              voiceInput: true,
            });
            return this.config.onVoiceTranscription!(text, chatId, senderName);
          }
        : undefined,
      log: {
        info: (s) => console.log('[decent-hermes-peer]', s),
        // Wire debug → console too so subsystems that log via opts.log?.debug?.()
        // (e.g. the peer-auth challenge handler in DecentChatNodePeer) actually
        // surface in bridge.log. Without this, every `log?.debug?.()` is a
        // silent no-op and we lose all visibility into the auth round-trip.
        debug: (s) => console.log('[decent-hermes-peer:debug]', s),
        warn: (s) => console.warn('[decent-hermes-peer]', s),
        error: (s) => console.error('[decent-hermes-peer]', s),
      },
    });

    await this.peer.start();
    this.connected = true;

    // Hook the underlying PeerTransport's signaling-state changes so we can
    // make `isConnected()` honest. The first event flips `hasSignalingState`
    // to true; from then on `isConnected()` reports the live state. Until
    // then we trust the successful start() above (the start path requires
    // at least one signaling server to come up).
    const transportForState = (this.peer as any).transport;
    if (transportForState && typeof transportForState === 'object') {
      // Seed initial state from a snapshot if the transport exposes one.
      try {
        if (typeof transportForState.getSignalingStatus === 'function') {
          const initialStatus = transportForState.getSignalingStatus() as Array<{ connected: boolean }>;
          if (Array.isArray(initialStatus) && initialStatus.length > 0) {
            this.hasSignalingState = true;
            this.anySignalingConnected = initialStatus.some((s) => s.connected);
            if (!this.anySignalingConnected) {
              this.signalingDownSince = Date.now();
            }
          }
        }
      } catch (err) {
        console.warn('[decent-hermes-bridge] Failed to read initial signaling status:', err);
      }

      // Live updates.
      transportForState.onSignalingStateChange = (status: Array<{ url: string; label: string; connected: boolean }>) => {
        this.handleSignalingStateChange(status);
      };
    } else {
      // Transport not exposed — leave isConnected() trusting the connected flag.
      console.warn('[decent-hermes-bridge] Underlying PeerTransport not accessible — /health will not reflect live signaling state');
    }

    // Start the SOS watchdog now that the peer is up. It is `unref()`'d so
    // it doesn't block process exit on its own.
    this.startSignalingWatchdog();

    // Optionally attach additional signaling servers (comma-separated via
    // DECENTCHAT_EXTRA_SIGNALING env var). This lets a single Xena instance
    // be reachable via BOTH public 0.peerjs.com and a local PeerJS server,
    // which helps avoid signaling-shard discovery issues.
    const extra = (process.env.DECENTCHAT_EXTRA_SIGNALING ?? '').split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (extra.length > 0) {
      const transport = (this.peer as any).transport;
      if (transport && typeof transport.addSignalingServer === 'function') {
        for (const url of extra) {
          try {
            const ok = await transport.addSignalingServer(url, url);
            console.log(`[decent-hermes-bridge] Extra signaling ${url}: ${ok ? 'attached' : 'failed'}`);
          } catch (err: any) {
            console.warn(`[decent-hermes-bridge] Failed to attach ${url}: ${err?.message ?? err}`);
          }
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.signalingWatchdog) {
      clearInterval(this.signalingWatchdog);
      this.signalingWatchdog = null;
    }
    await this.peer?.destroy();
    this.peer = null;
    this.connected = false;
    this.hasSignalingState = false;
    this.anySignalingConnected = false;
    this.signalingDownSince = null;
    this.signalingStuckLastLogAt = 0;
    this.activeStreams.clear();
  }

  /**
   * Live connectivity check exposed via the bridge's `/health` endpoint.
   *
   * Returns false when:
   *   - the peer has been stopped (or never started)
   *   - we have observed at least one signaling-state event AND no signaling
   *     server is currently connected
   *
   * Until the first signaling-state event arrives we trust the successful
   * `start()` path: that path itself requires at least one signaling server
   * to come up, so the brief pre-event window is safe.
   */
  isConnected(): boolean {
    if (!this.connected || !this.peer) return false;
    if (!this.hasSignalingState) return true;
    return this.anySignalingConnected;
  }

  /**
   * Diagnostic helper exposed for tests / future health endpoints. Returns a
   * snapshot of the bridge's view of signaling: number of connected servers,
   * number of total instances seen, and how long signaling has been down (if
   * down). Returns null when the bridge has not yet observed any state.
   */
  getSignalingState(): {
    hasState: boolean;
    anyConnected: boolean;
    downForMs: number | null;
  } {
    return {
      hasState: this.hasSignalingState,
      anyConnected: this.anySignalingConnected,
      downForMs: this.signalingDownSince ? Date.now() - this.signalingDownSince : null,
    };
  }

  /**
   * Handler invoked from the underlying PeerTransport whenever any signaling
   * server flips connection state. Pure state-tracking — never throws and
   * never reaches the network. The transport's own reconnect logic (and the
   * periodic safety-net probe added in this fix) handles actual recovery.
   */
  private handleSignalingStateChange(
    status: Array<{ url: string; label: string; connected: boolean }>,
  ): void {
    this.hasSignalingState = true;
    const previouslyAnyConnected = this.anySignalingConnected;
    this.anySignalingConnected = status.some((s) => s.connected);

    if (this.anySignalingConnected) {
      if (this.signalingDownSince) {
        const downMs = Date.now() - this.signalingDownSince;
        console.log(
          `[decent-hermes-bridge] Signaling recovered after ${(downMs / 1000).toFixed(1)}s`,
        );
      }
      this.signalingDownSince = null;
      this.signalingStuckLastLogAt = 0;
    } else {
      if (!this.signalingDownSince) {
        this.signalingDownSince = Date.now();
        if (previouslyAnyConnected) {
          console.warn(
            '[decent-hermes-bridge] All signaling servers disconnected — relying on transport probe to recover',
          );
        }
      }
    }
  }

  /**
   * Periodic SOS watchdog. After signaling has been fully down for
   * `SIGNALING_STUCK_THRESHOLD_MS`, log a loud warning every
   * `SIGNALING_STUCK_LOG_INTERVAL_MS` so an operator can grep for it. We
   * deliberately do NOT call `process.exit` — the bridge is not currently
   * supervised, so dying would leave Xena permanently offline. The
   * transport-side periodic probe is responsible for actual recovery.
   */
  private startSignalingWatchdog(): void {
    if (this.signalingWatchdog) return;
    this.signalingWatchdog = setInterval(() => {
      if (!this.signalingDownSince) return;
      const downMs = Date.now() - this.signalingDownSince;
      if (downMs < DecentHermesPeer.SIGNALING_STUCK_THRESHOLD_MS) return;
      const sinceLastLog = Date.now() - this.signalingStuckLastLogAt;
      if (sinceLastLog < DecentHermesPeer.SIGNALING_STUCK_LOG_INTERVAL_MS) return;
      this.signalingStuckLastLogAt = Date.now();
      console.error(
        `[decent-hermes-bridge] SOS: signaling has been down for ${(downMs / 1000).toFixed(0)}s — ` +
          `transport probe is still trying to reconnect, but you are effectively offline. ` +
          `Consider restarting the bridge if this persists.`,
      );
    }, DecentHermesPeer.SIGNALING_WATCHDOG_INTERVAL_MS);
    if (typeof (this.signalingWatchdog as any).unref === 'function') {
      (this.signalingWatchdog as any).unref();
    }
  }

  private shouldForwardIncomingMessage(params: {
    chatType: 'direct' | 'channel';
    content: string;
    channelId?: string;
    threadId?: string;
  }): { forward: boolean; reason?: string } {
    if (params.chatType === 'direct') return { forward: true };

    // 1) Explicit mention (either @alias or bare "Xena" as a word).
    if (this.messageMentionsBot(params.content)) {
      return { forward: true };
    }

    // 2) Implicit mention via thread context: if we've already posted in
    //    this thread, any follow-up there is clearly directed at us.
    //    Users shouldn't have to re-`@Xena` on every turn inside a
    //    thread the bot is already participating in.
    if (
      params.threadId &&
      params.channelId &&
      this.peer?.hasMyMessageInChannelThread(params.channelId, params.threadId)
    ) {
      return { forward: true, reason: 'active_thread' };
    }

    return { forward: false };
  }

  private messageMentionsBot(content: string): boolean {
    if (!content) return false;

    // 1) Bare alias as a whole word (case-insensitive). A channel post
    //    like "hi Xena how are ya" should wake the bot — users shouldn't
    //    have to remember the @ prefix to talk to a bot that's named in
    //    the sentence. `\b...\b` anchors on word boundaries so we don't
    //    match the bot name inside unrelated words (e.g. "Xenakis",
    //    "xenomorph"). Regex metacharacters in the alias are escaped so
    //    an alias like "Xena.bot" doesn't accidentally behave as a
    //    regex pattern.
    const alias = this.alias.trim();
    if (alias) {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Hyphenated form: "Xena Agent" → also match "Xena-Agent"
      const hyphenated = alias.replace(/\s+/g, '-')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const aliasPatterns: string[] = [`\\b${escapedAlias}\\b`];
      if (hyphenated !== escapedAlias) {
        aliasPatterns.push(`\\b${hyphenated}\\b`);
      }
      const aliasRegex = new RegExp(aliasPatterns.join('|'), 'i');
      if (aliasRegex.test(content)) {
        return true;
      }
    }

    // 2) Explicit `@alias` / `@peerId` mention token parsing. This is the
    //    original path — still valuable for strict matching and for
    //    peer-id mentions that wouldn't match as a bare-word alias.
    if (!content.includes('@')) return false;

    const normalizedContent = this.normalizeMentionValue(content);
    if (alias) {
      const normalizedAlias = this.normalizeMentionValue(alias);
      const hyphenatedAlias = this.normalizeMentionValue(alias.replace(/\s+/g, '-'));
      if (
        normalizedContent.includes(`@${normalizedAlias}`) ||
        normalizedContent.includes(`@${hyphenatedAlias}`)
      ) {
        return true;
      }
    }

    const mentionTokens = content.match(/(^|\s)@[A-Za-z0-9_.:-]+/g) ?? [];
    if (mentionTokens.length === 0) return false;

    const mentionTargets = this.getMentionTargets();
    for (const token of mentionTokens) {
      const mentionValue = this.normalizeMentionValue(token.replace(/^\s*@/, ''));
      if (mentionTargets.has(mentionValue)) {
        return true;
      }
    }
    return false;
  }

  private getMentionTargets(): Set<string> {
    const targets = new Set<string>();

    const alias = this.alias.trim();
    if (alias) {
      targets.add(this.normalizeMentionValue(alias));
      targets.add(this.normalizeMentionValue(alias.replace(/\s+/g, '-')));
    }

    const peerId = this.peer?.peerId?.trim();
    if (peerId) {
      targets.add(this.normalizeMentionValue(peerId));
      if (peerId.length >= 8) targets.add(this.normalizeMentionValue(peerId.slice(0, 8)));
    }

    return targets;
  }

  private normalizeMentionValue(value: string): string {
    return value.trim().toLowerCase();
  }

  drainMessages(): IncomingMessage[] {
    const msgs = [...this.messageBuffer];
    this.messageBuffer = [];
    return msgs;
  }

  async sendMessage(
    chatId: string,
    body: string,
    voiceReply = false,
    replyToId?: string,
    threadId?: string,
    model?: any,
  ): Promise<string> {
    if (!this.peer) throw new Error('Peer not started');
    const messageId = randomUUID();
    // Default thread to the message we're replying to so replies thread naturally
    const effectiveThreadId = threadId ?? replyToId;

    // Wait briefly for peer connectivity before sending. This avoids the
    // common case where a brief network blip / WebRTC reconnect cycle puts
    // the recipient in the offline queue, leaving the user staring at no
    // response until they manually refresh.
    await this.waitForRecipientConnectivity(chatId, 5000);

    // Parse chatId: "workspaceId:channelId" or "dm:peerId" or "voice:channelId"
    if (chatId.startsWith('dm:')) {
      const peerId = chatId.slice(3);
      await this.peer.sendDirectToPeer(peerId, body, effectiveThreadId, replyToId, messageId, model);
    } else if (chatId.startsWith('voice:')) {
      const channelId = chatId.slice(6);
      await this.peer.sendToChannel(channelId, body, effectiveThreadId, replyToId, messageId, model);
    } else {
      const colonIdx = chatId.indexOf(':');
      if (colonIdx < 0) throw new Error(`Invalid chatId: ${chatId}`);
      // chatId is "workspaceId:channelId"; sendToChannel resolves the workspace itself
      const channelId = chatId.slice(colonIdx + 1);
      await this.peer.sendToChannel(channelId, body, effectiveThreadId, replyToId, messageId, model);
    }
    return messageId;
  }

  async startStream(
    chatId: string,
    options: {
      replyTo?: string;
      threadId?: string;
      model?: StreamModelMeta;
      messageId?: string;
    } = {},
  ): Promise<string> {
    if (!this.peer) throw new Error('Peer not started');
    const messageId = options.messageId ?? randomUUID();
    const effectiveThreadId = options.threadId ?? options.replyTo;

    await this.waitForRecipientConnectivity(chatId, 5000);

    if (chatId.startsWith('dm:')) {
      const peerId = chatId.slice(3);
      await this.peer.startDirectStream({
        peerId,
        messageId,
        ...(options.model ? { model: options.model } : {}),
      });
      this.activeStreams.set(messageId, {
        chatId,
        isDirect: true,
        peerId,
        channelId: peerId,
        workspaceId: 'direct',
        threadId: effectiveThreadId,
        replyToId: options.replyTo,
        model: options.model,
        chunks: [],
      });
      return messageId;
    }

    const colonIdx = chatId.indexOf(':');
    const isVoice = chatId.startsWith('voice:');
    const channelId = isVoice ? chatId.slice(6) : colonIdx >= 0 ? chatId.slice(colonIdx + 1) : '';
    if (!channelId) throw new Error(`Invalid chatId: ${chatId}`);
    const workspaceId = isVoice
      ? (this.resolveWorkspaceForChannel(channelId) ?? '')
      : chatId.slice(0, colonIdx);

    await this.peer.startStream({
      channelId,
      workspaceId,
      messageId,
      ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
      ...(options.replyTo ? { replyToId: options.replyTo } : {}),
      ...(options.model ? { model: options.model } : {}),
    });
    this.activeStreams.set(messageId, {
      chatId,
      isDirect: false,
      channelId,
      workspaceId,
      threadId: effectiveThreadId,
      replyToId: options.replyTo,
      model: options.model,
      chunks: [],
    });
    return messageId;
  }

  async appendStream(chatId: string, messageId: string, content: string): Promise<void> {
    if (!this.peer) throw new Error('Peer not started');
    if (!messageId) throw new Error('messageId required');
    if (!content) return;

    let state = this.activeStreams.get(messageId);
    if (!state) {
      await this.startStream(chatId, { messageId });
      state = this.activeStreams.get(messageId);
      if (!state) throw new Error(`Failed to initialize stream: ${messageId}`);
    }

    state.chunks.push(content);
    if (state.isDirect) {
      await this.peer.sendDirectStreamDelta({
        peerId: state.peerId!,
        messageId,
        content,
      });
      return;
    }

    await this.peer.sendStreamDelta({
      channelId: state.channelId,
      workspaceId: state.workspaceId,
      messageId,
      content,
    });
  }

  async finishStream(chatId: string, messageId: string): Promise<void> {
    if (!this.peer) throw new Error('Peer not started');
    if (!messageId) throw new Error('messageId required');

    let state = this.activeStreams.get(messageId);
    if (!state) {
      await this.startStream(chatId, { messageId });
      state = this.activeStreams.get(messageId);
      if (!state) throw new Error(`Failed to initialize stream: ${messageId}`);
    }

    if (state.isDirect) {
      await this.peer.sendDirectStreamDone({
        peerId: state.peerId!,
        messageId,
      });
    } else {
      await this.peer.sendStreamDone({
        channelId: state.channelId,
        workspaceId: state.workspaceId,
        messageId,
      });
    }

    const fullContent = state.chunks.join('').trim();
    if (fullContent) {
      await this.peer.persistMessageLocally(
        state.channelId,
        state.workspaceId,
        fullContent,
        state.threadId,
        state.replyToId,
        messageId,
        state.model,
      );
    }

    this.activeStreams.delete(messageId);
  }

  /**
   * Wait until at least one recipient peer is connected, up to timeoutMs.
   * For DMs: waits for the specific peer.
   * For channels: waits for at least one channel member.
   * Returns immediately if already connected. Returns silently on timeout
   * (caller falls through to send anyway, which will queue/custody the message).
   */
  private async waitForRecipientConnectivity(chatId: string, timeoutMs: number): Promise<void> {
    if (!this.peer) return;
    const transport = (this.peer as any).transport;
    if (!transport || typeof transport.getConnectedPeers !== 'function') return;

    const myPeerId = (this.peer as any).myPeerId as string | undefined;
    const targetPeers: string[] = [];

    if (chatId.startsWith('dm:')) {
      targetPeers.push(chatId.slice(3));
    } else {
      // Channel: look up all members of the workspace except ourselves
      let channelId: string;
      if (chatId.startsWith('voice:')) {
        channelId = chatId.slice(6);
      } else {
        const colonIdx = chatId.indexOf(':');
        if (colonIdx < 0) return;
        channelId = chatId.slice(colonIdx + 1);
      }
      try {
        const workspaces = (this.peer as any).workspaceManager?.getAllWorkspaces?.() ?? [];
        for (const ws of workspaces) {
          if (!ws.channels?.some((ch: any) => ch.id === channelId)) continue;
          for (const m of ws.members ?? []) {
            if (m.peerId && m.peerId !== myPeerId) targetPeers.push(m.peerId);
          }
        }
      } catch {}
    }

    if (targetPeers.length === 0) return;

    const isAnyConnected = (): boolean => {
      const connected: string[] = transport.getConnectedPeers();
      return targetPeers.some((p) => connected.includes(p));
    };

    if (isAnyConnected()) return;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      if (isAnyConnected()) return;
    }
    // Timeout: caller proceeds, message goes to offline queue / custody
  }

  /** Send typing indicator (start or stop) for a chat. */
  async sendTyping(chatId: string, typing: boolean): Promise<void> {
    if (!this.peer) return;
    if (chatId.startsWith('dm:')) {
      const peerId = chatId.slice(3);
      await this.peer.sendDirectTyping({ peerId, typing });
    } else if (chatId.startsWith('voice:')) {
      // No typing for voice channels
      return;
    } else {
      const colonIdx = chatId.indexOf(':');
      if (colonIdx < 0) return;
      const workspaceId = chatId.slice(0, colonIdx);
      const channelId = chatId.slice(colonIdx + 1);
      await this.peer.sendTyping({ channelId, workspaceId, typing });
    }
  }

  private resolveWorkspaceForChannel(channelId: string): string | undefined {
    if (!this.peer) return undefined;
    // Access workspaceManager via the peer (it's private, so we use a workaround)
    // Try all workspaces to find the one containing this channel
    try {
      const workspaces = (this.peer as any).workspaceManager?.getAllWorkspaces?.() ?? [];
      for (const ws of workspaces) {
        if (ws.channels?.some((ch: any) => ch.id === channelId)) {
          return ws.id;
        }
      }
    } catch {}
    return undefined;
  }

  async getChatInfo(chatId: string): Promise<{ name: string; type: string; chat_id: string }> {
    if (chatId.startsWith('dm:')) {
      const peerId = chatId.slice(3);
      const truncatedPeerId =
        peerId.length > 16 ? `${peerId.slice(0, 8)}...${peerId.slice(-4)}` : peerId;
      const aliasFromDirectory = this.peer
        ?.listDirectoryPeersLive({ query: peerId, limit: 20 })
        .find((entry) => entry.id === peerId)
        ?.name
        ?.trim();
      const aliasFromCache = ((this.peer as any)?.store?.get?.(`peer-alias-${peerId}`, '') as string | undefined)?.trim();
      return {
        name: aliasFromDirectory || aliasFromCache || truncatedPeerId,
        type: 'private',
        chat_id: chatId,
      };
    }
    if (chatId.startsWith('voice:')) {
      return { name: `Voice: ${chatId.slice(6)}`, type: 'voice', chat_id: chatId };
    }
    const colonIdx = chatId.indexOf(':');
    if (colonIdx < 0) return { name: chatId, type: 'unknown', chat_id: chatId };
    const workspaceId = chatId.slice(0, colonIdx);
    const channelId = chatId.slice(colonIdx + 1);
    try {
      const workspaces = (this.peer as any).workspaceManager?.getAllWorkspaces?.() ?? [];
      for (const ws of workspaces) {
        if (ws.id === workspaceId) {
          const ch = ws.channels?.find((c: any) => c.id === channelId);
          return {
            name: ch?.name ?? channelId,
            type: 'group',
            chat_id: chatId,
          };
        }
      }
    } catch {}
    return { name: channelId, type: 'group', chat_id: chatId };
  }
}
