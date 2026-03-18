/**
 * NodeXenaPeer — Xena as a permanent DecentChat P2P peer.
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
  SeedPhraseManager,
  WorkspaceManager,
  Negentropy,
} from 'decent-protocol';
import type {
  Workspace,
  WorkspaceMember,
  PlaintextMessage,
  MessageMetadata,
  AssistantMessageMetadata,
  CustodyEnvelope,
  DeliveryReceipt,
  SyncDomain,
  ManifestDelta,
  ManifestDiffRequest,
  SyncManifestSummary,
  SyncManifestSnapshot,
  ManifestStoreState,
} from 'decent-protocol';
import { PeerTransport } from 'decent-transport-webrtc';
import { randomUUID } from 'node:crypto';
import { FileStore } from './FileStore.js';
import { NodeMessageProtocol } from './NodeMessageProtocol.js';
import { SyncProtocol, type SyncEvent } from './SyncProtocol.js';
import type { ResolvedDecentChatAccount } from '../types.js';
import { BotHuddleManager, type BotHuddleConfig } from '../huddle/BotHuddleManager.js';
import { loadCompanyContextForAccount } from '../company-sim/context-loader.js';

export interface NodeXenaPeerOptions {
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
  log?: { info: (s: string) => void; warn?: (s: string) => void; error?: (s: string) => void };
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

type PendingMediaRequest = {
  attachmentId: string;
  peerId: string;
  resolve: (buffer: Buffer | null) => void;
  chunks: Map<number, Buffer>;
  timeout: ReturnType<typeof setTimeout>;
};


type DirectoryEntry = {
  kind: 'user' | 'group';
  id: string;
  name?: string;
  handle?: string;
  rank?: number;
  raw?: unknown;
};

export class NodeXenaPeer {
  private static readonly CUSTODIAN_REPLICATION_TARGET = 2;

  private readonly store: FileStore;
  private readonly workspaceManager: WorkspaceManager;
  private readonly messageStore: MessageStore;
  private readonly cryptoManager: CryptoManager;
  private transport: PeerTransport | null = null;
  private syncProtocol: SyncProtocol | null = null;
  private messageProtocol: NodeMessageProtocol | null = null;
  private myPeerId = '';
  private myPublicKey = '';
  private destroyed = false;
  private _maintenanceInterval: ReturnType<typeof setInterval> | null = null;
  private readonly offlineQueue: OfflineQueue;
  private readonly custodyStore: CustodyStore;
  private readonly manifestStore: ManifestStore;
  private readonly custodianInbox = new Map<string, CustodyEnvelope>();
  private readonly pendingCustodyOffers = new Map<string, string[]>();
  private readonly opts: NodeXenaPeerOptions;
  private readonly pendingMediaRequests = new Map<string, PendingMediaRequest>();
  private readonly mediaChunkTimeout = 30000;
  private manifestPersistTimer: ReturnType<typeof setTimeout> | null = null;
  public botHuddle: BotHuddleManager | null = null;

  constructor(opts: NodeXenaPeerOptions) {
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

  async start(): Promise<void> {
    const seedPhrase = this.opts.account.seedPhrase;
    if (!seedPhrase) {
      throw new Error('Xena seed phrase not configured (channels.decentchat.seedPhrase)');
    }

    const seedMgr = new SeedPhraseManager();
    const validation = seedMgr.validate(seedPhrase);
    if (!validation.valid) {
      throw new Error(`Invalid seed phrase in channels.decentchat.seedPhrase: ${validation.error}`);
    }

    const { ecdhKeyPair, ecdsaKeyPair } = await seedMgr.deriveKeys(seedPhrase);
    this.myPeerId = await seedMgr.derivePeerId(seedPhrase);

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

    this.restoreWorkspaces();
    this.restoreMessages();
    this.restoreManifestState();
    this.restoreCustodianInbox();

    const configServer = this.opts.account.signalingServer ?? 'https://decentchat.app/peerjs';
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
    this.opts.log?.info(`[xena-peer] signaling servers: ${allServers.join(', ')}`);

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
      this.opts.log?.info(`[xena-peer] peer connected: ${peerId}`);
      // Clear ALL ratchet state (not just shared secret) so processHandshake always reinitializes
      void this.messageProtocol?.clearRatchetState(peerId);
      this.messageProtocol?.clearSharedSecret(peerId);
      this.store.delete(`ratchet-${peerId}`);
      void this.sendHandshake(peerId);
    };

    this.transport.onDisconnect = (peerId) => {
      this.opts.log?.info(`[xena-peer] peer disconnected: ${peerId}`);
      this.messageProtocol?.clearSharedSecret(peerId);
    };

    this.transport.onMessage = (fromPeerId, rawData) => {
      void this.handlePeerMessage(fromPeerId, rawData);
    };

    this.transport.onError = (err) => {
      this.opts.log?.error?.(`[xena-peer] transport error: ${err.message}`);
    };

    this.myPeerId = await this.transport.init(this.myPeerId);
    this.opts.log?.info(`[xena-peer] online as ${this.myPeerId}, signaling: ${allServers.join(', ')}`);
    this.startPeerMaintenance();

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
        ttsVoice: huddleConfig?.ttsVoice,
        vadSilenceMs: huddleConfig?.vadSilenceMs,
        vadThreshold: huddleConfig?.vadThreshold,
      });
    }

    for (const inviteUri of this.opts.account.invites ?? []) {
      // Try immediately; if the peer is offline, retry with backoff
      void this.joinWorkspaceWithRetry(inviteUri);
    }
  }

  private async joinWorkspaceWithRetry(inviteUri: string, maxAttempts = 5): Promise<void> {
    const delays = [5000, 15000, 30000, 60000, 120000];
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.destroyed) return;
      try {
        await this.joinWorkspace(inviteUri);
        return; // success — stop retrying
      } catch {
        // joinWorkspace() catches internally and logs; we just check if we're connected
      }
      // If already connected to this peer (inbound connection arrived first), stop retrying
      const invite = (() => { try { return InviteURI.decode(inviteUri); } catch { return null; } })();
      if (invite?.peerId && this.transport?.getConnectedPeers().includes(invite.peerId)) return;

      if (attempt < maxAttempts - 1) {
        const delay = delays[Math.min(attempt, delays.length - 1)];
        this.opts.log?.info?.(`[xena-peer] join retry in ${delay / 1000}s (attempt ${attempt + 1}/${maxAttempts})`);
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
      this.opts.log?.info?.(`[xena-peer] persisted message locally: ${msg.id.slice(0, 8)} (${content.length} chars)`);
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

    const workspace = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
    const recipients = workspace
      ? workspace.members.map((m) => m.peerId).filter((p) => p !== this.myPeerId)
      : this.transport.getConnectedPeers().filter((p) => p !== this.myPeerId);

    for (const peerId of recipients) {
      try {
        const encrypted = await this.messageProtocol.encryptMessage(peerId, content.trim(), 'text', modelMeta);
        (encrypted as any).channelId = channelId;
        (encrypted as any).workspaceId = workspaceId;
        (encrypted as any).senderId = this.myPeerId;
        (encrypted as any).senderName = this.opts.account.alias;
        (encrypted as any).messageId = msg.id;
        if (threadId) (encrypted as any).threadId = threadId;
        if (replyToId) (encrypted as any).replyToId = replyToId;

        const connected = this.transport.getConnectedPeers().includes(peerId);
        if (connected) {
          await this.queuePendingAck(peerId, {
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
          const accepted = this.transport.send(peerId, encrypted);
          if (!accepted) {
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
                senderId: this.myPeerId,
                senderName: this.opts.account.alias,
                ...(replyToId ? { replyToId } : {}),
              },
            });
            await this.replicateToCustodians(peerId, workspaceId, channelId, msg.id);
          }
          continue;
        }

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
            senderId: this.myPeerId,
            senderName: this.opts.account.alias,
            ...(replyToId ? { replyToId } : {}),
          },
        });
        await this.replicateToCustodians(peerId, workspaceId, channelId, msg.id);
      } catch (err) {
        this.opts.log?.error?.(`[xena-peer] failed to prepare outbound for ${peerId}: ${String(err)}`);
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

  async joinWorkspace(inviteUri: string): Promise<void> {
    if (!this.syncProtocol || !this.transport) return;

    try {
      const invite = InviteURI.decode(inviteUri);
      if (!invite.peerId) {
        this.opts.log?.warn?.('[xena-peer] invite missing peer ID; cannot auto-join');
        return;
      }

      // Validate invite expiration
      if (InviteURI.isExpired(invite)) {
        this.opts.log?.warn?.('[xena-peer] invite has expired; skipping join');
        return;
      }

      await this.transport.connect(invite.peerId);

      const member: WorkspaceMember = {
        peerId: this.myPeerId,
        alias: this.opts.account.alias,
        publicKey: this.myPublicKey,
        role: 'member',
        isBot: true,
        companySim: this.getMyCompanySimProfile(),
        joinedAt: Date.now(),
      };

      this.syncProtocol.requestJoin(invite.peerId, invite.inviteCode, member, invite.inviteId);
      this.opts.log?.info(`[xena-peer] join request sent to ${invite.peerId}`);
    } catch (err) {
      this.opts.log?.error?.(`[xena-peer] join failed: ${String(err)}`);
    }
  }

  destroy(): void {
    this.destroyed = true;
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
    this.botHuddle?.destroy();
    this.botHuddle = null;
    this.transport?.destroy();
    this.opts.log?.info('[xena-peer] stopped');
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
      if (this.destroyed || !this.transport) return;
      const connectedPeers = new Set(this.transport.getConnectedPeers());
      const seen = new Set<string>();
      for (const workspace of this.workspaceManager.getAllWorkspaces()) {
        for (const member of workspace.members) {
          const peerId = member.peerId;
          if (peerId === this.myPeerId) continue;
          if (connectedPeers.has(peerId)) continue;
          if (seen.has(peerId)) continue;
          seen.add(peerId);
          this.transport.connect(peerId).catch(() => {});
        }
      }
    }, 30_000);
  }

  private async handlePeerMessage(fromPeerId: string, rawData: unknown): Promise<void> {
    if (this.destroyed || !this.syncProtocol || !this.messageProtocol || !this.transport) return;

    const msg = rawData as any;

    if (msg?.type === 'ack') {
      await this.handleInboundReceipt(fromPeerId, msg, 'acknowledged');
      return;
    }

    if (msg?.type === 'read') {
      await this.handleInboundReceipt(fromPeerId, msg, 'read');
      return;
    }

    if (await this.handlePreKeyControl(fromPeerId, msg)) {
      return;
    }

    if (msg?.type === 'handshake') {
      await this.messageProtocol.processHandshake(fromPeerId, msg);
      if (msg.preKeySupport) {
        this.transport.send(fromPeerId, { type: 'pre-key-bundle.request' });
      }
      await this.publishPreKeyBundle(fromPeerId);
      const knownKeys = this.store.get<Record<string, string>>('peer-public-keys', {});
      knownKeys[fromPeerId] = msg.publicKey;
      this.store.set('peer-public-keys', knownKeys);
      this.updateWorkspaceMemberKey(fromPeerId, msg.publicKey);
      // Save sender's display name if provided
      if (msg.alias) {
        this.updateWorkspaceMemberAlias(fromPeerId, msg.alias as string, msg.companySim as any, msg.isBot === true);
      }
      // Resend previously pending ACK-tracked messages first, then flush newly queued
      // offline payloads to avoid immediate duplicate sends in the same handshake cycle.
      await this.resendPendingAcks(fromPeerId);
      await this.flushOfflineQueue(fromPeerId);
      await this.flushPendingReadReceipts(fromPeerId);
      this.requestSyncForPeer(fromPeerId);
      this.sendManifestSummary(fromPeerId);
      this.requestCustodyRecovery(fromPeerId);
      return;
    }

    // Handle name-announce (unencrypted) — must be before the encrypted guard
    if (msg?.type === 'name-announce' && msg.alias) {
      const alias = msg.alias as string;
      this.updateWorkspaceMemberAlias(fromPeerId, alias, msg.companySim as any, msg.isBot === true);
      // Also cache directly so resolveSenderName can find it even before workspace sync
      this.store.set(`peer-alias-${fromPeerId}`, alias);
      return;
    }

    if (msg?.type === 'workspace-sync' && msg.sync) {
      // Handle workspace-state directly (SyncProtocol doesn't have a case for it)
      if (msg.sync.type === 'workspace-state' && msg.workspaceId) {
        this.handleWorkspaceState(fromPeerId, msg.workspaceId, msg.sync);
        return;
      }
      const merged = msg.workspaceId ? { ...msg.sync, workspaceId: msg.workspaceId } : msg.sync;
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
      this.opts.log?.warn?.(`[xena-peer] missing public key for ${fromPeerId}, skipping message`);
      return;
    }

    const peerPublicKey = await this.cryptoManager.importPublicKey(peerPubKeyB64);
    let content: string | null;
    try {
      content = await this.messageProtocol.decryptMessage(fromPeerId, msg, peerPublicKey);
    } catch (err) {
      this.opts.log?.warn?.(`[xena-peer] decrypt threw for ${fromPeerId}, resetting ratchet: ${String(err)}`);
      void this.messageProtocol?.clearRatchetState(fromPeerId);
      this.messageProtocol?.clearSharedSecret(fromPeerId);
      this.store.delete(`ratchet-${fromPeerId}`);
      return;
    }
    if (!content) {
      // decryptMessage returned null (internal error) — ratchet desynced, reset it
      this.opts.log?.warn?.(`[xena-peer] decrypt returned null for ${fromPeerId}, resetting ratchet`);
      void this.messageProtocol?.clearRatchetState(fromPeerId);
      this.messageProtocol?.clearSharedSecret(fromPeerId);
      this.store.delete(`ratchet-${fromPeerId}`);
      return;
    }

    const channelId = msg.channelId as string | undefined;
    if (!channelId) return;

    const created = await this.messageStore.createMessage(
      channelId,
      (msg.senderId as string | undefined) ?? fromPeerId,
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
      this.opts.log?.warn?.(`[xena-peer] rejected message ${created.id}: ${result.error}`);
      return;
    }

    this.persistMessagesForChannel(channelId);

    const workspaceId = (msg.workspaceId as string | undefined) ?? '';
    this.recordManifestDomain('channel-message', workspaceId || this.findWorkspaceIdForChannel(channelId), {
      channelId,
      itemCount: this.messageStore.getMessages(channelId).length,
      operation: 'create',
      subject: created.id,
      data: { messageId: created.id, senderId: fromPeerId },
    });

    this.transport.send(fromPeerId, {
      type: 'ack',
      messageId: created.id,
      channelId,
      ...(typeof msg.envelopeId === 'string' ? { envelopeId: msg.envelopeId } : {}),
    });

    const senderName = this.resolveSenderName(workspaceId, fromPeerId, msg.senderName as string | undefined);
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
      senderId: fromPeerId,
      senderName,
      messageId: created.id,
      chatType: msg.isDirect ? 'direct' : 'channel',
      timestamp: created.timestamp,
      replyToId: msg.replyToId as string | undefined,
      threadId: msg.threadId as string | undefined,
      attachments,
    });
  }

  private async handleNegentropyQuery(fromPeerId: string, msg: any): Promise<void> {
    const wsId = msg.workspaceId as string | undefined;
    const channelId = msg.channelId as string | undefined;
    const requestId = msg.requestId as string | undefined;
    const query = msg.query;
    if (!wsId || !channelId || !requestId || !query) return;

    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === fromPeerId)) return;
    if (!ws.channels.some((ch: any) => ch.id === channelId)) return;

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
    this.opts.log?.info?.(`[xena-peer] Negentropy query from ${fromPeerId.slice(0, 8)} for channel ${channelId.slice(0, 8)}: ${localItems.length} local messages`);
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
    this.opts.log?.info?.(`[xena-peer] Fetch request from ${fromPeerId.slice(0, 8)}: sent ${allMessages.length} messages`);
  }

  private async publishPreKeyBundle(peerId: string): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;
    try {
      const bundle = await this.messageProtocol.createPreKeyBundle();
      this.transport.send(peerId, { type: 'pre-key-bundle.publish', bundle });
    } catch (error) {
      this.opts.log?.warn?.(`[xena-peer] failed to publish pre-key bundle to ${peerId.slice(0, 8)}: ${String(error)}`);
    }
  }

  private async handlePreKeyControl(fromPeerId: string, msg: any): Promise<boolean> {
    if (!this.transport || !this.messageProtocol) return false;

    if (msg?.type === 'pre-key-bundle.publish') {
      if (msg.bundle) {
        await this.messageProtocol.storePeerPreKeyBundle(fromPeerId, msg.bundle);
      }
      return true;
    }

    if (msg?.type === 'pre-key-bundle.request') {
      try {
        const bundle = await this.messageProtocol.createPreKeyBundle();
        this.transport.send(fromPeerId, { type: 'pre-key-bundle.response', bundle });
      } catch (error) {
        this.opts.log?.warn?.(`[xena-peer] failed to respond with pre-key bundle to ${fromPeerId.slice(0, 8)}: ${String(error)}`);
      }
      return true;
    }

    if (msg?.type === 'pre-key-bundle.response') {
      if (msg.bundle) {
        await this.messageProtocol.storePeerPreKeyBundle(fromPeerId, msg.bundle);
      }
      return true;
    }

    return false;
  }

  private async sendHandshake(peerId: string): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;
    try {
      const handshake = await this.messageProtocol.createHandshake();
      this.transport.send(peerId, { type: 'handshake', ...handshake, capabilities: ['negentropy-sync-v1'] });
      await this.publishPreKeyBundle(peerId);
      // Announce display name (separate unencrypted message — same pattern as the web client)
      // Include workspaceId so the peer can deterministically add us to the correct workspace
      // (critical when the peer has multiple workspaces — without this, we'd only update
      // existing members, never add new ones)
      const allWorkspaces = this.workspaceManager.getAllWorkspaces();
      const workspaceWithPeer = allWorkspaces.find(ws =>
        ws.members.some(m => m.peerId === peerId)
      );
      this.transport.send(peerId, {
        type: 'name-announce',
        alias: this.opts.account.alias,
        isBot: true,
        companySim: this.getMyCompanySimProfile(),
        ...(workspaceWithPeer ? { workspaceId: workspaceWithPeer.id } : {}),
      });
    } catch (err) {
      this.opts.log?.error?.(`[xena-peer] handshake failed for ${peerId}: ${String(err)}`);
    }
  }

  private async handleSyncEvent(event: SyncEvent): Promise<void> {
    switch (event.type) {
      case 'workspace-joined': {
        this.opts.log?.info(`[xena-peer] joined workspace: ${event.workspace.id}`);
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
        this.opts.log?.warn?.(`[xena-peer] join REJECTED: ${(event as any).reason || 'unknown reason'}`);
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
      this.opts.log?.warn?.(`[xena-peer] failed to restore manifest state: ${String(error)}`);
    }
  }

  private persistManifestState(): void {
    try {
      this.store.set(this.manifestStateKey(), this.manifestStore.exportState());
    } catch (error) {
      this.opts.log?.warn?.(`[xena-peer] failed to persist manifest state: ${String(error)}`);
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

    if (!ws) {
      // First time receiving this workspace — create it
      const workspace = {
        id: workspaceId,
        name: sync.name || workspaceId.slice(0, 8),
        description: sync.description || '',
        channels: (sync.channels || []).map((ch: any) => ({
          id: ch.id,
          workspaceId,
          name: ch.name,
          type: ch.type || 'channel',
          members: [],
          createdBy: fromPeerId,
          createdAt: Date.now(),
        })),
        members: (sync.members || []).map((m: any) => ({
          peerId: m.peerId,
          alias: m.alias || m.peerId.slice(0, 8),
          publicKey: m.publicKey || '',
          signingPublicKey: m.signingPublicKey || undefined,
          role: m.role || 'member',
          isBot: m.isBot === true,
          companySim: m.companySim || undefined,
          joinedAt: Date.now(),
        })),
        inviteCode: sync.inviteCode || '',
        permissions: sync.permissions || {},
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
          companySim: this.getMyCompanySimProfile(),
          joinedAt: Date.now(),
        });
      }

      this.workspaceManager.importWorkspace(workspace);
      this.ensureBotFlag();
      this.opts.log?.info(`[xena-peer] imported workspace ${workspaceId.slice(0, 8)} "${sync.name}" with ${workspace.members.length} members, ${workspace.channels.length} channels`);
    } else {
      // Update existing workspace: sync members and channels
      if (sync.name && ws.name !== sync.name) ws.name = sync.name;
      if (sync.description !== undefined) ws.description = sync.description;

      // Merge members
      for (const remoteMember of (sync.members || [])) {
        const existing = ws.members.find((m: any) => m.peerId === remoteMember.peerId);
        if (!existing) {
          ws.members.push({
            peerId: remoteMember.peerId,
            alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
            publicKey: remoteMember.publicKey || '',
            signingPublicKey: remoteMember.signingPublicKey || undefined,
            role: remoteMember.role || 'member',
            isBot: remoteMember.isBot === true,
            companySim: remoteMember.companySim || undefined,
            joinedAt: Date.now(),
          });
        } else if (remoteMember.alias && !/^[a-f0-9]{8}$/i.test(remoteMember.alias)) {
          existing.alias = remoteMember.alias;
          if (remoteMember.publicKey) existing.publicKey = remoteMember.publicKey;
          if (remoteMember.isBot === true) existing.isBot = true;
          if (remoteMember.companySim) existing.companySim = remoteMember.companySim;
        }
      }

      // Merge channels
      for (const remoteCh of (sync.channels || [])) {
        const localCh = ws.channels.find((ch: any) => ch.id === remoteCh.id);
        if (!localCh) {
          ws.channels.push({
            id: remoteCh.id,
            workspaceId,
            name: remoteCh.name,
            type: remoteCh.type || 'channel',
            members: [],
            createdBy: fromPeerId,
            createdAt: Date.now(),
          });
        }
      }

      this.opts.log?.info(`[xena-peer] updated workspace ${workspaceId.slice(0, 8)} "${ws.name}" — now ${ws.members.length} members, ${ws.channels.length} channels`);
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
      const encrypted = await this.messageProtocol.encryptMessage(peerId, content.trim(), 'text', modelMeta);
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
              isDirect: true,
              senderId: this.myPeerId,
              senderName: this.opts.account.alias,
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
          isDirect: true,
          senderId: this.myPeerId,
          senderName: this.opts.account.alias,
        },
      });
    } catch (err) {
      this.opts.log?.error?.(`[xena-peer] DM to ${peerId} failed: ${String(err)}`);
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
      this.opts.log?.warn?.(`[xena-peer] failed to send read receipt to ${peerId}: ${String(err)}`);
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
    const workspace = params.workspaceId ? this.workspaceManager.getWorkspace(params.workspaceId) : undefined;
    const recipients = workspace
      ? workspace.members.map((m) => m.peerId).filter((p) => p !== this.myPeerId)
      : this.transport.getConnectedPeers().filter((p) => p !== this.myPeerId);
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
    const workspace = params.workspaceId ? this.workspaceManager.getWorkspace(params.workspaceId) : undefined;
    const recipients = workspace
      ? workspace.members.map((m) => m.peerId).filter((p) => p !== this.myPeerId)
      : this.transport.getConnectedPeers().filter((p) => p !== this.myPeerId);
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
    const workspace = params.workspaceId ? this.workspaceManager.getWorkspace(params.workspaceId) : undefined;
    const recipients = workspace
      ? workspace.members.map((m) => m.peerId).filter((p) => p !== this.myPeerId)
      : this.transport.getConnectedPeers().filter((p) => p !== this.myPeerId);
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
    const workspace = params.workspaceId ? this.workspaceManager.getWorkspace(params.workspaceId) : undefined;
    const recipients = workspace
      ? workspace.members.map((m) => m.peerId).filter((p) => p !== this.myPeerId)
      : this.transport.getConnectedPeers().filter((p) => p !== this.myPeerId);
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
    if (!this.opts.account.companySim?.enabled) return undefined;
    try {
      const context = loadCompanyContextForAccount(this.opts.account);
      if (!context) return undefined;
      return {
        automationKind: 'openclaw-agent',
        roleTitle: context.employee.title,
        teamId: context.employee.teamId,
      };
    } catch (err) {
      this.opts.log?.warn?.(`[xena-peer] failed to load company profile for ${this.opts.account.accountId}: ${String(err)}`);
      return { automationKind: 'openclaw-agent' };
    }
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
    for (const delta of deltas) {
      this.manifestStore.applyDelta(delta);
      if (delta.domain === 'channel-message') {
        this.requestSyncForPeer(peerId);
      }
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

  private selectCustodianPeers(workspaceId: string, recipientPeerId: string, limit = NodeXenaPeer.CUSTODIAN_REPLICATION_TARGET): string[] {
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
    workspaceId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    if (!this.transport || !workspaceId) return;
    const custodians = this.selectCustodianPeers(workspaceId, recipientPeerId);
    if (custodians.length === 0) return;

    const pending = await this.custodyStore.getPendingForRecipient(recipientPeerId);
    const envelopes = pending.filter((envelope) => envelope.opId === messageId && envelope.workspaceId === workspaceId);
    if (envelopes.length === 0) return;

    for (const envelope of envelopes) {
      this.pendingCustodyOffers.set(envelope.envelopeId, custodians);
      for (const custodianPeerId of custodians) {
        this.transport.send(custodianPeerId, {
          type: 'custody.offer',
          workspaceId,
          recipientPeerId,
          channelId,
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
          await this.handlePeerMessage(fromPeerId, envelope.ciphertext);
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
        if (item.ciphertext && typeof item.ciphertext === 'object') {
          const outbound = { ...item.ciphertext } as any;
          outbound._offlineReplay = 1;
          if (typeof item.envelopeId === 'string' && !outbound.envelopeId) {
            outbound.envelopeId = item.envelopeId;
          }
          this.transport.send(peerId, outbound);
          continue;
        }

        if (typeof item.content !== 'string') continue;
        const envelope = await this.messageProtocol.encryptMessage(peerId, item.content, 'text', item.metadata);
        (envelope as any).senderId = item.senderId ?? this.myPeerId;
        (envelope as any).senderName = item.senderName ?? this.opts.account.alias;
        (envelope as any).messageId = item.messageId;
        if (item.isDirect) {
          (envelope as any).isDirect = true;
        } else {
          (envelope as any).channelId = item.channelId;
          (envelope as any).workspaceId = item.workspaceId;
        }
        if (item.threadId) (envelope as any).threadId = item.threadId;
        if (item.replyToId) (envelope as any).replyToId = item.replyToId;
        this.transport.send(peerId, envelope);
      } catch (err) {
        this.opts.log?.warn?.(`[xena-peer] resend pending failed for ${peerId}: ${String(err)}`);
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
          const encrypted = await this.messageProtocol.encryptMessage(peerId, payload.content, 'text', payload.metadata);
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
            metadata: {
              ...(payload.isDirect ? { isDirect: true } : {}),
              ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
              senderId: payload.senderId ?? this.myPeerId,
              senderName: payload.senderName ?? this.opts.account.alias,
            },
          });
          return;
        } catch (err) {
          this.opts.log?.warn?.(`[xena-peer] encryption failed while queueing offline payload for ${peerId}: ${String(err)}`);
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
      this.opts.log?.info?.(`[xena-peer] queued outbound message for offline peer ${peerId}`);
    } catch (err) {
      this.opts.log?.error?.(`[xena-peer] failed to queue outbound message for ${peerId}: ${String(err)}`);
    }
  }

  private async flushOfflineQueue(peerId: string): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;
    if (!this.transport.getConnectedPeers().includes(peerId)) return;

    const queued = await this.offlineQueue.getQueued(peerId);
    if (queued.length === 0) return;

    let sentCount = 0;
    let failedCount = 0;

    for (const queuedItem of queued) {
      const item = (queuedItem?.data ?? queuedItem) as any;
      if (!item || typeof item !== 'object') {
        if (typeof queuedItem?.id === 'number') {
          await this.offlineQueue.remove(peerId, queuedItem.id);
        }
        continue;
      }

      try {
        if (this.isCustodyEnvelope(item)) {
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
            await this.offlineQueue.remove(peerId, queuedItem.id);
          }
          sentCount += 1;
          continue;
        }

        if (item.type === 'read' || item.type === 'ack') {
          const accepted = this.transport.send(peerId, item);
          if (!accepted) throw new Error('transport rejected queued receipt send');
          if (typeof queuedItem?.id === 'number') {
            await this.offlineQueue.remove(peerId, queuedItem.id);
          }
          sentCount += 1;
          continue;
        }

        if (typeof item.content !== 'string') {
          if (typeof queuedItem?.id === 'number') {
            await this.offlineQueue.remove(peerId, queuedItem.id);
          }
          continue;
        }

        if (!item.messageId) item.messageId = randomUUID();
        await this.queuePendingAck(peerId, item);
        const envelope = await this.messageProtocol.encryptMessage(peerId, item.content, 'text', item.metadata);
        (envelope as any).senderId = item.senderId ?? this.myPeerId;
        (envelope as any).senderName = item.senderName ?? this.opts.account.alias;
        (envelope as any).messageId = item.messageId;
        if (item.isDirect) {
          (envelope as any).isDirect = true;
        } else {
          (envelope as any).channelId = item.channelId;
          (envelope as any).workspaceId = item.workspaceId;
        }
        if (item.threadId) (envelope as any).threadId = item.threadId;
        if (item.replyToId) (envelope as any).replyToId = item.replyToId;

        const accepted = this.transport.send(peerId, envelope);
        if (!accepted) throw new Error('transport rejected queued send');

        if (typeof queuedItem?.id === 'number') {
          await this.offlineQueue.remove(peerId, queuedItem.id);
        }
        sentCount += 1;
      } catch (err) {
        failedCount += 1;
        if (typeof queuedItem?.id === 'number') {
          await this.offlineQueue.markAttempt(peerId, queuedItem.id);
        }
        this.opts.log?.warn?.(`[xena-peer] failed queued send to ${peerId}: ${String(err)}`);
      }
    }

    if (sentCount > 0) {
      this.opts.log?.info?.(`[xena-peer] flushed ${sentCount} queued messages to ${peerId}`);
    }
    if (failedCount > 0) {
      this.opts.log?.warn?.(`[xena-peer] ${failedCount} queued message(s) remain pending for ${peerId}`);
    }
  }

}
