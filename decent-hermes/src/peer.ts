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

export class DecentHermesPeer {
  private peer: DecentChatNodePeer | null = null;
  private config: BridgeConfig;
  private messageBuffer: IncomingMessage[] = [];
  private connected = false;
  private alias: string;
  private dataDir: string;

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
      streamEnabled: false,
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
        if (!this.shouldForwardIncomingMessage(params)) {
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
        warn: (s) => console.warn('[decent-hermes-peer]', s),
        error: (s) => console.error('[decent-hermes-peer]', s),
      },
    });

    await this.peer.start();
    this.connected = true;

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
    await this.peer?.destroy();
    this.peer = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.peer !== null;
  }

  private shouldForwardIncomingMessage(params: {
    chatType: 'direct' | 'channel';
    content: string;
  }): boolean {
    if (params.chatType === 'direct') return true;
    return this.messageMentionsBot(params.content);
  }

  private messageMentionsBot(content: string): boolean {
    if (!content || !content.includes('@')) return false;

    const normalizedContent = this.normalizeMentionValue(content);
    const alias = this.alias.trim();
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
      await this.peer.sendDirectToPeer(peerId, body, effectiveThreadId, replyToId, undefined, model);
    } else if (chatId.startsWith('voice:')) {
      const channelId = chatId.slice(6);
      await this.peer.sendToChannel(channelId, body, effectiveThreadId, replyToId, undefined, model);
    } else {
      const colonIdx = chatId.indexOf(':');
      if (colonIdx < 0) throw new Error(`Invalid chatId: ${chatId}`);
      // chatId is "workspaceId:channelId"; sendToChannel resolves the workspace itself
      const channelId = chatId.slice(colonIdx + 1);
      await this.peer.sendToChannel(channelId, body, effectiveThreadId, replyToId, undefined, model);
    }
    return messageId;
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
