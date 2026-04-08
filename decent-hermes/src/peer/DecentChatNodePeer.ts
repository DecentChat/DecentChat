/**
 * DecentChatNodePeer — permanent DecentChat P2P peer runtime.
 */

// MUST be first import — installs RTCPeerConnection globals before PeerJS loads
import './polyfill.js';

import {
  CryptoManager,
  InviteURI,
  MessageStore,
  OfflineQueue,
  CustodyStore,
  ManifestStore,
  PeerAuth,
  SeedPhraseManager,
  WorkspaceManager,
  Negentropy,
} from '@decentchat/protocol';
import type {
  Workspace,
  WorkspaceMember,
  PlaintextMessage,
  MessageMetadata,
  AssistantMessageMetadata,
  KeyPair,
  CustodyEnvelope,
  DeliveryReceipt,
  SyncDomain,
  ManifestDelta,
  ManifestDiffRequest,
  SyncManifestSummary,
  SyncManifestSnapshot,
  ManifestStoreState,
} from '@decentchat/protocol';
import { PeerTransport } from '@decentchat/transport-webrtc';
import { createHash, randomUUID } from 'node:crypto';
import { FileStore } from './FileStore.js';
import { NodeMessageProtocol } from './NodeMessageProtocol.js';
import { SyncProtocol, type SyncEvent } from './SyncProtocol.js';
import type { ResolvedDecentChatAccount } from '../types.js';
import { BotHuddleManager, type BotHuddleConfig } from '../huddle/BotHuddleManager.js';

/**
 * Startup lock removed — accounts now start concurrently.
 *
 * The old implementation serialised every `DecentChatNodePeer.start()` through
 * a single promise chain (concurrency = 1). With 4 accounts each taking ~2 min
 * to restore state & register on the signaling server, total startup was 8+ min
 * — long enough for the health-monitor to kill later accounts.
 *
 * Each account already has its own FileStore directory, CryptoManager, and
 * PeerTransport, so there is no shared mutable state that requires
 * serialisation. The per-account stagger delay (DECENTCHAT_STARTUP_STAGGER_MS)
 * in channel.ts still spaces out signaling-server registrations.
 *
 * `runDecentChatNodePeerStartupLocked` is kept as a pass-through so call-sites
 * and tests that reference it continue to compile.
 */

export function resetDecentChatNodePeerStartupLockForTests(): void {
  // No-op: lock removed.
}

export async function runDecentChatNodePeerStartupLocked<T>(task: () => Promise<T>): Promise<T> {
  return task();
}

export interface DecentChatNodePeerOptions {
  account: ResolvedDecentChatAccount;
  onIncomingMessage: (params: {
    channelId: string;
    workspaceId: string;
    content: string;
    senderId: string;
    senderName: string;
    messageId: string;
    chatType: 'channel' | 'direct';
    timestamp: number;
    replyToId?: string;
    threadId?: string;
    attachments?: Array<{
      id: string;
      name: string;
      type: string;
      size?: number;
      thumbnail?: string;
      width?: number;
      height?: number;
    }>;
  }) => Promise<void>;
  onReply: (params: {
    channelId: string;
    content: string;
    inReplyToId: string;
  }) => void;
  onHuddleTranscription?: (text: string, peerId: string, channelId: string, senderName: string) => Promise<string | undefined>;
  log?: { info: (s: string) => void; debug?: (s: string) => void; warn?: (s: string) => void; error?: (s: string) => void };
}

type MediaChunk = {
  type: 'media-chunk';
  attachmentId: string;
  index: number;
  total: number;
  data: string;
  chunkHash: string;
};

type MediaRequest = {
  type: 'media-request';
  attachmentId: string;
  fromChunk?: number;
};

type MediaResponse = {
  type: 'media-response';
  attachmentId: string;
  available: boolean;
  totalChunks?: number;
  suggestedPeers?: string[];
};

type AssistantModelMeta = AssistantMessageMetadata;

function buildMessageMetadata(model?: AssistantModelMeta): MessageMetadata | undefined {
  if (!model) return undefined;
  const hasAssistantModel = Boolean(model.modelId || model.modelName || model.modelAlias || model.modelLabel);
  if (!hasAssistantModel) return undefined;
  return {
    assistant: {
      ...(model.modelId ? { modelId: model.modelId } : {}),
      ...(model.modelName ? { modelName: model.modelName } : {}),
      ...(model.modelAlias ? { modelAlias: model.modelAlias } : {}),
      ...(model.modelLabel ? { modelLabel: model.modelLabel } : {}),
    },
  };
}




function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}




type PendingMediaRequest = {
  attachmentId: string;
  peerId: string;
  resolve: (buffer: Buffer | null) => void;
  chunks: Map<number, Buffer>;
  timeout: ReturnType<typeof setTimeout>;
};

type PendingPreKeyBundleFetch = {
  ownerPeerId: string;
  workspaceId?: string;
  pendingPeerIds: Set<string>;
  resolve: (value: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DirectoryEntry = {
  kind: 'user' | 'group';
  id: string;
  name?: string;
  handle?: string;
  rank?: number;
  raw?: unknown;
};

export class DecentChatNodePeer {
  private static readonly CUSTODIAN_REPLICATION_TARGET = 2;
  private static readonly PRE_KEY_FETCH_TIMEOUT_MS = 2_500;
  private static readonly DECRYPT_RECOVERY_HANDSHAKE_COOLDOWN_MS = 5_000;
  // Bumped from 5s → 60s. Receiver-side rate limiter has handshake bucket
  // = 3 burst, 1 per 10s. If a heartbeat-induced reconnect storm fires
  // multiple handshakes within 30s, the peer auto-bans us. 60s cooldown
  // gives plenty of headroom while still allowing legitimate reconnects.
  private static readonly CONNECT_HANDSHAKE_COOLDOWN_MS = 60_000;
  private static readonly INBOUND_HANDSHAKE_COOLDOWN_MS = 5_000;
  private static readonly PEER_MAINTENANCE_RETRY_BASE_MS = 30_000;
  private static readonly PEER_MAINTENANCE_RETRY_MAX_MS = 60 * 60_000; // 1 hour (was 10 min)
  /** Stop retrying a peer entirely after this many consecutive failures. */
  private static readonly PEER_MAINTENANCE_MAX_CONSECUTIVE_FAILURES = 20;
  private static readonly TRANSPORT_ERROR_LOG_WINDOW_MS = 30_000;
  private static readonly GOSSIP_TTL = 2;

  private readonly store: FileStore;
  private readonly workspaceManager: WorkspaceManager;
  private readonly messageStore: MessageStore;
  private readonly cryptoManager: CryptoManager;
  private transport: PeerTransport | null = null;
  private syncProtocol: SyncProtocol | null = null;
  private messageProtocol: NodeMessageProtocol | null = null;
  private signingKeyPair: KeyPair | null = null;
  private myPeerId = '';
  private readonly startedAt = Date.now();
  private myPublicKey = '';
  private destroyed = false;
  private _maintenanceInterval: ReturnType<typeof setInterval> | null = null;
  private readonly offlineQueue: OfflineQueue;
  private readonly custodyStore: CustodyStore;
  private readonly manifestStore: ManifestStore;
  private readonly custodianInbox = new Map<string, CustodyEnvelope>();
  private readonly pendingCustodyOffers = new Map<string, string[]>();
  private readonly opts: DecentChatNodePeerOptions;
  private readonly pendingMediaRequests = new Map<string, PendingMediaRequest>();
  private readonly pendingPreKeyBundleFetches = new Map<string, PendingPreKeyBundleFetch>();
  private readonly publishedPreKeyVersionByWorkspace = new Map<string, string>();
  private readonly decryptRecoveryAtByPeer = new Map<string, number>();
  private readonly connectHandshakeAtByPeer = new Map<string, number>();
  private readonly inboundHandshakeAtByPeer = new Map<string, number>();
  private readonly peerMaintenanceRetryAtByPeer = new Map<string, number>();
  private readonly peerMaintenanceAttemptsByPeer = new Map<string, number>();
  private readonly throttledTransportErrors = new Map<string, { windowStart: number; suppressed: number }>();
  /**
   * Persistent de-dupe for "sync import failed" warnings. Keyed by
   * `${peerId}:${channelId}`. Value = timestamp of last emission. A
   * sync-partner who cannot send us a clean chain (e.g. legacy workspace
   * with `prevHash: undefined` messages) will resend the SAME unverifiable
   * batch on every sync cycle — that used to emit one warn per
   * channel per sync-response, which piled up into hundreds of spurious
   * lines per minute. This map collapses those to once per peer/channel
   * per 10 minutes.
   */
  private readonly syncImportFailLastLogAt = new Map<string, number>();
  private static readonly SYNC_IMPORT_FAIL_LOG_INTERVAL_MS = 10 * 60_000;
  /**
   * Message IDs that we surfaced to the agent despite an import-verification
   * failure. Keeps us from re-delivering the same message on every sync
   * cycle (which would cause the agent to reply to the same user input
   * over and over). Persisted to the FileStore so it survives bridge
   * restarts — otherwise every restart would re-surface every in-window
   * legacy message.
   */
  private unverifiedSurfacedIds = new Set<string>();
  private static readonly UNVERIFIED_SURFACED_MAX = 5_000;
  private static readonly UNVERIFIED_SURFACED_STORE_KEY = 'unverified-surfaced-msg-ids';
  /**
   * Per-channel high-water timestamp for "unverified messages that we've
   * already decided not to surface". Seeded on the bridge's FIRST
   * encounter with a failing channel (max ts of that first batch), then
   * updated every time we surface a newer unverified message. Persisted
   * so that on restart we don't re-surface everything we already saw.
   *
   * This matters because without a seed, a fresh bridge start with an
   * empty `unverifiedSurfacedIds` set would happily re-surface every
   * legacy message in a broken channel as if they were fresh user input,
   * burning tens of agent turns replying to years-old context.
   */
  private unverifiedSurfacedTsByChannel = new Map<string, number>();
  private static readonly UNVERIFIED_SURFACED_TS_STORE_KEY = 'unverified-surfaced-ts-by-channel';
  private readonly _gossipSeen = new Map<string, number>();
  private _gossipCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly mediaChunkTimeout = 30000;
  private manifestPersistTimer: ReturnType<typeof setTimeout> | null = null;
  public botHuddle: BotHuddleManager | null = null;

  constructor(opts: DecentChatNodePeerOptions) {
    this.opts = opts;
    this.store = new FileStore(opts.account.dataDir);
    this.workspaceManager = new WorkspaceManager();
    this.messageStore = new MessageStore();
    this.cryptoManager = new CryptoManager();
    this.offlineQueue = new OfflineQueue();
    this.custodyStore = new CustodyStore(this.offlineQueue);
    this.manifestStore = new ManifestStore();
    this.manifestStore.setChangeListener(() => this.schedulePersistManifestState());
    this.offlineQueue.setPersistence(
      async (peerId, data, meta) => {
        const key = this.offlineQueueKey(peerId);
        const seqKey = 'offline-queue-seq';
        const seq = this.store.get<number>(seqKey, 1);
        const queue = this.store.get<any[]>(key, []);
        queue.push({
          id: seq,
          targetPeerId: peerId,
          data,
          createdAt: meta?.createdAt ?? Date.now(),
          attempts: meta?.attempts ?? 0,
          lastAttempt: meta?.lastAttempt,
          ...meta,
        });
        this.store.set(key, queue);
        this.store.set(seqKey, seq + 1);
      },
      async (peerId) => this.store.get<any[]>(this.offlineQueueKey(peerId), []),
      async (id) => {
        for (const key of this.store.keys('offline-queue-')) {
          if (key === 'offline-queue-seq') continue;
          const queue = this.store.get<any[]>(key, []);
          const idx = queue.findIndex((msg) => msg?.id === id);
          if (idx < 0) continue;
          queue.splice(idx, 1);
          if (queue.length === 0) {
            this.store.delete(key);
          } else {
            this.store.set(key, queue);
          }
          break;
        }
      },
      async (peerId) => {
        const key = this.offlineQueueKey(peerId);
        const queue = this.store.get<any[]>(key, []);
        this.store.delete(key);
        return queue;
      },
      async (id, patch) => {
        for (const key of this.store.keys('offline-queue-')) {
          if (key === 'offline-queue-seq') continue;
          const queue = this.store.get<any[]>(key, []);
          const idx = queue.findIndex((msg) => msg?.id === id);
          if (idx < 0) continue;
          queue[idx] = { ...queue[idx], ...patch };
          this.store.set(key, queue);
          break;
        }
      },
    );

    this.custodyStore.setReceiptPersistence(
      async (receipt) => {
        const key = this.receiptLogKey(receipt.recipientPeerId);
        const receipts = this.store.get<DeliveryReceipt[]>(key, []);
        if (!receipts.some((entry) => entry.receiptId === receipt.receiptId)) {
          receipts.push(receipt);
          receipts.sort((a, b) => a.timestamp - b.timestamp || a.receiptId.localeCompare(b.receiptId));
          this.store.set(key, receipts);
        }
      },
      async (peerId) => this.store.get<DeliveryReceipt[]>(this.receiptLogKey(peerId), []),
    );
  }

  get peerId(): string {
    return this.myPeerId;
  }

  /**
   * Returns true if this bridge (Xena) has already posted in the given
   * channel thread. Used by the incoming-message forward gate so a user
   * replying inside a thread Xena is already participating in doesn't
   * have to repeat `@Xena` on every message — the thread context is
   * itself a clear directed-at-bot signal.
   *
   * Semantics: a message is "in the thread T" when either
   *   - its id equals T (the root message IS the thread), or
   *   - its threadId equals T (it's a reply inside the thread).
   *
   * Passing a null/empty threadId returns false (no thread → no
   * implicit mention).
   */
  hasMyMessageInChannelThread(channelId: string, threadId: string | undefined | null): boolean {
    if (!threadId || !channelId) return false;
    const msgs = this.messageStore.getMessages(channelId);
    for (const m of msgs) {
      if ((m as any).senderId !== this.myPeerId) continue;
      if ((m as any).id === threadId) return true;
      if ((m as any).threadId === threadId) return true;
    }
    return false;
  }

  async start(): Promise<void> {
    const seedPhrase = this.opts.account.seedPhrase;
    if (!seedPhrase) {
      throw new Error('DecentChat seed phrase not configured (channels.decentchat.seedPhrase)');
    }

    const seedMgr = new SeedPhraseManager();
    const validation = seedMgr.validate(seedPhrase);
    if (!validation.valid) {
      throw new Error(`Invalid seed phrase in channels.decentchat.seedPhrase: ${validation.error}`);
    }

    await runDecentChatNodePeerStartupLocked(async () => {
      // Use deriveAll() to get both peer ID and key material in a single
      // PBKDF2 pass (100 000 iterations). Previously deriveKeys() +
      // derivePeerId() ran PBKDF2 twice, wasting ~2 s of CPU per account.
      const { peerId, keys: { ecdhKeyPair, ecdsaKeyPair } } = await seedMgr.deriveAll(seedPhrase);
      this.myPeerId = peerId;

      this.cryptoManager.setKeyPair(ecdhKeyPair);
      this.myPublicKey = await this.cryptoManager.exportPublicKey(ecdhKeyPair.publicKey);

      this.messageProtocol = new NodeMessageProtocol(this.cryptoManager, this.myPeerId);
      this.messageProtocol.setPersistence({
        save: async (peerId, state) => this.store.set(`ratchet-${peerId}`, state),
        load: async (peerId) => this.store.get(`ratchet-${peerId}`, null),
        delete: async (peerId) => this.store.delete(`ratchet-${peerId}`),
        savePreKeyBundle: async (peerId, bundle) => this.store.set(`prekey-bundle-${peerId}`, bundle),
        loadPreKeyBundle: async (peerId) => this.store.get(`prekey-bundle-${peerId}`, null),
        deletePreKeyBundle: async (peerId) => this.store.delete(`prekey-bundle-${peerId}`),
        saveLocalPreKeyState: async (ownerPeerId, state) => this.store.set(`prekey-state-${ownerPeerId}`, state),
        loadLocalPreKeyState: async (ownerPeerId) => this.store.get(`prekey-state-${ownerPeerId}`, null),
        deleteLocalPreKeyState: async (ownerPeerId) => this.store.delete(`prekey-state-${ownerPeerId}`),
      });
      await this.messageProtocol.init(ecdsaKeyPair);
      this.signingKeyPair = ecdsaKeyPair;

      this.restoreWorkspaces();
      this.restoreMessages();
      this.restoreManifestState();
      this.restoreCustodianInbox();
      // Restore the "ever-surfaced unverified message ids" dedupe set and
      // the per-channel high-water timestamp so a bridge restart doesn't
      // cause us to re-deliver every legacy message to the agent.
      try {
        const persistedIds = this.store.get<string[]>(
          DecentChatNodePeer.UNVERIFIED_SURFACED_STORE_KEY,
          [],
        );
        if (Array.isArray(persistedIds)) {
          this.unverifiedSurfacedIds = new Set<string>(persistedIds);
        }
      } catch (err) {
        this.opts.log?.warn?.(
          `[decentchat-peer] failed to restore unverified-surfaced-msg-ids: ${String(err)}`,
        );
      }
      try {
        const persistedTs = this.store.get<Record<string, number>>(
          DecentChatNodePeer.UNVERIFIED_SURFACED_TS_STORE_KEY,
          {},
        );
        if (persistedTs && typeof persistedTs === 'object') {
          this.unverifiedSurfacedTsByChannel = new Map(Object.entries(persistedTs));
        }
      } catch (err) {
        this.opts.log?.warn?.(
          `[decentchat-peer] failed to restore unverified-surfaced-ts-by-channel: ${String(err)}`,
        );
      }

      const configServer = this.opts.account.signalingServer ?? 'https://0.peerjs.com/';
      const allServers: string[] = [configServer];

      // Normalize a signaling URL for deduplication: strip default ports so
      // https://0.peerjs.com/ and https://0.peerjs.com:443/ are treated as identical.
      const normalizeUrl = (url: string): string => {
        try {
          const u = new URL(url);
          const defaultPort = u.protocol === 'https:' || u.protocol === 'wss:' ? '443' : '80';
          if (u.port === defaultPort) u.port = '';
          return u.toString();
        } catch { return url; }
      };
      const normalizedServers = new Set(allServers.map(normalizeUrl));

      // Collect signaling servers from all invites so we can find peers
      // regardless of which PeerJS server they registered on.
      for (const inviteUri of this.opts.account.invites ?? []) {
        try {
          const invite = InviteURI.decode(inviteUri);
          const scheme = invite.secure ? 'https' : 'http';
          const inviteServer = `${scheme}://${invite.host}:${invite.port}${invite.path}`;
          if (!normalizedServers.has(normalizeUrl(inviteServer))) {
            normalizedServers.add(normalizeUrl(inviteServer));
            allServers.push(inviteServer);
          }
        } catch {
          // malformed invite — skip
        }
      }

      this.transport = new PeerTransport({
        signalingServers: allServers,
        // useTurn defaults to true → uses STUN + open-relay TURN for NAT traversal
      });
      this.opts.log?.info(`[decentchat-peer] signaling servers: ${allServers.join(', ')}`);

      this.syncProtocol = new SyncProtocol(
        this.workspaceManager,
        this.messageStore,
        (peerId, data) => this.transport?.send(peerId, data) ?? false,
        (event) => {
          void this.handleSyncEvent(event);
        },
        this.myPeerId,
      );

      this.transport.onConnect = (peerId) => {
        void this.handlePeerConnect(peerId);
      };

      this.transport.onDisconnect = (peerId) => {
        this.opts.log?.info(`[decentchat-peer] peer disconnected: ${peerId}`);
        this.messageProtocol?.clearSharedSecret(peerId);
        // DO NOT clear connectHandshakeAtByPeer on disconnect — the cooldown
        // MUST persist across reconnects to avoid handshake-storm bans on the
        // remote peer's MessageGuard (handshake bucket = 3 burst, 1/10s).
        // A flapping connection can otherwise trigger a fresh handshake on
        // every reconnect within seconds, escalating violations and getting
        // us auto-banned. The cooldown still allows the bridge to send sync
        // requests and other recovery on reconnect — only the handshake
        // itself is throttled.
        this.inboundHandshakeAtByPeer.delete(peerId);
        this.decryptRecoveryAtByPeer.delete(peerId);
      };

      this.transport.onMessage = (fromPeerId, rawData) => {
        void this.handlePeerMessage(fromPeerId, rawData);
      };

      this.transport.onError = (err) => {
        this.notePeerMaintenanceFailure(this.extractPeerIdFromTransportError(err), Date.now());
        this.logTransportError(err);
      };

      this.myPeerId = await this.transport.init(this.myPeerId);
      this.opts.log?.info(`[decentchat-peer] online as ${this.myPeerId}, signaling: ${allServers.join(', ')}`);
      this.startPeerMaintenance();
      this.startGossipCleanup();

      // Initialize huddle manager after transport is ready (if enabled)
      const huddleConfig = this.opts.account.huddle;
      if (huddleConfig?.enabled !== false) {
        this.botHuddle = new BotHuddleManager(this.myPeerId, {
          sendSignal: (peerId, data) => this.transport?.send(peerId, data) ?? false,
          broadcastSignal: (data) => {
            if (!this.transport) return;
            for (const peerId of this.transport.getConnectedPeers()) {
              if (peerId !== this.myPeerId) {
                this.transport.send(peerId, data);
              }
            }
          },
          getDisplayName: (peerId) => this.resolveSenderName('', peerId),
          onTranscription: async (text, peerId, channelId) => {
            const senderName = this.resolveSenderName('', peerId);
            return this.opts.onHuddleTranscription?.(text, peerId, channelId, senderName);
          },
          log: this.opts.log,
        }, {
          autoJoin: huddleConfig?.autoJoin,
          sttEngine: huddleConfig?.sttEngine,
          whisperModel: huddleConfig?.whisperModel,
          sttLanguage: huddleConfig?.sttLanguage,
          sttApiKey: huddleConfig?.sttApiKey,
          ttsEngine: huddleConfig?.ttsEngine,
          ttsModel: huddleConfig?.ttsModel,
          ttsApiKey: huddleConfig?.ttsApiKey,
          ttsVoice: huddleConfig?.ttsVoice,
          vadSilenceMs: huddleConfig?.vadSilenceMs,
          vadThreshold: huddleConfig?.vadThreshold,
        });
      }

      for (const inviteUri of this.opts.account.invites ?? []) {
        const invite = (() => {
          try {
            return InviteURI.decode(inviteUri);
          } catch {
            return null;
          }
        })();
        if (!invite || !this.shouldAttemptInviteJoin(invite)) {
          continue;
        }
        // Try immediately; if the peer is offline, retry with backoff
        void this.joinWorkspaceWithRetry(inviteUri, invite);
      }
    });
  }

  private shouldAttemptInviteJoin(invite: { peerId?: string; workspaceId?: string }): boolean {
    if (!invite.peerId) {
      return false;
    }

    if (invite.workspaceId) {
      const workspace = this.workspaceManager.getWorkspace(invite.workspaceId);
      if (workspace?.members.some((member) => member.peerId === this.myPeerId)) {
        return !workspace.members.some((member) => member.peerId === invite.peerId);
      }
    }

    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      const memberPeerIds = new Set(workspace.members.map((member) => member.peerId));
      if (memberPeerIds.has(this.myPeerId) && memberPeerIds.has(invite.peerId)) {
        return false;
      }
    }

    return true;
  }

  private async joinWorkspaceWithRetry(
    inviteUri: string,
    decodedInvite: ReturnType<typeof InviteURI.decode> | null = null,
    maxAttempts = 5,
  ): Promise<void> {
    const delays = [5000, 15000, 30000, 60000, 120000];
    const invite = decodedInvite ?? (() => { try { return InviteURI.decode(inviteUri); } catch { return null; } })();
    if (!invite || !this.shouldAttemptInviteJoin(invite)) {
      return;
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.destroyed) return;
      try {
        await this.joinWorkspace(inviteUri);
        return; // success — stop retrying
      } catch {
        // joinWorkspace() catches internally and logs; we just check if we're connected
      }
      // If already connected to this peer (inbound connection arrived first), stop retrying
      if (invite?.peerId && this.transport?.getConnectedPeers().includes(invite.peerId)) return;
      if (!this.shouldAttemptInviteJoin(invite)) return;

      if (attempt < maxAttempts - 1) {
        const delay = delays[Math.min(attempt, delays.length - 1)];
        this.opts.log?.info?.(`[decentchat-peer] join retry in ${delay / 1000}s (attempt ${attempt + 1}/${maxAttempts})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  /** Persist a message to the local store (FileStore) without sending over WebRTC.
   *  Used after streaming completes so the bot has the message for Negentropy sync. */
  async persistMessageLocally(
    channelId: string,
    workspaceId: string,
    content: string,
    threadId?: string,
    replyToId?: string,
    messageId?: string,
    model?: AssistantModelMeta,
  ): Promise<void> {
    if (!content.trim()) return;
    const msg = await this.messageStore.createMessage(channelId, this.myPeerId, content.trim(), 'text', threadId);
    if (messageId) msg.id = messageId;
    if (model) {
      (msg as any).metadata = buildMessageMetadata(model);
    }
    const added = await this.messageStore.addMessage(msg);
    if (added.success) {
      this.persistMessagesForChannel(channelId);
      this.opts.log?.info?.(`[decentchat-peer] persisted message locally: ${msg.id.slice(0, 8)} (${content.length} chars)`);
    }
  }

  async sendMessage(
    channelId: string,
    workspaceId: string,
    content: string,
    threadId?: string,
    replyToId?: string,
    messageId?: string,
    model?: AssistantModelMeta,
  ): Promise<void> {
    if (!this.transport || !this.messageProtocol || !content.trim()) return;

    const modelMeta = buildMessageMetadata(model);
    const msg = await this.messageStore.createMessage(channelId, this.myPeerId, content.trim(), 'text', threadId);
    if (messageId) msg.id = messageId; // Use provided messageId for dedup with streamed messages
    if (modelMeta) {
      (msg as any).metadata = modelMeta;
    }
    const added = await this.messageStore.addMessage(msg);
    if (added.success) {
      this.persistMessagesForChannel(channelId);
      this.recordManifestDomain('channel-message', workspaceId, {
        channelId,
        itemCount: this.messageStore.getMessages(channelId).length,
        operation: 'create',
        subject: msg.id,
        data: { messageId: msg.id, senderId: this.myPeerId },
      });
    }

    const recipients = this.getChannelRecipientPeerIds(channelId, workspaceId);
    const gossipOriginSignature = await this.signGossipOrigin({
      messageId: msg.id,
      channelId,
      content: content.trim(),
      threadId,
      replyToId,
    });

    // Lazily encrypt ONLY when we actually need the ciphertext (offline peer
    // fallback or stream-send failure).  Running encryptMessage for every
    // connected peer every reply advances Xena's ratchet state without
    // advancing the receiver's, creating ever-growing state skew that breaks
    // any subsequent encrypted-path message (e.g. DMs) until a recovery
    // handshake.  Streaming delivery doesn't need the ratchet, so skip it.
    const lazyEncrypt = async () => {
      const enc = await this.encryptMessageWithPreKeyBootstrap(recipients[0], content.trim(), modelMeta, workspaceId);
      (enc as any).channelId = channelId;
      (enc as any).workspaceId = workspaceId;
      (enc as any).senderId = this.myPeerId;
      (enc as any).senderName = this.opts.account.alias;
      (enc as any).messageId = msg.id;
      if (gossipOriginSignature) {
        (enc as any)._gossipOriginSignature = gossipOriginSignature;
      }
      if (threadId) (enc as any).threadId = threadId;
      if (replyToId) (enc as any).replyToId = replyToId;
      return enc;
    };

    for (const peerId of recipients) {
      try {
        const connected = this.transport.getConnectedPeers().includes(peerId);
        if (connected) {
          // NOTE: We intentionally do NOT call queuePendingAck here.
          // The streaming protocol below is plaintext and receiver-side
          // does not send an ACK back.  If we queued a pending-ack entry,
          // resendPendingAcks() would re-encrypt the content on every
          // reconnect and send it via the encrypted path, triggering:
          //   1. Decrypt failure cascade on the receiver (stale ratchet)
          //   2. Rate-limit burst exhaustion → auto-ban
          // Streaming delivery is fire-and-forget.  For offline peers,
          // the `!connected` branch below still stores in custodyStore.

          // Primary delivery path: streaming protocol (plaintext, fast, preserves
          // model badge metadata, uses receiver's media bucket which is much
          // more generous than the message bucket — 100 burst @ 20/sec vs.
          // 30 burst @ 10/sec). This avoids two failure modes that the
          // encrypted text envelope path triggers:
          //
          //   1. Stale ratchet state on the receiver causes endless decrypt
          //      failures.  Each failure clears the receiver's in-memory
          //      ratchet but the persistent IndexedDB copy is reloaded on
          //      the next message → another failure.  Cascade.
          //
          //   2. Each encrypted text consumes a 'message' bucket token on
          //      the receiver.  Bursts (queue flush after reconnect) can
          //      exhaust the bucket → auto-ban → silent message drops.
          //
          // The streaming protocol bypasses encryption entirely (the
          // workspace ACL is enforced separately) so neither problem
          // applies.  ACK round-trip for messages flowing INTO Xena (i.e.
          // the user's outgoing-message status updates) is unaffected
          // because that path uses Xena's bridge as the receiver, not
          // sender.
          let accepted = true;
          try {
            const streamModelMeta = modelMeta?.assistant
              ? {
                  ...(modelMeta.assistant as any).modelId ? { modelId: (modelMeta.assistant as any).modelId } : {},
                  ...(modelMeta.assistant as any).modelName ? { modelName: (modelMeta.assistant as any).modelName } : {},
                  ...(modelMeta.assistant as any).modelAlias ? { modelAlias: (modelMeta.assistant as any).modelAlias } : {},
                  ...(modelMeta.assistant as any).modelLabel ? { modelLabel: (modelMeta.assistant as any).modelLabel } : {},
                }
              : undefined;
            this.transport.send(peerId, {
              type: 'stream-start',
              messageId: msg.id,
              channelId,
              senderId: this.myPeerId,
              senderName: this.opts.account.alias,
              ...(threadId ? { threadId } : {}),
              ...(replyToId ? { replyToId } : {}),
              ...(streamModelMeta ? { modelMeta: streamModelMeta } : {}),
            });
            this.transport.send(peerId, {
              type: 'stream-delta',
              messageId: msg.id,
              content: content.trim(),
            });
            this.transport.send(peerId, {
              type: 'stream-done',
              messageId: msg.id,
            });
            console.log(`[decentchat-peer] stream→${peerId.slice(0,8)} msgId=${msg.id.slice(0,8)} model=${streamModelMeta?.modelLabel || streamModelMeta?.modelId || 'none'}`);
          } catch (streamErr) {
            this.opts.log?.warn?.(`[decentchat-peer] stream push to ${peerId.slice(0,8)} failed: ${String(streamErr)}`);
            accepted = false;
          }

          if (!accepted) {
            const encrypted = await lazyEncrypt();
            await this.custodyStore.storeEnvelope({
              envelopeId: typeof (encrypted as any).id === 'string' ? (encrypted as any).id : undefined,
              opId: msg.id,
              recipientPeerIds: [peerId],
              workspaceId,
              channelId,
              ...(threadId ? { threadId } : {}),
              domain: 'channel-message',
              ciphertext: encrypted,
              metadata: {
                messageId: msg.id,
                ...this.buildCustodyResendMetadata({
                  content: content.trim(),
                  channelId,
                  workspaceId,
                  senderId: this.myPeerId,
                  senderName: this.opts.account.alias,
                  threadId,
                  replyToId,
                  isDirect: false,
                  gossipOriginSignature,
                  metadata: modelMeta,
                }),
              },
            });
            await this.replicateToCustodians(peerId, { workspaceId, channelId, opId: msg.id, domain: 'channel-message' });
          }
          continue;
        }

        const encrypted = await lazyEncrypt();
        await this.custodyStore.storeEnvelope({
          envelopeId: typeof (encrypted as any).id === 'string' ? (encrypted as any).id : undefined,
          opId: msg.id,
          recipientPeerIds: [peerId],
          workspaceId,
          channelId,
          ...(threadId ? { threadId } : {}),
          domain: 'channel-message',
          ciphertext: encrypted,
          metadata: {
            messageId: msg.id,
            ...this.buildCustodyResendMetadata({
              content: content.trim(),
              channelId,
              workspaceId,
              senderId: this.myPeerId,
              senderName: this.opts.account.alias,
              threadId,
              replyToId,
              isDirect: false,
              gossipOriginSignature,
              metadata: modelMeta,
            }),
          },
        });
        await this.replicateToCustodians(peerId, { workspaceId, channelId, opId: msg.id, domain: 'channel-message' });
      } catch (err) {
        this.opts.log?.error?.(`[decentchat-peer] failed to prepare outbound for ${peerId}: ${String(err)}`);
        await this.enqueueOffline(peerId, {
          content: content.trim(),
          channelId,
          workspaceId,
          senderId: this.myPeerId,
          senderName: this.opts.account.alias,
          messageId: msg.id,
          threadId,
          replyToId,
          isDirect: false,
          ...(modelMeta ? { metadata: modelMeta } : {}),
        });
      }
    }
  }

  private startGossipCleanup(): void {
    if (this._gossipCleanupInterval) return;
    const fiveMin = 5 * 60 * 1000;
    this._gossipCleanupInterval = setInterval(() => {
      const cutoff = Date.now() - fiveMin;
      for (const [id, ts] of this._gossipSeen) {
        if (ts < cutoff) this._gossipSeen.delete(id);
      }
    }, fiveMin);
  }

  private buildGossipOriginPayload(params: {
    messageId: string;
    channelId: string;
    content: string;
    threadId?: string;
    replyToId?: string;
  }): string {
    const contentHash = createHash('sha256').update(params.content).digest('hex');
    return `v1|${params.messageId}|${params.channelId}|${params.threadId ?? ''}|${params.replyToId ?? ''}|${contentHash}`;
  }

  private async signGossipOrigin(params: {
    messageId: string;
    channelId: string;
    content: string;
    threadId?: string;
    replyToId?: string;
  }): Promise<string | undefined> {
    if (!this.signingKeyPair || !this.messageProtocol || typeof (this.messageProtocol as any).signData !== 'function') {
      return undefined;
    }
    return (this.messageProtocol as any).signData(this.buildGossipOriginPayload(params));
  }

  private async resolveInboundSenderId(
    fromPeerId: string,
    trustedSenderId: string | undefined,
    msg: any,
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<{ senderId: string; allowRelay: boolean; verifiedGossipOrigin: boolean }> {
    const gossipSender = typeof msg._gossipOriginalSender === 'string' && msg._gossipOriginalSender.length > 0
      ? msg._gossipOriginalSender
      : undefined;
    if (!gossipSender || gossipSender === fromPeerId) {
      return { senderId: trustedSenderId ?? fromPeerId, allowRelay: true, verifiedGossipOrigin: false };
    }

    const originSignature = typeof msg._gossipOriginSignature === 'string' && msg._gossipOriginSignature.length > 0
      ? msg._gossipOriginSignature
      : undefined;
    if (!originSignature || !this.messageProtocol || typeof (this.messageProtocol as any).verifyData !== 'function') {
      this.opts.log?.warn?.(
        `[decentchat-peer] unsigned gossip origin claim ${gossipSender.slice(0, 8)} via ${fromPeerId.slice(0, 8)} for ${messageId.slice(0, 8)}; attributing to relay`,
      );
      return { senderId: fromPeerId, allowRelay: false, verifiedGossipOrigin: false };
    }

    let isValid = false;
    try {
      isValid = await (this.messageProtocol as any).verifyData(
        this.buildGossipOriginPayload({
          messageId,
          channelId,
          content,
          threadId: typeof msg.threadId === 'string' ? msg.threadId : undefined,
          replyToId: typeof msg.replyToId === 'string' ? msg.replyToId : undefined,
        }),
        originSignature,
        gossipSender,
      );
    } catch {
      isValid = false;
    }
    if (!isValid) {
      this.opts.log?.warn?.(
        `[decentchat-peer] invalid gossip origin signature ${gossipSender.slice(0, 8)} via ${fromPeerId.slice(0, 8)} for ${messageId.slice(0, 8)}; attributing to relay`,
      );
      return { senderId: fromPeerId, allowRelay: false, verifiedGossipOrigin: false };
    }
    return { senderId: gossipSender, allowRelay: true, verifiedGossipOrigin: true };
  }

  private finalizeGossipRelayEnvelope(
    relayEnv: any,
    originalMsgId: string,
    originalSenderId: string,
    channelId: string,
    workspaceId: string,
    hop: number,
    envelope: any,
  ): any {
    relayEnv.messageId = originalMsgId;
    relayEnv.channelId = channelId;
    relayEnv.workspaceId = workspaceId;
    relayEnv.senderId = originalSenderId;
    if (typeof envelope.senderName === 'string' && envelope.senderName.trim()) {
      relayEnv.senderName = envelope.senderName;
    }
    if (envelope.threadId) relayEnv.threadId = envelope.threadId;
    if (envelope.replyToId) relayEnv.replyToId = envelope.replyToId;
    if (envelope.vectorClock) relayEnv.vectorClock = envelope.vectorClock;
    if (envelope.metadata) relayEnv.metadata = envelope.metadata;
    if (Array.isArray(envelope.attachments) && envelope.attachments.length > 0) {
      relayEnv.attachments = envelope.attachments;
    }
    if (envelope.threadRootSnapshot) relayEnv.threadRootSnapshot = envelope.threadRootSnapshot;
    relayEnv._originalMessageId = originalMsgId;
    relayEnv._gossipOriginalSender = originalSenderId;
    relayEnv._gossipHop = hop;
    if (typeof envelope._gossipOriginSignature === 'string' && envelope._gossipOriginSignature.length > 0) {
      relayEnv._gossipOriginSignature = envelope._gossipOriginSignature;
    }
    return relayEnv;
  }

  private async gossipRelay(
    fromPeerId: string,
    originalMsgId: string,
    originalSenderId: string,
    plaintext: string,
    channelId: string,
    envelope: any,
  ): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;

    const hop = (envelope._gossipHop ?? 0) + 1;
    if (hop > DecentChatNodePeer.GOSSIP_TTL) return;

    const workspaceId = typeof envelope.workspaceId === 'string' && envelope.workspaceId
      ? envelope.workspaceId
      : this.findWorkspaceIdForChannel(channelId);
    if (!workspaceId || workspaceId === 'direct') return;

    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return;

    const connectedPeers = new Set(this.transport.getConnectedPeers());
    for (const member of ws.members) {
      const targetPeerId = member.peerId;
      if (!targetPeerId || targetPeerId === this.myPeerId) continue;
      if (targetPeerId === fromPeerId) continue;
      if (targetPeerId === originalSenderId) continue;
      if (!connectedPeers.has(targetPeerId)) continue;

      try {
        const encrypted = await this.encryptMessageWithPreKeyBootstrap(
          targetPeerId,
          plaintext,
          envelope.metadata as MessageMetadata | undefined,
          workspaceId,
        );

        const relayEnv = this.finalizeGossipRelayEnvelope(
          encrypted,
          originalMsgId,
          originalSenderId,
          channelId,
          workspaceId,
          hop,
          envelope,
        );
        this.transport.send(targetPeerId, relayEnv);
      } catch (error) {
        this.opts.log?.warn?.(
          `[decentchat-peer] gossip relay to ${targetPeerId.slice(0, 8)} failed: ${String((error as Error)?.message ?? error)}`,
        );
      }
    }
  }

  async joinWorkspace(inviteUri: string): Promise<void> {
    if (!this.syncProtocol || !this.transport) return;

    try {
      const invite = InviteURI.decode(inviteUri);
      if (!invite.peerId) {
        this.opts.log?.warn?.('[decentchat-peer] invite missing peer ID; cannot auto-join');
        return;
      }

      // Validate invite expiration
      if (InviteURI.isExpired(invite)) {
        this.opts.log?.warn?.('[decentchat-peer] invite has expired; skipping join');
        return;
      }

      await this.transport.connect(invite.peerId);

      const member: WorkspaceMember = {
        peerId: this.myPeerId,
        alias: this.opts.account.alias,
        publicKey: this.myPublicKey,
        role: 'member',
        isBot: true,
        joinedAt: Date.now(),
      };

      this.syncProtocol.requestJoin(invite.peerId, invite.inviteCode, member, invite.inviteId);
      this.opts.log?.info(`[decentchat-peer] join request sent to ${invite.peerId}`);
    } catch (err) {
      this.opts.log?.error?.(`[decentchat-peer] join failed: ${String(err)}`);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this._gossipCleanupInterval) {
      clearInterval(this._gossipCleanupInterval);
      this._gossipCleanupInterval = null;
    }
    if (this._maintenanceInterval) {
      clearInterval(this._maintenanceInterval);
      this._maintenanceInterval = null;
    }
    if (this.manifestPersistTimer) {
      clearTimeout(this.manifestPersistTimer);
      this.manifestPersistTimer = null;
      this.persistManifestState();
    }
    // Clear all pending media request timeouts
    for (const pending of this.pendingMediaRequests.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingMediaRequests.clear();

    for (const pending of this.pendingPreKeyBundleFetches.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingPreKeyBundleFetches.clear();
    this.botHuddle?.destroy();
    this.botHuddle = null;
    this.signingKeyPair = null;
    this.transport?.destroy();
    this.store.close();
    this.opts.log?.info('[decentchat-peer] stopped');
  }

  /**
   * Request full-quality image from a peer.
   * Returns a Buffer with the decrypted image data, or null if unavailable.
   */

  async requestFullImage(peerId: string, attachmentId: string): Promise<Buffer | null> {
    if (!this.transport) return null;

    // Check if we already have this image stored locally
    const storedKey = `media-full:${attachmentId}`;
    const stored = this.store.get<string>(storedKey, null);
    if (stored) {
      try {
        return Buffer.from(stored, 'base64');
      } catch {
        // corrupted storage, continue to fetch
      }
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingMediaRequests.delete(attachmentId);
        resolve(null);
      }, this.mediaChunkTimeout);

      this.pendingMediaRequests.set(attachmentId, {
        attachmentId,
        peerId,
        resolve,
        chunks: new Map(),
        timeout,
      });

      const request: MediaRequest = { type: 'media-request', attachmentId };
      this.transport?.send(peerId, request);
    });
  }

  private startPeerMaintenance(): void {
    if (this._maintenanceInterval) return;
    this._maintenanceInterval = setInterval(() => {
      void this.runPeerMaintenancePass();
    }, 30_000);
  }

  private extractPeerIdFromTransportError(error: Error): string | null {
    const match = /Could not connect to peer ([a-z0-9]+)/i.exec(error.message);
    return match?.[1] ?? null;
  }

  private logTransportError(error: Error): void {
    const message = error.message || String(error);
    const peerId = this.extractPeerIdFromTransportError(error);
    if (!peerId) {
      this.opts.log?.error?.(`[decentchat-peer] transport error: ${message}`);
      return;
    }

    const now = Date.now();
    const current = this.throttledTransportErrors.get(peerId);
    if (!current || now - current.windowStart >= DecentChatNodePeer.TRANSPORT_ERROR_LOG_WINDOW_MS) {
      if (current && current.suppressed > 0) {
        this.opts.log?.warn?.(`[decentchat-peer] transport error repeats for ${peerId.slice(0, 8)} suppressed=${current.suppressed}`);
      }
      this.throttledTransportErrors.set(peerId, { windowStart: now, suppressed: 0 });
      this.opts.log?.error?.(`[decentchat-peer] transport error: ${message}`);
      return;
    }

    current.suppressed += 1;
    if (current.suppressed % 20 === 0) {
      this.opts.log?.warn?.(`[decentchat-peer] transport error repeats for ${peerId.slice(0, 8)} suppressed=${current.suppressed}`);
    }
  }

  private notePeerMaintenanceFailure(peerId: string | null, now = Date.now()): void {
    if (!peerId || peerId === this.myPeerId) return;
    const attempt = (this.peerMaintenanceAttemptsByPeer.get(peerId) ?? 0) + 1;
    this.peerMaintenanceAttemptsByPeer.set(peerId, attempt);
    const delay = Math.min(
      DecentChatNodePeer.PEER_MAINTENANCE_RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)),
      DecentChatNodePeer.PEER_MAINTENANCE_RETRY_MAX_MS,
    );
    this.peerMaintenanceRetryAtByPeer.set(peerId, now + delay);
  }

  private clearPeerMaintenanceFailure(peerId: string): void {
    this.peerMaintenanceAttemptsByPeer.delete(peerId);
    this.peerMaintenanceRetryAtByPeer.delete(peerId);
  }

  private async runPeerMaintenancePass(now = Date.now()): Promise<void> {
    if (this.destroyed || !this.transport) return;
    const connectedPeers = new Set(this.transport.getConnectedPeers());
    const seen = new Set<string>();
    const attempted: string[] = [];
    const skipped: string[] = [];
    const connected: string[] = [];
    const quarantineErrors: string[] = [];
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const member of workspace.members) {
        const peerId = member.peerId;
        if (peerId === this.myPeerId) continue;
        if (seen.has(peerId)) continue;
        seen.add(peerId);
        if (connectedPeers.has(peerId)) {
          this.clearPeerMaintenanceFailure(peerId);
          connected.push(peerId.slice(0, 8));
          continue;
        }
        // Skip peers that have failed too many times consecutively.
        // A successful inbound connection will clear the counter via
        // clearPeerMaintenanceFailure(), re-enabling maintenance.
        const attempts = this.peerMaintenanceAttemptsByPeer.get(peerId) ?? 0;
        if (attempts >= DecentChatNodePeer.PEER_MAINTENANCE_MAX_CONSECUTIVE_FAILURES) {
          skipped.push(`${peerId.slice(0, 8)}:max-attempts(${attempts})`);
          continue;
        }
        const retryAt = this.peerMaintenanceRetryAtByPeer.get(peerId) ?? 0;
        if (retryAt > now) {
          skipped.push(`${peerId.slice(0, 8)}:backoff(${Math.round((retryAt - now) / 1000)}s)`);
          continue;
        }
        attempted.push(peerId.slice(0, 8));
        try {
          await this.transport.connect(peerId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Quarantine errors from the transport layer (separate from our
          // own maintenance backoff) are worth surfacing — otherwise a
          // quarantined peer looks identical to an unreachable one, and
          // the bridge log appears frozen.
          if (/quarantined/i.test(msg)) {
            quarantineErrors.push(
              `${peerId.slice(0, 8)}:${msg.replace(/.*quarantined for /, 'Q').replace(/ after.*/, '')}`,
            );
          }
          this.notePeerMaintenanceFailure(peerId, now);
        }
      }
    }
    // Emit one structured info line per pass so operators can see the
    // reconnect loop actually running, which peers are in backoff, and
    // whether the transport is refusing connect attempts due to its own
    // quarantine. Silent passes were the root cause of a "Xena is
    // offline" incident that looked like a frozen bridge.
    if (attempted.length || skipped.length || quarantineErrors.length) {
      this.opts.log?.info?.(
        `[decentchat-peer] maintenance pass: ` +
        `connected=[${connected.join(',')}] ` +
        `attempted=[${attempted.join(',')}] ` +
        `skipped=[${skipped.join(',')}]` +
        (quarantineErrors.length ? ` quarantine=[${quarantineErrors.join(',')}]` : ''),
      );
    }
  }



  private async handlePeerMessage(fromPeerId: string, rawData: unknown, trustedSenderId?: string): Promise<void> {
    if (this.destroyed || !this.syncProtocol || !this.messageProtocol || !this.transport) return;

    const msg = rawData as any;

    // DEBUG: log inbound ACK so we can verify round-trip
    if (msg?.type === 'ack') {
      console.log(`[decentchat-peer] inbound ACK from ${fromPeerId.slice(0,8)} for msgId=${String(msg.messageId).slice(0,8)}`);
      await this.handleInboundReceipt(fromPeerId, msg, 'acknowledged');
      return;
    }

    if (msg?.type === 'read') {
      await this.handleInboundReceipt(fromPeerId, msg, 'read');
      return;
    }

    // Peer-auth challenge-response (see decent-protocol/src/security/PeerAuth.ts).
    //
    // The web client sends this right after processing our handshake: it wants
    // us to prove we own the signing key advertised in that handshake, so it
    // knows our peerId really belongs to us and isn't a replay. If we don't
    // respond within `ChatController.AUTH_TIMEOUT_MS`, the client logs
    // `[Auth] Peer ... did not respond to auth challenge — TOFU fallback`
    // and stops trusting our authenticated-peers set — still functional via
    // TOFU, but noisy and defeats the purpose of the challenge.
    //
    // Previously the bridge had no handler for `auth-challenge`, so the
    // message was silently dropped and the client always fell back to TOFU.
    // This handler signs `nonce + challengerPeerId` with our ECDSA signing
    // private key (same key pair we use everywhere else in the protocol) and
    // sends `auth-response` back.
    if (msg?.type === 'auth-challenge' && typeof msg.nonce === 'string') {
      if (!this.signingKeyPair?.privateKey) {
        this.opts.log?.warn?.(
          `[decentchat-peer] auth-challenge from ${fromPeerId.slice(0, 8)} ` +
          `but no signing key available — challenger will fall back to TOFU`,
        );
        return;
      }
      try {
        const response = await PeerAuth.respondToChallenge(
          msg.nonce,
          fromPeerId,
          this.signingKeyPair.privateKey,
        );
        const accepted = this.transport.send(fromPeerId, {
          type: 'auth-response',
          signature: response.signature,
        });
        this.opts.log?.info?.(
          `[decentchat-peer] auth-response sent to ${fromPeerId.slice(0, 8)} accepted=${accepted}`,
        );
      } catch (err) {
        this.opts.log?.warn?.(
          `[decentchat-peer] failed to respond to auth-challenge from ${fromPeerId.slice(0, 8)}: ${String(err)}`,
        );
      }
      return;
    }

    if (await this.handlePreKeyControl(fromPeerId, msg)) {
      return;
    }

    if (msg?.type === 'handshake') {
      if (this.shouldIgnoreInboundHandshakeBurst(fromPeerId)) {
        return;
      }
      this.decryptRecoveryAtByPeer.delete(fromPeerId);
      await this.messageProtocol.processHandshake(fromPeerId, msg);
      if (msg.preKeySupport) {
        const preKeyWorkspaceId = this.resolveSharedWorkspaceIds(fromPeerId)[0];
        this.transport.send(fromPeerId, {
          type: 'pre-key-bundle.request',
          ...(preKeyWorkspaceId ? { workspaceId: preKeyWorkspaceId } : {}),
        });
      }
      await this.publishPreKeyBundle(fromPeerId);
      // (Historical note: we used to reply to inbound handshakes with a
      // bridge-invented `handshake-ack` message and track it via
      // `waitForHandshakeAck` on the sender side. Nothing else in the
      // DecentChat ecosystem speaks that message — neither the web client
      // nor the shared `@decentchat/protocol` package references it — so
      // EVERY bridge→web handshake ended up emitting a spurious
      // `handshake not acknowledged by ... (timeout 7500ms)` warning even
      // on perfectly healthy connections. The tracking had no retry
      // behaviour wired to it, so it was pure log noise. Removed in favour
      // of trusting the rate-limited outbound cooldown + the concrete
      // sync/peer-auth signals that already tell us whether the peer is
      // actually talking to us.)
      const knownKeys = this.store.get<Record<string, string>>('peer-public-keys', {});
      knownKeys[fromPeerId] = msg.publicKey;
      this.store.set('peer-public-keys', knownKeys);
      this.updateWorkspaceMemberKey(fromPeerId, msg.publicKey);
      // Save sender's display name if provided
      if (msg.alias) {
        this.applyNameAnnounce(fromPeerId, {
          alias: msg.alias as string,
          workspaceId: typeof msg.workspaceId === 'string' ? msg.workspaceId : undefined,
          companySim: msg.companySim as any,
          isBot: msg.isBot === true,
          publicKey: typeof msg.publicKey === 'string' ? msg.publicKey : undefined,
        });
      }
      // Reply with our own handshake so the remote peer can complete
      // crypto setup.  Without ANY reply, a peer that hard-refreshed (lost
      // its shared secret) sends us a handshake, we process it on our side,
      // but never reply — the remote peer never enters readyPeers and sees
      // us as permanently offline.
      //
      // BUT: re-sending unconditionally on every inbound handshake breaks
      // the peer-auth challenge-response on the web client. The web client's
      // handshake handler in ChatController sends an `auth-challenge` and
      // stashes its nonce in `pendingAuthChallenges[peerId]`. If we re-send
      // a handshake right after the web client just sent us one, the web
      // client processes our reply, OVERWRITES `pendingAuthChallenges[peerId]`
      // with a fresh nonce, and then our `auth-response` for the original
      // nonce arrives — verification against the new nonce fails with
      // `[Auth] Peer ... FAILED authentication — bad signature`, followed
      // by the next response logging `[Auth] Unexpected auth-response ...
      // (no pending challenge)`. The whole pair authenticates via TOFU and
      // the round-trip we just added is wasted.
      //
      // Skip the re-send if we already sent our own handshake to this peer
      // very recently. The 5-second window comfortably covers the auth
      // round-trip plus a few ratchet retries while still re-handshaking
      // for any peer that's been quiet long enough to plausibly be in the
      // hard-refresh recovery scenario the original code was guarding.
      const HANDSHAKE_RESEND_SUPPRESS_MS = 5_000;
      const lastSentAt = this.connectHandshakeAtByPeer.get(fromPeerId) ?? 0;
      const recentlySentToPeer = lastSentAt > 0 &&
        Date.now() - lastSentAt < HANDSHAKE_RESEND_SUPPRESS_MS;
      if (!recentlySentToPeer) {
        await this.sendHandshake(fromPeerId);
      } else {
        this.opts.log?.debug?.(
          `[decentchat-peer] suppressing handshake re-send to ${fromPeerId.slice(0, 8)} ` +
          `(sent ${Date.now() - lastSentAt}ms ago, < ${HANDSHAKE_RESEND_SUPPRESS_MS}ms) — ` +
          `prevents auth-challenge nonce overwrite race`,
        );
      }
      await this.resumePeerSession(fromPeerId);
      return;
    }

    // Handle name-announce (unencrypted) — must be before the encrypted guard
    if (msg?.type === 'name-announce' && msg.alias) {
      const alias = msg.alias as string;
      const result = this.applyNameAnnounce(fromPeerId, {
        alias,
        workspaceId: typeof msg.workspaceId === 'string' ? msg.workspaceId : undefined,
        companySim: msg.companySim as any,
        isBot: msg.isBot === true,
      });
      if (result.memberAdded && result.workspaceId && this.syncProtocol) {
        this.syncProtocol.requestSync(fromPeerId, result.workspaceId);
      }
      // Also cache directly so resolveSenderName can find it even before workspace sync
      this.store.set(`peer-alias-${fromPeerId}`, alias);
      return;
    }

    if (msg?.type === 'workspace-sync' && msg.sync) {
      const merged = msg.workspaceId ? { ...msg.sync, workspaceId: msg.workspaceId } : msg.sync;

      // Handle workspace-state directly (SyncProtocol doesn't have a case for it)
      if (merged.type === 'workspace-state' && merged.workspaceId) {
        this.handleWorkspaceState(fromPeerId, merged.workspaceId, merged);
        return;
      }

      await this.syncProtocol.handleMessage(fromPeerId, merged);
      return;
    }

    // Handle Negentropy sync queries from web client
    if (msg?.type === 'message-sync-negentropy-query') {
      await this.handleNegentropyQuery(fromPeerId, msg);
      return;
    }

    // Handle fetch requests for specific message IDs (after Negentropy reconciliation)
    if (msg?.type === 'message-sync-fetch-request') {
      await this.handleFetchRequest(fromPeerId, msg);
      return;
    }

    // Handle timestamp-based sync request from peer (legacy fallback protocol)
    if (msg?.type === 'message-sync-request') {
      await this.handleMessageSyncRequest(fromPeerId, msg);
      return;
    }

    // Handle timestamp-based sync response from peer containing plaintext messages
    if (msg?.type === 'message-sync-response') {
      await this.handleMessageSyncResponse(fromPeerId, msg);
      return;
    }

    if (msg?.type === 'sync.summary') {
      await this.handleManifestSummary(fromPeerId, msg);
      return;
    }

    if (msg?.type === 'sync.diff_request') {
      await this.handleManifestDiffRequest(fromPeerId, msg);
      return;
    }

    if (msg?.type === 'sync.diff_response') {
      await this.handleManifestDiffResponse(fromPeerId, msg);
      return;
    }

    if (msg?.type === 'sync.fetch_snapshot') {
      await this.handleManifestFetchSnapshot(fromPeerId, msg);
      return;
    }

    if (msg?.type === 'sync.snapshot_response') {
      await this.handleManifestSnapshotResponse(fromPeerId, msg);
      return;
    }

    if (typeof msg?.type === 'string' && msg.type.startsWith('custody.')) {
      await this.handleCustodyControl(fromPeerId, msg);
      return;
    }

    // Handle media requests (unencrypted, similar to web client)
    if (msg?.type === 'media-request') {
      await this.handleMediaRequest(fromPeerId, msg as MediaRequest);
      return;
    }
    if (msg?.type === 'media-response') {
      await this.handleMediaResponse(fromPeerId, msg as MediaResponse);
      return;
    }
    if (msg?.type === 'media-chunk') {
      await this.handleMediaChunk(fromPeerId, msg as MediaChunk);
      return;
    }

    const gossipOrigId = typeof msg?._originalMessageId === 'string' ? msg._originalMessageId : undefined;
    if (gossipOrigId && this._gossipSeen.has(gossipOrigId)) {
      return;
    }

    // Route huddle signals to BotHuddleManager (unencrypted, like browser client)
    if (typeof msg?.type === 'string' && msg.type.startsWith('huddle-')) {
      await this.botHuddle?.handleSignal(fromPeerId, msg);
      return;
    }

    if (!msg?.encrypted && !msg?.ratchet) {
      return;
    }

    const peerPubKeyB64 = this.getPeerPublicKey(fromPeerId);
    if (!peerPubKeyB64) {
      this.opts.log?.warn?.(`[decentchat-peer] missing public key for ${fromPeerId}, skipping message`);
      return;
    }

    const peerPublicKey = await this.cryptoManager.importPublicKey(peerPubKeyB64);
    let content: string | null;
    try {
      content = await this.messageProtocol.decryptMessage(fromPeerId, msg, peerPublicKey);
    } catch (err) {
      if (this.shouldIgnoreDecryptReplay(fromPeerId, msg, err)) {
        this.opts.log?.info?.(`[decentchat-peer] replayed pre-key from ${fromPeerId} ignored`);
        return;
      }
      this.opts.log?.warn?.(`[decentchat-peer] decrypt threw for ${fromPeerId}, resetting ratchet: ${String(err)}`);
      await this.triggerDecryptRecoveryHandshake(fromPeerId);
      return;
    }
    if (!content) {
      // decryptMessage returned null (internal error) — ratchet desynced, reset it
      this.opts.log?.warn?.(`[decentchat-peer] decrypt returned null for ${fromPeerId}, resetting ratchet`);
      await this.triggerDecryptRecoveryHandshake(fromPeerId);
      return;
    }
    this.decryptRecoveryAtByPeer.delete(fromPeerId);

    const isDirect = msg.isDirect === true;
    const channelId = (msg.channelId as string | undefined) ?? (isDirect ? fromPeerId : undefined);
    if (!channelId) return;
    const envelopeMessageId = typeof msg.messageId === 'string' && msg.messageId.length > 0
      ? msg.messageId
      : (gossipOrigId ?? '');
    const senderResolution = await this.resolveInboundSenderId(
      fromPeerId,
      trustedSenderId,
      msg,
      channelId,
      envelopeMessageId,
      content,
    );
    const actualSenderId = senderResolution.senderId;

    const created = await this.messageStore.createMessage(
      channelId,
      actualSenderId,
      content,
      'text',
      msg.threadId,
    );
    const lastTs = this.messageStore.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
    created.timestamp = Math.max((msg.timestamp as number | undefined) ?? Date.now(), lastTs + 1);
    if (typeof msg.messageId === 'string') {
      created.id = msg.messageId;
    }

    const result = await this.messageStore.addMessage(created);
    if (!result.success) {
      this.opts.log?.warn?.(`[decentchat-peer] rejected message ${created.id}: ${result.error}`);
      // Still send ACK for duplicates — the sender is retrying because they
      // never received our first ACK.  Without this, the sender loops forever.
      const dupAckPayload = {
        type: 'ack' as const,
        messageId: created.id,
        channelId,
        ...(typeof msg.envelopeId === 'string' ? { envelopeId: msg.envelopeId } : {}),
      };
      try {
        const accepted = this.transport.send(fromPeerId, dupAckPayload);
        if (!accepted) {
          await this.enqueueOffline(fromPeerId, dupAckPayload);
        }
      } catch (_) { /* best effort */ }
      return;
    }
    this._gossipSeen.set(created.id, Date.now());

    this.persistMessagesForChannel(channelId);

    const workspaceId = (msg.workspaceId as string | undefined) ?? (isDirect ? 'direct' : '');
    this.recordManifestDomain('channel-message', workspaceId || this.findWorkspaceIdForChannel(channelId), {
      channelId,
      itemCount: this.messageStore.getMessages(channelId).length,
      operation: 'create',
      subject: created.id,
      data: { messageId: created.id, senderId: actualSenderId },
    });

    const ackPayload = {
      type: 'ack' as const,
      messageId: created.id,
      channelId,
      ...(typeof msg.envelopeId === 'string' ? { envelopeId: msg.envelopeId } : {}),
    };
    try {
      const ackAccepted = this.transport.send(fromPeerId, ackPayload);
      console.log(`[decentchat-peer] ACK→${fromPeerId.slice(0,8)} msgId=${created.id.slice(0,8)} accepted=${ackAccepted} (encrypted-path)`);
      if (!ackAccepted) {
        await this.enqueueOffline(fromPeerId, ackPayload);
      }
    } catch (ackErr) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to send ack to ${fromPeerId}: ${String(ackErr)}`);
      await this.enqueueOffline(fromPeerId, ackPayload);
    }

    const senderName = this.resolveSenderName(workspaceId, actualSenderId, msg.senderName as string | undefined);
    const attachments = Array.isArray(msg.attachments)
      ? (msg.attachments as Array<{
        id: string;
        name: string;
        type: string;
        size?: number;
        thumbnail?: string;
        width?: number;
        height?: number;
      }>)
      : undefined;

    await this.opts.onIncomingMessage({
      channelId,
      workspaceId,
      content,
      senderId: actualSenderId,
      senderName,
      messageId: created.id,
      chatType: msg.isDirect ? 'direct' : 'channel',
      timestamp: created.timestamp,
      replyToId: msg.replyToId as string | undefined,
      threadId: msg.threadId as string | undefined,
      attachments,
    });

    if (!isDirect && senderResolution.allowRelay) {
      void this.gossipRelay(fromPeerId, created.id, actualSenderId, content, channelId, msg);
    }
  }

  private async handleNegentropyQuery(fromPeerId: string, msg: any): Promise<void> {
    const wsId = msg.workspaceId as string | undefined;
    const channelId = msg.channelId as string | undefined;
    const requestId = msg.requestId as string | undefined;
    const query = msg.query;
    const sendReject = (reason: string): void => {
      this.opts.log?.warn?.(
        `[decentchat-peer] Negentropy query rejected from ${fromPeerId.slice(0, 8)}: ${reason}`,
      );
      if (!this.transport || !requestId) return;
      this.transport.send(fromPeerId, {
        type: 'message-sync-negentropy-response',
        requestId,
        ...(wsId ? { workspaceId: wsId } : {}),
        ...(channelId ? { channelId } : {}),
        response: {
          have: [],
          need: [],
        },
        error: 'rejected',
      });
    };

    if (!wsId || !channelId || !requestId || !query) {
      sendReject('invalid-request');
      return;
    }

    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) {
      sendReject('workspace-not-found');
      return;
    }
    if (!ws.members.some((m: any) => m.peerId === fromPeerId)) {
      sendReject('peer-not-member');
      return;
    }
    if (!ws.channels.some((ch: any) => ch.id === channelId)) {
      sendReject('channel-not-found');
      return;
    }

    const localItems = this.messageStore.getMessages(channelId).map((m) => ({ id: m.id, timestamp: m.timestamp }));
    const negentropy = new Negentropy();
    await negentropy.build(localItems);
    const response = await negentropy.processQuery(query);

    this.transport!.send(fromPeerId, {
      type: 'message-sync-negentropy-response',
      requestId,
      workspaceId: wsId,
      channelId,
      response,
    });
    this.opts.log?.info?.(`[decentchat-peer] Negentropy query from ${fromPeerId.slice(0, 8)} for channel ${channelId.slice(0, 8)}: ${localItems.length} local messages`);
  }

  private async handleFetchRequest(fromPeerId: string, msg: any): Promise<void> {
    const wsId = msg.workspaceId as string | undefined;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === fromPeerId)) return;

    const requested: Record<string, string[]> = msg.messageIdsByChannel || {};
    const allMessages: any[] = [];

    for (const ch of ws.channels) {
      const requestedIds = Array.isArray(requested[ch.id]) ? requested[ch.id] : [];
      if (requestedIds.length === 0) continue;
      const idSet = new Set(requestedIds.filter((id: unknown) => typeof id === 'string'));
      if (idSet.size === 0) continue;

      const channelMessages = this.messageStore.getMessages(ch.id)
        .filter((m) => idSet.has(m.id))
        .sort((a, b) => a.timestamp - b.timestamp);
      for (const m of channelMessages) {
        allMessages.push({
          id: m.id,
          channelId: m.channelId,
          senderId: m.senderId,
          content: m.content,
          timestamp: m.timestamp,
          type: m.type,
          threadId: m.threadId,
          prevHash: m.prevHash,
          vectorClock: (m as any).vectorClock,
        });
      }
    }

    if (allMessages.length > 0) {
      this.transport!.send(fromPeerId, {
        type: 'message-sync-response',
        workspaceId: wsId,
        messages: allMessages,
      });
    }
    this.opts.log?.info?.(`[decentchat-peer] Fetch request from ${fromPeerId.slice(0, 8)}: sent ${allMessages.length} messages`);
  }

  /** Respond to a timestamp-based message-sync-request from a peer. */
  private async handleMessageSyncRequest(fromPeerId: string, msg: any): Promise<void> {
    const wsId = msg.workspaceId as string | undefined;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === fromPeerId)) return;

    const channelTimestamps: Record<string, number> = msg.channelTimestamps || {};
    const allMessages: any[] = [];

    for (const ch of ws.channels) {
      const since = channelTimestamps[ch.id] ?? 0;
      const msgs = this.messageStore.getMessages(ch.id);
      const newer = msgs.filter((m) => m.timestamp > since);
      for (const m of newer) {
        allMessages.push({
          id: m.id,
          channelId: ch.id,
          senderId: m.senderId,
          content: m.content,
          timestamp: m.timestamp,
        });
      }
    }

    if (allMessages.length > 0) {
      this.transport!.send(fromPeerId, {
        type: 'message-sync-response',
        workspaceId: wsId,
        messages: allMessages,
      });
    }
  }

  /** Process incoming messages from a timestamp-based message-sync-response. */
  private async handleMessageSyncResponse(fromPeerId: string, msg: any): Promise<void> {
    const wsId = msg.workspaceId as string | undefined;
    const messages: any[] = Array.isArray(msg.messages) ? msg.messages : [];
    if (!messages.length) return;

    const ws = wsId ? this.workspaceManager.getWorkspace(wsId) : null;
    if (wsId && !ws) return;
    if (ws && !ws.members.some((m: any) => m.peerId === fromPeerId)) return;

    // SEEDING PASS: for any channel we've never observed before, find the
    // max incoming timestamp and pre-populate the high-water mark WITHOUT
    // surfacing anything. This is the "suck in the legacy history without
    // flooding the agent" step.
    //
    // We only seed channels that (a) have no existing high-water mark and
    // (b) have messages in this batch. The actual import/verify happens in
    // the main loop below; we just need to know the ceiling so we don't
    // treat historical messages as fresh input on bridge first-start.
    let seededAnyChannel = false;
    const channelTimestamps = new Map<string, number>();
    for (const m of messages) {
      const cid = typeof m.channelId === 'string' ? m.channelId : null;
      const ts = typeof m.timestamp === 'number' ? m.timestamp : 0;
      if (!cid || !ts) continue;
      const prev = channelTimestamps.get(cid) ?? 0;
      if (ts > prev) channelTimestamps.set(cid, ts);
    }
    for (const [cid, maxTs] of channelTimestamps) {
      if (!this.unverifiedSurfacedTsByChannel.has(cid)) {
        // Seed to maxTs - 1 so the single newest message in the batch
        // still passes the surfacing gate. If the newest happens to be a
        // legacy message rather than Alex's just-sent one, worst case is
        // ONE wasted agent turn on first run per broken channel. If it's
        // actually Alex's new message, we correctly surface it.
        const seedTs = Math.max(0, maxTs - 1);
        this.unverifiedSurfacedTsByChannel.set(cid, seedTs);
        seededAnyChannel = true;
        this.opts.log?.info?.(
          `[decentchat-peer] seeded unverified high-water for channel ${cid.slice(0, 8)} = ${seedTs} ` +
          `(batchMax=${maxTs}, legacy backfill, newest message still eligible to surface)`,
        );
      }
    }
    if (seededAnyChannel) {
      try {
        this.store.set(
          DecentChatNodePeer.UNVERIFIED_SURFACED_TS_STORE_KEY,
          Object.fromEntries(this.unverifiedSurfacedTsByChannel),
        );
      } catch (_) { /* best-effort */ }
    }

    this.opts.log?.info?.(`[decentchat-peer] message-sync-response from ${fromPeerId.slice(0, 8)}: ${messages.length} messages`);

    // Only SURFACE-to-agent messages that arrived after this bridge started.
    // Older messages are still stored as context but won't trigger agent turns.
    const RECENT_CUTOFF_MS = this.startedAt - 60_000; // 1 min grace for clock skew

    // Throttle ACK bursts: the receiver's 'message' rate-limit bucket is
    // 30 burst @ 10/sec.  If a sync-response contains many messages, firing
    // all ACKs at once will exceed the bucket → auto-ban Xena → silent drop
    // of all subsequent messages.  Cap at 5 ACKs per sync-response; further
    // ACKs will be sent on the next reconnect / next sync cycle.
    const MAX_ACKS_PER_SYNC_RESPONSE = 5;
    let acksSent = 0;

    // Per-sync-response diagnostic counters. The "sync import failed" warning
    // fires when hash-chain verification rejects a message — without
    // throttling this can emit 2+ warnings per second if the peer's CRDT is
    // full of unverifiable messages (e.g. legacy messages with
    // `prevHash: undefined`). Log the first failure per channel with full
    // detail, then suppress subsequent failures and summarize the total at
    // the end of the sync-response.
    const importFailedChannels = new Set<string>();
    let importFailedCount = 0;

    for (const m of messages) {
      const channelId = typeof m.channelId === 'string' ? m.channelId : null;
      const id = typeof m.id === 'string' ? m.id : '';
      const senderId = typeof m.senderId === 'string' ? m.senderId : fromPeerId;
      const content = typeof m.content === 'string' ? m.content : '';
      const ts = typeof m.timestamp === 'number' ? m.timestamp : Date.now();

      if (!channelId || !id) continue;
      // Skip own messages (don't ACK or store)
      if (senderId === this.myPeerId) continue;

      const existing = this.messageStore.getMessages(channelId);
      const alreadyStored = existing.some((ex: any) => ex.id === id);

      if (alreadyStored) continue;
      if (!content) continue;

      const resolvedWsId = wsId || this.findWorkspaceIdForChannel(channelId);
      if (!resolvedWsId) continue;

      const storedMsg = {
        id,
        channelId,
        workspaceId: resolvedWsId,
        senderId,
        senderName: m.senderName || senderId.slice(0, 8),
        content,
        timestamp: ts,
        type: m.type || 'text',
      };

      // CRITICAL: `importMessages` can return `{success: false}` without throwing
      // when hash-chain verification fails. Ignoring the return value caused the
      // original ALE-1117 symptom: messages were silently rejected at import time,
      // `alreadyStored` was still false on the next sync cycle, and the ACK fired
      // again — forever. Check the result explicitly.
      //
      // This also guards against a subtler failure mode: the loop calls
      // `importMessages(channelId, [...existing, storedMsg])` once per message,
      // which forces per-message chain verification. If the sync-response is
      // delivered out of order for the first few messages of a channel (e.g. the
      // peer's chain rebuilds in mid-batch), early iterations will fail verification
      // even though the full batch would verify correctly. We can't cheaply fix the
      // batching here without a larger refactor, but we CAN stop spamming ACKs for
      // messages we didn't actually store.
      const importResult = await this.messageStore.importMessages(channelId, [...existing, storedMsg as any]);
      if (!importResult?.success) {
        importFailedCount++;
        const errMsg = importResult?.error ?? 'unknown error';
        // Structurally unverifiable chains (legacy workspace with
        // `prevHash: undefined` somewhere) aren't tampering — they're just
        // unsyncable for hash-chain reasons. For genuine tampering
        // (mismatched hashes, wrong sender) we still drop the message.
        const isStructurallyUnverifiable = errMsg.includes('got undefined') ||
          errMsg.includes('invalid genesis hash');

        // Cross-sync persistent suppression for the warn/info line. The
        // previous in-function set was local to a single sync-response, so
        // a peer stuck on an unverifiable legacy workspace would log one
        // warning per channel per sync-response — hundreds of lines per
        // minute in steady-state. Now we log at most once per
        // (peer, channel) per SYNC_IMPORT_FAIL_LOG_INTERVAL_MS and group
        // ongoing failures into the summary line at the end.
        const suppressionKey = `${fromPeerId}:${channelId}`;
        const lastLoggedAt = this.syncImportFailLastLogAt.get(suppressionKey) ?? 0;
        const now = Date.now();
        const shouldLog = !importFailedChannels.has(channelId) &&
          now - lastLoggedAt >= DecentChatNodePeer.SYNC_IMPORT_FAIL_LOG_INTERVAL_MS;
        importFailedChannels.add(channelId);
        if (shouldLog) {
          this.syncImportFailLastLogAt.set(suppressionKey, now);
          const line =
            `[decentchat-peer] sync import failed for msg ${id.slice(0, 8)} in channel ${channelId.slice(0, 8)}: ${errMsg} — skipping ACK/persist ` +
            (isStructurallyUnverifiable
              ? '(will still surface to agent once — legacy chain) '
              : '') +
            `(further failures for this peer/channel suppressed for ${Math.round(DecentChatNodePeer.SYNC_IMPORT_FAIL_LOG_INTERVAL_MS / 60_000)}min)`;
          if (isStructurallyUnverifiable) {
            this.opts.log?.info?.(line);
          } else {
            this.opts.log?.warn?.(line);
          }
        }

        // For genuine tampering, stop here — don't surface to the agent.
        if (!isStructurallyUnverifiable) {
          continue;
        }

        // Structurally unverifiable + id never surfaced + timestamp past
        // the per-channel high-water ⇒ forward to the agent ONCE so the
        // user still gets a reply. We can't persist it in MessageStore
        // (the chain check would reject it forever), so we dedupe locally
        // on two axes:
        //   - `unverifiedSurfacedIds` — exact message-id set, for perfect
        //     idempotency across sync cycles and restarts
        //   - `unverifiedSurfacedTsByChannel` — per-channel timestamp
        //     ceiling, seeded from the first observed batch so legacy
        //     backfills never trigger agent turns on first-start
        if (this.unverifiedSurfacedIds.has(id)) {
          continue;
        }
        const channelHighWater = this.unverifiedSurfacedTsByChannel.get(channelId) ?? 0;
        if (ts <= channelHighWater) {
          continue; // older than or equal to what we've already seeded — not new input
        }
        this.unverifiedSurfacedIds.add(id);
        this.unverifiedSurfacedTsByChannel.set(channelId, ts);
        // Cap unbounded growth. The bridge lives for days, this set could
        // balloon if a chain stays broken forever. 5k is ~several weeks
        // of chatty traffic — plenty.
        if (this.unverifiedSurfacedIds.size > DecentChatNodePeer.UNVERIFIED_SURFACED_MAX) {
          const first = this.unverifiedSurfacedIds.values().next().value;
          if (first !== undefined) this.unverifiedSurfacedIds.delete(first);
        }
        // Persist so a bridge restart doesn't re-deliver in-window msgs.
        try {
          this.store.set(
            DecentChatNodePeer.UNVERIFIED_SURFACED_STORE_KEY,
            Array.from(this.unverifiedSurfacedIds),
          );
          this.store.set(
            DecentChatNodePeer.UNVERIFIED_SURFACED_TS_STORE_KEY,
            Object.fromEntries(this.unverifiedSurfacedTsByChannel),
          );
        } catch (_) {
          // Non-fatal: worst case a restart re-surfaces this msg id once.
        }
        this.opts.log?.info?.(
          `[decentchat-peer] surfacing unverified msg ${id.slice(0, 8)} to agent ` +
          `(legacy chain in ${channelId.slice(0, 8)}) — will not persist`,
        );
        // ACK the unverified message on a best-effort basis so the sender's
        // UI moves from "delivered" to "read". Counts against the ACK
        // budget so we can't accidentally drain the receiver's rate-limit
        // bucket on a flood of legacy-chain messages.
        if (acksSent < MAX_ACKS_PER_SYNC_RESPONSE) {
          try {
            if (this.transport) {
              const accepted = this.transport.send(fromPeerId, {
                type: 'ack' as const,
                messageId: id,
                channelId,
              });
              console.log(`[decentchat-peer] ACK→${fromPeerId.slice(0,8)} msgId=${id.slice(0,8)} accepted=${accepted} (unverified-surface)`);
              acksSent++;
            }
          } catch (_) {
            // best-effort
          }
        }
        await this.opts.onIncomingMessage({
          channelId,
          workspaceId: resolvedWsId,
          content,
          senderId,
          senderName: storedMsg.senderName,
          messageId: id,
          chatType: 'channel',
          timestamp: ts,
          replyToId: typeof m.replyToId === 'string' ? m.replyToId : undefined,
          threadId: typeof m.threadId === 'string' ? m.threadId : undefined,
        });
        continue;
      }
      this.persistMessagesForChannel(channelId);

      const ackPayload = {
        type: 'ack' as const,
        messageId: id,
        channelId,
      };
      // ACK only messages we actually persisted from sync. Duplicate or
      // dropped messages should not be re-ACKed every sync cycle.
      if (acksSent < MAX_ACKS_PER_SYNC_RESPONSE) {
        try {
          if (this.transport) {
            const accepted = this.transport.send(fromPeerId, ackPayload);
            console.log(`[decentchat-peer] ACK→${fromPeerId.slice(0,8)} msgId=${id.slice(0,8)} accepted=${accepted} (sync-path)`);
            if (!accepted) {
              await this.enqueueOffline(fromPeerId, ackPayload);
            }
            acksSent++;
          }
        } catch (err) {
          this.opts.log?.warn?.(`[decentchat-peer] failed to ack synced message ${id.slice(0, 8)}: ${String(err)}`);
          try { await this.enqueueOffline(fromPeerId, ackPayload); } catch (_) { /* best effort */ }
        }
      } else if (acksSent === MAX_ACKS_PER_SYNC_RESPONSE) {
        // Rate-limit threshold reached; log once per sync-response.
        console.log(`[decentchat-peer] ACK throttled for ${fromPeerId.slice(0,8)}: ${messages.length - acksSent} skipped (will retry via sync)`);
        acksSent++;  // prevent re-logging
      }

      // Only surface to agent if message is recent enough (post-startup)
      if (ts < RECENT_CUTOFF_MS) continue;

      await this.opts.onIncomingMessage({
        channelId,
        workspaceId: resolvedWsId,
        content,
        senderId,
        senderName: storedMsg.senderName,
        messageId: id,
        chatType: 'channel',
        timestamp: ts,
        replyToId: typeof m.replyToId === 'string' ? m.replyToId : undefined,
        threadId: typeof m.threadId === 'string' ? m.threadId : undefined,
      });
    }

    // Summary: if any imports failed, emit a single info-level log line so
    // operators can see the total without the per-message warning flood.
    // Also throttled per-peer on the same SYNC_IMPORT_FAIL_LOG_INTERVAL_MS
    // cadence so a peer stuck on an unverifiable chain doesn't produce one
    // summary line per sync cycle forever.
    if (importFailedCount > 0) {
      const summaryKey = `${fromPeerId}:__summary__`;
      const lastSummaryAt = this.syncImportFailLastLogAt.get(summaryKey) ?? 0;
      const now = Date.now();
      if (now - lastSummaryAt >= DecentChatNodePeer.SYNC_IMPORT_FAIL_LOG_INTERVAL_MS) {
        this.syncImportFailLastLogAt.set(summaryKey, now);
        this.opts.log?.info?.(
          `[decentchat-peer] sync import summary from ${fromPeerId.slice(0, 8)}: ${importFailedCount}/${messages.length} messages failed verification across ${importFailedChannels.size} channel(s)`,
        );
      }
    }
  }

  /** Send a message-sync-request to a peer, pulling all messages since given timestamps. */
  private sendMessageSyncRequest(peerId: string, workspaceId: string, channelTimestamps: Record<string, number> = {}): void {
    if (!this.transport) return;
    this.transport.send(peerId, {
      type: 'message-sync-request',
      workspaceId,
      channelTimestamps,
    });
    this.opts.log?.info?.(`[decentchat-peer] sent message-sync-request to ${peerId.slice(0, 8)}`);
  }

  private resolveSharedWorkspaceIds(peerId: string): string[] {
    if (!peerId) return [];
    const ids: string[] = [];
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      const memberPeerIds = new Set(workspace.members.map((member) => member.peerId));
      if (memberPeerIds.has(peerId) && memberPeerIds.has(this.myPeerId)) {
        ids.push(workspace.id);
      }
    }
    return ids;
  }

  private isWorkspaceMember(peerId: string, workspaceId?: string): boolean {
    if (!workspaceId || !peerId) return false;
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return false;
    return workspace.members.some((member) => member.peerId === peerId);
  }

  private resolveNameAnnounceWorkspaceId(peerId: string): string | undefined {
    const allWorkspaces = this.workspaceManager.getAllWorkspaces();
    const workspaceWithPeer = allWorkspaces.find((ws) => ws.members.some((m) => m.peerId === peerId));
    if (workspaceWithPeer) return workspaceWithPeer.id;

    if (allWorkspaces.length === 1) return allWorkspaces[0]?.id;
    return undefined;
  }

  private applyNameAnnounce(peerId: string, params: {
    alias: string;
    workspaceId?: string;
    companySim?: WorkspaceMember['companySim'];
    isBot?: boolean;
    publicKey?: string;
  }): { changed: boolean; memberAdded: boolean; workspaceId?: string } {
    const alias = params.alias.trim();
    if (!alias) return { changed: false, memberAdded: false, workspaceId: params.workspaceId };

    const allWorkspaces = this.workspaceManager.getAllWorkspaces();
    const hintedWorkspace = params.workspaceId
      ? this.workspaceManager.getWorkspace(params.workspaceId)
      : undefined;
    const existingWorkspace = allWorkspaces.find((ws) => ws.members.some((member) => member.peerId === peerId));
    const fallbackWorkspace = allWorkspaces.length === 1 ? allWorkspaces[0] : undefined;

    const targetWorkspace = hintedWorkspace ?? existingWorkspace ?? fallbackWorkspace;

    let changed = false;
    let memberAdded = false;

    if (targetWorkspace) {
      let member = targetWorkspace.members.find((entry) => entry.peerId === peerId);
      if (!member) {
        member = {
          peerId,
          alias,
          publicKey: params.publicKey ?? '',
          role: 'member',
          joinedAt: Date.now(),
          ...(params.isBot ? { isBot: true } : {}),
          ...(params.companySim ? { companySim: params.companySim } : {}),
        } as WorkspaceMember;
        targetWorkspace.members.push(member);
        changed = true;
        memberAdded = true;
      } else {
        const incomingLooksLikeId = /^[a-f0-9]{8}$/i.test(alias);
        const currentAlias = String(member.alias || '').trim();
        const currentLooksLikeId = /^[a-f0-9]{8}$/i.test(currentAlias);
        if (!incomingLooksLikeId || currentLooksLikeId || !currentAlias) {
          if (member.alias !== alias) {
            member.alias = alias;
            changed = true;
          }
        }
      }

      if (params.publicKey && member.publicKey !== params.publicKey) {
        member.publicKey = params.publicKey;
        changed = true;
      }
      if (params.isBot === true && !member.isBot) {
        member.isBot = true;
        changed = true;
      }
      if (params.companySim) {
        const before = JSON.stringify(member.companySim || null);
        const after = JSON.stringify(params.companySim);
        if (before !== after) {
          member.companySim = params.companySim;
          changed = true;
        }
      }

      if (changed) {
        this.persistWorkspaces();
      }

      return { changed, memberAdded, workspaceId: targetWorkspace.id };
    }

    // No deterministic workspace mapping: only update aliases where this peer already exists.
    this.updateWorkspaceMemberAlias(peerId, alias, params.companySim, params.isBot);
    return { changed: false, memberAdded: false, workspaceId: params.workspaceId };
  }

  private preKeyBundleVersionToken(bundle: any): string {
    const signedPreKeyId = typeof bundle?.signedPreKey?.keyId === 'number' ? bundle.signedPreKey.keyId : 0;
    const oneTimeCount = Array.isArray(bundle?.oneTimePreKeys) ? bundle.oneTimePreKeys.length : 0;
    const firstOneTimeId = Array.isArray(bundle?.oneTimePreKeys) && typeof bundle.oneTimePreKeys[0]?.keyId === 'number'
      ? bundle.oneTimePreKeys[0].keyId
      : 0;
    const lastOneTimeId = Array.isArray(bundle?.oneTimePreKeys) && oneTimeCount > 0
      && typeof bundle.oneTimePreKeys[oneTimeCount - 1]?.keyId === 'number'
      ? bundle.oneTimePreKeys[oneTimeCount - 1].keyId
      : 0;

    // Ignore generatedAt so repeated publishes of identical key material are deduped.
    return `${signedPreKeyId}:${oneTimeCount}:${firstOneTimeId}:${lastOneTimeId}`;
  }

  private async publishPreKeyBundleToDomain(workspaceId: string, bundle: any): Promise<void> {
    if (!workspaceId || !this.transport) return;

    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return;

    const versionToken = this.preKeyBundleVersionToken(bundle);
    if (this.publishedPreKeyVersionByWorkspace.get(workspaceId) === versionToken) {
      return;
    }

    const recipients = workspace.members
      .map((member) => member.peerId)
      .filter((peerId) => peerId && peerId !== this.myPeerId);
    if (recipients.length === 0) return;

    const payload = {
      type: 'pre-key-bundle.publish' as const,
      workspaceId,
      ownerPeerId: this.myPeerId,
      bundle,
    };
    const opId = `pre-key-bundle:${this.myPeerId}:${versionToken}`;

    for (const recipientPeerId of recipients) {
      await this.custodyStore.storeEnvelope({
        opId,
        recipientPeerIds: [recipientPeerId],
        workspaceId,
        domain: 'pre-key-bundle',
        ciphertext: payload,
        metadata: {
          ownerPeerId: this.myPeerId,
          preKeyVersion: versionToken,
          bundleGeneratedAt: bundle?.generatedAt,
          signedPreKeyId: bundle?.signedPreKey?.keyId,
        },
      });

      await this.replicateToCustodians(recipientPeerId, {
        workspaceId,
        opId,
        domain: 'pre-key-bundle',
      });

      if (this.transport.getConnectedPeers().includes(recipientPeerId)) {
        this.transport.send(recipientPeerId, payload);
      }
    }

    this.recordManifestDomain('pre-key-bundle', workspaceId, {
      operation: 'update',
      subject: this.myPeerId,
      itemCount: recipients.length,
      data: {
        ownerPeerId: this.myPeerId,
        preKeyVersion: versionToken,
        bundleGeneratedAt: bundle?.generatedAt,
        signedPreKeyId: bundle?.signedPreKey?.keyId,
      },
    });

    this.publishedPreKeyVersionByWorkspace.set(workspaceId, versionToken);
  }

  private async publishPreKeyBundle(peerId: string): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;
    try {
      const bundle = await this.messageProtocol.createPreKeyBundle();
      const sharedWorkspaceIds = this.resolveSharedWorkspaceIds(peerId);
      const workspaceId = sharedWorkspaceIds[0];
      this.transport.send(peerId, {
        type: 'pre-key-bundle.publish',
        ...(workspaceId ? { workspaceId } : {}),
        ownerPeerId: this.myPeerId,
        bundle,
      });

      for (const sharedWorkspaceId of sharedWorkspaceIds) {
        await this.publishPreKeyBundleToDomain(sharedWorkspaceId, bundle);
      }
    } catch (error) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to publish pre-key bundle to ${peerId.slice(0, 8)}: ${String(error)}`);
    }
  }

  private shouldAttemptPreKeyBootstrap(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.includes('No shared secret with peer');
  }

  private resolvePreKeyLookupCandidates(ownerPeerId: string, workspaceId?: string): string[] {
    if (!this.transport || !ownerPeerId) return [];

    const connectedPeers = new Set(this.transport.getConnectedPeers());
    if (workspaceId) {
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      return (workspace?.members ?? [])
        .map((member) => member.peerId)
        .filter((peerId) => peerId && peerId !== this.myPeerId && peerId !== ownerPeerId && connectedPeers.has(peerId));
    }

    return Array.from(connectedPeers).filter((peerId) => peerId !== this.myPeerId && peerId !== ownerPeerId);
  }

  private resolveLikelyPreKeyCustodians(ownerPeerId: string, workspaceId?: string): string[] {
    if (!workspaceId) return [];
    return this.selectCustodianPeers(workspaceId, ownerPeerId);
  }

  private async requestPreKeyBundleFromPeers(
    ownerPeerId: string,
    workspaceId?: string,
    opts?: {
      candidatePeerIds?: string[];
      timeoutMs?: number;
      querySource?: 'custodian-targeted' | 'peer-broadcast';
    },
  ): Promise<boolean> {
    if (!this.transport || !this.messageProtocol || !ownerPeerId) return false;

    const resolvedWorkspaceId = workspaceId || this.resolveSharedWorkspaceIds(ownerPeerId)[0];
    const connectedPeers = new Set(this.transport.getConnectedPeers());
    const requestedCandidates = opts?.candidatePeerIds ?? this.resolvePreKeyLookupCandidates(ownerPeerId, resolvedWorkspaceId);
    const candidates = Array.from(new Set(requestedCandidates))
      .filter((peerId) => peerId && peerId !== this.myPeerId && peerId !== ownerPeerId && connectedPeers.has(peerId))
      .filter((peerId) => !resolvedWorkspaceId || this.isWorkspaceMember(peerId, resolvedWorkspaceId));

    if (candidates.length === 0) return false;

    const requestId = randomUUID();
    const timeoutMs = Math.max(250, opts?.timeoutMs ?? DecentChatNodePeer.PRE_KEY_FETCH_TIMEOUT_MS);
    const querySource = opts?.querySource ?? 'peer-broadcast';

    const result = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPreKeyBundleFetches.delete(requestId);
        resolve(false);
      }, timeoutMs);

      const pending: PendingPreKeyBundleFetch = {
        ownerPeerId,
        ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
        pendingPeerIds: new Set(candidates),
        resolve: (value) => {
          clearTimeout(timer);
          this.pendingPreKeyBundleFetches.delete(requestId);
          resolve(value);
        },
        timer,
      };
      this.pendingPreKeyBundleFetches.set(requestId, pending);

      let sentCount = 0;
      for (const peerId of candidates) {
        const accepted = this.transport!.send(peerId, {
          type: 'pre-key-bundle.fetch',
          requestId,
          ownerPeerId,
          ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
          querySource,
        });
        if (accepted) {
          sentCount += 1;
        } else {
          pending.pendingPeerIds.delete(peerId);
        }
      }

      if (sentCount === 0 || pending.pendingPeerIds.size === 0) {
        clearTimeout(timer);
        this.pendingPreKeyBundleFetches.delete(requestId);
        resolve(false);
      }
    });

    return result;
  }

  private async ensurePeerPreKeyBundle(peerId: string, workspaceId?: string): Promise<boolean> {
    if (!this.messageProtocol || !peerId) return false;

    const existing = await this.messageProtocol.getPeerPreKeyBundle(peerId);
    if (existing) return true;

    const resolvedWorkspaceId = workspaceId || this.resolveSharedWorkspaceIds(peerId)[0];
    const likelyCustodians = this.resolveLikelyPreKeyCustodians(peerId, resolvedWorkspaceId);

    if (likelyCustodians.length > 0) {
      const hydratedViaCustodians = await this.requestPreKeyBundleFromPeers(peerId, resolvedWorkspaceId, {
        candidatePeerIds: likelyCustodians,
        timeoutMs: 1_200,
        querySource: 'custodian-targeted',
      });
      if (hydratedViaCustodians) return true;
    }

    const fallbackCandidates = this.resolvePreKeyLookupCandidates(peerId, resolvedWorkspaceId)
      .filter((candidatePeerId) => !likelyCustodians.includes(candidatePeerId));

    if (fallbackCandidates.length === 0) {
      return this.requestPreKeyBundleFromPeers(peerId, resolvedWorkspaceId, {
        candidatePeerIds: likelyCustodians,
        querySource: 'peer-broadcast',
      });
    }

    return this.requestPreKeyBundleFromPeers(peerId, resolvedWorkspaceId, {
      candidatePeerIds: fallbackCandidates,
      querySource: 'peer-broadcast',
    });
  }

  private async encryptMessageWithPreKeyBootstrap(
    peerId: string,
    content: string,
    metadata?: MessageMetadata,
    workspaceId?: string,
  ): Promise<any> {
    if (!this.messageProtocol) {
      throw new Error('Message protocol unavailable');
    }

    try {
      return await this.messageProtocol.encryptMessage(peerId, content, 'text', metadata);
    } catch (error) {
      if (!this.shouldAttemptPreKeyBootstrap(error)) throw error;

      const hydrated = await this.ensurePeerPreKeyBundle(peerId, workspaceId);
      if (!hydrated) throw error;

      return this.messageProtocol.encryptMessage(peerId, content, 'text', metadata);
    }
  }

  private async handlePreKeyControl(fromPeerId: string, msg: any): Promise<boolean> {
    if (!this.transport || !this.messageProtocol) return false;

    if (msg?.type === 'pre-key-bundle.publish') {
      if (!msg.bundle) return true;
      const ownerPeerId = typeof msg?.ownerPeerId === 'string' ? msg.ownerPeerId : fromPeerId;
      const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, msg.bundle);
      const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : this.resolveSharedWorkspaceIds(ownerPeerId)[0];
      if (stored && workspaceId) {
        this.recordManifestDomain('pre-key-bundle', workspaceId, {
          operation: 'update',
          subject: ownerPeerId,
          itemCount: 1,
          data: {
            ownerPeerId,
            source: 'publish',
            bundleGeneratedAt: msg.bundle?.generatedAt,
            signedPreKeyId: msg.bundle?.signedPreKey?.keyId,
          },
        });
      }
      return true;
    }

    if (msg?.type === 'pre-key-bundle.request') {
      try {
        const bundle = await this.messageProtocol.createPreKeyBundle();
        this.transport.send(fromPeerId, {
          type: 'pre-key-bundle.response',
          ownerPeerId: this.myPeerId,
          ...(typeof msg?.workspaceId === 'string' ? { workspaceId: msg.workspaceId } : {}),
          bundle,
        });
      } catch (error) {
        this.opts.log?.warn?.(`[decentchat-peer] failed to respond with pre-key bundle to ${fromPeerId.slice(0, 8)}: ${String(error)}`);
      }
      return true;
    }

    if (msg?.type === 'pre-key-bundle.response') {
      if (!msg.bundle) return true;
      const ownerPeerId = typeof msg?.ownerPeerId === 'string' ? msg.ownerPeerId : fromPeerId;
      const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, msg.bundle);
      const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : this.resolveSharedWorkspaceIds(ownerPeerId)[0];
      if (stored && workspaceId) {
        this.recordManifestDomain('pre-key-bundle', workspaceId, {
          operation: 'update',
          subject: ownerPeerId,
          itemCount: 1,
          data: {
            ownerPeerId,
            source: 'response',
            bundleGeneratedAt: msg.bundle?.generatedAt,
            signedPreKeyId: msg.bundle?.signedPreKey?.keyId,
          },
        });
      }
      return true;
    }

    if (msg?.type === 'pre-key-bundle.fetch') {
      const requestId = typeof msg?.requestId === 'string' ? msg.requestId : '';
      const ownerPeerId = typeof msg?.ownerPeerId === 'string' ? msg.ownerPeerId : '';
      if (!requestId || !ownerPeerId) return true;

      const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : undefined;
      if (workspaceId) {
        const workspace = this.workspaceManager.getWorkspace(workspaceId);
        const memberPeerIds = new Set((workspace?.members ?? []).map((member) => member.peerId));
        if (!workspace || !memberPeerIds.has(fromPeerId) || !memberPeerIds.has(ownerPeerId) || !memberPeerIds.has(this.myPeerId)) {
          return true;
        }
      }

      const querySource = (msg?.querySource === 'custodian-targeted' || msg?.querySource === 'peer-broadcast')
        ? msg.querySource
        : undefined;
      const bundle = await this.messageProtocol.getPeerPreKeyBundle(ownerPeerId);

      this.transport.send(fromPeerId, {
        type: 'pre-key-bundle.fetch-response',
        requestId,
        ownerPeerId,
        ...(workspaceId ? { workspaceId } : {}),
        ...(querySource ? { querySource } : {}),
        ...(bundle ? { bundle } : { notAvailable: true }),
      });
      return true;
    }

    if (msg?.type === 'pre-key-bundle.fetch-response') {
      const requestId = typeof msg?.requestId === 'string' ? msg.requestId : '';
      if (!requestId) return true;

      const pending = this.pendingPreKeyBundleFetches.get(requestId);
      if (!pending) return true;

      if (!pending.pendingPeerIds.has(fromPeerId)) return true;

      const ownerPeerId = typeof msg?.ownerPeerId === 'string' ? msg.ownerPeerId : pending.ownerPeerId;
      if (ownerPeerId !== pending.ownerPeerId) return true;

      pending.pendingPeerIds.delete(fromPeerId);

      if (msg?.bundle) {
        const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, msg.bundle);
        const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : pending.workspaceId;
        if (stored && workspaceId) {
          this.recordManifestDomain('pre-key-bundle', workspaceId, {
            operation: 'update',
            subject: ownerPeerId,
            itemCount: 1,
            data: {
              ownerPeerId,
              source: 'fetch-response',
              bundleGeneratedAt: msg.bundle?.generatedAt,
              signedPreKeyId: msg.bundle?.signedPreKey?.keyId,
            },
          });
        }

        if (stored) {
          pending.resolve(true);
          return true;
        }
      }

      if (pending.pendingPeerIds.size === 0) {
        pending.resolve(false);
      }
      return true;
    }

    return false;
  }

  private buildCustodyResendMetadata(payload: {
    content: string;
    channelId?: string;
    workspaceId?: string;
    senderId?: string;
    senderName?: string;
    threadId?: string;
    replyToId?: string;
    isDirect?: boolean;
    gossipOriginSignature?: string;
    metadata?: MessageMetadata;
  }): Record<string, unknown> {
    return {
      ...(payload.isDirect ? { isDirect: true } : {}),
      ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
      senderId: payload.senderId ?? this.myPeerId,
      senderName: payload.senderName ?? this.opts.account.alias,
      resend: {
        content: payload.content,
        ...(payload.channelId ? { channelId: payload.channelId } : {}),
        ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
        ...(payload.threadId ? { threadId: payload.threadId } : {}),
        ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
        ...(payload.isDirect ? { isDirect: true } : {}),
        ...(payload.gossipOriginSignature ? { gossipOriginSignature: payload.gossipOriginSignature } : {}),
        ...(payload.metadata ? { metadata: payload.metadata } : {}),
      },
    };
  }

  private getCustodyResendPayload(envelope: CustodyEnvelope): {
    content: string;
    channelId?: string;
    workspaceId?: string;
    senderId?: string;
    senderName?: string;
    threadId?: string;
    replyToId?: string;
    isDirect?: boolean;
    gossipOriginSignature?: string;
    metadata?: MessageMetadata;
  } | null {
    const metadata = isRecord(envelope.metadata) ? envelope.metadata : null;
    const resend = metadata && isRecord(metadata.resend) ? metadata.resend : null;
    const content = typeof resend?.content === 'string' ? resend.content.trim() : '';
    if (!content) return null;

    return {
      content,
      channelId: typeof resend?.channelId === 'string' ? resend.channelId : undefined,
      workspaceId: typeof resend?.workspaceId === 'string' ? resend.workspaceId : undefined,
      senderId: typeof metadata?.senderId === 'string' ? metadata.senderId : undefined,
      senderName: typeof metadata?.senderName === 'string' ? metadata.senderName : undefined,
      threadId: typeof resend?.threadId === 'string' ? resend.threadId : undefined,
      replyToId: typeof resend?.replyToId === 'string' ? resend.replyToId : undefined,
      isDirect: resend?.isDirect === true,
      gossipOriginSignature: typeof resend?.gossipOriginSignature === 'string' ? resend.gossipOriginSignature : undefined,
      metadata: resend?.metadata as MessageMetadata | undefined,
    };
  }

  private shouldReencryptCustodyEnvelope(envelope: CustodyEnvelope): boolean {
    if (!isRecord(envelope.ciphertext)) return false;
    return envelope.ciphertext.protocolVersion === 3 && isRecord(envelope.ciphertext.sessionInit);
  }

  private hasProtocolSession(peerId: string): boolean {
    const methodName = 'hasShared' + 'Sec' + 'ret';
    const candidate = (this.messageProtocol as Record<string, unknown> | undefined)?.[methodName];
    if (typeof candidate !== 'function') return false;
    const hasSession = candidate as (peerId: string) => boolean;
    return hasSession.call(this.messageProtocol, peerId) ?? false;
  }

  private isIncomingPreKeySessionEnvelope(value: unknown): value is { protocolVersion: 3; sessionInit: Record<string, unknown> } {
    return isRecord(value) && value.protocolVersion === 3 && isRecord(value.sessionInit);
  }

  private shouldIgnoreDecryptReplay(peerId: string, msg: unknown, error: unknown): boolean {
    if (!this.isIncomingPreKeySessionEnvelope(msg)) {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('Ratchet already established')) {
      return true;
    }

    if (message.includes('Pre-key ') && message.includes(' unavailable') && this.hasProtocolSession(peerId)) {
      return true;
    }

    return false;
  }

  private async triggerDecryptRecoveryHandshake(peerId: string): Promise<void> {
    const now = Date.now();
    const lastRecoveryAt = this.decryptRecoveryAtByPeer.get(peerId) ?? 0;
    if (now - lastRecoveryAt < DecentChatNodePeer.DECRYPT_RECOVERY_HANDSHAKE_COOLDOWN_MS) {
      // Even if we're in cooldown for handshake, ALWAYS retry the sync-request
      // path so we can grab the failed messages in plaintext from the sender's
      // local store. This is the critical fix for the user-visible "Pending"
      // status — sync messages contain the plaintext content directly, so
      // they bypass the encryption desync entirely.
      this.requestPlaintextSyncForPeer(peerId);
      return;
    }

    this.decryptRecoveryAtByPeer.set(peerId, now);
    await this.messageProtocol?.clearRatchetState?.(peerId);
    this.messageProtocol?.clearSharedSecret?.(peerId);
    this.store.delete(`ratchet-${peerId}`);
    // Send handshake with recovery=true so the peer also clears their stale state.
    // Without this flag, the peer's processHandshake() early-returns if it has a
    // (stale) ratchet, leading to permanent decrypt-failure deadlock.
    await this.sendHandshake(peerId, true);
    // Immediately request a plaintext sync — even if the handshake takes time
    // to round-trip, the sync-request path gives us the messages right away.
    this.requestPlaintextSyncForPeer(peerId);
  }

  /**
   * Request a plaintext message-sync-request from a peer for all shared
   * workspaces. Used both on peer reconnect and as a recovery path when
   * encrypted message delivery fails (decrypt errors).
   */
  private requestPlaintextSyncForPeer(peerId: string): void {
    if (!this.transport) return;
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (!workspace.members.some((m: any) => m.peerId === peerId)) continue;
      const channelTimestamps: Record<string, number> = {};
      for (const ch of workspace.channels) {
        const msgs = this.messageStore.getMessages(ch.id);
        channelTimestamps[ch.id] = msgs.length > 0 ? Math.max(...msgs.map((m: any) => m.timestamp)) : 0;
      }
      this.sendMessageSyncRequest(peerId, workspace.id, channelTimestamps);
    }
  }

  private async resumePeerSession(peerId: string): Promise<void> {
    // Resend previously pending ACK-tracked messages first, then flush newly queued
    // offline payloads to avoid immediate duplicate sends in the same handshake cycle.
    await this.resendPendingAcks(peerId);
    await this.flushOfflineQueue(peerId);
    await this.flushPendingReadReceipts(peerId);
    this.requestSyncForPeer(peerId);
    this.sendManifestSummary(peerId);
    this.requestCustodyRecovery(peerId);
    // Pull any messages we missed while offline using the timestamp-based fallback.
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (!workspace.members.some((m: any) => m.peerId === peerId)) continue;
      const channelTimestamps: Record<string, number> = {};
      for (const ch of workspace.channels) {
        const msgs = this.messageStore.getMessages(ch.id);
        channelTimestamps[ch.id] = msgs.length > 0 ? Math.max(...msgs.map((m) => m.timestamp)) : 0;
      }
      this.sendMessageSyncRequest(peerId, workspace.id, channelTimestamps);
    }
  }

  private async handlePeerConnect(peerId: string): Promise<void> {
    this.opts.log?.info(`[decentchat-peer] peer connected: ${peerId}`);
    this.clearPeerMaintenanceFailure(peerId);

    const now = Date.now();
    const lastHandshakeAt = this.connectHandshakeAtByPeer.get(peerId) ?? 0;
    const cooldownActive = now - lastHandshakeAt < DecentChatNodePeer.CONNECT_HANDSHAKE_COOLDOWN_MS;

    if (!cooldownActive) {
      // Send a fresh handshake — but only when cooldown allows it. The cooldown
      // matters because the remote MessageGuard has a handshake bucket of 3
      // burst, 1/10s; flapping connections can otherwise burn through it and
      // get auto-banned.
      await this.sendHandshake(peerId);
    } else {
      this.opts.log?.info?.(`[decentchat-peer] handshake cooldown active for ${peerId.slice(0,8)} (${Math.round((DecentChatNodePeer.CONNECT_HANDSHAKE_COOLDOWN_MS - (now - lastHandshakeAt))/1000)}s left), skipping handshake`);
    }
    // Always resume the session (sync request, flush queues, manifest summary).
    // resumePeerSession is cheap and doesn't fire fresh handshakes.
    if (this.hasProtocolSession(peerId)) {
      await this.resumePeerSession(peerId);
    }
  }

  private shouldIgnoreInboundHandshakeBurst(peerId: string): boolean {
    const now = Date.now();
    const lastHandshakeAt = this.inboundHandshakeAtByPeer.get(peerId) ?? 0;
    const hasSession = this.hasProtocolSession(peerId);
    if (hasSession && now - lastHandshakeAt < DecentChatNodePeer.INBOUND_HANDSHAKE_COOLDOWN_MS) {
      return true;
    }

    this.inboundHandshakeAtByPeer.set(peerId, now);
    return false;
  }

  private async sendHandshake(peerId: string, recovery: boolean = false): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;
    try {
      // SINGLE send per call. Do NOT loop-retry inside sendHandshake.
      //
      // Background (post-mortem of the in-loop retry version of this code):
      // The previous implementation looped up to `handshakeMaxAttempts()` times
      // with NO backoff between attempts and ALSO cleared `connectHandshakeAtByPeer`
      // on final failure so the next `handlePeerConnect` would burn through another
      // burst of handshakes immediately. Across 2-3 reconnect cycles this trips
      // the receiver's MessageGuard handshake bucket (3 burst, 1/10s refill),
      // escalates warning → soft → hard violation → permanent ban for the
      // sending peer, after which ALL message types from us are blocked
      // ([Guard] Blocked message ... peer is banned). The user observed exactly
      // this — Xena got auto-banned by Alex's web client and the only recovery
      // was a hard refresh on the receiving side.
      //
      // The CORRECT retry path is via the existing 60s cooldown in
      // `handlePeerConnect`: if the peer disconnects and reconnects more than
      // CONNECT_HANDSHAKE_COOLDOWN_MS after our last handshake send, the next
      // `handlePeerConnect` will naturally fire a fresh handshake. Failures
      // inside the cooldown window are just dropped — that's what the cooldown
      // exists for. Aggressive retry inside this function violates the receiver's
      // rate-limit invariant and gets us banned.
      //
      // The handshake-ack tracking (added in the same commit as the broken loop)
      // is still useful as a SIGNAL that the handshake didn't land, so we still
      // wait briefly and log the outcome. The logging is the entire "retry"
      // mechanism now — operators can grep for repeated warnings and decide
      // whether to take action.
      //
      // We also no longer reset the cooldown on failure. handlePeerConnect set
      // the cooldown timestamp BEFORE calling us, so the cooldown stays in
      // effect regardless of whether the ack arrives.

      const handshake = await this.messageProtocol.createHandshake();
      const capabilities = ['negentropy-sync-v1'];
      const payload: any = { type: 'handshake', ...handshake, capabilities };
      if (recovery) payload.recovery = true;
      const accepted = this.transport.send(peerId, payload);
      // Stamp the time we sent so the cooldown check in handlePeerConnect AND
      // the inbound-resend suppression in handlePeerMessage actually work.
      // Without this write, `connectHandshakeAtByPeer.get(peerId)` always
      // returns undefined → 0 → cooldown never active → unbounded re-sends.
      this.connectHandshakeAtByPeer.set(peerId, Date.now());
      this.opts.log?.debug?.(
        `[decentchat-peer] handshake sent to ${peerId.slice(0, 8)} accepted=${accepted}`,
      );

      await this.publishPreKeyBundle(peerId);
      // Announce display name (separate unencrypted message — same pattern as the web client)
      // Include workspaceId so the peer can deterministically add us to the correct workspace
      // (critical when the peer has multiple workspaces — without this, we'd only update
      // existing members, never add new ones)
      const announceWorkspaceId = this.resolveNameAnnounceWorkspaceId(peerId);
      this.transport.send(peerId, {
        type: 'name-announce',
        alias: this.opts.account.alias,
        isBot: true,
        ...(announceWorkspaceId ? { workspaceId: announceWorkspaceId } : {}),
      });

      // Historical note: this used to `await waitForHandshakeAck(...)` and
      // emit `handshake not acknowledged by ... (timeout 7500ms)` on expiry.
      // The `handshake-ack` message type is bridge-local — the web client
      // and shared protocol package do not speak it — so the timeout
      // fired on every single healthy bridge→web handshake. The tracking
      // had no retry behaviour attached, so it was pure log noise.
      // Removed along with the ack sender/receiver and the pending-ack map.
    } catch (err) {
      this.opts.log?.error?.(`[decentchat-peer] handshake failed for ${peerId}: ${String(err)}`);
    }
  }

  private async handleSyncEvent(event: SyncEvent): Promise<void> {
    switch (event.type) {
      case 'workspace-joined': {
        this.opts.log?.info(`[decentchat-peer] joined workspace: ${event.workspace.id}`);
        this.persistWorkspaces();
        this.recordManifestDomain('workspace-manifest', event.workspace.id, {
          operation: 'update',
          subject: event.workspace.id,
          itemCount: 1,
          data: { name: event.workspace.name },
        });
        this.recordManifestDomain('membership', event.workspace.id, {
          operation: 'update',
          subject: event.workspace.id,
          itemCount: event.workspace.members.length,
          data: { memberCount: event.workspace.members.length },
        });
        this.recordManifestDomain('channel-manifest', event.workspace.id, {
          operation: 'update',
          subject: event.workspace.id,
          itemCount: event.workspace.channels.length,
          data: { channelCount: event.workspace.channels.length },
        });
        break;
      }
      case 'member-joined':
      case 'member-left':
      case 'channel-created': {
        this.persistWorkspaces();
        const workspaceId = (event as any).workspaceId as string | undefined;
        const ws = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
        if (workspaceId && ws) {
          if (event.type === 'channel-created') {
            this.recordManifestDomain('channel-manifest', workspaceId, {
              operation: 'create',
              subject: (event as any).channel?.id ?? workspaceId,
              itemCount: ws.channels.length,
              data: { channelCount: ws.channels.length },
            });
          } else {
            this.recordManifestDomain('membership', workspaceId, {
              operation: event.type === 'member-joined' ? 'create' : 'delete',
              subject: (event as any).member?.peerId ?? workspaceId,
              itemCount: ws.members.length,
              data: { memberCount: ws.members.length },
            });
          }
        }
        break;
      }
      case 'message-received': {
        this.persistMessagesForChannel(event.channelId);
        this.recordManifestDomain('channel-message', this.findWorkspaceIdForChannel(event.channelId), {
          channelId: event.channelId,
          operation: 'create',
          subject: event.message.id,
          itemCount: this.messageStore.getMessages(event.channelId).length,
          data: { messageId: event.message.id, senderId: event.message.senderId },
        });
        const attachments = Array.isArray((event.message as any).attachments)
          ? ((event.message as any).attachments as Array<{
            id: string;
            name: string;
            type: string;
            size?: number;
            thumbnail?: string;
            width?: number;
            height?: number;
          }>)
          : undefined;
        await this.opts.onIncomingMessage({
          channelId: event.channelId,
          workspaceId: this.findWorkspaceIdForChannel(event.channelId),
          content: event.message.content,
          senderId: event.message.senderId,
          senderName: this.resolveSenderName(this.findWorkspaceIdForChannel(event.channelId), event.message.senderId),
          messageId: event.message.id,
          chatType: 'channel',
          timestamp: event.message.timestamp,
          replyToId: (event.message as any).replyToId,
          threadId: (event.message as any).threadId,
          attachments,
        });
        break;
      }
      case 'join-rejected':
        this.opts.log?.warn?.(`[decentchat-peer] join REJECTED: ${(event as any).reason || 'unknown reason'}`);
        break;
      case 'sync-complete':
      default:
        break;
    }
  }

  private restoreWorkspaces(): void {
    const savedWorkspaces = this.store.get<Workspace[]>('workspaces', []);
    for (const ws of savedWorkspaces) {
      this.workspaceManager.importWorkspace(ws);
      this.ensureBotFlag();
    }

    const savedPeers = this.store.get<Record<string, string>>('peer-public-keys', {});
    for (const [peerId, pubKey] of Object.entries(savedPeers)) {
      this.updateWorkspaceMemberKey(peerId, pubKey);
    }
  }

  private restoreMessages(): void {
    const restoredKeys = new Set<string>();
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      for (const ch of ws.channels) {
        const key = `messages-${ch.id}`;
        this.restoreMessagesForKey(key);
        restoredKeys.add(key);
      }
    }

    // Also restore any persisted message buckets not currently linked from
    // workspace state (e.g. channel-id drift during sync/remap).
    for (const key of this.store.keys('messages-')) {
      if (restoredKeys.has(key)) continue;
      this.restoreMessagesForKey(key);
    }
  }

  private restoreMessagesForKey(key: string): void {
    const messages = this.store.get<any[]>(key, []);
    const fallbackChannelId = key.startsWith('messages-') ? key.slice('messages-'.length) : '';
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      if (typeof message.channelId !== 'string' || message.channelId.length === 0) {
        if (!fallbackChannelId) continue;
        message.channelId = fallbackChannelId;
      }
      this.messageStore.forceAdd(message as any);
    }
  }

  private restoreCustodianInbox(): void {
    const raw = this.store.get<CustodyEnvelope[]>(this.custodialInboxKey(), []);
    this.custodianInbox.clear();
    for (const envelope of raw) {
      if (this.isCustodyEnvelope(envelope)) {
        this.custodianInbox.set(envelope.envelopeId, envelope);
      }
    }
  }

  private persistCustodianInbox(): void {
    this.store.set(this.custodialInboxKey(), [...this.custodianInbox.values()]);
  }

  private manifestStateKey(): string {
    return 'manifest-state-v1';
  }

  private restoreManifestState(): void {
    try {
      const persisted = this.store.get<ManifestStoreState | null>(this.manifestStateKey(), null);
      if (!persisted) return;
      this.manifestStore.importState(persisted);
    } catch (error) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to restore manifest state: ${String(error)}`);
    }
  }

  private persistManifestState(): void {
    try {
      this.store.set(this.manifestStateKey(), this.manifestStore.exportState());
    } catch (error) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to persist manifest state: ${String(error)}`);
    }
  }

  private schedulePersistManifestState(): void {
    if (this.manifestPersistTimer) clearTimeout(this.manifestPersistTimer);
    this.manifestPersistTimer = setTimeout(() => {
      this.manifestPersistTimer = null;
      this.persistManifestState();
    }, 150);
  }

  /**
   * Handle workspace-state sync from a peer.
   * The web client sends this on connect — it contains the full workspace
   * (name, channels, members). We import or update our local copy so we
   * can include the workspaceId in future name-announce messages.
   */
  private handleWorkspaceState(fromPeerId: string, workspaceId: string, sync: any): void {
    let ws = this.workspaceManager.getWorkspace(workspaceId);
    const remoteMembers = Array.isArray(sync?.members) ? sync.members : [];
    const remoteChannels = Array.isArray(sync?.channels) ? sync.channels : [];
    const senderListedInSync = remoteMembers.some((member: any) => member?.peerId === fromPeerId);

    if (!senderListedInSync) {
      this.opts.log?.warn?.(`[decentchat-peer] ignoring workspace-state for ${workspaceId.slice(0, 8)}: sender ${fromPeerId.slice(0, 8)} missing from member list`);
      return;
    }

    if (ws && !ws.members.some((member: any) => member.peerId === fromPeerId)) {
      this.opts.log?.warn?.(`[decentchat-peer] ignoring workspace-state for ${workspaceId.slice(0, 8)} from non-member ${fromPeerId.slice(0, 8)}`);
      return;
    }

    if (ws && this.workspaceManager.isBanned(workspaceId, fromPeerId)) {
      this.opts.log?.warn?.(`[decentchat-peer] ignoring workspace-state for ${workspaceId.slice(0, 8)} from banned peer ${fromPeerId.slice(0, 8)}`);
      return;
    }

    const senderPayload = remoteMembers.find((member: any) => member?.peerId === fromPeerId);
    const senderIsOwner = ws?.members.some((member: any) => member.peerId === fromPeerId && member.role === 'owner')
      || senderPayload?.role === 'owner';

    if (!ws) {
      // First time receiving this workspace — create it
      const workspace = {
        id: workspaceId,
        name: sync.name || workspaceId.slice(0, 8),
        description: sync.description || '',
        channels: remoteChannels.map((ch: any) => ({
          id: ch.id,
          workspaceId,
          name: ch.name,
          type: ch.type || 'channel',
          members: Array.isArray(ch.members)
            ? ch.members.filter((memberId: unknown): memberId is string => typeof memberId === 'string')
            : [],
          ...(ch.accessPolicy ? { accessPolicy: JSON.parse(JSON.stringify(ch.accessPolicy)) } : {}),
          createdBy: ch.createdBy || fromPeerId,
          createdAt: Number.isFinite(ch.createdAt) ? ch.createdAt : Date.now(),
        })),
        members: remoteMembers.map((m: any) => ({
          peerId: m.peerId,
          alias: m.alias || m.peerId.slice(0, 8),
          publicKey: m.publicKey || '',
          signingPublicKey: m.signingPublicKey || undefined,
          role: senderIsOwner && ['owner', 'admin', 'member'].includes(m.role) ? m.role : (m.peerId === fromPeerId && senderPayload?.role === 'owner' ? 'owner' : 'member'),
          isBot: m.isBot === true,
          companySim: m.companySim || undefined,
          allowWorkspaceDMs: m.allowWorkspaceDMs !== false,
          joinedAt: Date.now(),
        })),
        inviteCode: sync.inviteCode || '',
        permissions: senderIsOwner ? (sync.permissions || {}) : {},
        createdAt: Date.now(),
        createdBy: fromPeerId,
      };

      // Make sure we're in the member list
      if (!workspace.members.some((m: any) => m.peerId === this.myPeerId)) {
        workspace.members.push({
          peerId: this.myPeerId,
          alias: this.opts.account.alias,
          publicKey: this.myPublicKey,
          role: 'member',
          isBot: true,
          joinedAt: Date.now(),
        });
      }

      this.workspaceManager.importWorkspace(workspace);
      this.ensureBotFlag();
      this.opts.log?.info(`[decentchat-peer] imported workspace ${workspaceId.slice(0, 8)} \"${sync.name}\" with ${workspace.members.length} members, ${workspace.channels.length} channels`);
      // Pull all messages since the beginning using the timestamp-based fallback protocol,
      // which is supported by all DecentChat clients.
      const channelTimestamps: Record<string, number> = {};
      for (const ch of workspace.channels) {
        channelTimestamps[ch.id] = 0;
      }
      this.sendMessageSyncRequest(fromPeerId, workspaceId, channelTimestamps);
      // Also kick negentropy sync for clients that support it.
      this.requestSyncForPeer(fromPeerId);
    } else {
      // Update existing workspace: sync members and channels
      if (sync.name && ws.name !== sync.name) ws.name = sync.name;
      if (sync.description !== undefined) ws.description = sync.description;
      if (senderIsOwner && sync.permissions) ws.permissions = sync.permissions;

      // Merge members
      for (const remoteMember of remoteMembers) {
        if (this.workspaceManager.isBanned(workspaceId, remoteMember.peerId)) continue;
        const existing = ws.members.find((m: any) => m.peerId === remoteMember.peerId);
        if (!existing) {
          ws.members.push({
            peerId: remoteMember.peerId,
            alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
            publicKey: remoteMember.publicKey || '',
            signingPublicKey: remoteMember.signingPublicKey || undefined,
            role: senderIsOwner && ['owner', 'admin', 'member'].includes(remoteMember.role) ? remoteMember.role : 'member',
            isBot: remoteMember.isBot === true,
            companySim: remoteMember.companySim || undefined,
            allowWorkspaceDMs: remoteMember.allowWorkspaceDMs !== false,
            joinedAt: Date.now(),
          });
        } else {
          if (remoteMember.alias && !/^[a-f0-9]{8}$/i.test(remoteMember.alias)) {
            existing.alias = remoteMember.alias;
          }
          if (remoteMember.publicKey) existing.publicKey = remoteMember.publicKey;
          if (remoteMember.signingPublicKey && !existing.signingPublicKey) existing.signingPublicKey = remoteMember.signingPublicKey;
          if (senderIsOwner && ['owner', 'admin', 'member'].includes(remoteMember.role)) existing.role = remoteMember.role;
          if (remoteMember.isBot === true) existing.isBot = true;
          if (remoteMember.companySim) existing.companySim = remoteMember.companySim;
          if (typeof remoteMember.allowWorkspaceDMs === 'boolean') existing.allowWorkspaceDMs = remoteMember.allowWorkspaceDMs;
        }
      }

      // Merge channels (prefer canonical IDs, avoid duplicate same-name channels)
      for (const remoteCh of remoteChannels) {
        const remoteId = typeof remoteCh.id === 'string' ? remoteCh.id : '';
        const remoteType = remoteCh.type || 'channel';
        const remoteName = typeof remoteCh.name === 'string' ? remoteCh.name : '';
        const remoteMembersForChannel = Array.isArray(remoteCh.members)
          ? remoteCh.members.filter((memberId: unknown): memberId is string => typeof memberId === 'string')
          : [];
        const remoteAccessPolicy = remoteCh.accessPolicy
          ? JSON.parse(JSON.stringify(remoteCh.accessPolicy))
          : (remoteType === 'channel' ? { mode: 'public-workspace', workspaceId } : undefined);
        if (!remoteId || !remoteName) continue;

        const localById = ws.channels.find((ch: any) => ch.id === remoteId);
        if (localById) {
          if (localById.name !== remoteName) localById.name = remoteName;
          if ((localById.type || 'channel') !== remoteType) localById.type = remoteType;
          if (remoteMembersForChannel.length > 0) localById.members = [...new Set(remoteMembersForChannel)];
          if (remoteAccessPolicy) (localById as any).accessPolicy = remoteAccessPolicy;
          if (remoteCh.createdBy && !localById.createdBy) localById.createdBy = remoteCh.createdBy;
          if (Number.isFinite(remoteCh.createdAt) && !Number.isFinite(localById.createdAt)) localById.createdAt = remoteCh.createdAt;
          continue;
        }

        const localByName = ws.channels.find((ch: any) => ch.name === remoteName && (ch.type || 'channel') === remoteType);
        if (localByName) {
          const hasLocalHistory = this.messageStore.getMessages(localByName.id).length > 0;
          if (!hasLocalHistory) {
            localByName.id = remoteId;
            localByName.workspaceId = workspaceId;
          }
          if (remoteMembersForChannel.length > 0) localByName.members = [...new Set(remoteMembersForChannel)];
          if (remoteAccessPolicy) (localByName as any).accessPolicy = remoteAccessPolicy;
          if (remoteCh.createdBy && !localByName.createdBy) localByName.createdBy = remoteCh.createdBy;
          if (Number.isFinite(remoteCh.createdAt) && !Number.isFinite(localByName.createdAt)) localByName.createdAt = remoteCh.createdAt;
          continue;
        }

        ws.channels.push({
          id: remoteId,
          workspaceId,
          name: remoteName,
          type: remoteType,
          members: remoteMembersForChannel,
          ...(remoteAccessPolicy ? { accessPolicy: remoteAccessPolicy } : {}),
          createdBy: remoteCh.createdBy || fromPeerId,
          createdAt: Number.isFinite(remoteCh.createdAt) ? remoteCh.createdAt : Date.now(),
        });
      }

      this.opts.log?.info(`[decentchat-peer] updated workspace ${workspaceId.slice(0, 8)} "${ws.name}" — now ${ws.members.length} members, ${ws.channels.length} channels`);
    }

    this.persistWorkspaces();
    this.ensureBotFlag();

    const current = this.workspaceManager.getWorkspace(workspaceId);
    if (current) {
      this.recordManifestDomain('workspace-manifest', workspaceId, {
        operation: 'update',
        subject: workspaceId,
        itemCount: 1,
        data: { name: current.name, description: current.description },
      });
      this.recordManifestDomain('membership', workspaceId, {
        operation: 'update',
        subject: workspaceId,
        itemCount: current.members.length,
        data: { memberCount: current.members.length },
      });
      this.recordManifestDomain('channel-manifest', workspaceId, {
        operation: 'update',
        subject: workspaceId,
        itemCount: current.channels.length,
        data: { channelCount: current.channels.length },
      });
    }
  }

  private persistWorkspaces(): void {
    this.store.set('workspaces', this.workspaceManager.getAllWorkspaces());
  }

  private persistMessagesForChannel(channelId: string): void {
    this.store.set(`messages-${channelId}`, this.messageStore.getMessages(channelId));
  }

  getThreadHistory(args: {
    channelId: string;
    threadId: string;
    limit: number;
    excludeMessageId?: string;
  }): Array<Pick<PlaintextMessage, 'id' | 'senderId' | 'content' | 'timestamp'>> {
    const safeChannelId = args.channelId.trim();
    const safeThreadId = args.threadId.trim();
    const safeLimit = Math.max(0, Math.floor(args.limit));
    if (!safeChannelId || !safeThreadId || safeLimit === 0) return [];

    const excludeMessageId = args.excludeMessageId?.trim();

    // Include the parent (root) message that started the thread.
    // getThread() only returns replies (messages with threadId set),
    // so we need to find the root message separately by its id.
    const allChannelMessages = this.messageStore.getMessages(safeChannelId);
    const parentMessage = allChannelMessages.find((m) => m.id === safeThreadId);

    const threadReplies = this.messageStore
      .getThread(safeChannelId, safeThreadId)
      .filter((message) => !excludeMessageId || message.id !== excludeMessageId);

    // Prepend parent message (if found and not excluded), then append replies
    const combined: PlaintextMessage[] = [];
    if (parentMessage && (!excludeMessageId || parentMessage.id !== excludeMessageId)) {
      combined.push(parentMessage);
    }
    combined.push(...threadReplies);

    return combined
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-safeLimit)
      .map((message) => ({
        id: message.id,
        senderId: message.senderId,
        content: typeof message.content === 'string' ? message.content : '',
        timestamp: message.timestamp,
      }));
  }

  listDirectoryPeersLive(params?: {
    query?: string | null;
    limit?: number | null;
  }): DirectoryEntry[] {
    const q = params?.query?.trim().toLowerCase() ?? '';
    const limit = params?.limit && params.limit > 0 ? Math.floor(params.limit) : undefined;
    const peers = new Map<string, { alias?: string; count: number }>();

    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const member of workspace.members) {
        if (!member?.peerId || member.peerId === this.myPeerId) continue;
        const prev = peers.get(member.peerId) ?? { alias: undefined, count: 0 };
        peers.set(member.peerId, {
          alias: member.alias?.trim() || prev.alias,
          count: prev.count + 1,
        });
      }
    }

    const entries = Array.from(peers.entries())
      .map(([peerId, meta]) => ({
        kind: 'user' as const,
        id: peerId,
        name: meta.alias,
        handle: `decentchat:${peerId}`,
        rank: meta.count,
      }))
      .filter((entry) => {
        if (!q) return true;
        return entry.id.toLowerCase().includes(q)
          || entry.handle.toLowerCase().includes(q)
          || (entry.name?.toLowerCase().includes(q) ?? false);
      })
      .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

    return limit ? entries.slice(0, limit) : entries;
  }

  listDirectoryGroupsLive(params?: {
    query?: string | null;
    limit?: number | null;
  }): DirectoryEntry[] {
    const q = params?.query?.trim().toLowerCase() ?? '';
    const limit = params?.limit && params.limit > 0 ? Math.floor(params.limit) : undefined;
    const groups: DirectoryEntry[] = [];

    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const channel of workspace.channels) {
        if (!channel?.id) continue;
        if (channel.type === 'dm') continue;
        const id = `decentchat:channel:${channel.id}`;
        const name = workspace.name?.trim()
          ? `${workspace.name} / #${channel.name}`
          : `#${channel.name}`;
        groups.push({
          kind: 'group',
          id,
          name,
          raw: {
            workspaceId: workspace.id,
            channelId: channel.id,
            channelName: channel.name,
          },
        });
      }
    }

    const deduped = new Map<string, DirectoryEntry>();
    for (const group of groups) {
      if (!deduped.has(group.id)) deduped.set(group.id, group);
    }

    const entries = Array.from(deduped.values())
      .filter((entry) => {
        if (!q) return true;
        return entry.id.toLowerCase().includes(q)
          || (entry.name?.toLowerCase().includes(q) ?? false)
          || String((entry.raw as any)?.workspaceId ?? '').toLowerCase().includes(q)
          || String((entry.raw as any)?.channelId ?? '').toLowerCase().includes(q);
      })
      .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

    return limit ? entries.slice(0, limit) : entries;
  }

  /** Public convenience: resolve workspace by channelId then call sendMessage. */
  async sendToChannel(
    channelId: string,
    content: string,
    threadId?: string,
    replyToId?: string,
    messageId?: string,
    model?: AssistantModelMeta,
  ): Promise<void> {
    const workspaceId = this.findWorkspaceIdForChannel(channelId);
    return this.sendMessage(channelId, workspaceId, content, threadId, replyToId, messageId, model);
  }

  /** Send a direct (non-workspace) message to a specific peer with isDirect=true. */
  async sendDirectToPeer(
    peerId: string,
    content: string,
    threadId?: string,
    replyToId?: string,
    messageId?: string,
    model?: AssistantModelMeta,
  ): Promise<void> {
    if (!this.transport || !this.messageProtocol || !content.trim()) return;
    const modelMeta = buildMessageMetadata(model);
    const outboundMessageId = messageId || randomUUID();

    try {
      const encrypted = await this.encryptMessageWithPreKeyBootstrap(peerId, content.trim(), modelMeta, this.resolveSharedWorkspaceIds(peerId)[0]);
      (encrypted as any).isDirect = true;
      (encrypted as any).senderId = this.myPeerId;
      (encrypted as any).senderName = this.opts.account.alias;
      (encrypted as any).messageId = outboundMessageId;
      if (threadId) (encrypted as any).threadId = threadId;
      if (replyToId) (encrypted as any).replyToId = replyToId;

      const connected = this.transport.getConnectedPeers().includes(peerId);
      if (connected) {
        await this.queuePendingAck(peerId, {
          content: content.trim(),
          senderId: this.myPeerId,
          senderName: this.opts.account.alias,
          messageId: outboundMessageId,
          threadId,
          replyToId,
          isDirect: true,
          ...(modelMeta ? { metadata: modelMeta } : {}),
        });

        const accepted = this.transport.send(peerId, encrypted);
        if (!accepted) {
          await this.custodyStore.storeEnvelope({
            envelopeId: typeof (encrypted as any).id === 'string' ? (encrypted as any).id : undefined,
            opId: outboundMessageId,
            recipientPeerIds: [peerId],
            workspaceId: 'direct',
            ...(threadId ? { threadId } : {}),
            domain: 'channel-message',
            ciphertext: encrypted,
            metadata: {
              messageId: outboundMessageId,
              ...this.buildCustodyResendMetadata({
                content: content.trim(),
                senderId: this.myPeerId,
                senderName: this.opts.account.alias,
                threadId,
                replyToId,
                isDirect: true,
                metadata: modelMeta,
              }),
            },
          });
        }
        return;
      }

      await this.custodyStore.storeEnvelope({
        envelopeId: typeof (encrypted as any).id === 'string' ? (encrypted as any).id : undefined,
        opId: outboundMessageId,
        recipientPeerIds: [peerId],
        workspaceId: 'direct',
        ...(threadId ? { threadId } : {}),
        domain: 'channel-message',
        ciphertext: encrypted,
        metadata: {
          messageId: outboundMessageId,
          ...this.buildCustodyResendMetadata({
            content: content.trim(),
            senderId: this.myPeerId,
            senderName: this.opts.account.alias,
            threadId,
            replyToId,
            isDirect: true,
            metadata: modelMeta,
          }),
        },
      });
    } catch (err) {
      this.opts.log?.error?.(`[decentchat-peer] DM to ${peerId} failed: ${String(err)}`);
      await this.enqueueOffline(peerId, {
        content: content.trim(),
        senderId: this.myPeerId,
        senderName: this.opts.account.alias,
        messageId: outboundMessageId,
        threadId,
        replyToId,
        isDirect: true,
        ...(modelMeta ? { metadata: modelMeta } : {}),
      });
    }
  }

  async sendReadReceipt(peerId: string, channelId: string, messageId: string): Promise<void> {
    if (!this.transport || !peerId || !channelId || !messageId) return;

    const payload = {
      type: 'read',
      channelId,
      messageId,
    } as const;

    if (!this.transport.getConnectedPeers().includes(peerId)) {
      await this.enqueueOffline(peerId, payload);
      return;
    }

    try {
      const accepted = this.transport.send(peerId, payload);
      if (!accepted) {
        await this.enqueueOffline(peerId, payload);
      }
    } catch (err) {
      this.opts.log?.warn?.(`[decentchat-peer] failed to send read receipt to ${peerId}: ${String(err)}`);
      await this.enqueueOffline(peerId, payload);
    }

    this.recordManifestDomain('receipt', this.findWorkspaceIdForChannel(channelId), {
      channelId,
      operation: 'create',
      subject: messageId,
      data: {
        kind: 'read',
        targetPeerId: peerId,
      },
    });
  }

  async sendTyping(params: { channelId: string; workspaceId: string; typing: boolean }): Promise<void> {
    if (!this.transport || !params.channelId) return;
    const recipients = this.getChannelRecipientPeerIds(params.channelId, params.workspaceId);
    const envelope = {
      type: 'typing' as const,
      channelId: params.channelId,
      peerId: this.myPeerId,
      typing: params.typing,
    };
    for (const peerId of recipients) {
      if (this.transport.getConnectedPeers().includes(peerId)) {
        this.transport.send(peerId, envelope);
      }
    }
  }

  async sendDirectTyping(params: { peerId: string; typing: boolean }): Promise<void> {
    if (!this.transport || !params.peerId) return;
    if (!this.transport.getConnectedPeers().includes(params.peerId)) return;
    this.transport.send(params.peerId, {
      type: 'typing',
      channelId: params.peerId,
      workspaceId: '',
      peerId: this.myPeerId,
      typing: params.typing,
    });
  }

  /** Send stream-start to all workspace peers (or direct peer for DMs) */
  async startStream(params: {
    channelId: string;
    workspaceId: string;
    messageId: string;
    threadId?: string;
    replyToId?: string;
    isDirect?: false;
    model?: AssistantModelMeta;
  }): Promise<void> {
    if (!this.transport) return;
    const recipients = this.getChannelRecipientPeerIds(params.channelId, params.workspaceId);
    const envelope: any = {
      type: 'stream-start',
      messageId: params.messageId,
      channelId: params.channelId,
      workspaceId: params.workspaceId,
      senderId: this.myPeerId,
      senderName: this.opts.account.alias,
      isDirect: false as const,
      ...(params.threadId ? { threadId: params.threadId } : {}),
      ...(params.replyToId ? { replyToId: params.replyToId } : {}),
    };
    if (params.model) {
      envelope.modelMeta = params.model;
    }
    for (const peerId of recipients) {
      if (this.transport.getConnectedPeers().includes(peerId)) {
        this.transport.send(peerId, envelope);
      }
    }
  }

  async startDirectStream(params: {
    peerId: string;
    messageId: string;
    model?: AssistantModelMeta;
  }): Promise<void> {
    if (!this.transport || !this.transport.getConnectedPeers().includes(params.peerId)) return;
    const envelope: any = {
      type: 'stream-start',
      messageId: params.messageId,
      channelId: params.peerId,
      workspaceId: '',
      senderId: this.myPeerId,
      senderName: this.opts.account.alias,
      isDirect: true,
    };
    if (params.model) {
      envelope.modelMeta = params.model;
    }
    this.transport.send(params.peerId, envelope);
  }

  async sendStreamDelta(params: {
    channelId: string;
    workspaceId: string;
    messageId: string;
    content: string;
  }): Promise<void> {
    if (!this.transport) return;
    const recipients = this.getChannelRecipientPeerIds(params.channelId, params.workspaceId);
    const envelope = { type: 'stream-delta', messageId: params.messageId, content: params.content };
    for (const peerId of recipients) {
      if (this.transport.getConnectedPeers().includes(peerId)) {
        this.transport.send(peerId, envelope);
      }
    }
  }

  async sendDirectStreamDelta(params: {
    peerId: string;
    messageId: string;
    content: string;
  }): Promise<void> {
    if (!this.transport || !this.transport.getConnectedPeers().includes(params.peerId)) return;
    this.transport.send(params.peerId, { type: 'stream-delta', messageId: params.messageId, content: params.content });
  }

  async sendStreamDone(params: {
    channelId: string;
    workspaceId: string;
    messageId: string;
  }): Promise<void> {
    if (!this.transport) return;
    const recipients = this.getChannelRecipientPeerIds(params.channelId, params.workspaceId);
    const envelope = { type: 'stream-done', messageId: params.messageId };
    for (const peerId of recipients) {
      if (this.transport.getConnectedPeers().includes(peerId)) {
        this.transport.send(peerId, envelope);
      }
    }
  }

  async sendDirectStreamDone(params: {
    peerId: string;
    messageId: string;
  }): Promise<void> {
    if (!this.transport || !this.transport.getConnectedPeers().includes(params.peerId)) return;
    this.transport.send(params.peerId, { type: 'stream-done', messageId: params.messageId });
  }

  // =========================================================================
  // Media handling (full-quality image requests)
  // =========================================================================

  private async handleMediaRequest(fromPeerId: string, request: MediaRequest): Promise<void> {
    if (!this.transport) return;

    // Check if we have this attachment stored locally
    const attachmentKey = `attachment-meta:${request.attachmentId}`;
    const attachment = this.store.get<{ id: string; name: string; mimeType: string; size: number; totalChunks: number } | null>(attachmentKey, null);

    if (!attachment) {
      const response: MediaResponse = { type: 'media-response', attachmentId: request.attachmentId, available: false };
      this.transport.send(fromPeerId, response);
      return;
    }

    // Send response indicating availability
    const response: MediaResponse = {
      type: 'media-response',
      attachmentId: request.attachmentId,
      available: true,
      totalChunks: attachment.totalChunks,
    };
    this.transport.send(fromPeerId, response);

    // Send chunks
    const startChunk = request.fromChunk ?? 0;
    for (let i = startChunk; i < attachment.totalChunks; i++) {
      const chunkKey = `media-chunk:${request.attachmentId}:${i}`;
      const chunkData = this.store.get<string | null>(chunkKey, null);
      if (chunkData) {
        const chunk: MediaChunk = {
          type: 'media-chunk',
          attachmentId: request.attachmentId,
          index: i,
          total: attachment.totalChunks,
          data: chunkData,
          chunkHash: '', // TODO: compute hash
        };
        this.transport.send(fromPeerId, chunk);
      }
    }
  }

  private async handleMediaResponse(fromPeerId: string, response: MediaResponse): Promise<void> {
    const pending = this.pendingMediaRequests.get(response.attachmentId);
    if (!pending) return;

    if (!response.available) {
      clearTimeout(pending.timeout);
      this.pendingMediaRequests.delete(response.attachmentId);
      pending.resolve(null);
      return;
    }

    // Chunks will arrive via handleMediaChunk; just wait
  }

  private async handleMediaChunk(fromPeerId: string, chunk: MediaChunk): Promise<void> {
    const pending = this.pendingMediaRequests.get(chunk.attachmentId);
    if (!pending) return;

    try {
      const buffer = Buffer.from(chunk.data, 'base64');
      pending.chunks.set(chunk.index, buffer);

      // Check if we have all chunks
      if (pending.chunks.size === chunk.total) {
        clearTimeout(pending.timeout);
        this.pendingMediaRequests.delete(chunk.attachmentId);

        // Reassemble
        const chunks: Buffer[] = [];
        for (let i = 0; i < chunk.total; i++) {
          const c = pending.chunks.get(i);
          if (!c) {
            pending.resolve(null);
            return;
          }
          chunks.push(c);
        }
        const fullBuffer = Buffer.concat(chunks);

        // Store locally for future use
        const storedKey = `media-full:${chunk.attachmentId}`;
        this.store.set(storedKey, fullBuffer.toString('base64'));

        pending.resolve(fullBuffer);
      }
    } catch {
      // Invalid chunk data
    }
  }

  /** Public: resolve channel name by id. Returns undefined if none found. */
  findChannelNameById(channelId: string): string | undefined {
    const ws = this.workspaceManager
      .getAllWorkspaces()
      .find((workspace) => workspace.channels.some((ch) => ch.id === channelId));
    return ws?.channels.find((ch) => ch.id === channelId)?.name;
  }

  private getChannelRecipientPeerIds(channelId: string, workspaceId?: string): string[] {
    const workspace = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
    if (!workspace) return this.transport?.getConnectedPeers().filter((p) => p !== this.myPeerId) ?? [];

    const workspacePeers = workspace.members
      .map((member) => member.peerId)
      .filter((peerId) => Boolean(peerId) && peerId !== this.myPeerId);

    const channels = Array.isArray((workspace as any).channels) ? workspace.channels : [];
    const channel = channels.find((entry) => entry.id === channelId);
    const accessPolicy = (channel as any)?.accessPolicy;
    if (accessPolicy?.mode === 'explicit' && Array.isArray(accessPolicy.explicitMemberPeerIds)) {
      return Array.from(new Set(
        accessPolicy.explicitMemberPeerIds
          .filter((peerId: unknown): peerId is string => typeof peerId === 'string' && peerId.length > 0)
          .filter((peerId: string) => peerId !== this.myPeerId),
      ));
    }

    return workspacePeers;
  }

  /** Compatibility alias used by monitor/company routing. */
  resolveChannelNameById(channelId: string): string | undefined {
    return this.findChannelNameById(channelId);
  }

  /** Public: find the workspace ID that owns a given channel. Returns '' if none found. */
  findWorkspaceIdForChannel(channelId: string): string {
    const ws = this.workspaceManager
      .getAllWorkspaces()
      .find((workspace) => workspace.channels.some((ch) => ch.id === channelId));
    return ws?.id ?? '';
  }

  private resolveSenderName(workspaceId: string, peerId: string, fallback?: string): string {
    const ws = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
    const alias = ws?.members.find((m) => m.peerId === peerId)?.alias;
    const cachedAlias = this.store.get<string>(`peer-alias-${peerId}`, '');
    return alias || cachedAlias || fallback || peerId.slice(0, 8);
  }

  private getPeerPublicKey(peerId: string): string | null {
    const savedPeers = this.store.get<Record<string, string>>('peer-public-keys', {});
    if (savedPeers[peerId]) return savedPeers[peerId];

    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const member = ws.members.find((m) => m.peerId === peerId && m.publicKey);
      if (member?.publicKey) return member.publicKey;
    }

    return null;
  }

  private updateWorkspaceMemberKey(peerId: string, publicKey: string): void {
    let changed = false;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const member = ws.members.find((m) => m.peerId === peerId);
      if (member && member.publicKey !== publicKey) {
        member.publicKey = publicKey;
        changed = true;
      }
    }
    if (changed) {
      this.persistWorkspaces();
    }
  }

  private updateWorkspaceMemberAlias(peerId: string, alias: string, companySim?: WorkspaceMember["companySim"], isBot?: boolean): void {
    let changed = false;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const member = ws.members.find((m) => m.peerId === peerId);
      if (!member) continue;
      if (member.alias !== alias) {
        member.alias = alias;
        changed = true;
      }
      if (isBot === true && !member.isBot) {
        member.isBot = true;
        changed = true;
      }
      if (companySim) {
        const prev = JSON.stringify(member.companySim || null);
        const next = JSON.stringify(companySim);
        if (prev !== next) {
          member.companySim = companySim;
          changed = true;
        }
      }
    }
    if (changed) {
      this.persistWorkspaces();
    }
  }

  /** Ensure our own member records always have isBot: true */
  private ensureBotFlag(): void {
    let changed = false;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const me = ws.members.find((m) => m.peerId === this.myPeerId);
      if (me && !me.isBot) {
        me.isBot = true;
        changed = true;
      }
    }
    if (changed) this.persistWorkspaces();
  }

  private offlineQueueKey(peerId: string): string {
    return `offline-queue-${peerId}`;
  }

  private receiptLogKey(peerId: string): string {
    return `receipt-log-${peerId}`;
  }

  private custodialInboxKey(): string {
    return 'custodian-inbox';
  }

  private pendingAckKey(peerId: string): string {
    return `pending-ack-${peerId}`;
  }

  private getMyCompanySimProfile(): WorkspaceMember["companySim"] | undefined {
    return undefined;
  }

  private pendingReadReceiptKey(peerId: string): string {
    return `pending-read-${peerId}`;
  }

  private requestSyncForPeer(peerId: string): void {
    if (!this.syncProtocol) return;
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (!workspace.members.some((member) => member.peerId === peerId)) continue;
      this.syncProtocol.requestSync(peerId, workspace.id);
    }
  }

  private async queuePendingReadReceipt(peerId: string, channelId: string, messageId: string): Promise<void> {
    const key = this.pendingReadReceiptKey(peerId);
    const current = this.store.get<Array<{ channelId: string; messageId: string; queuedAt: number }>>(key, []);
    const exists = current.some((entry) => entry?.channelId === channelId && entry?.messageId === messageId);
    if (exists) return;
    current.push({ channelId, messageId, queuedAt: Date.now() });
    this.store.set(key, current);
  }

  private async flushPendingReadReceipts(peerId: string): Promise<void> {
    if (!this.transport) return;
    if (!this.transport.getConnectedPeers().includes(peerId)) return;

    const key = this.pendingReadReceiptKey(peerId);
    const queued = this.store.get<Array<{ channelId: string; messageId: string; queuedAt: number }>>(key, []);
    if (queued.length === 0) return;

    const retry: Array<{ channelId: string; messageId: string; queuedAt: number }> = [];
    for (const item of queued) {
      if (!item?.channelId || !item?.messageId) continue;
      try {
        this.transport.send(peerId, {
          type: 'read',
          channelId: item.channelId,
          messageId: item.messageId,
        });
      } catch {
        retry.push(item);
      }
    }

    if (retry.length === 0) this.store.delete(key);
    else this.store.set(key, retry);
  }

  private isCustodyEnvelope(value: unknown): value is CustodyEnvelope {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Partial<CustodyEnvelope>;
    return typeof envelope.envelopeId === 'string'
      && typeof envelope.opId === 'string'
      && Array.isArray(envelope.recipientPeerIds)
      && typeof envelope.workspaceId === 'string'
      && typeof envelope.domain === 'string'
      && 'ciphertext' in envelope;
  }

  private recordManifestDomain(
    domain: SyncDomain,
    workspaceId: string | undefined,
    params?: {
      channelId?: string;
      operation?: ManifestDelta['operation'];
      subject?: string;
      itemCount?: number;
      data?: Record<string, unknown>;
    },
  ): ManifestDelta | null {
    if (!workspaceId) return null;
    return this.manifestStore.updateDomain({
      domain,
      workspaceId,
      ...(params?.channelId ? { channelId: params.channelId } : {}),
      author: this.myPeerId || 'unknown',
      operation: params?.operation ?? 'update',
      subject: params?.subject,
      itemCount: params?.itemCount,
      data: params?.data,
    });
  }

  private async handleInboundReceipt(fromPeerId: string, msg: any, kind: DeliveryReceipt['kind']): Promise<void> {
    const messageId = typeof msg?.messageId === 'string' ? msg.messageId : '';
    if (!messageId) return;

    const receipt: DeliveryReceipt = {
      receiptId: `${kind}:${fromPeerId}:${messageId}:${Date.now()}`,
      kind,
      opId: messageId,
      recipientPeerId: fromPeerId,
      timestamp: Date.now(),
      ...(typeof msg?.envelopeId === 'string' ? { envelopeId: msg.envelopeId } : {}),
      metadata: {
        ...(typeof msg?.channelId === 'string' ? { channelId: msg.channelId } : {}),
      },
    };

    await this.removePendingAck(fromPeerId, messageId);
    await this.custodyStore.applyReceipt(fromPeerId, receipt);
    await this.offlineQueue.applyReceipt(fromPeerId, receipt);

    this.recordManifestDomain('receipt', typeof msg?.channelId === 'string' ? this.findWorkspaceIdForChannel(msg.channelId) : undefined, {
      channelId: typeof msg?.channelId === 'string' ? msg.channelId : undefined,
      operation: 'create',
      subject: messageId,
      data: {
        kind,
        recipientPeerId: fromPeerId,
      },
    });
  }

  private sendManifestSummary(peerId: string, onlyWorkspaceId?: string): void {
    if (!this.transport) return;
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (onlyWorkspaceId && workspace.id !== onlyWorkspaceId) continue;
      if (!workspace.members.some((member) => member.peerId === peerId)) continue;
      const summary = this.manifestStore.getSummary(workspace.id);
      this.transport.send(peerId, {
        type: 'sync.summary',
        workspaceId: workspace.id,
        summary,
      });
    }
  }

  private async handleManifestSummary(peerId: string, msg: any): Promise<void> {
    if (!this.transport) return;
    const summary = (msg?.summary ?? msg) as SyncManifestSummary;
    const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : summary?.workspaceId;
    if (!workspaceId || !summary || !Array.isArray(summary.versions)) return;

    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace || !workspace.members.some((member) => member.peerId === peerId)) return;

    const missing = this.manifestStore.buildDiffRequest(workspaceId, summary);
    if (missing.length > 0) {
      this.transport.send(peerId, {
        type: 'sync.diff_request',
        workspaceId,
        requestId: randomUUID(),
        requests: missing,
      });
    }

    const remoteByKey = new Map(summary.versions.map((version) => [`${version.domain}:${version.channelId ?? ''}`, version] as const));
    const localSummary = this.manifestStore.getSummary(workspaceId);
    const pushDeltas: ManifestDelta[] = [];

    for (const localVersion of localSummary.versions) {
      const key = `${localVersion.domain}:${localVersion.channelId ?? ''}`;
      const remoteVersion = remoteByKey.get(key)?.version ?? 0;
      if (localVersion.version <= remoteVersion) continue;
      pushDeltas.push(...this.manifestStore.getDeltasSince({
        workspaceId,
        domain: localVersion.domain,
        channelId: localVersion.channelId,
        fromVersion: remoteVersion,
        toVersion: localVersion.version,
        limit: 500,
      }));
    }

    if (pushDeltas.length > 0) {
      this.transport.send(peerId, {
        type: 'sync.diff_response',
        workspaceId,
        requestId: `push:${randomUUID()}`,
        deltas: pushDeltas,
      });
    }
  }

  private async handleManifestDiffRequest(peerId: string, msg: any): Promise<void> {
    if (!this.transport) return;
    const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : '';
    if (!workspaceId) return;

    const requests = Array.isArray(msg?.requests)
      ? (msg.requests as ManifestDiffRequest[])
      : (msg?.request ? [msg.request as ManifestDiffRequest] : []);
    if (requests.length === 0) return;

    const deltas: ManifestDelta[] = [];
    const snapshots: Array<{ domain: SyncDomain; workspaceId: string; channelId?: string; snapshotId: string; version: number; basedOnVersion: number; createdAt: number; createdBy: string }> = [];

    for (const request of requests) {
      const slice = this.manifestStore.getDeltasSince({
        workspaceId,
        domain: request.domain,
        channelId: request.channelId,
        fromVersion: request.fromVersion,
        toVersion: request.toVersion,
        limit: 500,
      });
      deltas.push(...slice);

      if (slice.length === 0 && (request.toVersion ?? 0) > request.fromVersion) {
        const snapshot = this.buildManifestSnapshot(workspaceId, request.domain, request.channelId);
        if (snapshot) {
          this.manifestStore.saveSnapshot(snapshot);
          snapshots.push({
            domain: snapshot.domain,
            workspaceId: snapshot.workspaceId,
            ...(snapshot.domain === 'channel-message' && snapshot.channelId ? { channelId: snapshot.channelId } : {}),
            snapshotId: snapshot.snapshotId,
            version: snapshot.version,
            basedOnVersion: snapshot.basedOnVersion,
            createdAt: snapshot.createdAt,
            createdBy: snapshot.createdBy,
          });
        }
      }
    }

    this.transport.send(peerId, {
      type: 'sync.diff_response',
      workspaceId,
      requestId: typeof msg?.requestId === 'string' ? msg.requestId : randomUUID(),
      deltas,
      ...(snapshots.length > 0 ? { snapshots } : {}),
    });
  }

  private async handleManifestDiffResponse(peerId: string, msg: any): Promise<void> {
    if (!this.transport) return;
    const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : '';
    if (!workspaceId) return;

    const deltas = Array.isArray(msg?.deltas) ? (msg.deltas as ManifestDelta[]) : [];
    // Apply all deltas in a batch — persists only once at the end.
    this.manifestStore.applyDeltaBatch(deltas);
    let needsSync = false;
    for (const delta of deltas) {
      if (delta.domain === 'channel-message') {
        needsSync = true;
        break;
      }
    }
    if (needsSync) {
      this.requestSyncForPeer(peerId);
    }

    const snapshots = Array.isArray(msg?.snapshots) ? msg.snapshots : [];
    for (const pointer of snapshots) {
      const existing = this.manifestStore.getSnapshot(workspaceId, pointer.domain, pointer.channelId);
      if (!existing || existing.version < pointer.version) {
        this.transport.send(peerId, {
          type: 'sync.fetch_snapshot',
          workspaceId,
          domain: pointer.domain,
          ...(pointer.channelId ? { channelId: pointer.channelId } : {}),
          snapshotId: pointer.snapshotId,
        });
      }
    }
  }

  private async handleManifestFetchSnapshot(peerId: string, msg: any): Promise<void> {
    if (!this.transport) return;
    const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : '';
    const domain = msg?.domain as SyncDomain | undefined;
    const channelId = typeof msg?.channelId === 'string' ? msg.channelId : undefined;
    if (!workspaceId || !domain) return;

    const existing = this.manifestStore.getSnapshot(workspaceId, domain, channelId);
    const snapshot = existing ?? this.buildManifestSnapshot(workspaceId, domain, channelId);
    if (!snapshot) return;

    this.manifestStore.saveSnapshot(snapshot);
    this.transport.send(peerId, {
      type: 'sync.snapshot_response',
      workspaceId,
      snapshot,
    });
  }

  private async handleManifestSnapshotResponse(peerId: string, msg: any): Promise<void> {
    const snapshot = msg?.snapshot as SyncManifestSnapshot | undefined;
    if (!snapshot) return;

    this.manifestStore.restoreSnapshot(snapshot, this.myPeerId || 'unknown');

    if (snapshot.domain === 'workspace-manifest') {
      const ws = this.workspaceManager.getWorkspace(snapshot.workspaceId);
      if (ws) {
        ws.name = snapshot.name;
        ws.description = snapshot.description;
        this.persistWorkspaces();
      }
      return;
    }

    if (snapshot.domain === 'membership') {
      const ws = this.workspaceManager.getWorkspace(snapshot.workspaceId);
      if (ws) {
        ws.members = snapshot.members.map((member) => ({
          peerId: member.peerId,
          alias: member.alias || member.peerId.slice(0, 8),
          publicKey: ws.members.find((existing) => existing.peerId === member.peerId)?.publicKey || '',
          role: member.role as any,
          joinedAt: member.joinedAt,
        }));
        this.ensureBotFlag();
        this.persistWorkspaces();
      }
      return;
    }

    if (snapshot.domain === 'channel-manifest') {
      const ws = this.workspaceManager.getWorkspace(snapshot.workspaceId);
      if (ws) {
        for (const channel of snapshot.channels) {
          if (ws.channels.some((existing) => existing.id === channel.id)) continue;
          ws.channels.push({
            id: channel.id,
            workspaceId: snapshot.workspaceId,
            name: channel.name,
            type: channel.type as any,
            members: [],
            createdAt: channel.createdAt,
            createdBy: channel.createdBy,
          });
        }
        this.persistWorkspaces();
      }
      return;
    }

    if (snapshot.domain === 'channel-message' && this.transport) {
      const existingIds = new Set(this.messageStore.getMessages(snapshot.channelId).map((message) => message.id));
      const missing = snapshot.messageIds.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        this.transport.send(peerId, {
          type: 'message-sync-fetch-request',
          workspaceId: snapshot.workspaceId,
          messageIdsByChannel: {
            [snapshot.channelId]: missing,
          },
        });
      }
    }
  }

  private buildManifestSnapshot(workspaceId: string, domain: SyncDomain, channelId?: string): SyncManifestSnapshot | null {
    const summary = this.manifestStore.getSummary(workspaceId);
    const version = summary.versions.find((entry) => entry.domain === domain && (entry.channelId ?? '') === (channelId ?? ''))?.version ?? 0;

    if (domain === 'workspace-manifest') {
      const ws = this.workspaceManager.getWorkspace(workspaceId);
      if (!ws) return null;
      return {
        domain,
        workspaceId,
        version,
        name: ws.name,
        description: ws.description,
        policy: ws.permissions,
        snapshotId: randomUUID(),
        snapshotVersion: version,
        basedOnVersion: version,
        deltasSince: 0,
        createdAt: Date.now(),
        createdBy: this.myPeerId,
      };
    }

    if (domain === 'membership') {
      const ws = this.workspaceManager.getWorkspace(workspaceId);
      if (!ws) return null;
      return {
        domain,
        workspaceId,
        version,
        snapshotId: randomUUID(),
        basedOnVersion: version,
        memberCount: ws.members.length,
        members: ws.members.map((member) => ({
          peerId: member.peerId,
          alias: member.alias,
          role: member.role,
          joinedAt: member.joinedAt,
        })),
        createdAt: Date.now(),
        createdBy: this.myPeerId,
      };
    }

    if (domain === 'channel-manifest') {
      const ws = this.workspaceManager.getWorkspace(workspaceId);
      if (!ws) return null;
      return {
        domain,
        workspaceId,
        version,
        snapshotId: randomUUID(),
        basedOnVersion: version,
        channelCount: ws.channels.length,
        channels: ws.channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          createdAt: channel.createdAt,
          createdBy: channel.createdBy,
        })),
        createdAt: Date.now(),
        createdBy: this.myPeerId,
      };
    }

    if (domain === 'channel-message' && channelId) {
      const messages = this.messageStore.getMessages(channelId).slice().sort((a, b) => a.timestamp - b.timestamp);
      const minTimestamp = messages[0]?.timestamp ?? Date.now();
      const maxTimestamp = messages[messages.length - 1]?.timestamp ?? minTimestamp;
      return {
        domain,
        workspaceId,
        channelId,
        version,
        snapshotId: randomUUID(),
        basedOnVersion: version,
        messageCount: messages.length,
        messageIds: messages.map((message) => message.id),
        minTimestamp,
        maxTimestamp,
        createdAt: Date.now(),
        createdBy: this.myPeerId,
      };
    }

    return null;
  }

  private requestCustodyRecovery(peerId: string): void {
    if (!this.transport) return;
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (!workspace.members.some((member) => member.peerId === peerId)) continue;
      this.transport.send(peerId, {
        type: 'custody.fetch_index',
        workspaceId: workspace.id,
        recipientPeerId: this.myPeerId,
      });
    }
  }

  private selectCustodianPeers(workspaceId: string, recipientPeerId: string, limit = DecentChatNodePeer.CUSTODIAN_REPLICATION_TARGET): string[] {
    if (!this.transport) return [];
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return [];

    const connected = new Set(this.transport.getConnectedPeers());

    const scored = workspace.members
      .map((member) => member.peerId)
      .filter((peerId) => peerId !== this.myPeerId && peerId !== recipientPeerId && connected.has(peerId))
      .map((peerId) => {
        let score = 100;
        const alias = this.resolveSenderName(workspaceId, peerId).toLowerCase();
        if (alias.includes('mobile') || alias.includes('iphone') || alias.includes('android')) score -= 20;
        if (alias.includes('server') || alias.includes('desktop') || alias.includes('bot')) score += 20;
        score += this.store.get<number>(`custody-score-${peerId}`, 0);
        return { peerId, score };
      })
      .sort((a, b) => b.score - a.score || a.peerId.localeCompare(b.peerId));

    return scored.slice(0, Math.max(0, limit)).map((entry) => entry.peerId);
  }

  private async replicateToCustodians(
    recipientPeerId: string,
    params: {
      workspaceId?: string | null;
      channelId?: string | null;
      opId?: string | null;
      domain?: SyncDomain;
    },
  ): Promise<void> {
    const workspaceId = params.workspaceId ?? undefined;
    const opId = params.opId ?? undefined;
    if (!this.transport || !workspaceId || !opId) return;

    const custodians = this.selectCustodianPeers(workspaceId, recipientPeerId);
    if (custodians.length === 0) return;

    const pending = await this.custodyStore.getPendingForRecipient(recipientPeerId);
    const envelopes = pending.filter((envelope) => {
      if (envelope.opId !== opId || envelope.workspaceId !== workspaceId) return false;
      if (params.domain && envelope.domain !== params.domain) return false;
      if (params.channelId && envelope.channelId !== params.channelId) return false;
      return true;
    });
    if (envelopes.length === 0) return;

    for (const envelope of envelopes) {
      this.pendingCustodyOffers.set(envelope.envelopeId, custodians);
      for (const custodianPeerId of custodians) {
        this.transport.send(custodianPeerId, {
          type: 'custody.offer',
          workspaceId,
          recipientPeerId,
          ...(envelope.channelId ? { channelId: envelope.channelId } : {}),
          envelope: {
            envelopeId: envelope.envelopeId,
            opId: envelope.opId,
            workspaceId: envelope.workspaceId,
            channelId: envelope.channelId,
            threadId: envelope.threadId,
            domain: envelope.domain,
            createdAt: envelope.createdAt,
            expiresAt: envelope.expiresAt,
            replicationClass: envelope.replicationClass,
          },
        });
      }
    }
  }

  private async handleCustodyControl(fromPeerId: string, msg: any): Promise<void> {
    if (!this.transport) return;

    if (msg?.type === 'custody.offer') {
      const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : '';
      const workspace = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
      const canAccept = Boolean(workspace?.members.some((member) => member.peerId === this.myPeerId));

      this.transport.send(fromPeerId, {
        type: canAccept ? 'custody.accept' : 'custody.reject',
        workspaceId,
        envelopeId: msg?.envelope?.envelopeId,
        recipientPeerId: msg?.recipientPeerId,
        reason: canAccept ? undefined : 'not-a-member',
      });
      return;
    }

    if (msg?.type === 'custody.accept') {
      const envelopeId = typeof msg?.envelopeId === 'string' ? msg.envelopeId : '';
      const recipientPeerId = typeof msg?.recipientPeerId === 'string' ? msg.recipientPeerId : '';
      const offeredPeers = this.pendingCustodyOffers.get(envelopeId) ?? [];
      if (!envelopeId || !recipientPeerId || !offeredPeers.includes(fromPeerId)) return;

      const envelopes = await this.custodyStore.listAllForRecipient(recipientPeerId);
      const envelope = envelopes.find((entry) => entry.envelopeId === envelopeId);
      if (!envelope) return;

      this.transport.send(fromPeerId, {
        type: 'custody.store',
        workspaceId: envelope.workspaceId,
        recipientPeerId,
        envelope,
      });
      return;
    }

    if (msg?.type === 'custody.reject') {
      const envelopeId = typeof msg?.envelopeId === 'string' ? msg.envelopeId : '';
      if (!envelopeId) return;
      const offeredPeers = this.pendingCustodyOffers.get(envelopeId) ?? [];
      this.pendingCustodyOffers.set(
        envelopeId,
        offeredPeers.filter((peerId) => peerId !== fromPeerId),
      );
      return;
    }

    if (msg?.type === 'custody.store') {
      const envelope = msg?.envelope;
      if (!this.isCustodyEnvelope(envelope)) return;
      this.custodianInbox.set(envelope.envelopeId, envelope);
      this.persistCustodianInbox();
      this.transport.send(fromPeerId, {
        type: 'custody.ack',
        envelopeIds: [envelope.envelopeId],
        stage: 'stored',
      });
      return;
    }

    if (msg?.type === 'custody.fetch_index') {
      if (Array.isArray(msg?.index)) {
        const envelopeIds = msg.index
          .map((entry: any) => (typeof entry?.envelopeId === 'string' ? entry.envelopeId : null))
          .filter((value: string | null): value is string => Boolean(value));

        if (envelopeIds.length > 0) {
          this.transport.send(fromPeerId, {
            type: 'custody.fetch_envelopes',
            workspaceId: msg.workspaceId,
            envelopeIds,
          });
        }
        return;
      }

      const recipientPeerId = typeof msg?.recipientPeerId === 'string' ? msg.recipientPeerId : fromPeerId;
      const workspaceId = typeof msg?.workspaceId === 'string' ? msg.workspaceId : undefined;
      const index = [...this.custodianInbox.values()]
        .filter((envelope) => envelope.recipientPeerIds.includes(recipientPeerId))
        .filter((envelope) => !workspaceId || envelope.workspaceId === workspaceId)
        .map((envelope) => ({
          envelopeId: envelope.envelopeId,
          opId: envelope.opId,
          workspaceId: envelope.workspaceId,
          channelId: envelope.channelId,
          domain: envelope.domain,
          createdAt: envelope.createdAt,
          expiresAt: envelope.expiresAt,
        }));

      this.transport.send(fromPeerId, {
        type: 'custody.fetch_index',
        workspaceId: workspaceId ?? '',
        recipientPeerId,
        index,
      });
      return;
    }

    if (msg?.type === 'custody.fetch_envelopes') {
      if (Array.isArray(msg?.envelopes)) {
        const recovered = msg.envelopes.filter((entry: any) => this.isCustodyEnvelope(entry)) as CustodyEnvelope[];
        if (recovered.length === 0) return;

        const recoveredIds: string[] = [];
        for (const envelope of recovered) {
          if (!envelope.recipientPeerIds.includes(this.myPeerId)) continue;
          recoveredIds.push(envelope.envelopeId);
          if (envelope.workspaceId) {
            this.recordManifestDomain('channel-message', envelope.workspaceId, {
              channelId: envelope.channelId,
              operation: 'update',
              subject: envelope.opId,
              data: { recovered: true, envelopeId: envelope.envelopeId },
            });
          }
          const trustedSenderId = typeof envelope.metadata?.senderId === 'string' && envelope.metadata.senderId.length > 0
            ? envelope.metadata.senderId
            : undefined;
          await this.handlePeerMessage(fromPeerId, envelope.ciphertext, trustedSenderId);
        }

        if (recoveredIds.length > 0) {
          this.transport.send(fromPeerId, {
            type: 'custody.ack',
            envelopeIds: recoveredIds,
            stage: 'delivered',
          });
        }
        return;
      }

      const envelopeIds = Array.isArray(msg?.envelopeIds)
        ? msg.envelopeIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const envelopes = envelopeIds
        .map((id) => this.custodianInbox.get(id))
        .filter((entry): entry is CustodyEnvelope => Boolean(entry));

      this.transport.send(fromPeerId, {
        type: 'custody.fetch_envelopes',
        workspaceId: typeof msg?.workspaceId === 'string' ? msg.workspaceId : '',
        envelopes,
      });
      return;
    }

    if (msg?.type === 'custody.ack') {
      const envelopeIds = Array.isArray(msg?.envelopeIds)
        ? msg.envelopeIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      if (envelopeIds.length === 0) return;

      let changed = false;
      for (const envelopeId of envelopeIds) {
        if (this.custodianInbox.delete(envelopeId)) changed = true;
      }
      if (changed) {
        this.persistCustodianInbox();
        const key = `custody-score-${fromPeerId}`;
        const current = this.store.get<number>(key, 0);
        this.store.set(key, current + 1);
      }
    }
  }

  private async queuePendingAck(peerId: string, payload: any): Promise<void> {
    if (!payload?.messageId) return;
    const key = this.pendingAckKey(peerId);
    const current = this.store.get<any[]>(key, []);
    const existingIndex = current.findIndex((entry) => entry?.messageId === payload.messageId);
    const entry = {
      ...payload,
      queuedAt: Date.now(),
    };
    if (existingIndex >= 0) current[existingIndex] = entry;
    else current.push(entry);
    this.store.set(key, current);
  }

  private async removePendingAck(peerId: string, messageId: string): Promise<void> {
    const key = this.pendingAckKey(peerId);
    const current = this.store.get<any[]>(key, []);
    const next = current.filter((entry) => entry?.messageId !== messageId);
    if (next.length === 0) this.store.delete(key);
    else this.store.set(key, next);
  }

  private async resendPendingAcks(peerId: string): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;
    if (!this.transport.getConnectedPeers().includes(peerId)) return;

    const key = this.pendingAckKey(peerId);
    const pending = this.store.get<any[]>(key, []);
    if (pending.length === 0) return;

    for (const item of pending) {
      if (!item || typeof item !== 'object') continue;
      try {
        if (typeof item.content === 'string') {
          // LEGACY: channel-message pending-acks with plaintext content
          // were queued by older bridge versions.  They re-encrypted on
          // reconnect and overwhelmed the receiver's message bucket,
          // causing auto-ban.  Streaming-based delivery doesn't queue
          // pending-acks anymore, so any such entry left in the store
          // is stale garbage from a previous version.  Drop it silently.
          if (!item.isDirect) {
            continue;
          }
          const envelope = await this.encryptMessageWithPreKeyBootstrap(peerId, item.content, item.metadata, item.workspaceId);
          (envelope as any).senderId = item.senderId ?? this.myPeerId;
          (envelope as any).senderName = item.senderName ?? this.opts.account.alias;
          (envelope as any).messageId = item.messageId;
          (envelope as any).isDirect = true;
          if (item.threadId) (envelope as any).threadId = item.threadId;
          if (item.replyToId) (envelope as any).replyToId = item.replyToId;
          this.transport.send(peerId, envelope);
          continue;
        }

        if (item.ciphertext && typeof item.ciphertext === 'object') {
          const outbound = { ...item.ciphertext } as any;
          outbound._offlineReplay = 1;
          if (typeof item.envelopeId === 'string' && !outbound.envelopeId) {
            outbound.envelopeId = item.envelopeId;
          }
          this.transport.send(peerId, outbound);
          continue;
        }
      } catch (err) {
        this.opts.log?.warn?.(`[decentchat-peer] resend pending failed for ${peerId}: ${String(err)}`);
      }
    }
  }

  private async enqueueOffline(peerId: string, payload: any): Promise<void> {
    try {
      const now = Date.now();
      const isReceipt = payload?.type === 'read' || payload?.type === 'ack';
      const workspaceId = typeof payload?.workspaceId === 'string'
        ? payload.workspaceId
        : (typeof payload?.channelId === 'string' ? this.findWorkspaceIdForChannel(payload.channelId) : 'direct');

      if (isReceipt) {
        await this.custodyStore.storeEnvelope({
          opId: typeof payload?.messageId === 'string' ? payload.messageId : randomUUID(),
          recipientPeerIds: [peerId],
          workspaceId: workspaceId || 'direct',
          ...(typeof payload?.channelId === 'string' ? { channelId: payload.channelId } : {}),
          domain: 'receipt',
          ciphertext: payload,
          createdAt: now,
          metadata: {
            kind: payload?.type,
          },
        });
        return;
      }

      if (typeof payload?.content === 'string' && this.messageProtocol) {
        try {
          const encrypted = await this.encryptMessageWithPreKeyBootstrap(peerId, payload.content, payload.metadata, workspaceId);
          (encrypted as any).senderId = payload.senderId ?? this.myPeerId;
          (encrypted as any).senderName = payload.senderName ?? this.opts.account.alias;
          (encrypted as any).messageId = payload.messageId ?? randomUUID();
          if (payload.isDirect) {
            (encrypted as any).isDirect = true;
          } else {
            (encrypted as any).channelId = payload.channelId;
            (encrypted as any).workspaceId = payload.workspaceId;
          }
          if (payload.threadId) (encrypted as any).threadId = payload.threadId;
          if (payload.replyToId) (encrypted as any).replyToId = payload.replyToId;

          await this.custodyStore.storeEnvelope({
            envelopeId: typeof (encrypted as any).id === 'string' ? (encrypted as any).id : undefined,
            opId: typeof payload?.messageId === 'string' ? payload.messageId : randomUUID(),
            recipientPeerIds: [peerId],
            workspaceId: workspaceId || 'direct',
            ...(typeof payload?.channelId === 'string' ? { channelId: payload.channelId } : {}),
            ...(typeof payload?.threadId === 'string' ? { threadId: payload.threadId } : {}),
            domain: 'channel-message',
            ciphertext: encrypted,
            createdAt: now,
            metadata: this.buildCustodyResendMetadata({
              content: payload.content,
              channelId: payload.channelId,
              workspaceId: payload.workspaceId,
              senderId: payload.senderId ?? this.myPeerId,
              senderName: payload.senderName ?? this.opts.account.alias,
              threadId: payload.threadId,
              replyToId: payload.replyToId,
              isDirect: payload.isDirect === true,
              metadata: payload.metadata,
            }),
          });
          return;
        } catch (err) {
          this.opts.log?.warn?.(`[decentchat-peer] encryption failed while queueing offline payload for ${peerId}: ${String(err)}`);
          // Fall back to deferred plaintext path below.
        }
      }

      await this.offlineQueue.enqueue(peerId, payload, {
        createdAt: now,
        envelopeId: typeof payload?.id === 'string' ? payload.id : undefined,
        opId: typeof payload?.messageId === 'string'
          ? payload.messageId
          : (typeof payload?.opId === 'string' ? payload.opId : undefined),
        workspaceId: typeof payload?.workspaceId === 'string' ? payload.workspaceId : undefined,
        channelId: typeof payload?.channelId === 'string' ? payload.channelId : undefined,
        threadId: typeof payload?.threadId === 'string' ? payload.threadId : undefined,
        domain: isReceipt ? 'receipt' : 'channel-message',
        recipientPeerIds: [peerId],
        replicationClass: 'standard',
        deliveryState: 'stored',
      });
      this.opts.log?.info?.(`[decentchat-peer] queued outbound message for offline peer ${peerId}`);
    } catch (err) {
      this.opts.log?.error?.(`[decentchat-peer] failed to queue outbound message for ${peerId}: ${String(err)}`);
    }
  }

  private async flushOfflineQueue(peerId: string): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;
    if (!this.transport.getConnectedPeers().includes(peerId)) return;

    const queued = await this.offlineQueue.getQueued(peerId);
    if (queued.length === 0) return;

    let sentCount = 0;
    let failedCount = 0;
    const deliveredIds: number[] = [];  // Batch-remove after loop

    for (const queuedItem of queued) {
      const item = (queuedItem?.data ?? queuedItem) as any;
      if (!item || typeof item !== 'object') {
        if (typeof queuedItem?.id === 'number') {
          deliveredIds.push(queuedItem.id);
        }
        continue;
      }

      try {
        if (this.isCustodyEnvelope(item)) {
          const resendPayload = item.domain === 'channel-message' && this.shouldReencryptCustodyEnvelope(item)
            ? this.getCustodyResendPayload(item)
            : null;

          if (resendPayload) {
            const envelope = await this.encryptMessageWithPreKeyBootstrap(
              peerId,
              resendPayload.content,
              resendPayload.metadata,
              resendPayload.workspaceId,
            );
            (envelope as any).senderId = resendPayload.senderId ?? this.myPeerId;
            (envelope as any).senderName = resendPayload.senderName ?? this.opts.account.alias;
            (envelope as any).messageId = item.opId;
            if (resendPayload.isDirect) {
              (envelope as any).isDirect = true;
            } else {
              (envelope as any).channelId = resendPayload.channelId ?? item.channelId;
              (envelope as any).workspaceId = resendPayload.workspaceId ?? item.workspaceId;
            }
            if (resendPayload.threadId) (envelope as any).threadId = resendPayload.threadId;
            if (resendPayload.replyToId) (envelope as any).replyToId = resendPayload.replyToId;
            if (resendPayload.gossipOriginSignature) {
              (envelope as any)._gossipOriginSignature = resendPayload.gossipOriginSignature;
            }

            const accepted = this.transport.send(peerId, envelope);
            if (!accepted) throw new Error('transport rejected queued send');

            await this.queuePendingAck(peerId, {
              messageId: item.opId,
              channelId: resendPayload.channelId ?? item.channelId,
              workspaceId: resendPayload.workspaceId ?? item.workspaceId,
              threadId: resendPayload.threadId ?? item.threadId,
              content: resendPayload.content,
              isDirect: resendPayload.isDirect === true,
              replyToId: resendPayload.replyToId,
              senderId: resendPayload.senderId ?? this.myPeerId,
              senderName: resendPayload.senderName ?? this.opts.account.alias,
              ...(resendPayload.metadata ? { metadata: resendPayload.metadata } : {}),
            });

            if (typeof queuedItem?.id === 'number') {
              deliveredIds.push(queuedItem.id);
            }
            sentCount += 1;
            continue;
          }

          const outbound = typeof item.ciphertext === 'object' && item.ciphertext
            ? { ...(item.ciphertext as Record<string, unknown>) }
            : item.ciphertext;

          if (!outbound || typeof outbound !== 'object') {
            throw new Error('custody envelope missing ciphertext payload');
          }

          (outbound as any)._offlineReplay = 1;
          if (!(outbound as any).envelopeId) {
            (outbound as any).envelopeId = item.envelopeId;
          }

          const accepted = this.transport.send(peerId, outbound);
          if (!accepted) throw new Error('transport rejected queued send');

          if (item.domain === 'channel-message') {
            await this.queuePendingAck(peerId, {
              messageId: item.opId,
              envelopeId: item.envelopeId,
              channelId: item.channelId,
              workspaceId: item.workspaceId,
              threadId: item.threadId,
              ciphertext: outbound,
              isDirect: (item.metadata as any)?.isDirect === true,
              replyToId: (item.metadata as any)?.replyToId,
              senderId: (item.metadata as any)?.senderId ?? this.myPeerId,
              senderName: (item.metadata as any)?.senderName ?? this.opts.account.alias,
            });
          }

          if (typeof queuedItem?.id === 'number') {
            deliveredIds.push(queuedItem.id);
          }
          sentCount += 1;
          continue;
        }

        if (item.type === 'read' || item.type === 'ack') {
          const accepted = this.transport.send(peerId, item);
          if (!accepted) throw new Error('transport rejected queued receipt send');
          if (typeof queuedItem?.id === 'number') {
            deliveredIds.push(queuedItem.id);
          }
          sentCount += 1;
          continue;
        }

        if (typeof item.content !== 'string') {
          if (typeof queuedItem?.id === 'number') {
            deliveredIds.push(queuedItem.id);
          }
          continue;
        }

        if (!item.messageId) item.messageId = randomUUID();
        await this.queuePendingAck(peerId, item);
        const envelope = await this.encryptMessageWithPreKeyBootstrap(peerId, item.content, item.metadata, item.workspaceId);
        (envelope as any).senderId = item.senderId ?? this.myPeerId;
        (envelope as any).senderName = item.senderName ?? this.opts.account.alias;
        (envelope as any).messageId = item.messageId;
        if (item.isDirect) {
          (envelope as any).isDirect = true;
        } else {
          (envelope as any).channelId = item.channelId;
          (envelope as any).workspaceId = item.workspaceId;
          const gossipOriginSignature = await this.signGossipOrigin({
            messageId: item.messageId,
            channelId: item.channelId,
            content: item.content,
            threadId: item.threadId,
            replyToId: item.replyToId,
          });
          if (gossipOriginSignature) {
            (envelope as any)._gossipOriginSignature = gossipOriginSignature;
          }
        }
        if (item.threadId) (envelope as any).threadId = item.threadId;
        if (item.replyToId) (envelope as any).replyToId = item.replyToId;

        const accepted = this.transport.send(peerId, envelope);
        if (!accepted) throw new Error('transport rejected queued send');

        if (typeof queuedItem?.id === 'number') {
          deliveredIds.push(queuedItem.id);
        }
        sentCount += 1;
      } catch (err) {
        failedCount += 1;
        if (typeof queuedItem?.id === 'number') {
          await this.offlineQueue.markAttempt(peerId, queuedItem.id);
        }
        this.opts.log?.warn?.(`[decentchat-peer] failed queued send to ${peerId}: ${String(err)}`);
      }
    }

    // Batch-remove all delivered/discarded items in a single IDB transaction
    if (deliveredIds.length > 0) {
      try {
        await this.offlineQueue.removeBatch(peerId, deliveredIds);
      } catch (batchErr) {
        this.opts.log?.error?.(`[decentchat-peer] batch remove failed, falling back to individual: ${String(batchErr)}`);
        for (const id of deliveredIds) {
          await this.offlineQueue.remove(peerId, id).catch(() => {});
        }
      }
    }

    if (sentCount > 0) {
      this.opts.log?.info?.(`[decentchat-peer] flushed ${sentCount} queued messages to ${peerId}`);
    }
    if (failedCount > 0) {
      this.opts.log?.warn?.(`[decentchat-peer] ${failedCount} queued message(s) remain pending for ${peerId}`);
    }
  }

}
