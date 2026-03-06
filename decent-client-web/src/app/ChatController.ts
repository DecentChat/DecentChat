/**
 * ChatController — Business logic for the P2P Chat app.
 *
 * Owns the protocol instances (transport, messageProtocol, offlineQueue, CRDTs)
 * and handles message send/receive, workspace persistence, and transport events.
 */

import {
  CryptoManager,
  MessageStore,
  WorkspaceManager,
  PersistentStore,
  OfflineQueue,
  MessageCRDT,

  MediaStore,
  ChunkedSender,
  ChunkedReceiver,
  ClockSync,
  MessageGuard,
  Negentropy,
  verifyHandshakeKey,
  verifyPeerIdBinding,
  PeerAuth,
  DeviceManager,
  hashBlob,
  createAttachmentMeta,
  generateImageThumbnail,
  CHUNK_SIZE,
  InviteURI,
  signInvite,
  MemoryContactStore,
  MemoryDirectConversationStore,
  ServerDiscovery,
} from 'decent-protocol';
import type { InviteData } from 'decent-protocol';
import { MessageCipher } from 'decent-protocol';
import type {
  PlaintextMessage, Workspace, Channel,
  AttachmentMeta, Attachment, MediaChunk, MediaRequest, MediaResponse,
  TimeSyncRequest, TimeSyncResponse,
  NegentropyQuery, NegentropyResponse,
  Contact, DirectConversation,
} from 'decent-protocol';

import { PeerTransport, ICE_SERVERS_WITH_TURN } from 'decent-transport-webrtc';
import { KeyStore } from '../crypto/KeyStore';
import { IndexedDBBlobStorage } from '../storage/IndexedDBBlobStorage';
import { StorageQuotaManager } from '../storage/StorageQuotaManager';
// Database.ts is kept on disk (task #8 — not deleted yet) but is no longer
// instantiated here; PersistentStore is the single source of truth.
import { MessageProtocol } from '../messages/MessageProtocol';
import { PresenceManager } from '../ui/PresenceManager';
import { ReactionManager } from '../ui/ReactionManager';
import type { ReactionEvent } from '../ui/ReactionManager';
import type { TypingEvent, ReadReceipt } from '../ui/PresenceManager';
import { NotificationManager } from '../ui/NotificationManager';
import { HuddleManager } from '../huddle/HuddleManager';
import type { HuddleState, HuddleParticipant } from '../huddle/HuddleManager';
import type { AppState } from '../main';

const PROTOCOL_VERSION = 2;
const NEGENTROPY_SYNC_CAPABILITY = 'negentropy-sync-v1';
const NEGENTROPY_QUERY_TIMEOUT_MS = 8000;

const DEV_SIGNAL_PORT = Number((import.meta as any).env?.VITE_SIGNAL_PORT || 9000);
const DEV_SIGNAL_WS = `ws://localhost:${DEV_SIGNAL_PORT}`;
const PROD_SIGNAL_WS = 'wss://0.peerjs.com/'; // Free PeerJS cloud service (root path → PeerJS appends /peerjs)

// Get the appropriate signaling server based on environment
function getDefaultSignalingServer(): string {
  return window.location.hostname === 'localhost' ? DEV_SIGNAL_WS : PROD_SIGNAL_WS;
}

// ---------------------------------------------------------------------------
// Interface for UI callbacks that ChatController drives
// ---------------------------------------------------------------------------

export interface UIUpdater {
  updateSidebar: () => void;
  updateChannelHeader: () => void;
  appendMessageToDOM: (msg: PlaintextMessage, animate?: boolean) => void;
  showToast: (message: string, type?: 'info' | 'error' | 'success') => void;
  renderThreadMessages: () => void;
  renderMessages: () => void;
  renderApp: () => void;
  updateWorkspaceRail?: () => void;
  updateComposePlaceholder?: () => void;
  /** Update the thread reply indicator on a parent message in the main list */
  updateThreadIndicator: (parentMessageId: string, channelId: string) => void;
  /** DEP-005/012/013: Update message ticks (sent/delivered/read) without full re-render */
  updateMessageStatus?: (
    messageId: string,
    status: 'pending' | 'sent' | 'delivered' | 'read',
    detail?: { acked?: number; total?: number; read?: number },
  ) => void;
  updateStreamingMessage?: (messageId: string, content: string) => void;
  finalizeStreamingMessage?: (messageId: string) => void;
  openThread?: (messageId: string) => void;
  /** Huddle state changed (inactive / available / in-call) */
  onHuddleStateChange?: (state: HuddleState, channelId: string | null) => void;
  /** Huddle participants list updated */
  onHuddleParticipantsChange?: (participants: HuddleParticipant[]) => void;
  /** Refresh the activity sidebar panel if open */
  refreshActivityPanel?: () => void;
}

// ---------------------------------------------------------------------------
// ChatController
// ---------------------------------------------------------------------------

export class ChatController {
  // Protocol instances
  readonly cryptoManager: CryptoManager;
  readonly keyStore: KeyStore;
  transport: PeerTransport | any;
  messageProtocol: MessageProtocol | null = null;
  readonly messageStore: MessageStore;
  readonly workspaceManager: WorkspaceManager;
  readonly persistentStore: PersistentStore;
  readonly offlineQueue: OfflineQueue;
  readonly messageCRDTs: Map<string, MessageCRDT> = new Map();
  readonly mediaStore: MediaStore;
  private readonly blobStorage: IndexedDBBlobStorage;
  readonly clockSync: ClockSync;
  private signingKeyPair: { publicKey: CryptoKey; privateKey: CryptoKey } | null = null;
  private lastRoleChangeTimestamp = new Map<string, number>(); // peerId → last accepted timestamp
  readonly messageGuard: MessageGuard;
  readonly presence: PresenceManager;
  readonly reactions: ReactionManager;
  readonly notifications: NotificationManager;
  readonly contactStore: MemoryContactStore;
  readonly directConversationStore: MemoryDirectConversationStore;
  private networkOnlineListenerBound = false;
  private transportReinitInFlight: Promise<boolean> | null = null;
  private lastTransportReinitAt = 0;
  private peerCapabilities = new Map<string, Set<string>>();
  private pendingNegentropyQueries = new Map<
    string,
    {
      peerId: string;
      resolve: (response: NegentropyResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private lastMessageSyncRequestAt = new Map<string, number>();

  /** DEP-002: Peer Exchange for signaling server discovery */
  readonly storageQuota: StorageQuotaManager = new StorageQuotaManager();

  private serverDiscovery: Map<string, ServerDiscovery> = new Map();
  private pexBroadcastInterval: number | null = null;
  private _quotaCheckInterval: ReturnType<typeof setInterval> | null = null;
  private _peerMaintenanceInterval: ReturnType<typeof setInterval> | null = null;

  // T3.2: Gossip propagation
  /** Max relay hops a message may travel (0 = sent by original author, 1 = relayed once, …) */
  static readonly GOSSIP_TTL = 2;
  /** Deduplicate received messages by their original ID. Maps id → received timestamp */
  private _gossipSeen = new Map<string, number>();

  /** Peers that have completed challenge-response authentication */
  private authenticatedPeers = new Set<string>();

  /** Multi-device: tracks known devices per identity for message delivery */
  private deviceRegistry = new DeviceManager.DeviceRegistry();
  /** Multi-device: message ID dedup to prevent duplicate processing */
  private multiDeviceDedup = new DeviceManager.MessageDedup();
  /** Pending auth challenges we sent (peerId → challenge data) */
  private pendingAuthChallenges = new Map<string, { nonce: string; timestamp: number }>();
  /** Auth timeout: fall back to TOFU if peer doesn't respond to challenge */
  private static readonly AUTH_TIMEOUT_MS = 5000;
  /** Cleanup interval for the seen-set (every 5 min) */
  private _gossipCleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Activity feed (local derived index for thread replies/mentions) */
  private activityItems: Array<{
    id: string;
    type: 'thread-reply' | 'mention';
    workspaceId: string;
    channelId: string;
    threadId?: string;
    messageId: string;
    actorId: string;
    snippet: string;
    timestamp: number;
    read: boolean;
  }> = [];

  /** Pending stream metadata until the first delta arrives */
  private pendingStreams = new Map<string, {
    channelId: string;
    senderId: string;
    senderName?: string;
    threadId?: string;
    isDirect: boolean;
  }>();

  /** Active chunked transfers (receiving) */
  private activeTransfers = new Map<string, ChunkedReceiver>();
  /** Active chunked transfers (sending) */
  private activeSenders = new Map<string, ChunkedSender>();

  myPublicKey: string = '';
  /** Canonical identity ID (hash of public key). Set during init. */
  myIdentityId: string = '';
  huddle: HuddleManager | null = null;
  private ui: UIUpdater | null = null;
  private reactionsPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private channelViewInFlight = new Map<string, Promise<void>>();
  private pendingReadReceiptKeys = new Set<string>();

  constructor(private state: AppState) {
    this.cryptoManager = new CryptoManager();
    this.keyStore = new KeyStore(this.cryptoManager);
    this.transport = this._buildTransport();
    this.messageStore = new MessageStore();
    this.workspaceManager = new WorkspaceManager();
    this.persistentStore = new PersistentStore();
    this.offlineQueue = new OfflineQueue({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    this.blobStorage = new IndexedDBBlobStorage();
    this.mediaStore = new MediaStore(this.blobStorage);
    this.clockSync = new ClockSync();
    this.messageGuard = new MessageGuard();
    this.presence = new PresenceManager();
    this.reactions = new ReactionManager();
    this.reactions.onReactionsChanged = (messageId) => {
      const el = document.getElementById(`reactions-${messageId}`);
      if (el) {
        el.innerHTML = this.reactions.renderReactions(messageId, this.state.myPeerId);
        // Re-wire reaction pill clicks
        el.querySelectorAll('.reaction-pill').forEach(btn => {
          btn.addEventListener('click', () => {
            const emoji = (btn as HTMLElement).dataset.emoji!;
            this.toggleReaction(messageId, emoji);
          });
        });
      }
      this.schedulePersistReactions();
    };
    this.contactStore = new MemoryContactStore();
    this.directConversationStore = new MemoryDirectConversationStore();
    this.notifications = new NotificationManager();
    this.messageGuard.rateLimiter.onViolation = (v) => {
      console.warn(`[Guard] ${v.severity} violation from ${v.peerId.slice(0, 8)}: ${v.action}`);
      if (v.severity === 'ban') {
        this.ui?.showToast(`⚠️ Peer ${v.peerId.slice(0, 8)} temporarily banned (rate limit abuse)`, 'error');
      }
    };

    // Best-effort flush of in-flight streaming messages on page unload
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        for (const [messageId] of this.pendingStreams) {
          const msg = this.findMessageById(messageId);
          if (msg?.content) {
            this.persistMessage(msg).catch(() => {});
          }
        }
      });
    }
  }

  /** Inject UI callbacks after construction (breaks circular dep). */
  setUI(ui: UIUpdater): void {
    this.ui = ui;
  }

  private _buildTransport(): PeerTransport | any {
    const MockT = typeof window !== 'undefined' && (window as any).__MockTransport;
    return MockT ? new MockT() : new PeerTransport({
      iceServers: this.getIceServersFromEnv(),
    });
  }

  private _replaceTransport(nextTransport: PeerTransport | any): void {
    this.transport = nextTransport;
    if (typeof window !== 'undefined') {
      (window as any).__transport = this.transport;
    }
  }

  async recreateTransportAndInit(peerId?: string, reason = 'manual'): Promise<string> {
    try {
      this.transport.destroy();
    } catch {
      // Best-effort teardown of stale transport before recreation.
    }
    const nextTransport = this._buildTransport();
    this._replaceTransport(nextTransport);
    const assignedId = await this.transport.init(peerId);
    this.setupTransportHandlers();
    console.log(`[Reconnect] Recreated transport (${reason})`);
    return assignedId;
  }

  // =========================================================================
  // Transport event wiring
  // =========================================================================

  private isWorkspaceMember(peerId: string, workspaceId?: string): boolean {
    if (!workspaceId) return false;
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return false;
    return ws.members.some((m: any) => m.peerId === peerId);
  }

  private isTrustedSyncControlMessage(peerId: string, data: any): boolean {
    const type = data?.type;
    if (typeof type !== 'string') return false;

    const syncTypes = new Set([
      'message-sync-request',
      'message-sync-response',
      'message-sync-fetch-request',
      'message-sync-fetch-response',
      'message-sync-negentropy-query',
      'message-sync-negentropy-response',
    ]);
    if (!syncTypes.has(type)) return false;

    return this.isWorkspaceMember(peerId, data?.workspaceId as string | undefined);
  }

  private isTrustedOfflineReplayMessage(_peerId: string, data: any): boolean {
    // Offline queue replay lane: allow higher throughput for messages explicitly
    // marked as local outbox replay after reconnect.
    return data?._offlineReplay === 1 && (!!data?.encrypted || !!data?.ratchet);
  }

  /**
   * Best-effort control-message send with short retries across reconnect races.
   * Use only for low-frequency control traffic (handshake/sync metadata), not chat payloads.
   */
  private sendControlWithRetry(
    peerId: string,
    data: unknown,
    opts?: { maxAttempts?: number; initialDelayMs?: number; backoff?: number; label?: string },
  ): boolean {
    const maxAttempts = opts?.maxAttempts ?? 4;
    const initialDelayMs = opts?.initialDelayMs ?? 150;
    const backoff = opts?.backoff ?? 2;

    const trySend = (attempt: number): boolean => {
      const sent = this.transport.send(peerId, data);
      if (sent) return true;
      if (attempt >= maxAttempts) return false;

      const delay = Math.round(initialDelayMs * Math.pow(backoff, attempt - 1));
      setTimeout(() => {
        const ok = trySend(attempt + 1);
        if (!ok && attempt + 1 === maxAttempts) {
          const label = opts?.label ? ` (${opts.label})` : '';
          console.warn(`[Transport] control send failed after retries${label} to ${peerId.slice(0, 8)}`);
        }
      }, delay);
      return false;
    };

    return trySend(1);
  }

  setupTransportHandlers(): void {
    this.transport.onConnect = async (peerId: string) => {
      this.state.connectedPeers.add(peerId);
      this.state.connectingPeers.delete(peerId);
      this.ui?.updateSidebar();

      try {
        const handshake = await this.messageProtocol!.createHandshake();
        this.sendControlWithRetry(peerId, {
          type: 'handshake',
          ...handshake,
          capabilities: [NEGENTROPY_SYNC_CAPABILITY],
        }, { label: 'handshake' });
      } catch (err) {
        console.error('Handshake failed:', err);
      }
    };

    this.transport.onDisconnect = (peerId: string) => {
      this.state.connectedPeers.delete(peerId);
      this.state.connectingPeers.delete(peerId);
      this.state.readyPeers.delete(peerId);
      this.messageProtocol?.clearSharedSecret(peerId);
      this.peerCapabilities.delete(peerId);
      this.authenticatedPeers.delete(peerId);
      this.pendingAuthChallenges.delete(peerId);
      for (const [requestId, pending] of this.pendingNegentropyQueries) {
        if (pending.peerId !== peerId) continue;
        clearTimeout(pending.timer);
        pending.reject(new Error(`Peer ${peerId} disconnected during negentropy sync`));
        this.pendingNegentropyQueries.delete(requestId);
      }
      this.ui?.updateSidebar();
    };

    this.transport.onMessage = async (peerId: string, rawData: unknown) => {
      const data = rawData as any;
      
      // Rate limit + validate before any processing.
      // Trusted sync-control traffic gets its own lane (still authenticated by
      // workspace membership checks in handlers) so reconnect catch-up is not
      // throttled by normal chat message limits.
      // Huddle signaling (SDP offers/answers, ICE candidates) is control-plane
      // traffic that arrives in rapid bursts — must bypass rate limiting or
      // the WebRTC audio connection will silently fail.
      const isHuddleSignaling = typeof data?.type === 'string' && data.type.startsWith('huddle-');
      const bypassGuard = isHuddleSignaling
        || this.isTrustedSyncControlMessage(peerId, data)
        || this.isTrustedOfflineReplayMessage(peerId, data);
      if (!bypassGuard) {
        const guardResult = this.messageGuard.check(peerId, data);
        if (!guardResult.allowed) {
          console.warn(`[Guard] Blocked message from ${peerId.slice(0, 8)}: ${guardResult.reason} type=${data?.type}`);
          return;
        }
      }

      try {
        // --- DEP-005: Delivery ACK (control message — handle before decrypt) ---
        if (data?.type === 'ack') {
          const channelId = data.channelId as string;
          const messageId = data.messageId as string;
          if (channelId && messageId) {
            const validation = this.isValidInboundReceipt(peerId, channelId, messageId, 'ack');
            if (!validation.valid) return;

            const { msg, recipients } = validation;
            const ackedBy = new Set<string>(Array.isArray((msg as any).ackedBy) ? (msg as any).ackedBy : []);
            ackedBy.add(peerId);
            (msg as any).ackedBy = Array.from(ackedBy);
            const ackedAt: Record<string, number> = { ...((msg as any).ackedAt || {}) };
            ackedAt[peerId] = Date.now();
            (msg as any).ackedAt = ackedAt;

            const expected = recipients.length;
            const ackedCount = ackedBy.size;
            const readBy = new Set<string>(Array.isArray((msg as any).readBy) ? (msg as any).readBy : []);
            const readCount = readBy.size;
            const deliveredToAll = expected > 0 && recipients.every((id) => ackedBy.has(id));
            const readByAll = expected > 0 && recipients.every((id) => readBy.has(id));
            const nextStatus: 'pending' | 'sent' | 'delivered' | 'read' = readByAll ? 'read' : (deliveredToAll ? 'delivered' : 'sent');

            (msg as any).status = nextStatus;
            this.ui?.updateMessageStatus?.(messageId, nextStatus, { acked: ackedCount, total: expected, read: readCount });

            await this.persistentStore.saveMessage({ ...msg, status: nextStatus, recipientPeerIds: recipients, ackedBy: Array.from(ackedBy), ackedAt });
          }
          return;
        }

        // Message read receipt (WhatsApp-like message info)
        if (data?.type === 'read') {
          const channelId = data.channelId as string;
          const messageId = data.messageId as string;
          if (channelId && messageId) {
            const validation = this.isValidInboundReceipt(peerId, channelId, messageId, 'read');
            if (!validation.valid) return;

            const { msg, recipients } = validation;
            const readBy = new Set<string>(Array.isArray((msg as any).readBy) ? (msg as any).readBy : []);
            readBy.add(peerId);
            (msg as any).readBy = Array.from(readBy);
            const readAt: Record<string, number> = { ...((msg as any).readAt || {}) };
            readAt[peerId] = Date.now();
            (msg as any).readAt = readAt;

            // Read implies delivered for this peer.
            const ackedBy = new Set<string>(Array.isArray((msg as any).ackedBy) ? (msg as any).ackedBy : []);
            if (!ackedBy.has(peerId)) {
              ackedBy.add(peerId);
              (msg as any).ackedBy = Array.from(ackedBy);
            }
            const ackedAt: Record<string, number> = { ...((msg as any).ackedAt || {}) };
            if (!ackedAt[peerId]) ackedAt[peerId] = Date.now();
            (msg as any).ackedAt = ackedAt;

            const readByAll = recipients.length > 0 && recipients.every((id) => readBy.has(id));
            const deliveredToAll = recipients.length > 0 && recipients.every((id) => ackedBy.has(id));
            const nextStatus: 'pending' | 'sent' | 'delivered' | 'read' = readByAll ? 'read' : (deliveredToAll ? 'delivered' : 'sent');
            (msg as any).status = nextStatus;

            this.ui?.updateMessageStatus?.(messageId, nextStatus, {
              acked: ackedBy.size,
              total: recipients.length,
              read: readBy.size,
            });

            await this.persistentStore.saveMessage({ ...msg, status: nextStatus, recipientPeerIds: recipients, ackedBy: Array.from(ackedBy), ackedAt, readBy: Array.from(readBy), readAt });
          }
          return;
        }

        if (data?.type === 'stream-start') {
          const { messageId, channelId, senderId, senderName, isDirect, threadId, replyToId } = data as any;
          let targetChannelId = channelId as string;
          const streamSenderId = (senderId ?? peerId) as string;

          if (isDirect) {
            let conv = await this.directConversationStore.getByContact(streamSenderId);
            if (!conv) {
              conv = await this.directConversationStore.create(streamSenderId);
              await this.persistentStore.saveDirectConversation(conv);
            }
            targetChannelId = conv.id;
          }

          // IMPORTANT: replyToId is quote/reply metadata, not thread metadata.
          // Only explicit threadId may open/render a thread.
          const streamThreadId = isDirect ? undefined : threadId;
          this.pendingStreams.set(messageId, {
            channelId: targetChannelId,
            senderId: streamSenderId,
            senderName,
            threadId: streamThreadId,
            isDirect: !!isDirect,
          });

          // === CREATE MESSAGE + DOM ELEMENT IN stream-start (not delta) ===
          // This ensures exactly ONE element exists before any deltas arrive.
          const msg = await this.messageStore.createMessage(
            targetChannelId,
            streamSenderId,
            '',
            'text',
            streamThreadId,
          );
          msg.id = messageId;
          (msg as any).senderName = senderName;
          (msg as any).streaming = true;
          await this.messageStore.addMessage(msg);
          await this.persistMessage(msg); // Persist to IndexedDB immediately so it survives refresh

          if (streamThreadId) {
            // Auto-open thread panel (always, even if different channel is active)
            // openThread internally calls renderThreadMessages, which will include our new empty msg.
            this.ui?.openThread?.(streamThreadId);
            // If thread was already open on this threadId, openThread might skip.
            // Force re-render to include the new streaming message.
            if (this.state.threadOpen && this.state.activeThreadId === streamThreadId) {
              this.ui?.renderThreadMessages?.();
            }
            this.ui?.updateThreadIndicator?.(streamThreadId, targetChannelId);
          } else if (targetChannelId === this.state.activeChannelId) {
            this.ui?.appendMessageToDOM(msg, true);
          }
          return;
        }
        if (data?.type === 'stream-delta') {
          const { messageId, content } = data as any;
          const normalizedContent = typeof content === 'string' ? content : '';
          if (!normalizedContent.trim()) {
            // Ignore empty deltas to avoid creating empty placeholder messages.
            return;
          }
          const pending = this.pendingStreams.get(messageId);
          if (pending) {
            // Update stored message content (element already created in stream-start)
            const existing = this.findMessageById(messageId);
            if (existing) {
              existing.content = normalizedContent;
              (existing as any).streaming = true;
              await this.persistMessage(existing); // Persist partial content so it survives refresh
            }
            // Replace DOM element text with latest cumulative content
            this.ui?.updateStreamingMessage?.(messageId, normalizedContent);
          }
          return;
        }
        if (data?.type === 'stream-done') {
          const { messageId } = data as any;
          this.pendingStreams.delete(messageId);
          const msg = this.findMessageById(messageId);
          if (msg) {
            (msg as any).streaming = false;
            await this.persistMessage(msg);
          }

          if (msg?.threadId) {
            this.ui?.updateThreadIndicator?.(msg.threadId, msg.channelId);
          }

          // Record thread/mention activity for streamed messages (same as normal inbound)
          if (msg && msg.senderId !== this.state.myPeerId) {
            let activityChanged = false;
            const wsId = this.resolveWorkspaceIdByChannelId(msg.channelId);
            if (wsId) {
              const before = this.activityItems.length;
              this.maybeRecordMentionActivity(msg, msg.channelId, wsId);
              if (this.activityItems.length !== before) activityChanged = true;
            }
            if (msg.threadId) {
              const before = this.activityItems.length;
              this.maybeRecordThreadActivity(msg, msg.channelId);
              if (this.activityItems.length !== before) activityChanged = true;
            }
            if (activityChanged) {
              this.ui?.updateChannelHeader();
              this.ui?.updateWorkspaceRail?.();
            }
          }

          this.ui?.finalizeStreamingMessage?.(messageId);
          return;
        }

        // --- Huddle signaling (voice calls) ---
        if (data?.type?.startsWith('huddle-')) {
          await this.huddle?.handleSignal(peerId, data);
          return;
        }

        // --- Handshake ---
        if (data?.type === 'handshake') {
          // DEP-003 / MITM protection: if we have a pre-stored public key for this peer
          // (e.g. from an invite URL), verify the handshake key matches before accepting.
          const wsId = this.state.activeWorkspaceId;
          const ws = wsId ? this.workspaceManager.getWorkspace(wsId) : null;
          const existingMember = ws?.members.find((m: any) => m.peerId === peerId);
          const preStoredKey = existingMember?.publicKey;

          const verification = verifyHandshakeKey(preStoredKey, data.publicKey);
          if (!verification.ok) {
            console.error(`[Security] Handshake rejected for peer ${peerId}: ${verification.reason}`);
            this.transport.disconnect(peerId);
            this.ui?.showToast(
              `⚠️ Security alert: ${peerId.slice(0, 8)} sent a different key than expected. ` +
              `Connection rejected — possible impersonation attempt.`,
              'error',
            );
            return;
          }

          await this.messageProtocol?.clearRatchetState(peerId);
          this.messageProtocol?.clearSharedSecret(peerId);
          await this.messageProtocol!.processHandshake(peerId, data);

          // --- PeerId↔PublicKey binding verification (anti-impersonation) ---
          if (data.publicKey) {
            const binding = await verifyPeerIdBinding(peerId, data.publicKey);
            if (!binding.valid) {
              console.error(`[Security] PeerId binding failed for ${peerId}: ${binding.reason}`);
              this.transport.disconnect(peerId);
              this.ui?.showToast(
                `⚠️ Security: ${peerId.slice(0, 8)} peerId doesn't match their public key. Connection rejected.`,
                'error',
              );
              return;
            }
          }

          // --- Initiate challenge-response auth ---
          // Send a challenge; peer must prove they own the signing key.
          // If they don't respond within AUTH_TIMEOUT_MS, fall back to TOFU.
          if (data.signingPublicKey) {
            const challenge = PeerAuth.createChallenge();
            this.pendingAuthChallenges.set(peerId, challenge);
            this.sendControlWithRetry(peerId, {
              type: 'auth-challenge',
              nonce: challenge.nonce,
            }, { label: 'auth-challenge' });

            // TOFU fallback timeout: if peer doesn't respond, accept without auth
            setTimeout(() => {
              if (!this.authenticatedPeers.has(peerId) && this.state.connectedPeers.has(peerId)) {
                console.warn(`[Auth] Peer ${peerId.slice(0, 8)} did not respond to auth challenge — TOFU fallback`);
                this.authenticatedPeers.add(peerId);
                this.pendingAuthChallenges.delete(peerId);
              }
            }, ChatController.AUTH_TIMEOUT_MS);
          } else {
            // Old client without signing key — mark as authenticated via TOFU
            this.authenticatedPeers.add(peerId);
          }

          // Protocol version check (DEP-004)
          if (data.protocolVersion != null && data.protocolVersion > PROTOCOL_VERSION) {
            console.warn(
              `[Protocol] Peer ${peerId.slice(0, 8)} uses protocol v${data.protocolVersion} ` +
              `(we support v${PROTOCOL_VERSION}). Some features may not work.`,
            );
          }
          const capabilities = Array.isArray(data.capabilities)
            ? data.capabilities.filter((value: unknown): value is string => typeof value === 'string')
            : [];
          this.peerCapabilities.set(peerId, new Set(capabilities));

          this.state.readyPeers.add(peerId);
          this.ensurePeerInActiveWorkspace(peerId, data.publicKey);

          // Persist peer — PersistentStore is the single source of truth for peers.
          await this.persistentStore.savePeer({
            peerId,
            publicKey: data.publicKey,
            lastSeen: Date.now(),
          });
          await this.keyStore.storePeerPublicKey(peerId, data.publicKey);

          this.state.connectedPeers.add(peerId);
          this.ui?.updateSidebar();
          const ratchetActive = this.messageProtocol!.hasRatchetState(peerId);
          // Connection toast removed — too noisy for end users
          console.debug(`[P2P] ${ratchetActive ? "Forward-secret" : "Encrypted"} connection with ${peerId.slice(0, 8)}`);

          await this.flushOfflineQueue(peerId);
          this.requestMessageSync(peerId).catch(err => console.warn('[Sync] Message sync request failed:', err));

          // Send workspace state to new peer (channels, members, name)
          this.sendWorkspaceState(peerId);

          // Announce our display name for this workspace
          if (this.state.activeWorkspaceId) {
            this.sendControlWithRetry(peerId, {
              type: 'name-announce',
              workspaceId: this.state.activeWorkspaceId,
              alias: this.getMyAliasForWorkspace(this.state.activeWorkspaceId),
            }, { label: 'name-announce' });
          }

          // Start clock sync with new peer
          const syncReq = this.clockSync.startSync(peerId);
          this.sendControlWithRetry(peerId, syncReq, { label: 'time-sync-request' });
          return;
        }

        // --- Auth challenge-response ---
        if (data?.type === 'auth-challenge' && data.nonce) {
          // Peer is challenging us: prove we own our signing key
          if (this.signingKeyPair?.privateKey) {
            try {
              const response = await PeerAuth.respondToChallenge(
                data.nonce,
                peerId, // challenger's peerId goes into the signed payload
                this.signingKeyPair.privateKey,
              );
              this.sendControlWithRetry(peerId, {
                type: 'auth-response',
                signature: response.signature,
              }, { label: 'auth-response' });
            } catch (err) {
              console.error(`[Auth] Failed to respond to challenge from ${peerId.slice(0, 8)}:`, err);
            }
          }
          return;
        }

        if (data?.type === 'auth-response' && data.signature) {
          // Peer responded to our challenge — verify their signature
          const pending = this.pendingAuthChallenges.get(peerId);
          if (!pending) {
            console.warn(`[Auth] Unexpected auth-response from ${peerId.slice(0, 8)} (no pending challenge)`);
            return;
          }
          // Get the peer's signing public key
          const peerSigningKey = this.messageProtocol?.getSigningPublicKey(peerId);
          if (!peerSigningKey) {
            console.warn(`[Auth] No signing key for ${peerId.slice(0, 8)} — TOFU fallback`);
            this.authenticatedPeers.add(peerId);
            this.pendingAuthChallenges.delete(peerId);
            return;
          }
          const valid = await PeerAuth.verifyResponse(
            pending.nonce,
            this.state.myPeerId,
            data.signature,
            peerSigningKey,
          );
          this.pendingAuthChallenges.delete(peerId);
          if (valid) {
            this.authenticatedPeers.add(peerId);
            console.log(`[Auth] Peer ${peerId.slice(0, 8)} authenticated ✓`);
          } else {
            console.error(`[Auth] Peer ${peerId.slice(0, 8)} FAILED authentication — bad signature`);
            // Don't disconnect — TOFU fallback; log the failure for observability
            this.authenticatedPeers.add(peerId);
          }
          return;
        }

        // --- Clock sync ---
        if (data?.type === 'time-sync-request') {
          const response = this.clockSync.handleRequest(data as TimeSyncRequest);
          this.sendControlWithRetry(peerId, response, { label: 'time-sync-response' });
          return;
        }
        if (data?.type === 'time-sync-response') {
          this.clockSync.handleResponse(peerId, data as TimeSyncResponse);
          return;
        }

        // --- Media requests ---
        if (data?.type === 'media-request') {
          await this.handleMediaRequest(peerId, data as MediaRequest);
          return;
        }
        if (data?.type === 'media-response') {
          await this.handleMediaResponse(peerId, data as MediaResponse);
          return;
        }
        if (data?.type === 'media-chunk') {
          await this.handleMediaChunk(peerId, data as MediaChunk);
          return;
        }

        // --- Reactions ---
        if (data?.type === 'reaction') {
          // Workspace isolation: only accept reactions from peers in a shared workspace
          if (data.workspaceId) {
            const ws = this.workspaceManager.getWorkspace(data.workspaceId);
            if (!ws || !ws.members.some((m: any) => m.peerId === peerId)) {
              console.warn(`[Security] Dropping reaction from ${peerId.slice(0, 8)}: not in workspace`);
              return;
            }
          }
          this.reactions.handleReactionEvent(data as ReactionEvent);
          return;
        }

        // --- Typing indicators ---
        if (data?.type === 'typing') {
          this.presence.handleTypingEvent(data as TypingEvent);
          return;
        }

        // --- Read receipts ---
        if (data?.type === 'read-receipt') {
          this.presence.handleReadReceipt(data as ReadReceipt);
          return;
        }

        // --- Name announce (peer telling us their display name) ---
        if (data?.type === 'name-announce' && data.alias) {
          const allWorkspaces = this.workspaceManager.getAllWorkspaces();

          // Prefer explicit workspaceId from sender when it exists locally.
          // Fallback to sole-workspace mode; otherwise avoid auto-adding into active workspace
          // to prevent cross-workspace membership leakage.
          let ws = data.workspaceId
            ? this.workspaceManager.getWorkspace(data.workspaceId)
            : null;
          if (!ws && allWorkspaces.length === 1) ws = allWorkspaces[0];

          if (ws) {
            const member = ws.members.find((m: any) => m.peerId === peerId);
            if (member) {
              const incomingAlias = String(data.alias || '').trim();
              const currentAlias = String(member.alias || '').trim();
              const incomingLooksLikeId = /^[a-f0-9]{8}$/i.test(incomingAlias);
              const currentLooksLikeId = /^[a-f0-9]{8}$/i.test(currentAlias);
              if (incomingAlias && (!incomingLooksLikeId || currentLooksLikeId || !currentAlias)) {
                member.alias = incomingAlias;
              }
              if (data.isBot && !member.isBot) member.isBot = true;
            } else {
              ws.members.push({ peerId, alias: data.alias, publicKey: '', joinedAt: Date.now(), role: 'member', ...(data.isBot ? { isBot: true } : {}) });
            }
            this.persistWorkspace(ws.id).catch(() => {});
          } else {
            // No deterministic workspace mapping: only update aliases where member already exists.
            for (const workspace of allWorkspaces) {
              const member = workspace.members.find((m: any) => m.peerId === peerId);
              if (member) {
                member.alias = data.alias;
                this.persistWorkspace(workspace.id).catch(() => {});
              }
            }
          }

          // Also persist to contacts for cross-workspace display
          this.contactStore.get(peerId).then(contact => {
            if (contact) {
              if (contact.displayName !== data.alias) {
                this.contactStore.update(peerId, { displayName: data.alias }).catch(() => {});
                this.persistentStore.saveContact({ ...contact, displayName: data.alias }).catch(() => {});
              }
            } else {
              // Peer not yet a contact — save so name persists across refresh
              const newContact = {
                peerId,
                displayName: data.alias as string,
                publicKey: '',
                signalingServers: [] as string[],
                addedAt: Date.now(),
                lastSeen: Date.now(),
              };
              this.contactStore.add(newContact).catch(() => {});
              this.persistentStore.saveContact(newContact).catch(() => {});
            }
          }).catch(() => {});
          this.ui?.updateSidebar();
          this.ui?.renderMessages();
          return;
        }

        // --- Workspace sync ---
        if (data?.type === 'workspace-sync') {
          this.handleSyncMessage(peerId, data);
          return;
        }

        // --- Message sync (reconnect catch-up) ---
        if (data?.type === 'message-sync-negentropy-query') {
          await this.handleNegentropySyncQuery(peerId, data);
          return;
        }
        if (data?.type === 'message-sync-negentropy-response') {
          this.handleNegentropySyncResponse(peerId, data);
          return;
        }
        if (data?.type === 'message-sync-fetch-request') {
          await this.handleMessageSyncFetchRequest(peerId, data);
          return;
        }
        if (data?.type === 'message-sync-request') {
          await this.handleMessageSyncRequest(peerId, data);
          return;
        }
        if (data?.type === 'message-sync-response') {
          await this.handleMessageSyncResponse(peerId, data);
          return;
        }

        // --- T3.2: Gossip dedup — drop if we already processed this message via another path ---
        // _originalMessageId is set on relayed copies; plain direct messages have none.
        // IMPORTANT: only CHECK here — don't set.  The seen-set is seeded uniformly
        // after successful processing (result.success block) so that the canonical msg.id
        // is the key regardless of whether the copy was direct or relayed.
        const _gossipOrigId: string | undefined = (rawData as any)?._originalMessageId;
        if (_gossipOrigId && this._gossipSeen.has(_gossipOrigId)) return;

        // --- Encrypted chat message ---
        // Prefer persisted peer key, but tolerate brief handshake/persistence races by
        // falling back to workspace member key when available.
        const peerData = await this.persistentStore.getPeer(peerId);
        let peerPublicKeyBase64: string | undefined = peerData?.publicKey;

        if (!peerPublicKeyBase64) {
          const wsId = this.state.activeWorkspaceId;
          const ws = wsId ? this.workspaceManager.getWorkspace(wsId) : null;
          const member = ws?.members.find((m: any) => m.peerId === peerId);
          if (member?.publicKey) {
            peerPublicKeyBase64 = member.publicKey;
          }
        }

        if (!peerPublicKeyBase64) {
          console.warn(`[Crypto] Missing public key for ${peerId.slice(0, 8)}; dropping message envelope.`);
          return;
        }

        const peerPublicKey = await this.cryptoManager.importPublicKey(peerPublicKeyBase64);
        let content: string | null;
        try {
          content = await this.messageProtocol!.decryptMessage(peerId, data, peerPublicKey);
        } catch (error) {
          this.messageProtocol?.clearSharedSecret(peerId);
          console.warn(`[Crypto] Decrypt failed for ${peerId.slice(0, 8)}; cleared ratchet state.`, error);
          return;
        }
        if (!content) return;

        // Direct message from a contact (outside workspace)
        if (data.isDirect) {
          // Multi-device dedup for DMs
          if (data.messageId && this.multiDeviceDedup.isDuplicate(data.messageId)) {
            console.log(`[MultiDevice] Dedup: skipping duplicate DM ${(data.messageId as string).slice(0, 8)} from ${peerId.slice(0, 8)}`);
            return;
          }
          if (data.messageId) this.multiDeviceDedup.markSeen(data.messageId);

          let conv = await this.directConversationStore.getByContact(peerId);
          if (!conv) {
            conv = await this.directConversationStore.create(peerId);
            await this.persistentStore.saveDirectConversation(conv);
          }

          const channelId = conv.id;
          const msg = await this.messageStore.createMessage(channelId, peerId, content);
          {
            const lastLocalTs = this.messageStore.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
            msg.timestamp = Math.max(data.timestamp ?? Date.now(), lastLocalTs + 1);
          }
          (msg as any).vectorClock = data.vectorClock;
          // Carry attachment metadata from the envelope so the receiver renders thumbnails
          if ((data as any).attachments?.length) {
            (msg as any).attachments = (data as any).attachments;
            const wsId = this.state.activeWorkspaceId || 'default';
            for (const att of (data as any).attachments) {
              // Register metadata in MediaStore (no blob yet — will be fetched on demand)
              this.mediaStore.registerMeta(wsId, att, 'pruned');
            }
          }
          const result = await this.messageStore.addMessage(msg);

          if (result.success) {
            const crdt = this.getOrCreateCRDT(channelId);
            crdt.addMessage({
              id: msg.id,
              channelId: msg.channelId,
              senderId: msg.senderId,
              content: msg.content,
              type: (msg.type || 'text') as any,
              vectorClock: data.vectorClock || {},
              wallTime: msg.timestamp,
              prevHash: msg.prevHash || '',
            });
            await this.persistMessage(msg);

            // DEP-005: Send delivery ACK back to sender
            this.transport.send(peerId, { type: 'ack', messageId: msg.id, channelId });

            await this.directConversationStore.updateLastMessage(channelId, msg.timestamp);
            const updatedConv = await this.directConversationStore.get(channelId);
            if (updatedConv) {
              await this.persistentStore.saveDirectConversation(updatedConv);
            }

            if (channelId === this.state.activeChannelId) {
              this.ui?.appendMessageToDOM(msg, true);
              // Message is immediately visible to user in active channel → emit read receipt.
              this.transport.send(peerId, { type: 'read', messageId: msg.id, channelId });
              (msg as any).localReadAt = Date.now();
              await this.persistentStore.saveMessage({ ...(msg as any), localReadAt: (msg as any).localReadAt });
            }

            const senderName = this.getDisplayNameForPeer(peerId);
            this.notifications.notify(channelId, senderName, senderName, content);
            this.ui?.updateSidebar();
          }
          return;
        }

        // ── Workspace + membership validation ──────────────────────────────
        // Every workspace message MUST come from a peer who is a member of a
        // workspace that owns the target channel. Reject anything that doesn't
        // pass — this prevents cross-workspace message leakage.
        let channelId: string;
        {
          const allWorkspaces = this.workspaceManager.getAllWorkspaces();

          // Prefer the explicit workspaceId in the envelope (new protocol).
          // If workspaceId is given but unknown, reject immediately — no fallback.
          // Legacy fallback to channelId lookup only when workspaceId is absent.
          let targetWs;
          if (data.workspaceId) {
            targetWs = allWorkspaces.find(ws => ws.id === data.workspaceId);
            if (!targetWs && data.channelId) {
              // Compatibility fallback: if workspaceId is stale/mismatched but channelId maps
              // to one of our known workspaces, use that workspace and continue with strict
              // membership checks below.
              targetWs = allWorkspaces.find(ws =>
                ws.channels.some((ch: any) => ch.id === data.channelId)
              );
              if (targetWs) {
                console.warn(`[Security] workspaceId mismatch from ${peerId.slice(0, 8)}: ${data.workspaceId} -> using channel-mapped workspace ${targetWs.id}`);
              }
            }

            if (!targetWs) {
              console.warn(`[Security] Dropping message from ${peerId.slice(0, 8)}: unknown workspaceId ${data.workspaceId}`);
              return;
            }
          } else if (data.channelId) {
            targetWs = allWorkspaces.find(ws =>
              ws.channels.some((ch: any) => ch.id === data.channelId)
            );
          }

          if (!targetWs) {
            // Fallback: if the sender is a known contact, treat as a DM (handles the case
            // where isDirect flag was lost in transit or sender used wrong send path).
            const fallbackConv = await this.directConversationStore.getByContact(peerId);
            if (fallbackConv) {
              console.warn(`[Security] Message from ${peerId.slice(0, 8)} missing isDirect/workspace — falling back to DM`, data);
              const channelId = fallbackConv.id;
              const msg = await this.messageStore.createMessage(channelId, peerId, content);
              {
                const lastLocalTs = this.messageStore.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
                msg.timestamp = Math.max(data.timestamp ?? Date.now(), lastLocalTs + 1);
              }
              (msg as any).vectorClock = data.vectorClock;
              if ((data as any).attachments?.length) {
                (msg as any).attachments = (data as any).attachments;
              }
              const result = await this.messageStore.addMessage(msg);
              if (result.success) {
                const crdt = this.getOrCreateCRDT(channelId);
                crdt.addMessage({
                  id: msg.id, channelId: msg.channelId, senderId: msg.senderId,
                  content: msg.content, type: (msg.type || 'text') as any,
                  vectorClock: data.vectorClock || {}, wallTime: msg.timestamp,
                  prevHash: msg.prevHash || '',
                });
                await this.persistMessage(msg);
                this.transport.send(peerId, { type: 'ack', messageId: msg.id, channelId });
                await this.directConversationStore.updateLastMessage(channelId, msg.timestamp);
                const updatedConv = await this.directConversationStore.get(channelId);
                if (updatedConv) await this.persistentStore.saveDirectConversation(updatedConv);
                if (channelId === this.state.activeChannelId) {
                  this.ui?.appendMessageToDOM(msg, true);
                  this.transport.send(peerId, { type: 'read', messageId: msg.id, channelId });
                  (msg as any).localReadAt = Date.now();
                  await this.persistentStore.saveMessage({ ...(msg as any), localReadAt: (msg as any).localReadAt });
                }
                const senderName = this.getDisplayNameForPeer(peerId);
                this.notifications.notify(channelId, senderName, senderName, content);
                this.ui?.updateSidebar();
              }
              return;
            }
            console.warn(`[Security] Dropping message from ${peerId.slice(0, 8)}: workspace/channel not found`, data);
            return;
          }

          // Sender must be a member of that workspace
          const isMember = targetWs.members.some((m: any) => m.peerId === peerId);
          if (!isMember) {
            if (this.state.readyPeers.has(peerId)) {
              this.workspaceManager.addMember(targetWs.id, {
                peerId,
                alias: peerId.slice(0, 8),
                publicKey: '',
                joinedAt: Date.now(),
                role: 'member',
              });
              this.persistWorkspace(targetWs.id).catch(() => {});
            } else {
              console.warn(`[Security] Dropping message from ${peerId.slice(0, 8)}: not a member of workspace ${targetWs.id}`);
              return;
            }
          }

          // Resolve channelId: use the declared one if it exists in the workspace,
          // otherwise fall back to the first channel (handles channel-id drift on first sync)
          if (data.channelId && targetWs.channels.some((ch: any) => ch.id === data.channelId)) {
            channelId = data.channelId;
          } else {
            channelId = targetWs.channels[0]?.id || data.channelId || 'default';
          }
        }

        // Threading must be explicit. replyToId is only quote/reply metadata.
        const normalizedThreadId: string | undefined = data.threadId as string | undefined;
        // T3.2: For gossip-relayed messages, use the original sender's peerId (not the relay node)
        const actualSenderId: string = (data._gossipOriginalSender as string | undefined) ?? peerId;
        const msg = await this.messageStore.createMessage(channelId, actualSenderId, content, 'text', normalizedThreadId);
        // Use sender's timestamp but guarantee it's strictly after our last stored message.
        // Without this guard the hash-chain timestamp check rejects messages that arrive
        // out-of-order (e.g. Alice sent a thread reply at T=100, Bob meanwhile sent at
        // T=101, so when Alice's message finally lands on Bob it fails: 100 > 101 = false).
        {
          const lastLocalTs = this.messageStore.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
          msg.timestamp = Math.max(data.timestamp ?? Date.now(), lastLocalTs + 1);
        }
        (msg as any).vectorClock = data.vectorClock;
        // Use sender's message ID so both peers share the same DOM element ID.
        // This is required for reaction sync: reactions reference messageId in the DOM
        // (e.g. #reactions-<msgId>). If the receiver generates its own ID, reactions
        // from the sender target an element that doesn't exist on the receiver's DOM.
        if (data.messageId) msg.id = data.messageId;
        // Carry attachment metadata (thumbnail + meta) so the receiver renders previews
        if (data.attachments?.length) {
          (msg as any).attachments = data.attachments;
          const wsId = this.state.activeWorkspaceId || 'default';
          for (const att of data.attachments) {
            this.mediaStore.registerMeta(wsId, att, 'pruned');
          }
        }


        // Streaming dedup: if this messageId was already received via streaming,
        // update the existing message content, clear streaming flag, persist, and return.
        const existingStreamMsg = this.findMessageById(msg.id);
        if (existingStreamMsg) {
          existingStreamMsg.content = content;
          (existingStreamMsg as any).streaming = false;
          await this.persistMessage(existingStreamMsg);
          this.ui?.updateStreamingMessage?.(msg.id, content);
          return;
        }
        // T3.2 Gossip dedup (post-decryption): if we already processed this exact message
        // ID via any path (direct or gossip), skip it now.  This covers the gossip-first
        // ordering where _originalMessageId was added to _gossipSeen before the direct
        // copy arrived (which has no _originalMessageId to check at the top of the handler).
        if (this._gossipSeen.has(msg.id)) return;

        // Multi-device dedup: if same message arrives from multiple device connections
        // of the same sender, skip duplicates. Uses messageId for dedup.
        if (msg.id && this.multiDeviceDedup.isDuplicate(msg.id)) {
          console.log(`[MultiDevice] Dedup: skipping duplicate message ${msg.id.slice(0, 8)} from ${peerId.slice(0, 8)}`);
          return;
        }
        if (msg.id) this.multiDeviceDedup.markSeen(msg.id);

        const result = await this.messageStore.addMessage(msg);

        if (result.success) {
          const crdt = this.getOrCreateCRDT(channelId);
          crdt.addMessage({
            id: msg.id,
            channelId: msg.channelId,
            senderId: msg.senderId,
            content: msg.content,
            type: (msg.type || 'text') as any,
            threadId: normalizedThreadId,     // propagate threadId to CRDT
            vectorClock: data.vectorClock || {},
            wallTime: msg.timestamp,
            prevHash: msg.prevHash || '',
          });

          await this.persistMessage(msg);

          // DEP-005: Send delivery ACK back to sender
          this.transport.send(peerId, { type: 'ack', messageId: msg.id, channelId });

          // Ensure thread root snapshot for thread replies
          if (normalizedThreadId) {
            if (data.threadRootSnapshot) {
              void this.ensureThreadRootFromSnapshot(normalizedThreadId, channelId, data.threadRootSnapshot);
            } else {
              void this.ensureThreadRoot(normalizedThreadId, channelId);
            }
          }

          // T3.2: Seed gossip seen-set with the canonical message ID so that a later
          // gossip-relayed copy of this same message (which uses msg.id as _originalMessageId)
          // is caught by the early dedup check and dropped without re-rendering.
          this._gossipSeen.set(msg.id, Date.now());

          // T3.2: Gossip relay — re-encrypt and forward to workspace peers who might not have received this
          void this._gossipRelay(peerId, msg.id, msg.senderId, content, channelId, data);

          const wsIdForMsg = this.resolveWorkspaceIdByChannelId(channelId);
          let activityChanged = false;
          if (wsIdForMsg) {
            const before = this.activityItems.length;
            this.maybeRecordMentionActivity(msg, channelId, wsIdForMsg);
            if (this.activityItems.length !== before) activityChanged = true;
          }
          if (msg.threadId) {
            const before = this.activityItems.length;
            this.maybeRecordThreadActivity(msg, channelId);
            if (this.activityItems.length !== before) activityChanged = true;
          }
          if (activityChanged) {
            this.ui?.updateChannelHeader();
            this.ui?.updateWorkspaceRail?.();
          }

          if (channelId === this.state.activeChannelId) {
            if (msg.threadId) {
              // It's a thread reply — update the parent message's reply indicator and
              // re-render the thread panel if it's open and showing the right thread
              this.ui?.updateThreadIndicator(msg.threadId, channelId);
              if (this.state.threadOpen && this.state.activeThreadId === msg.threadId) {
                this.ui?.renderThreadMessages();
              }
            } else {
              this.ui?.appendMessageToDOM(msg, true);
            }
            // Message is visible in active channel.
            this.transport.send(peerId, { type: 'read', messageId: msg.id, channelId });
            (msg as any).localReadAt = Date.now();
            await this.persistentStore.saveMessage({ ...(msg as any), localReadAt: (msg as any).localReadAt });

            // Auto-mark activity as read if the thread/channel is currently visible
            if (msg.threadId && this.state.threadOpen && this.state.activeThreadId === msg.threadId) {
              this.markThreadActivityRead(channelId, msg.threadId);
              this.ui?.updateWorkspaceRail?.();
              this.ui?.refreshActivityPanel?.();
            } else if (!msg.threadId) {
              // Channel-level mention — mark read if we're viewing this channel
              const mentionId = `mention:${this.resolveWorkspaceIdByChannelId(channelId)}:${channelId}:${msg.id}`;
              const item = this.activityItems.find(i => i.id === mentionId);
              if (item && !item.read) {
                item.read = true;
                this.persistActivity();
                this.ui?.updateWorkspaceRail?.();
                this.ui?.refreshActivityPanel?.();
              }
            }
          }

          // Notify — resolve from the workspace that owns this channel, not the active one
          const notifyWsId = this.resolveWorkspaceIdByChannelId(channelId);
          const notifyWs = notifyWsId ? this.workspaceManager.getWorkspace(notifyWsId) : null;
          const ch = notifyWs ? this.workspaceManager.getChannel(notifyWs.id, channelId) : null;
          const notifyName = this.getPeerAliasForChannel(peerId, channelId);
          this.notifications.notify(
            channelId,
            ch ? (ch.type === 'dm' ? ch.name : '#' + ch.name) : 'channel',
            notifyName,
            content,
          );

          // Always update sidebar so unread badge appears on non-active channels
          this.ui?.updateSidebar();
        }
      } catch (error) {
        console.error('Message processing failed:', error);
      }
    };

    this.transport.onError = (error: Error) => {
      // 'unavailable-id' is a transient race on page reload — PeerTransport retries silently.
      if ((error as any).type === 'unavailable-id' || error.message?.includes('is taken')) return;
      // Signaling server briefly dropped — PeerTransport auto-reconnects with backoff.
      if (error.message?.includes('disconnecting from server') ||
          error.message?.includes('disconnected from server') ||
          error.message?.includes('Lost connection to server')) return;
      // Peer is simply offline — expected, no need to disturb the user.
      if (error.message?.includes('Could not connect to peer') ||
          error.message?.includes('Failed to connect to') ||
          error.message?.includes('peer-unavailable')) return;
      // PeerJS can throw this transiently during reconnect races.
      if (error.message?.includes('Connection is not open') ||
          error.message?.includes('listen for the `open` event before sending')) return;
      this.ui?.showToast(error.message, 'error');
    };

    // ICE restart on network recovery (DEP-004)
    // PeerTransport's network listener handles heartbeat pings and signaling server probing.
    // At the app layer, show a toast to keep the user informed.
    if (typeof window !== 'undefined' && !this.networkOnlineListenerBound) {
      this.networkOnlineListenerBound = true;
      window.addEventListener('online', () => {
        const peers = this.transport.getConnectedPeers();
        console.log(`[Network] Reconnected. Re-probing ${peers.length} peers...`);
      });
    }
  }

  /** Send our workspace state (channels, members, name) to a connected peer */
  /**
   * Handle a channel-created message from a peer.
   * Adds the channel to the local workspace if not already present, then
   * refreshes the sidebar so the user sees it immediately.
   */
  private handleChannelCreated(workspaceId: string, channel: Channel): void {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) {
      console.warn(`[Sync] channel-created for unknown workspace ${workspaceId.slice(0, 8)}, ignoring`);
      return;
    }

    const exists = ws.channels.find((c: Channel) => c.id === channel.id);
    if (exists) return; // already have it (e.g. from workspace-state sync)

    ws.channels.push(channel);
    this.persistentStore.saveWorkspace(ws).catch(err =>
      console.error('[Sync] Failed to persist workspace after channel-created:', err)
    );

    console.log(`[Sync] Channel created by peer: #${channel.name} in workspace ${workspaceId.slice(0, 8)}`);

    // Refresh sidebar so the new channel appears immediately
    this.ui?.updateSidebar();
  }

  private async handleChannelRemoved(workspaceId: string, channelId: string): Promise<void> {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) {
      console.warn(`[Sync] channel-removed for unknown workspace ${workspaceId.slice(0, 8)}, ignoring`);
      return;
    }

    const channel = ws.channels.find((c: Channel) => c.id === channelId);
    if (!channel) return;

    ws.channels = ws.channels.filter((c: Channel) => c.id !== channelId);
    this.messageStore.clearChannel(channelId);
    this.messageCRDTs.delete(channelId);

    try {
      const messages = await this.persistentStore.getChannelMessages(channelId);
      if (messages.length > 0) {
        await this.persistentStore.deleteMessages(messages.map((m: any) => m.id));
      }
      await this.persistentStore.saveWorkspace(ws);
    } catch (err) {
      console.error('[Sync] Failed to persist cleanup after channel-removed:', err);
    }

    if (this.state.activeWorkspaceId === workspaceId && this.state.activeChannelId === channelId) {
      const fallback = ws.channels.find((c: Channel) => c.type === 'channel') || ws.channels[0] || null;
      this.state.activeChannelId = fallback?.id || null;
      this.ui?.renderMessages();
      this.ui?.updateChannelHeader();
      this.ui?.updateComposePlaceholder?.();
    }

    this.ui?.updateSidebar();
  }

  private sendWorkspaceState(peerId: string, workspaceId?: string): void {
    // Find the workspace to send: explicit ID, peer's workspace, or active workspace
    let ws: Workspace | undefined;
    if (workspaceId) {
      ws = this.workspaceManager.getWorkspace(workspaceId);
    }
    // If no explicit workspace, find workspace where this peer is a member
    if (!ws) {
      for (const w of this.workspaceManager.getAllWorkspaces()) {
        if (w.members.some(m => m.peerId === peerId)) {
          ws = w;
          break;
        }
      }
    }
    // Last resort: active workspace
    if (!ws && this.state.activeWorkspaceId) {
      ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    }
    if (!ws) {
      console.log(`[Sync] No workspace found for peer ${peerId.slice(0, 8)}, skipping state sync`);
      return;
    }

    const isPeerMember = ws.members.some(m => m.peerId === peerId);
    console.log(`[Sync] Sending workspace state to ${peerId.slice(0, 8)}:`, {
      name: ws.name, channels: ws.channels.length, members: ws.members.length,
      isPeerMember, peerInWs: ws.members.filter(m => m.peerId === peerId).map(m => m.alias)
    });

    this.sendControlWithRetry(peerId, {
      type: 'workspace-sync',
      workspaceId: ws.id,
      sync: {
        type: 'workspace-state',
        name: ws.name,
        description: ws.description,
        channels: ws.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
        members: ws.members.map(m => ({ peerId: m.peerId, alias: m.alias, publicKey: m.publicKey, signingPublicKey: m.signingPublicKey, identityId: m.identityId, devices: m.devices, role: m.role })),
        inviteCode: ws.inviteCode,
        permissions: ws.permissions,
      },
    }, { label: 'workspace-sync' });
  }

  private async handleSyncMessage(peerId: string, msg: any): Promise<void> {
    // Handle workspace state sync (channels, members, name)
    if (msg.sync?.type === 'workspace-state' && msg.workspaceId) {
      console.log('[Sync] Received workspace-state from', peerId.slice(0,8), 
        'ws:', msg.sync?.name, 
        'channels:', msg.sync?.channels?.map((c:any) => c.name));
      await this.handleWorkspaceStateSync(peerId, msg.workspaceId, msg.sync);
      return;
    }

    // Handle real-time channel creation broadcast
    if (msg.sync?.type === 'channel-created' && msg.workspaceId && msg.sync.channel) {
      this.handleChannelCreated(msg.workspaceId, msg.sync.channel);
      return;
    }

    // Handle real-time channel removal broadcast
    if (msg.sync?.type === 'channel-removed' && msg.workspaceId && msg.sync.channelId) {
      await this.handleChannelRemoved(msg.workspaceId, msg.sync.channelId);
      return;
    }

    // Handle workspace deletion broadcast
    if (msg.sync?.type === 'workspace-deleted' && msg.workspaceId) {
      const existed = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (existed) {
        await this.cleanupWorkspaceLocalState(msg.workspaceId, existed);
        this.workspaceManager.removeWorkspace(msg.workspaceId);
        this.ui?.showToast('Workspace was deleted by owner', 'error');
        this.ui?.updateWorkspaceRail?.();
        this.ui?.updateSidebar();
        this.ui?.updateChannelHeader();
        this.ui?.renderMessages();
        this.ui?.updateComposePlaceholder?.();
      }
      return;
    }

    // Handle role-changed event
    // SECURITY: Verify ECDSA signature from workspace owner. Fallback to local-state check for backward compat.
    if (msg.sync?.type === 'role-changed' && msg.workspaceId) {
      const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (ws) {
        const changedBy = msg.sync.changedBy;
        const validRoles = ['admin', 'member'];
        if (!validRoles.includes(msg.sync.newRole)) {
          console.warn(`[Security] Rejected role-changed: invalid role "${msg.sync.newRole}"`);
          return;
        }

        // Replay protection: reject if timestamp is not newer than last accepted
        const tsKey = `role:${msg.sync.peerId}`;
        const lastTs = this.lastRoleChangeTimestamp.get(tsKey) || 0;
        if (msg.sync.timestamp && msg.sync.timestamp <= lastTs) {
          console.warn(`[Security] Rejected role-changed: replay detected (ts ${msg.sync.timestamp} <= ${lastTs})`);
          return;
        }

        // ECDSA signature verification against LOCALLY STORED owner signing key
        let signatureVerified = false;
        if (msg.sync.signature) {
          const ownerMember = ws.members.find((m: any) => m.role === 'owner');
          if (ownerMember?.signingPublicKey) {
            // Verify against the owner's signing key we already trust (stored locally)
            signatureVerified = await this.verifyRoleEvent(
              msg.workspaceId, changedBy,
              { targetPeerId: msg.sync.peerId, newRole: msg.sync.newRole, timestamp: msg.sync.timestamp, signature: msg.sync.signature },
              ownerMember.signingPublicKey,
            );
            if (!signatureVerified) {
              console.warn(`[Security] Rejected role-changed: ECDSA signature verification failed against stored owner key`);
              return;
            }
          }
        }

        // Fallback: if no signature, require that transport sender IS the owner
        if (!signatureVerified) {
          if (!this.workspaceManager.isOwner(ws.id, peerId)) {
            console.warn(`[Security] Rejected role-changed from ${peerId.slice(0, 8)}: no valid signature and transport sender is not owner`);
            return;
          }
        }

        const member = ws.members.find((m: any) => m.peerId === msg.sync.peerId);
        if (member && member.role !== 'owner') {
          member.role = msg.sync.newRole;
          if (msg.sync.timestamp) this.lastRoleChangeTimestamp.set(tsKey, msg.sync.timestamp);
          this.persistWorkspace(ws.id).catch(() => {});
          const alias = member.alias || msg.sync.peerId.slice(0, 8);
          this.ui?.showToast(`${alias} is now ${msg.sync.newRole}`, 'info');
          this.ui?.renderApp();
        }
      }
      return;
    }

    // Handle workspace-settings-updated event
    // SECURITY: Verify ECDSA signature from admin/owner. Fallback to local-state check.
    if (msg.sync?.type === 'workspace-settings-updated' && msg.workspaceId) {
      const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (ws) {
        const changedBy = msg.sync.changedBy;

        // Validate settings shape
        const settings = msg.sync.settings;
        if (!settings || typeof settings !== 'object') return;
        const validValues = ['everyone', 'admins'];
        if (settings.whoCanCreateChannels && !validValues.includes(settings.whoCanCreateChannels)) return;
        if (settings.whoCanInviteMembers && !validValues.includes(settings.whoCanInviteMembers)) return;
        if (settings.revokedInviteIds !== undefined) {
          if (!Array.isArray(settings.revokedInviteIds)) return;
          if (settings.revokedInviteIds.some((id: any) => typeof id !== 'string')) return;
        }

        // Replay protection for settings events
        const settingsTsKey = `settings:${msg.workspaceId}`;
        const settingsLastTs = this.lastRoleChangeTimestamp.get(settingsTsKey) || 0;
        if (msg.sync.timestamp && msg.sync.timestamp <= settingsLastTs) {
          console.warn(`[Security] Rejected workspace-settings-updated: replay detected`);
          return;
        }

        // ECDSA signature verification against locally stored admin/owner signing key
        let signatureVerified = false;
        if (msg.sync.signature) {
          const actorMember = ws.members.find((m: any) => m.peerId === changedBy && (m.role === 'owner' || m.role === 'admin'));
          if (actorMember?.signingPublicKey) {
            signatureVerified = await this.verifySettingsEvent(
              msg.workspaceId, changedBy,
              { settings: msg.sync.settings, timestamp: msg.sync.timestamp, signature: msg.sync.signature },
              actorMember.signingPublicKey,
            );
            if (!signatureVerified) {
              console.warn(`[Security] Rejected workspace-settings-updated: ECDSA signature verification failed against stored key`);
              return;
            }
          }
        }

        // Fallback: require transport sender IS an admin/owner
        if (!signatureVerified) {
          if (!this.workspaceManager.isAdmin(ws.id, peerId)) {
            console.warn(`[Security] Rejected workspace-settings-updated: no valid signature and transport sender is not admin/owner`);
            return;
          }
        }

        ws.permissions = {
          ...(ws.permissions || { whoCanCreateChannels: 'everyone', whoCanInviteMembers: 'everyone', revokedInviteIds: [] }),
          ...settings,
          revokedInviteIds: Array.isArray(settings.revokedInviteIds)
            ? Array.from(new Set(settings.revokedInviteIds.map((id: string) => id.trim()).filter(Boolean)))
            : (ws.permissions?.revokedInviteIds || []),
        };
        if (msg.sync.timestamp) this.lastRoleChangeTimestamp.set(settingsTsKey, msg.sync.timestamp);
        this.persistWorkspace(ws.id).catch(() => {});
        this.ui?.showToast('Workspace settings updated', 'info');
      }
      return;
    }

    // Handle member-left event (voluntary leave)
    if (msg.sync?.type === 'member-left' && msg.workspaceId) {
      const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (ws) {
        const leftPeerId = msg.sync.peerId;

        ws.members = ws.members.filter((m: any) => m.peerId !== leftPeerId);
        for (const ch of ws.channels) {
          ch.members = ch.members.filter((id: string) => id !== leftPeerId);
        }

        if (leftPeerId === this.state.myPeerId) {
          const ok = await this.cleanupWorkspaceLocalState(ws.id, ws);
          if (ok) {
            this.workspaceManager.removeWorkspace(ws.id);
            this.ui?.showToast('You left the workspace', 'info');
            this.ui?.updateWorkspaceRail?.();
            this.ui?.updateSidebar();
            this.ui?.updateChannelHeader();
            this.ui?.renderMessages();
            this.ui?.updateComposePlaceholder?.();
          }
        } else {
          this.persistWorkspace(ws.id).catch(() => {});
          this.ui?.renderApp();
        }
      }
      return;
    }

    // Handle member-removed event
    // SECURITY: Verify ECDSA signature. Fallback to local-state permission check.
    if (msg.sync?.type === 'member-removed' && msg.workspaceId) {
      const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (ws) {
        const removedBy = msg.sync.removedBy;
        const removedPeerId = msg.sync.peerId;

        // Replay protection for member-removed events
        const removeTsKey = `remove:${removedPeerId}`;
        const removeLastTs = this.lastRoleChangeTimestamp.get(removeTsKey) || 0;
        if (msg.sync.timestamp && msg.sync.timestamp <= removeLastTs) {
          console.warn(`[Security] Rejected member-removed: replay detected`);
          return;
        }

        // ECDSA signature verification against locally stored admin/owner signing key
        let signatureVerified = false;
        if (msg.sync.signature) {
          const actorMember = ws.members.find((m: any) => m.peerId === removedBy && (m.role === 'owner' || m.role === 'admin'));
          if (actorMember?.signingPublicKey) {
            signatureVerified = await this.verifyRemoveEvent(
              msg.workspaceId, removedBy,
              { peerId: removedPeerId, timestamp: msg.sync.timestamp, signature: msg.sync.signature },
              actorMember.signingPublicKey,
            );
            if (!signatureVerified) {
              console.warn(`[Security] Rejected member-removed: ECDSA signature verification failed against stored key`);
              return;
            }
          }
        }

        // Fallback: require transport sender has permission (use peerId, not claimed removedBy)
        if (!signatureVerified) {
          if (!this.workspaceManager.canRemoveMember(ws.id, peerId, removedPeerId)) {
            console.warn(`[Security] Rejected member-removed: no valid signature and transport sender lacks permission`);
            return;
          }
        }

        ws.members = ws.members.filter((m: any) => m.peerId !== removedPeerId);
        for (const ch of ws.channels) {
          ch.members = ch.members.filter((id: string) => id !== removedPeerId);
        }

        if (removedPeerId === this.state.myPeerId) {
          const ok = await this.cleanupWorkspaceLocalState(ws.id, ws);
          if (ok) {
            this.workspaceManager.removeWorkspace(ws.id);
            this.ui?.showToast('You have been removed from this workspace', 'error');
            this.ui?.updateWorkspaceRail?.();
            this.ui?.updateSidebar();
            this.ui?.updateChannelHeader();
            this.ui?.renderMessages();
            this.ui?.updateComposePlaceholder?.();
          }
        } else {
          this.persistWorkspace(ws.id).catch(() => {});
          this.ui?.renderApp();
        }
      }
      return;
    }

    // Multi-device: Handle device-announce sync messages
    if (msg.sync?.type === 'device-announce' && msg.sync.identityId && msg.sync.device && msg.sync.proof) {
      try {
        // Verify the device proof before accepting
        // Look up the signing public key for this identity from workspace members
        const ws = msg.workspaceId ? this.workspaceManager.getWorkspace(msg.workspaceId) : null;
        const member = ws?.members.find((m: any) => m.identityId === msg.sync.identityId);
        if (member?.signingPublicKey) {
          const signingKey = await this.cryptoManager.importSigningPublicKey(member.signingPublicKey);
          const result = await DeviceManager.verifyDeviceProof(msg.sync.proof, signingKey);
          if (result.valid) {
            this.deviceRegistry.addDevice(msg.sync.identityId, msg.sync.device);
            // Update workspace member's device list
            if (member) {
              if (!member.devices) member.devices = [];
              const devIdx = member.devices.findIndex((d: any) => d.deviceId === msg.sync.device.deviceId);
              if (devIdx >= 0) {
                member.devices[devIdx] = msg.sync.device;
              } else {
                member.devices.push(msg.sync.device);
              }
              if (ws) this.persistWorkspace(ws.id).catch(() => {});
            }
            // Send ack
            this.transport.send(peerId, {
              type: 'sync',
              sync: { type: 'device-ack', identityId: msg.sync.identityId, deviceId: msg.sync.device.deviceId },
              workspaceId: msg.workspaceId,
            });
            console.log(`[MultiDevice] Registered device ${msg.sync.device.deviceLabel} for identity ${msg.sync.identityId.slice(0, 8)}`);
          } else {
            console.warn(`[MultiDevice] Rejected device-announce: ${result.reason}`);
          }
        } else {
          // No signing key — can't verify, accept with warning (TOFU for devices)
          this.deviceRegistry.addDevice(msg.sync.identityId, msg.sync.device);
          console.warn(`[MultiDevice] Accepted device-announce without verification (no signing key for identity ${msg.sync.identityId.slice(0, 8)})`);
        }
      } catch (err) {
        console.error('[MultiDevice] device-announce handling error:', err);
      }
      return;
    }

    // DEP-002: Handle peer-exchange messages
    if (msg.sync?.type === 'peer-exchange' && msg.workspaceId) {
      const discovery = this.serverDiscovery.get(msg.workspaceId);
      if (discovery && msg.sync.servers) {
        discovery.mergeReceivedServers(msg.sync.servers);
        this.saveServerDiscovery(msg.workspaceId); // Persist updated state
        console.log(`[PEX] Merged ${msg.sync.servers.length} servers from ${peerId.slice(0, 8)}`);

        // Try to connect to new high-ranked servers
        await this.connectToDiscoveredServers(discovery);
      }
    }
  }

  /**
   * Handle incoming workspace state sync — update local channels, members, and name
   * to match the peer's state. This ensures both peers see the same channels.
   */
  private async handleWorkspaceStateSync(peerId: string, remoteWorkspaceId: string, sync: any): Promise<void> {
    console.log(`[Sync] Received workspace state from ${peerId.slice(0, 8)}:`, sync);

    // Find matching local workspace deterministically:
    // 1) exact workspace ID, 2) matching invite code, 3) active workspace fallback (legacy).
    const allWorkspaces = this.workspaceManager.getAllWorkspaces();
    let localWs = allWorkspaces.find((ws: any) => ws.id === remoteWorkspaceId)
      || (sync?.inviteCode ? allWorkspaces.find((ws: any) => ws.inviteCode === sync.inviteCode) : null)
      || (this.state.activeWorkspaceId ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId) : null);

    if (!localWs) return;

    // SECURITY: workspace IDs should match for normal sync.
    // But on fresh invite-join flows, the joiner may have created a provisional
    // local workspace ID before receiving the owner's canonical workspace-state.
    // In that case, if inviteCode matches, adopt the remote workspace ID once.
    if (remoteWorkspaceId !== localWs.id) {
      const sameInvite = !!sync?.inviteCode && sync.inviteCode === localWs.inviteCode;
      const onlyOneWorkspace = this.workspaceManager.getAllWorkspaces().length === 1;
      const inviterIsKnownMember = localWs.members.some((m: any) => m.peerId === peerId);
      const inviterIsOwner = localWs.members.some((m: any) => m.peerId === peerId && m.role === 'owner');
      // Legacy fallback: only allow adoption heuristic when remote inviteCode is missing.
      // If inviteCode is present and mismatched, never adopt a different workspace ID.
      const canAdoptByJoinHeuristic = !sync?.inviteCode && onlyOneWorkspace && inviterIsKnownMember && inviterIsOwner;

      if (!sameInvite && !canAdoptByJoinHeuristic) {
        console.warn(`[Sync] Rejected workspace state from ${peerId.slice(0, 8)}: workspace ID mismatch. ` +
          `Local: ${localWs.id.slice(0, 8)}, Remote: ${remoteWorkspaceId.slice(0, 8)}. ` +
          `This peer may be from a different workspace.`);
        return;
      }

      // SECURITY: Only the JOINER should adopt the owner's canonical workspace ID.
      // The owner must never adopt a joiner's provisional ID — that corrupts
      // the canonical workspace state for all existing members.
      if (this.workspaceManager.isOwner(localWs.id, this.state.myPeerId)) {
        console.log(`[Sync] Skipping workspace ID adoption from ${peerId.slice(0, 8)}: I am the owner`);
      } else {
        const oldWorkspaceId = localWs.id;
        console.log(`[Sync] Adopting remote workspace ID ${remoteWorkspaceId.slice(0, 8)} (was ${oldWorkspaceId.slice(0, 8)}) for invite ${localWs.inviteCode}`);

        // Remap local channel IDs to the owner's canonical channel IDs by name/type.
        if (Array.isArray(sync.channels)) {
          for (const remoteCh of sync.channels) {
            const localCh = localWs.channels.find((ch: any) => ch.name === remoteCh.name && ch.type === remoteCh.type);
            if (localCh && localCh.id !== remoteCh.id) {
              const oldId = localCh.id;
              localCh.id = remoteCh.id;
              localCh.workspaceId = remoteWorkspaceId;
              this.messageStore.remapChannel(oldId, remoteCh.id);
              await this.persistentStore.remapChannelMessages(oldId, remoteCh.id);
              if (this.messageCRDTs.has(oldId)) {
                const crdt = this.messageCRDTs.get(oldId)!;
                this.messageCRDTs.set(remoteCh.id, crdt);
                this.messageCRDTs.delete(oldId);
              }
              if (this.state.activeChannelId === oldId) {
                this.state.activeChannelId = remoteCh.id;
              }
            }
          }
        }

        // Replace provisional workspace ID with canonical one.
        this.workspaceManager.removeWorkspace(oldWorkspaceId);
        localWs.id = remoteWorkspaceId;
        for (const ch of localWs.channels) {
          ch.workspaceId = remoteWorkspaceId;
        }
        this.workspaceManager.importWorkspace(localWs as any);

        await this.persistentStore.deleteWorkspace(oldWorkspaceId);
        await this.persistentStore.saveWorkspace(localWs as any);

        if (this.state.activeWorkspaceId === oldWorkspaceId) {
          this.state.activeWorkspaceId = remoteWorkspaceId;
        }
      }
    }

    // Update workspace name if it was using the invite code as name
    if (sync.name && localWs.name !== sync.name) {
      const isPlaceholder = localWs.name === localWs.inviteCode || localWs.name.length === 8;
      if (isPlaceholder) {
        localWs.name = sync.name;
      }
    }

    // Sync description
    if (sync.description !== undefined) {
      localWs.description = sync.description;
    }

    // Sync permissions — SECURITY: only accept from owner
    if (sync.permissions && this.workspaceManager.isOwner(localWs.id, peerId)) {
      localWs.permissions = sync.permissions;
    }

    // Sync channels: map remote channels to local ones
    if (sync.channels && Array.isArray(sync.channels)) {
      for (const remoteCh of sync.channels) {
        const localCh = localWs.channels.find(
          (ch: any) => ch.name === remoteCh.name && ch.type === remoteCh.type
        );
        if (localCh && localCh.id !== remoteCh.id && remoteCh.id < localCh.id) {
          // Min-wins: only adopt the remote channel ID when it is lexicographically smaller.
          // This prevents a late-joining peer (with fresh UUIDs) from overwriting the
          // established channel ID and orphaning messages stored under the old key.
          console.log(`[Sync] Remapping channel "${remoteCh.name}": ${localCh.id.slice(0, 8)} → ${remoteCh.id.slice(0, 8)}`);
          const oldId = localCh.id;
          localCh.id = remoteCh.id;

          // Migrate messages and CRDTs to the new channel ID
          this.messageStore.remapChannel(oldId, remoteCh.id);
          await this.persistentStore.remapChannelMessages(oldId, remoteCh.id);
          if (this.messageCRDTs.has(oldId)) {
            const crdt = this.messageCRDTs.get(oldId)!;
            this.messageCRDTs.set(remoteCh.id, crdt);
            this.messageCRDTs.delete(oldId);
          }

          // Update active channel if needed
          if (this.state.activeChannelId === oldId) {
            this.state.activeChannelId = remoteCh.id;
          }
        } else if (!localCh) {
          // New channel from peer — add it locally
          console.log(`[Sync] Adding new channel "${remoteCh.name}" from peer`);
          localWs.channels.push({
            id: remoteCh.id,
            workspaceId: localWs.id,
            name: remoteCh.name,
            type: remoteCh.type || 'channel',
            members: [],
            createdBy: peerId,
            createdAt: Date.now(),
          });
        }
      }
    }

    // Sync members: add missing, update aliases for existing
    if (sync.members && Array.isArray(sync.members)) {
      for (const remoteMember of sync.members) {
        const existing = localWs.members.find((m: any) => m.peerId === remoteMember.peerId);
        if (!existing) {
          // SECURITY: Only accept elevated roles from workspace owner
          const isFromOwner = this.workspaceManager.isOwner(localWs.id, peerId);
          const safeRole = isFromOwner && ['owner', 'admin', 'member'].includes(remoteMember.role)
            ? remoteMember.role : 'member';
          localWs.members.push({
            peerId: remoteMember.peerId,
            alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
            publicKey: remoteMember.publicKey || '',
            signingPublicKey: remoteMember.signingPublicKey || undefined,
            joinedAt: Date.now(),
            role: safeRole,
            isBot: remoteMember.isBot || undefined,
          });
        } else {
          // Update alias when it improves quality; avoid overwriting human names
          // with short peer-id-like placeholders.
          if (remoteMember.alias && remoteMember.alias.trim()) {
            const incomingAlias = remoteMember.alias.trim();
            const currentAlias = (existing.alias || '').trim();
            const incomingLooksLikeId = /^[a-f0-9]{8}$/i.test(incomingAlias);
            const currentLooksLikeId = /^[a-f0-9]{8}$/i.test(currentAlias);
            if (!incomingLooksLikeId || currentLooksLikeId || !currentAlias) {
              existing.alias = incomingAlias;
            }
          }
          if (remoteMember.publicKey) existing.publicKey = remoteMember.publicKey;
          // Store signing public key from remote (trust-on-first-use: accept if not set yet)
          if (remoteMember.signingPublicKey && !existing.signingPublicKey) {
            existing.signingPublicKey = remoteMember.signingPublicKey;
          }
          // SECURITY: Only sync role from remote if the sender is the workspace owner.
          // This prevents a rogue peer from escalating their own privileges via workspace-state sync.
          if (remoteMember.role && this.workspaceManager.isOwner(localWs.id, peerId)) {
            const validRoles = ['owner', 'admin', 'member'];
            if (validRoles.includes(remoteMember.role)) {
              existing.role = remoteMember.role;
            }
          }

          // Multi-device: sync identityId and device list
          if (remoteMember.identityId && !existing.identityId) {
            existing.identityId = remoteMember.identityId;
          }
          if (Array.isArray(remoteMember.devices) && remoteMember.devices.length > 0) {
            existing.devices = remoteMember.devices;
          }
          // Sync bot flag (self-declared by agent peers)
          if (remoteMember.isBot && !existing.isBot) {
            existing.isBot = true;
          }
        }

        // Multi-device: populate device registry from synced member data
        if (remoteMember.identityId && Array.isArray(remoteMember.devices)) {
          for (const device of remoteMember.devices) {
            this.deviceRegistry.addDevice(remoteMember.identityId, device);
          }
        }
      }
    }

    // Bug 1 fix: connect to workspace members we haven't connected to yet.
    // When Mary joins via Bob, Bob's workspace-state tells Mary about Alice,
    // but without an explicit connect() Mary never opens a WebRTC connection to Alice.
    // Guard connectingPeers to avoid duplicate in-flight connect() calls when
    // multiple peers send workspace-state in quick succession.
    for (const member of localWs.members) {
      if (
        member.peerId !== this.state.myPeerId &&
        !this.state.connectedPeers.has(member.peerId) &&
        !this.state.connectingPeers.has(member.peerId)
      ) {
        this.state.connectingPeers.add(member.peerId);
        this.ui?.updateSidebar();
        this.transport.connect(member.peerId).catch(() => {});
        setTimeout(() => {
          if (!this.state.connectedPeers.has(member.peerId)) {
            this.state.connectingPeers.delete(member.peerId);
            this.ui?.updateSidebar();
          }
        }, 4000);
      }
    }

    // Persist updated workspace state
    await this.persistWorkspace(localWs.id);
    this.ui?.renderApp();
    console.log(`[Sync] Workspace state synced from ${peerId.slice(0, 8)}`);

    // If we are the owner, send back our full workspace state so the joiner
    // gets all channels/members (their provisional workspace only has #general).
    if (this.workspaceManager.isOwner(localWs.id, this.state.myPeerId)) {
      this.sendWorkspaceState(peerId, localWs.id);
    }
  }

  /**
   * DEP-002: Try to connect to high-ranked servers we're not yet connected to
   */
  private async connectToDiscoveredServers(discovery: ServerDiscovery): Promise<void> {
    const ranked = discovery.getRankedServers();
    const currentServers = this.transport.getSignalingStatus().map((s: { url: string }) => s.url);

    // Try to connect to top 3 servers we're not connected to
    let attempted = 0;
    for (const server of ranked) {
      if (attempted >= 3) break;
      if (currentServers.includes(server.url)) continue;

      attempted++;
      // Don't await - connect in background
      this.transport.addSignalingServer(server.url, `PEX:${server.url}`).then((success: boolean) => {
        if (success) {
          discovery.recordSuccess(server.url, 100); // Assume 100ms latency for now
          this.saveServerDiscovery(discovery.toJSON().workspaceId);
        } else {
          discovery.recordFailure(server.url);
          this.saveServerDiscovery(discovery.toJSON().workspaceId);
        }
      });
    }
  }

  // =========================================================================
  // DEP-002: Peer Exchange (PEX)
  // =========================================================================

  /**
   * Get or create ServerDiscovery for a workspace
   */
  private getServerDiscovery(workspaceId: string, primaryServer: string): ServerDiscovery {
    if (!this.serverDiscovery.has(workspaceId)) {
      const discovery = new ServerDiscovery(workspaceId, primaryServer);
      this.serverDiscovery.set(workspaceId, discovery);
    }
    return this.serverDiscovery.get(workspaceId)!;
  }

  /**
   * Start periodic PEX broadcasts (every 5 minutes)
   */
  startPEXBroadcasts(): void {
    if (this.pexBroadcastInterval) return;

    const broadcastPEX = () => {
      for (const [workspaceId, discovery] of this.serverDiscovery) {
        const servers = discovery.getHandshakeServers();
        if (servers.length === 0) continue;

        // Broadcast to all connected peers in this workspace
        const connectedPeers = Array.from(this.state.connectedPeers);
        for (const peerId of connectedPeers) {
          this.transport.send(peerId, {
            type: 'workspace-sync',
            workspaceId,
            sync: {
              type: 'peer-exchange',
              servers,
            },
          });
        }
      }
    };

    // Broadcast every 5 minutes
    this.pexBroadcastInterval = window.setInterval(broadcastPEX, 5 * 60 * 1000);
    console.log('[PEX] Started periodic broadcasts (every 5 minutes)');
  }

  /**
   * Stop periodic PEX broadcasts
   */
  stopPEXBroadcasts(): void {
    if (this.pexBroadcastInterval) {
      clearInterval(this.pexBroadcastInterval);
      this.pexBroadcastInterval = null;
    }
    // Also stop maintenance timers
    if (this._quotaCheckInterval) {
      clearInterval(this._quotaCheckInterval);
      this._quotaCheckInterval = null;
    }
    if (this._peerMaintenanceInterval) {
      clearInterval(this._peerMaintenanceInterval);
      this._peerMaintenanceInterval = null;
    }
    if (this._gossipCleanupInterval) {
      clearInterval(this._gossipCleanupInterval);
      this._gossipCleanupInterval = null;
    }
  }

  // =========================================================================
  // T2.4: Storage Quota Management
  // =========================================================================

  /**
   * Check current storage usage and auto-prune if needed.
   * Call once on startup and every 24h thereafter.
   */
  async checkStorageQuota(): Promise<void> {
    const status = await this.storageQuota.check();
    if (!status.isPruneNeeded && !status.isWarning) return;

    const usedPct = Math.round(status.usageFraction * 100);

    if (status.isPruneNeeded) {
      console.warn(`[StorageQuota] Usage at ${usedPct}% — auto-pruning old messages`);
      const result = await this.storageQuota.prune(this.persistentStore, this.workspaceManager);
      if (result.messagesDeleted > 0) {
        const used = StorageQuotaManager.formatBytes(status.usageBytes);
        const quota = StorageQuotaManager.formatBytes(status.quotaBytes);
        this.ui?.showToast(
          `Storage was ${usedPct}% full (${used}/${quota}). Pruned ${result.messagesDeleted} old messages across ${result.channelsPruned} channel(s).`,
          'info',
        );
      }
    } else if (status.isWarning) {
      const used = StorageQuotaManager.formatBytes(status.usageBytes);
      const quota = StorageQuotaManager.formatBytes(status.quotaBytes);
      console.warn(`[StorageQuota] Usage at ${usedPct}% — approaching limit (${used} / ${quota})`);
      this.ui?.showToast(
        `Storage usage is high (${usedPct}%). Consider clearing old messages in Settings.`,
        'info',
      );
    }
  }

  /** Start periodic storage quota checks (every 24h) */
  startQuotaChecks(): void {
    if (this._quotaCheckInterval) return;
    // Check immediately, then every 24 hours
    void this.checkStorageQuota();
    this._quotaCheckInterval = setInterval(() => {
      void this.checkStorageQuota();
    }, 24 * 60 * 60 * 1000);
  }

  // =========================================================================
  // T2.5: Proactive Peer Maintenance
  // =========================================================================

  /** Start the peer maintenance sweep (every 60s) */
  startPeerMaintenance(): void {
    if (this._peerMaintenanceInterval) return;
    // Run immediately, then every 20 s.
    // 20 s is fast enough to recover from a simultaneous dual-browser refresh
    // (where both browsers finish loading within a few seconds of each other)
    // without generating excessive signaling traffic.
    this._runPeerMaintenance();
    this._peerMaintenanceInterval = setInterval(() => {
      this._runPeerMaintenance();
    }, 20_000);
  }

  /** Number of known workspace peers (excluding self) that should be connected. */
  getExpectedWorkspacePeerCount(): number {
    const peerIds = new Set<string>();
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      for (const member of ws.members) {
        if (member.peerId && member.peerId !== this.state.myPeerId) {
          peerIds.add(member.peerId);
        }
      }
    }
    return peerIds.size;
  }

  /** Public one-shot maintenance hook for startup/resume reconnect bootstrap. */
  runPeerMaintenanceNow(reason = 'manual'): number {
    const attempted = this._runPeerMaintenance();
    if (attempted > 0) {
      console.log(`[Maintenance] ${reason}: attempted reconnect to ${attempted} peer(s)`);
    }
    return attempted;
  }

  /**
   * Safety fallback: if signaling appears fully down after startup/resume,
   * reinitialize the transport once with cooldown to avoid reconnect storms.
   */
  async reinitializeTransportIfStuck(reason = 'manual'): Promise<boolean> {
    if (this.transportReinitInFlight) return this.transportReinitInFlight;
    const now = Date.now();
    if (now - this.lastTransportReinitAt < 15_000) return false;

    this.transportReinitInFlight = (async () => {
      this.lastTransportReinitAt = Date.now();
      try {
        const connectedPeers = this.transport.getConnectedPeers().length;
        if (connectedPeers > 0) return false;

        const signalingStatus = typeof this.transport.getSignalingStatus === 'function'
          ? this.transport.getSignalingStatus()
          : [];
        const allSignalingDown = signalingStatus.length > 0 && signalingStatus.every((s: any) => !s.connected);
        if (!allSignalingDown) return false;

        console.warn(`[Reconnect] Reinitializing transport (${reason})`);
        await this.recreateTransportAndInit(this.state.myPeerId || undefined, `stuck:${reason}`);
        this.runPeerMaintenanceNow(`post-reinit:${reason}`);
        return true;
      } catch (error) {
        console.warn('[Reconnect] Transport reinit failed:', (error as Error).message);
        return false;
      } finally {
        this.transportReinitInFlight = null;
      }
    })();

    return this.transportReinitInFlight;
  }

  // =========================================================================
  // T3.2: Gossip Propagation
  // =========================================================================

  /**
   * Relay a received workspace message to connected peers who might not have
   * received it from the original sender (partial mesh scenario).
   *
   * Strategy:
   *   - Re-encrypt the plaintext for each eligible relay target
   *   - Include _originalMessageId so recipients can dedup
   *   - Limit depth with GOSSIP_TTL (default: 2 hops)
   *
   * Overhead in full mesh: near-zero (every peer is already directly connected
   * to the sender; no session established with relay → skipped). CRDT dedup
   * handles the rare duplicate if two paths both deliver the same message.
   */
  private async _gossipRelay(
    fromPeerId: string,
    originalMsgId: string,
    originalSenderId: string,
    plaintext: string,
    channelId: string,
    envelope: any,
  ): Promise<void> {
    if (!this.messageProtocol) return;

    const hop = (envelope._gossipHop ?? 0) + 1;
    if (hop > ChatController.GOSSIP_TTL) return;

    // Fix #4: look up the workspace the message belongs to, not just the active one.
    // A background workspace message should still be relayed correctly.
    // NOTE: do NOT fall back to '' — empty string is falsy but serializes as '""' on the wire,
    // which confuses the receiver's isDirect detection. Use null so the property is absent/null.
    const workspaceId: string | null = (envelope.workspaceId as string | undefined | null)
      ?? this.state.activeWorkspaceId
      ?? null;
    const ws = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : null;
    if (!ws) return;

    const connectedPeers = new Set(this.transport.getConnectedPeers());

    for (const member of ws.members) {
      const targetPeerId = member.peerId;
      if (targetPeerId === this.state.myPeerId) continue;  // skip self
      if (targetPeerId === fromPeerId) continue;           // don't send back to relay source
      if (targetPeerId === originalSenderId) continue;     // don't send back to original author
      if (!connectedPeers.has(targetPeerId)) continue;     // must be reachable
      if (!this.messageProtocol.hasSharedSecret(targetPeerId)) continue; // need session

      try {
        const relayEnv = await this.messageProtocol.encryptMessage(
          targetPeerId, plaintext, 'text',
          envelope.metadata,
        );
        // Attach relay metadata (unencrypted, alongside the encrypted payload)
        (relayEnv as any).messageId = originalMsgId;             // canonical ID — ensures all peers store same msg.id for reaction sync
        (relayEnv as any).channelId = channelId;
        (relayEnv as any).workspaceId = workspaceId;
        (relayEnv as any).threadId = envelope.threadId;
        (relayEnv as any).vectorClock = envelope.vectorClock;
        if (envelope.attachments?.length) {
          (relayEnv as any).attachments = envelope.attachments;  // carry thumbnail + metadata through relay hops
        }
        if (envelope.threadRootSnapshot) {
          (relayEnv as any).threadRootSnapshot = envelope.threadRootSnapshot;  // carry thread root through relay
        }
        (relayEnv as any)._originalMessageId = originalMsgId;    // dedup key (checked before decryption)
        (relayEnv as any)._gossipOriginalSender = originalSenderId; // real author
        (relayEnv as any)._gossipHop = hop;
        this.transport.send(targetPeerId, relayEnv);
      } catch {
        // Best-effort — ignore relay failures silently
      }
    }
  }

  /** Start cleanup sweep for the gossip seen-set (every 5 minutes) */
  startGossipCleanup(): void {
    if (this._gossipCleanupInterval) return;
    const FIVE_MIN = 5 * 60 * 1000;
    this._gossipCleanupInterval = setInterval(() => {
      const cutoff = Date.now() - FIVE_MIN;
      for (const [id, ts] of this._gossipSeen) {
        if (ts < cutoff) this._gossipSeen.delete(id);
      }
    }, FIVE_MIN);
  }

  // =========================================================================
  // Workspace Peer Registry (signaling server discovery)
  // =========================================================================

  /**
   * Build the HTTP base URL of the signaling server for workspace registry API.
   * Converts ws:// → http:// and wss:// → https://.
   */
  private getSignalingHttpBase(): string {
    const wsUrl = getDefaultSignalingServer();
    const httpUrl = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    // Strip trailing /peerjs path and trailing slashes
    return httpUrl.replace(/\/peerjs\/?$/, '').replace(/\/+$/, '');
  }

  /**
   * Register this peer in the signaling server's workspace registry.
   * Called after transport init and workspace restore.
   * @param workspaceId - workspace to register in
   */
  async registerWorkspacePeer(workspaceId: string): Promise<void> {
    if (!this.state.myPeerId) return;
    const base = this.getSignalingHttpBase();
    try {
      await fetch(`${base}/workspace/${encodeURIComponent(workspaceId)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: this.state.myPeerId }),
      });
    } catch (err) {
      // Best-effort — signaling server may not support registry yet
      console.warn(`[Registry] Failed to register in workspace ${workspaceId.slice(0, 8)}:`, (err as Error)?.message);
    }
  }

  /**
   * Register this peer in all known workspaces.
   * Called once after transport init + workspace restore.
   */
  registerAllWorkspaces(): void {
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      void this.registerWorkspacePeer(ws.id);
    }
  }

  /**
   * Discover online peers for a workspace from the signaling server registry.
   * @param workspaceId - workspace to query
   * @returns Array of online peer IDs (may be empty if server doesn't support registry)
   */
  async discoverWorkspacePeers(workspaceId: string): Promise<string[]> {
    const base = this.getSignalingHttpBase();
    try {
      const res = await fetch(`${base}/workspace/${encodeURIComponent(workspaceId)}/peers`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.peers) ? data.peers : [];
    } catch {
      // Signaling server may not support registry — fail silently
      return [];
    }
  }

  /**
   * Proactive peer maintenance sweep — attempts to connect to any workspace
   * member we're not currently connected to.
   *
   * Complements PeerTransport's auto-reconnect (which only fires on connection
   * drop) by also reaching out to members we've never connected to.
   */
  private _runPeerMaintenance(): number {
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    if (!ws) return 0;

    const connectedPeers = new Set(this.transport.getConnectedPeers());
    const now = Date.now();
    let attempted = 0;

    for (const member of ws.members) {
      if (member.peerId === this.state.myPeerId) continue;
      if (connectedPeers.has(member.peerId)) {
        // Even when transport still thinks a peer is connected, traffic can be
        // dropped during relay outages. Periodic sync closes those gaps.
        if (this.state.readyPeers.has(member.peerId)) {
          const last = this.lastMessageSyncRequestAt.get(member.peerId) ?? 0;
          if (now - last >= 10_000) {
            this.lastMessageSyncRequestAt.set(member.peerId, now);
            this.requestMessageSync(member.peerId).catch(err => {
              console.warn('[Maintenance] Periodic message sync failed:', err);
            });
          }
        }
        continue;
      }
      // Use the transport's own in-flight state (connectingTo + pending reconnect
      // timers) instead of app-level connectingPeers, which can go stale when
      // connect() returns immediately (dedup early-return, no catch fired).
      if (typeof this.transport.isConnectingToPeer === 'function' &&
          this.transport.isConnectingToPeer(member.peerId)) {
        this.state.connectingPeers.add(member.peerId); // keep UI in sync
        continue;
      }

      attempted++;
      this.state.connectingPeers.add(member.peerId);
      this.ui?.updateSidebar();
      // Stop the pulsating indicator quickly — if the peer doesn't answer in
      // 4s, show them as offline rather than spinning forever. PeerTransport
      // keeps retrying silently in the background; onConnect will light them
      // up green the moment they come back.
      setTimeout(() => {
        if (!this.state.connectedPeers.has(member.peerId)) {
          this.state.connectingPeers.delete(member.peerId);
          this.ui?.updateSidebar();
        }
      }, 4000);
      this.transport.connect(member.peerId).catch(() => { /* retries handled by PeerTransport */ });
    }

    if (attempted > 0) {
      console.log(`[Maintenance] Attempting reconnect to ${attempted} workspace member(s)`);
    }
    return attempted;
  }

  /**
   * Save ServerDiscovery state to IndexedDB
   */
  private async saveServerDiscovery(workspaceId: string): Promise<void> {
    const discovery = this.serverDiscovery.get(workspaceId);
    if (!discovery) return;

    const json = discovery.toJSON();
    await this.persistentStore.saveSetting(`pex:${workspaceId}`, JSON.stringify(json));
  }

  /**
   * Restore ServerDiscovery state from IndexedDB
   */
  private async restoreServerDiscovery(workspaceId: string, primaryServer: string): Promise<void> {
    const saved = await this.persistentStore.getSetting(`pex:${workspaceId}`);
    if (!saved) {
      // No saved state, create new
      this.getServerDiscovery(workspaceId, primaryServer);
      return;
    }

    try {
      const json = JSON.parse(saved);
      const discovery = ServerDiscovery.fromJSON(json, primaryServer);
      this.serverDiscovery.set(workspaceId, discovery);
      console.log(`[PEX] Restored ${discovery.getRankedServers().length} servers for workspace ${workspaceId}`);
    } catch (err) {
      console.error('[PEX] Failed to restore server discovery:', err);
      this.getServerDiscovery(workspaceId, primaryServer);
    }
  }

  // =========================================================================
  // Persistence
  // =========================================================================

  private schedulePersistReactions(): void {
    if (this.reactionsPersistTimer) clearTimeout(this.reactionsPersistTimer);
    this.reactionsPersistTimer = setTimeout(() => {
      this.reactionsPersistTimer = null;
      void this.persistSetting('reactions', this.reactions.toJSON());
    }, 200);
  }

  /** Re-render persisted reactions into currently visible DOM message slots. */
  syncReactionsToDOM(): void {
    const nodes = document.querySelectorAll<HTMLElement>('[id^="reactions-"]');
    nodes.forEach((el) => {
      const messageId = el.id.slice('reactions-'.length);
      if (!messageId) return;
      el.innerHTML = this.reactions.renderReactions(messageId, this.state.myPeerId);
      el.querySelectorAll('.reaction-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          const emoji = (btn as HTMLElement).dataset.emoji!;
          this.toggleReaction(messageId, emoji);
        });
      });
    });
  }

  async restoreFromStorage(): Promise<void> {
    const savedAlias = await this.persistentStore.getSetting('myAlias');
    if (savedAlias) this.state.myAlias = savedAlias;

    // Restore thread root snapshots from IndexedDB
    const savedThreadRoots = await this.persistentStore.getSetting('threadRoots');
    if (savedThreadRoots && typeof savedThreadRoots === 'object') {
      for (const [threadId, snapshot] of Object.entries(savedThreadRoots)) {
        if (snapshot && typeof snapshot === 'object') {
          this.messageStore.setThreadRoot(threadId, snapshot as PlaintextMessage);
        }
      }
    }

    // Restore activity feed from IndexedDB
    const savedActivity = await this.persistentStore.getSetting('activityItems');
    if (Array.isArray(savedActivity)) {
      this.activityItems = savedActivity;
    }

    const savedWsAliases = await this.persistentStore.getSetting('workspaceAliases');
    if (savedWsAliases) {
      try { this.state.workspaceAliases = JSON.parse(savedWsAliases); } catch {}
    }

    const workspaces = await this.persistentStore.getAllWorkspaces();
    console.log('[DecentChat] restoreFromStorage: found', workspaces.length, 'workspaces');
    for (const ws of workspaces) {
      this.workspaceManager.importWorkspace(ws);

      // DEP-002: Restore server discovery for this workspace
      await this.restoreServerDiscovery(ws.id, getDefaultSignalingServer());

      for (const channel of ws.channels) {
        const messages = await this.persistentStore.getChannelMessages(channel.id);
        const crdt = this.getOrCreateCRDT(channel.id);
        for (const msg of messages) {
          try {
            this.messageStore.forceAdd(msg);
          } catch {}
          // Clear streaming flag on recovered messages (interrupted streams)
          if ((msg as any).streaming) {
            (msg as any).streaming = false;
            this.persistMessage(msg).catch(() => {});
          }
          try {
            const crdtMsg = {
              id: msg.id,
              channelId: msg.channelId,
              senderId: msg.senderId,
              content: msg.content,
              type: (msg.type || 'text') as any,
              vectorClock: msg.vectorClock || {},
              wallTime: msg.timestamp,
              prevHash: msg.prevHash || '',
            };
            crdt.addMessage(crdtMsg);
          } catch {}
          // Register attachment metadata in MediaStore for images sent by us
          if ((msg as any).attachments?.length) {
            for (const att of (msg as any).attachments) {
              // Only register if not already present (blob may or may not exist)
              if (!this.mediaStore.getAttachment(att.id)) {
                // Check if blob exists locally (for attachments we sent)
                const blobKey = `media:${ws.id}:${att.id}`;
                this.blobStorage.has(blobKey).then(hasBlob => {
                  this.mediaStore.registerMeta(ws.id, att, hasBlob ? 'available' : 'pruned');
                }).catch(() => {
                  this.mediaStore.registerMeta(ws.id, att, 'pruned');
                });
              }
            }
          }
        }
      }
    }

    const savedReactions = await this.persistentStore.getSetting('reactions');
    if (savedReactions) {
      this.reactions.loadFromJSON(savedReactions);
    }

    // DEP-002: Start periodic PEX broadcasts
    if (workspaces.length > 0) {
      this.startPEXBroadcasts();
      this.startPeerMaintenance();  // T2.5
      this.startQuotaChecks();      // T2.4
      this.startGossipCleanup();    // T3.2
    }
  }

  async persistWorkspace(workspaceId: string): Promise<void> {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (ws) {
      await this.persistentStore.saveWorkspace(
        this.workspaceManager.exportWorkspace(workspaceId),
      );
    }
  }

  async persistMessage(msg: PlaintextMessage): Promise<void> {
    await this.persistentStore.saveMessage(msg);
  }

  async persistSetting(key: string, value: unknown): Promise<void> {
    await this.persistentStore.saveSetting(key, value);

    // Keep aggregate app-settings in sync (SettingsPanel reads via getSettings()).
    if (key !== 'app-settings') {
      const current = await this.persistentStore.getSettings<Record<string, any>>({});
      await this.persistentStore.saveSettings({ ...current, [key]: value });
    }

    if (key === 'myAlias' && typeof value === 'string' && value.trim()) {
      const alias = value.trim();
      this.state.myAlias = alias;

      // Update our member entry in the active workspace
      const wsId = this.state.activeWorkspaceId;
      if (wsId) {
        const ws = this.workspaceManager.getWorkspace(wsId);
        if (ws) {
          const myMember = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
          if (myMember) myMember.alias = alias;
          this.persistWorkspace(wsId).catch(() => {});
        }

        // Announce new name to connected peers
        const targets = this.getWorkspaceRecipientPeerIds();
        for (const peerId of targets) {
          if (this.state.readyPeers.has(peerId)) {
            this.sendControlWithRetry(peerId, { type: 'name-announce', workspaceId: wsId, alias }, { label: 'name-announce' });
          }
        }
      }

      // Refresh sidebar and messages so own name updates immediately
      this.ui?.updateSidebar();
      this.ui?.renderMessages();
    }

  }

  async getSettings(): Promise<any> {
    return this.persistentStore.getSettings<any>({});
  }

  // =========================================================================
  // Thread Root Snapshots
  // =========================================================================

  /**
   * Ensure a thread root snapshot exists for the given threadId.
   * Creates a copy of the parent message so the thread is self-contained
   * even if the parent is later compacted from the channel.
   */
  private async ensureThreadRoot(threadId: string, channelId: string): Promise<PlaintextMessage | undefined> {
    if (this.messageStore.getThreadRoot(threadId)) {
      return this.messageStore.getThreadRoot(threadId);
    }

    const allMsgs = this.messageStore.getMessages(channelId);
    const parent = allMsgs.find(m => m.id === threadId);
    if (!parent) return undefined;

    const snapshot: PlaintextMessage = {
      id: parent.id,
      channelId: parent.channelId,
      senderId: parent.senderId,
      timestamp: parent.timestamp,
      content: parent.content,
      type: parent.type,
      prevHash: '',
      status: 'sent',
    };
    if ((parent as any).senderIdentityId) {
      (snapshot as any).senderIdentityId = (parent as any).senderIdentityId;
    }
    if ((parent as any).attachments) {
      (snapshot as any).attachments = (parent as any).attachments;
    }

    this.messageStore.setThreadRoot(threadId, snapshot);
    await this.persistThreadRoots();
    return snapshot;
  }

  /**
   * Create a thread root from a received envelope's snapshot data.
   * Used when the receiver doesn't have the parent message (e.g., joined late or compacted).
   */
  private async ensureThreadRootFromSnapshot(
    threadId: string,
    channelId: string,
    snapshot: { senderId?: string; senderIdentityId?: string; content?: string; timestamp?: number; attachments?: any[] },
  ): Promise<void> {
    if (this.messageStore.getThreadRoot(threadId)) return;

    // Try local parent first
    const allMsgs = this.messageStore.getMessages(channelId);
    const parent = allMsgs.find(m => m.id === threadId);
    if (parent) {
      await this.ensureThreadRoot(threadId, channelId);
      return;
    }

    // Build from snapshot
    const root: PlaintextMessage = {
      id: threadId,
      channelId,
      senderId: snapshot.senderId || 'unknown',
      timestamp: snapshot.timestamp || Date.now(),
      content: snapshot.content || '',
      type: 'text',
      prevHash: '',
      status: 'sent',
    };
    if (snapshot.senderIdentityId) (root as any).senderIdentityId = snapshot.senderIdentityId;
    if (snapshot.attachments) (root as any).attachments = snapshot.attachments;

    this.messageStore.setThreadRoot(threadId, root);
    await this.persistThreadRoots();
  }

  /** Persist all thread roots to IndexedDB. */
  private async persistThreadRoots(): Promise<void> {
    const roots = this.messageStore.getAllThreadRoots();
    const obj: Record<string, any> = {};
    for (const [id, snapshot] of roots) {
      obj[id] = snapshot;
    }
    await this.persistentStore.saveSetting('threadRoots', obj);
  }

  // =========================================================================
  // Send
  // =========================================================================

  async sendMessage(content: string, threadId?: string): Promise<void> {
    if (!content.trim() || !this.state.activeChannelId) return;

    const msg = await this.messageStore.createMessage(
      this.state.activeChannelId,
      this.state.myPeerId,
      content.trim(),
      'text',
      threadId,
    );
    if (this.myIdentityId) (msg as any).senderIdentityId = this.myIdentityId;

    const result = await this.messageStore.addMessage(msg);
    if (!result.success) {
      this.ui?.showToast('Failed to create message: ' + result.error, 'error');
      return;
    }

    const crdt = this.getOrCreateCRDT(this.state.activeChannelId);
    const crdtMsg = crdt.createMessage(this.state.activeChannelId, content.trim(), 'text', threadId);
    (msg as any).vectorClock = crdtMsg.vectorClock;

    await this.persistMessage(msg);

    // Ensure thread root snapshot exists so the thread is self-contained
    if (threadId) {
      await this.ensureThreadRoot(threadId, this.state.activeChannelId);
    }

    if (threadId && this.state.threadOpen) {
      this.ui?.renderThreadMessages();
    } else if (!threadId) {
      this.ui?.appendMessageToDOM(msg, true);
    }
    // Update reply count on parent message for the sender (peer events handle remote side)
    if (threadId) {
      this.ui?.updateThreadIndicator(threadId, this.state.activeChannelId);
    }

    // Deliver to workspace peers (or queue if offline)
    // Snapshot recipients at send-time for deterministic group ACK semantics.
    const recipientPeerIds = this.getWorkspaceRecipientPeerIds();
    (msg as any).recipientPeerIds = recipientPeerIds;
    (msg as any).ackedBy = [] as string[];
    (msg as any).ackedAt = {} as Record<string, number>;
    (msg as any).readBy = [] as string[];
    (msg as any).readAt = {} as Record<string, number>;

    let attemptedDispatch = false;
    for (const peerId of recipientPeerIds) {
      try {
        // If peer is offline and ratchet state is not loaded (e.g. after page refresh),
        // restore it from persistence so we can encrypt and queue the message.
        if (!this.state.readyPeers.has(peerId)) {
          const hasRatchet = this.messageProtocol!.hasRatchetState(peerId);
          if (!hasRatchet) {
            await this.messageProtocol!.restoreRatchetState(peerId);
          }
        }

        const envelope = await this.messageProtocol!.encryptMessage(peerId, content.trim(), 'text');
        (envelope as any).channelId = this.state.activeChannelId;
        (envelope as any).workspaceId = this.state.activeWorkspaceId;
        (envelope as any).threadId = threadId;
        (envelope as any).vectorClock = (msg as any).vectorClock;
        (envelope as any).messageId = msg.id; // For reaction targeting — receiver must use same ID

        // Include thread root snapshot so receiver can reconstruct thread context
        if (threadId) {
          const threadRoot = this.messageStore.getThreadRoot(threadId);
          if (threadRoot) {
            (envelope as any).threadRootSnapshot = {
              senderId: threadRoot.senderId,
              senderIdentityId: (threadRoot as any).senderIdentityId,
              content: threadRoot.content,
              timestamp: threadRoot.timestamp,
              attachments: (threadRoot as any).attachments,
            };
          }
        }

        if (this.state.readyPeers.has(peerId)) {
          const sent = this.transport.send(peerId, envelope);
          // Reconnect race: readyPeers can be briefly stale after disconnect.
          // If transport rejects the send, persist to outbox instead of dropping.
          if (!sent) {
            await this.offlineQueue.enqueue(peerId, envelope);
          }
        } else {
          await this.offlineQueue.enqueue(peerId, envelope);
        }
        attemptedDispatch = true;
      } catch (err) {
        console.error('Send to', peerId, 'failed:', err);
        // Encryption failed (no ratchet state or shared secret — peer never connected
        // in this session). Queue a deferred plaintext message; flushOfflineQueue will
        // re-encrypt once the handshake completes on reconnect.
        try {
          await this.offlineQueue.enqueue(peerId, {
            _deferred: true,
            channelId: this.state.activeChannelId,
            workspaceId: this.state.activeWorkspaceId,
            threadId: threadId,
            content: content.trim(),
            messageId: msg.id,
            vectorClock: (msg as any).vectorClock,
          });
          attemptedDispatch = true;
        } catch (queueErr) {
          console.error("Failed to queue deferred message for", peerId, queueErr);
        }
      }
    }

    // DEP-005 (+group semantics): pending → sent once dispatched or queued for at least one recipient
    if (attemptedDispatch && msg.status !== 'sent' && msg.status !== 'delivered') {
      msg.status = 'sent';
      await this.persistentStore.saveMessage({
        ...msg,
        status: 'sent',
        recipientPeerIds,
        ackedBy: [],
        ackedAt: {},
        readBy: [],
        readAt: {},
      });
      this.ui?.updateMessageStatus?.(msg.id, 'sent', { acked: 0, total: recipientPeerIds.length });
    }

  }

  // =========================================================================
  // Workspace / channel helpers (delegated to by UIService callbacks)
  // =========================================================================

  createWorkspace(name: string, alias: string): Workspace {
    const ws = this.workspaceManager.createWorkspace(
      name,
      this.state.myPeerId,
      alias,
      this.myPublicKey,
    );

    // DEP-002: Initialize server discovery for new workspace
    const defaultServer = getDefaultSignalingServer();
    this.getServerDiscovery(ws.id, defaultServer);
    this.startPEXBroadcasts();
    this.startPeerMaintenance();  // T2.5
    this.startQuotaChecks();      // T2.4
    this.startGossipCleanup();    // T3.2

    return ws;
  }

  private async connectPeerWithRetry(peerId: string, reason: string, attempts = 6): Promise<void> {
    if (!peerId || peerId === this.state.myPeerId) return;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (this.state.connectedPeers.has(peerId)) return;
      try {
        await this.transport.connect(peerId);
        return;
      } catch (err) {
        const isLast = attempt === attempts;
        const delayMs = Math.min(300 * (2 ** (attempt - 1)), 2_500);
        if (isLast) {
          console.warn(
            `[Connect] Failed to connect to ${peerId.slice(0, 8)} after ${attempts} attempts (${reason}):`,
            (err as Error)?.message ?? err,
          );
          return;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  async joinWorkspace(code: string, alias: string, peerId: string, inviteData?: InviteData): Promise<void> {
    console.log('[DecentChat] joinWorkspace called:', { code, alias, peerId, hasUI: !!this.ui });

    // ── Invite security validation ──────────────────────────────────────
    if (inviteData) {
      // Check expiration
      if (InviteURI.isExpired(inviteData)) {
        const msg = 'This invite link has expired';
        console.warn(`[DecentChat] ${msg}`);
        this.ui?.showToast(msg, 'error');
        return;
      }

      // Check revocation (when we already know this workspace locally)
      const knownWorkspace = (inviteData.workspaceId ? this.workspaceManager.getWorkspace(inviteData.workspaceId) : null)
        || this.workspaceManager.validateInviteCode(inviteData.inviteCode);
      if (inviteData.inviteId && knownWorkspace && this.workspaceManager.isInviteRevoked(knownWorkspace.id, inviteData.inviteId)) {
        const msg = 'This invite link has been revoked by an admin';
        console.warn(`[DecentChat] ${msg}`);
        this.ui?.showToast(msg, 'error');
        return;
      }

      // Check max uses (tracked in localStorage per invite code)
      if (inviteData.maxUses && inviteData.maxUses > 0) {
        const usageKey = `invite-usage:${inviteData.inviteCode}`;
        const currentUses = parseInt(localStorage.getItem(usageKey) || '0', 10);
        if (currentUses >= inviteData.maxUses) {
          const msg = 'This invite has reached its maximum uses';
          console.warn(`[DecentChat] ${msg}`);
          this.ui?.showToast(msg, 'error');
          return;
        }
        // Increment usage
        localStorage.setItem(usageKey, String(currentUses + 1));
      }

      // Verify signature if present (optional — unsigned invites still work for backward compat)
      if (inviteData.signature && inviteData.publicKey) {
        try {
          const { verifyInviteSignature } = await import('decent-protocol');
          const valid = await verifyInviteSignature(inviteData.publicKey, inviteData);
          if (!valid) {
            const msg = 'This invite link has an invalid signature — it may have been tampered with';
            console.warn(`[DecentChat] ${msg}`);
            this.ui?.showToast(msg, 'error');
            return;
          }
          console.log('[DecentChat] Invite signature verified ✓');
        } catch (err) {
          console.warn('[DecentChat] Failed to verify invite signature:', err);
          // Don't block join — verification failure is non-fatal for backward compat
        }
      }
    }

    // Create the workspace locally for the joining user
    const ws = this.workspaceManager.createWorkspace(
      code, // use invite code as workspace name (will be updated from peer)
      this.state.myPeerId,
      alias,
      this.myPublicKey,
      {
        inviteCode: code,
        workspaceId: inviteData?.workspaceId,
      },
    );

    // DEP-002: Initialize server discovery for joined workspace
    // Extract primary signaling server from invite data
    const primaryServer = inviteData
      ? `${inviteData.secure ? 'wss' : 'ws'}://${inviteData.host}:${inviteData.port}${inviteData.path || ''}`
      : getDefaultSignalingServer(); // Fallback to environment-appropriate server

    console.log(`[PEX] Initializing server discovery with primary: ${primaryServer}`);
    this.getServerDiscovery(ws.id, primaryServer);
    
    // Add fallback servers from invite
    if (inviteData?.fallbackServers && inviteData.fallbackServers.length > 0) {
      const discovery = this.serverDiscovery.get(ws.id)!;
      discovery.mergeReceivedServers(
        inviteData.fallbackServers.map(url => ({
          url,
          lastSeen: Date.now(),
          successRate: 0.9, // Assume good until proven otherwise
        }))
      );
      this.saveServerDiscovery(ws.id);
    }

    this.startPEXBroadcasts();
    this.startPeerMaintenance();  // T2.5
    this.startQuotaChecks();      // T2.4
    this.startGossipCleanup();    // T3.2

    // This is a JOINED workspace, not one we own.
    // Reassign ownership semantics so sync/permissions match canonical host workspace.
    ws.createdBy = peerId;
    const me = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
    if (me) me.role = 'member';

    // Bootstrap inviter as owner so incoming workspace-state from inviter is trusted.
    this.workspaceManager.addMember(ws.id, {
      peerId,
      alias: peerId.slice(0, 8),
      publicKey: inviteData?.publicKey || '',
      joinedAt: Date.now(),
      role: 'owner',
    });

    // Set as active workspace
    this.state.activeWorkspaceId = ws.id;
    this.state.activeChannelId = ws.channels[0]?.id || null;

    // Persist BEFORE rendering — if this fails the workspace would be lost on refresh
    await this.persistWorkspace(ws.id);

    // Render the app UI
    this.ui?.renderApp();

    // Register in the workspace registry for discovery
    void this.registerWorkspacePeer(ws.id);

    // Multi-peer join: try connecting to all candidate peers in parallel.
    // Collect: inviter peerId + invite peers + signaling-discovered peers.
    void this.connectToMultiplePeers(peerId, inviteData, ws.id);
  }

  /**
   * Connect to multiple candidate peers in parallel for resilient workspace join.
   * Collects peers from invite data and signaling server discovery, deduplicates,
   * and attempts all connections simultaneously.
   */
  private async connectToMultiplePeers(
    primaryPeerId: string,
    inviteData: InviteData | undefined,
    workspaceId: string,
  ): Promise<void> {
    // Collect all candidate peer IDs (deduplicated)
    const candidates = new Set<string>();
    candidates.add(primaryPeerId);

    // Add peers from invite data
    if (inviteData?.peers) {
      for (const p of inviteData.peers) {
        if (p && p !== this.state.myPeerId) candidates.add(p);
      }
    }

    // Discover additional peers from signaling server registry
    if (workspaceId) {
      try {
        const discovered = await this.discoverWorkspacePeers(workspaceId);
        for (const p of discovered) {
          if (p && p !== this.state.myPeerId) candidates.add(p);
        }
      } catch {
        // Best-effort — continue with invite peers only
      }
    }

    console.log(`[Join] Attempting parallel connect to ${candidates.size} candidate peer(s):`,
      Array.from(candidates).map(p => p.slice(0, 8)));

    // Connect to ALL candidates in parallel — first one that responds and
    // completes handshake wins. Workspace-state sync from any member is valid.
    const results = await Promise.allSettled(
      Array.from(candidates).map(p => this.connectPeerWithRetry(p, 'join-workspace'))
    );

    const connected = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    console.log(`[Join] Parallel connect results: ${connected} succeeded, ${failed} failed`);
  }

  connectPeer(peerId: string): void {
    void this.connectPeerWithRetry(peerId, 'manual-connect');
  }

  createChannel(name: string): { success: boolean; channel?: Channel; error?: string } {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    // Permission guard
    if (!this.workspaceManager.canCreateChannel(this.state.activeWorkspaceId, this.state.myPeerId)) {
      return { success: false, error: 'Only admins can create channels' };
    }

    const result = this.workspaceManager.createChannel(
      this.state.activeWorkspaceId,
      name,
      this.state.myPeerId,
    );
    if (result.success && result.channel) {
      // Broadcast to all connected workspace members so they see the new channel immediately
      const wsId = this.state.activeWorkspaceId;
      const channel = result.channel;
      for (const peerId of this.getWorkspaceRecipientPeerIds()) {
        this.transport.send(peerId, {
          type: 'workspace-sync',
          workspaceId: wsId,
          sync: { type: 'channel-created', channel },
        });
      }
    }
    return result;
  }

  getActivityItems() {
    return [...this.activityItems].sort((a, b) => b.timestamp - a.timestamp);
  }

  getActivityUnreadCount(): number {
    return this.activityItems.filter(i => !i.read).length;
  }

  markActivityRead(id: string): void {
    const item = this.activityItems.find(i => i.id === id);
    if (item) { item.read = true; this.persistActivity(); }
  }

  markAllActivityRead(): void {
    for (const item of this.activityItems) item.read = true;
    this.persistActivity();
  }

  markThreadActivityRead(channelId: string, threadId: string): void {
    let changed = false;
    for (const item of this.activityItems) {
      if (item.channelId === channelId && item.threadId === threadId && !item.read) {
        item.read = true;
        changed = true;
      }
    }
    if (changed) this.persistActivity();
  }

  private resolveWorkspaceIdByChannelId(channelId: string): string | null {
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      if (ws.channels.some((c: any) => c.id === channelId)) return ws.id;
    }
    return this.state.activeWorkspaceId || null;
  }

  private isMentioningMe(content: string, wsId: string | null): boolean {
    if (!content || !content.includes('@')) return false;

    const normalize = (v: string) => v.trim().toLowerCase();
    const mine = new Set<string>();

    const wsAlias = this.getMyAliasForWorkspace(wsId);
    if (wsAlias) {
      mine.add(normalize(wsAlias));
      for (const part of wsAlias.split(/\s+/)) if (part.trim()) mine.add(normalize(part));
    }
    if (this.state.myAlias) {
      mine.add(normalize(this.state.myAlias));
      for (const part of this.state.myAlias.split(/\s+/)) if (part.trim()) mine.add(normalize(part));
    }

    mine.add(normalize(this.state.myPeerId));
    mine.add(normalize(this.state.myPeerId.slice(0, 8)));

    const mentionTokens = content.match(/(^|\s)@[A-Za-z0-9_.\-]+/g) || [];
    for (const token of mentionTokens) {
      const value = normalize(token.replace(/^\s*@/, ''));
      if (mine.has(value)) return true;
    }
    return false;
  }

  private maybeRecordMentionActivity(msg: PlaintextMessage, channelId: string, wsId: string): void {
    if (msg.senderId === this.state.myPeerId) return;
    if (!this.isMentioningMe(msg.content || '', wsId)) return;

    const isCurrentlyOpen = this.state.activeChannelId === channelId && (!msg.threadId || (this.state.threadOpen && this.state.activeThreadId === msg.threadId));
    const id = `mention:${wsId}:${channelId}:${msg.id}`;
    if (this.activityItems.some(i => i.id === id)) return;

    this.activityItems.unshift({
      id,
      type: 'mention',
      workspaceId: wsId,
      channelId,
      threadId: msg.threadId || undefined,
      messageId: msg.id,
      actorId: msg.senderId,
      snippet: msg.content.slice(0, 140),
      timestamp: msg.timestamp,
      read: isCurrentlyOpen,
    });

    if (this.activityItems.length > 500) this.activityItems.length = 500;
    this.persistActivity();
  }

  private maybeRecordThreadActivity(msg: PlaintextMessage, channelId: string): void {
    const threadId = msg.threadId;
    if (!threadId) return;
    if (msg.senderId === this.state.myPeerId) return;

    const wsId = this.resolveWorkspaceIdByChannelId(channelId);
    if (!wsId) return;

    // If user is currently reading this thread, don't create unread activity.
    const isCurrentlyOpen = this.state.activeChannelId === channelId && this.state.threadOpen && this.state.activeThreadId === threadId;

    // One activity item per thread — update existing instead of accumulating.
    // Uses thread-level ID so multiple replies in the same thread merge into one entry.
    const threadActivityId = `thread:${wsId}:${channelId}:${threadId}`;
    const existingIdx = this.activityItems.findIndex(i => i.id === threadActivityId);

    if (existingIdx >= 0) {
      // Update existing entry with latest reply info and bump to top
      const existing = this.activityItems[existingIdx];
      existing.actorId = msg.senderId;
      existing.snippet = msg.content.slice(0, 140);
      existing.messageId = msg.id;
      existing.timestamp = msg.timestamp;
      if (!isCurrentlyOpen) existing.read = false; // re-mark as unread
      // Move to top
      this.activityItems.splice(existingIdx, 1);
      this.activityItems.unshift(existing);
    } else {
      this.activityItems.unshift({
        id: threadActivityId,
        type: 'thread-reply',
        workspaceId: wsId,
        channelId,
        threadId,
        messageId: msg.id,
        actorId: msg.senderId,
        snippet: msg.content.slice(0, 140),
        timestamp: msg.timestamp,
        read: isCurrentlyOpen,
      });
    }

    // Keep list bounded
    if (this.activityItems.length > 500) this.activityItems.length = 500;
    this.persistActivity();
  }

  /** Persist activity items to IndexedDB so they survive page refresh. */
  private persistActivity(): void {
    this.persistentStore.saveSetting('activityItems', this.activityItems).catch(() => {});
  }

  async removeChannel(channelId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.removeChannel(wsId, channelId, this.state.myPeerId);
    if (!result.success) return result;

    this.messageStore.clearChannel(channelId);
    this.messageCRDTs.delete(channelId);

    try {
      const messages = await this.persistentStore.getChannelMessages(channelId);
      if (messages.length > 0) {
        await this.persistentStore.deleteMessages(messages.map((m: any) => m.id));
      }
      const ws = this.workspaceManager.getWorkspace(wsId);
      if (ws) await this.persistentStore.saveWorkspace(ws);
    } catch (err) {
      console.error('[Workspace] Failed to persist cleanup after removeChannel:', err);
    }

    if (this.state.activeChannelId === channelId) {
      const ws = this.workspaceManager.getWorkspace(wsId);
      const fallback = ws?.channels.find((c: Channel) => c.type === 'channel') || ws?.channels[0] || null;
      this.state.activeChannelId = fallback?.id || null;
    }

    for (const peerId of this.getWorkspaceRecipientPeerIds()) {
      this.transport.send(peerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'channel-removed', channelId, removedBy: this.state.myPeerId },
      });
    }

    this.ui?.updateSidebar();
    this.ui?.updateChannelHeader();
    this.ui?.renderMessages();
    this.ui?.updateComposePlaceholder?.();

    return { success: true };
  }

  createDM(peerId: string): { success: boolean; channel?: Channel } {
    if (!this.state.activeWorkspaceId) return { success: false };
    return this.workspaceManager.createDM(
      this.state.activeWorkspaceId,
      this.state.myPeerId,
      peerId,
    );
  }

  private async cleanupWorkspaceLocalState(wsId: string, workspaceSnapshot?: Workspace | null): Promise<boolean> {
    const ws = workspaceSnapshot || this.workspaceManager.getWorkspace(wsId);
    if (!ws) return false;

    const channelIds = ws.channels.map((ch) => ch.id);

    for (const channelId of channelIds) {
      this.messageStore.clearChannel(channelId);
      this.messageCRDTs.delete(channelId);
    }

    try {
      for (const channelId of channelIds) {
        const messages = await this.persistentStore.getChannelMessages(channelId);
        if (messages.length > 0) {
          await this.persistentStore.deleteMessages(messages.map((m: any) => m.id));
        }
      }
      await this.persistentStore.deleteWorkspace(wsId);
    } catch (err) {
      console.error('[Workspace] Failed to delete persisted workspace data:', err);
      return false;
    }

    if (this.state.workspaceAliases?.[wsId]) {
      delete this.state.workspaceAliases[wsId];
      await this.persistentStore.saveSetting('workspaceAliases', JSON.stringify(this.state.workspaceAliases));
    }

    if (this.state.activeWorkspaceId === wsId) {
      this.state.activeWorkspaceId = null;
      this.state.activeChannelId = null;
      this.state.activeThreadId = null;
      this.state.threadOpen = false;
    }

    return true;
  }

  async deleteWorkspace(wsId: string): Promise<boolean> {
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return false;

    const deleted = this.workspaceManager.deleteWorkspace(wsId, this.state.myPeerId);
    if (!deleted) return false;

    const recipients = ws.members
      .map((m: any) => m.peerId)
      .filter((peerId: string) => peerId !== this.state.myPeerId && this.state.connectedPeers.has(peerId));

    for (const peerId of recipients) {
      this.transport.send(peerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'workspace-deleted', workspaceId: wsId, deletedBy: this.state.myPeerId },
      });
    }

    const ok = await this.cleanupWorkspaceLocalState(wsId, ws);
    if (ok) {
      this.ui?.updateWorkspaceRail?.();
      this.ui?.updateSidebar();
      this.ui?.updateChannelHeader();
      this.ui?.renderMessages();
      this.ui?.updateComposePlaceholder?.();
    }
    return ok;
  }

  async leaveWorkspace(wsId: string): Promise<{ success: boolean; error?: string }> {
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return { success: false, error: 'Workspace not found' };

    const me = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
    if (!me) return { success: false, error: 'You are not a member of this workspace' };

    if (me.role === 'owner') {
      return { success: false, error: 'Owner cannot leave workspace. Transfer ownership or delete workspace.' };
    }

    const timestamp = Date.now();

    // Broadcast voluntary leave event to connected members.
    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: {
          type: 'member-left',
          peerId: this.state.myPeerId,
          timestamp,
        },
      });
    }

    // Remove locally and purge all persisted workspace data.
    ws.members = ws.members.filter((m: any) => m.peerId !== this.state.myPeerId);
    for (const ch of ws.channels) {
      ch.members = ch.members.filter((id: string) => id !== this.state.myPeerId);
    }

    const ok = await this.cleanupWorkspaceLocalState(wsId, ws);
    if (!ok) return { success: false, error: 'Failed to delete local workspace data' };

    this.workspaceManager.removeWorkspace(wsId);

    this.ui?.showToast('You left the workspace', 'info');
    this.ui?.updateWorkspaceRail?.();
    this.ui?.updateSidebar();
    this.ui?.updateChannelHeader();
    this.ui?.renderMessages();
    this.ui?.updateComposePlaceholder?.();

    return { success: true };
  }

  async removeWorkspaceMember(peerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return { success: false, error: 'Workspace not found' };

    const me = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
    const target = ws.members.find((m: any) => m.peerId === peerId);
    if (!target) return { success: false, error: 'Member not found' };
    if (target.role === 'owner') return { success: false, error: 'Cannot remove owner' };

    // Robust permission check: tolerate stale local role snapshots.
    const managerOwner = this.workspaceManager.isOwner(wsId, this.state.myPeerId);
    const managerAdmin = this.workspaceManager.isAdmin(wsId, this.state.myPeerId);
    const hasRemovePermission = managerOwner || managerAdmin || ws.createdBy === this.state.myPeerId || me?.role === 'owner' || me?.role === 'admin';
    if (!hasRemovePermission) {
      return { success: false, error: 'Only owner or admin can remove members' };
    }

    // Deterministic local remove (avoid stale-role false negatives in manager guards).
    ws.members = ws.members.filter((m: any) => m.peerId !== peerId);
    for (const ch of ws.channels) {
      ch.members = ch.members.filter((id: string) => id !== peerId);
    }

    await this.persistWorkspace(wsId);

    // Sign and broadcast member-removed event
    const timestamp = Date.now();
    let signature: string | undefined;
    try {
      signature = await this.signRemoveEvent(wsId, { peerId, timestamp });
      if (this.signingKeyPair) {
      }
    } catch (e) {
      console.warn('[Security] Could not sign remove event:', e);
    }

    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'member-removed', peerId, removedBy: this.state.myPeerId, timestamp, signature },
      });
      this.sendWorkspaceState(connectedPeerId);
    }

    this.ui?.updateSidebar();
    this.ui?.updateChannelHeader();
    this.ui?.renderMessages();

    return { success: true };
  }

  async promoteMember(targetPeerId: string, newRole: 'admin'): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.promoteMember(wsId, this.state.myPeerId, targetPeerId, newRole);
    if (!result.success) return result;

    await this.persistWorkspace(wsId);

    // Sign and broadcast role-changed event
    const timestamp = Date.now();
    let signature: string | undefined;
    try {
      signature = await this.signRoleEvent(wsId, { targetPeerId, newRole, timestamp });
    } catch (e) {
      console.warn('[Security] Could not sign role event:', e);
    }

    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'role-changed', peerId: targetPeerId, newRole, changedBy: this.state.myPeerId, timestamp, signature },
      });
    }

    this.ui?.updateSidebar();
    this.ui?.updateChannelHeader();
    return { success: true };
  }

  async demoteMember(targetPeerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.demoteMember(wsId, this.state.myPeerId, targetPeerId);
    if (!result.success) return result;

    await this.persistWorkspace(wsId);

    // Sign and broadcast role-changed event
    const timestamp = Date.now();
    const newRole = 'member';
    let signature: string | undefined;
    try {
      signature = await this.signRoleEvent(wsId, { targetPeerId, newRole, timestamp });
      if (this.signingKeyPair) {
      }
    } catch (e) {
      console.warn('[Security] Could not sign role event:', e);
    }

    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'role-changed', peerId: targetPeerId, newRole, changedBy: this.state.myPeerId, timestamp, signature },
      });
    }

    this.ui?.updateSidebar();
    this.ui?.updateChannelHeader();
    return { success: true };
  }

  async updateWorkspacePermissions(permissions: Partial<import('decent-protocol').WorkspacePermissions>): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.updatePermissions(wsId, this.state.myPeerId, permissions);
    if (!result.success) return result;

    await this.persistWorkspace(wsId);

    // Sign and broadcast settings-updated event
    const fullPerms = this.workspaceManager.getPermissions(wsId);
    const timestamp = Date.now();
    let signature: string | undefined;
    try {
      signature = await this.signSettingsEvent(wsId, { settings: fullPerms, timestamp });
      if (this.signingKeyPair) {
      }
    } catch (e) {
      console.warn('[Security] Could not sign settings event:', e);
    }

    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'workspace-settings-updated', settings: fullPerms, changedBy: this.state.myPeerId, timestamp, signature },
      });
    }

    return { success: true };
  }

  async revokeInviteLink(inviteIdOrUrl: string): Promise<{ success: boolean; error?: string; inviteId?: string; alreadyRevoked?: boolean }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    if (!ws) return { success: false, error: 'Workspace not found' };

    let inviteId = String(inviteIdOrUrl || '').trim();
    if (!inviteId) return { success: false, error: 'Usage: /invite-revoke <inviteId|inviteURL>' };

    if (inviteId.includes('://') || inviteId.includes('/join/')) {
      try {
        const decoded = InviteURI.decode(inviteId);
        if (decoded.workspaceId && decoded.workspaceId !== ws.id) {
          return { success: false, error: 'Invite URL belongs to a different workspace' };
        }
        if (!decoded.workspaceId && decoded.inviteCode !== ws.inviteCode) {
          return { success: false, error: 'Invite URL does not match this workspace' };
        }
        if (!decoded.inviteId) {
          return { success: false, error: 'Invite URL has no revokable invite ID (older link)' };
        }
        inviteId = decoded.inviteId;
      } catch {
        return { success: false, error: 'Invalid invite URL' };
      }
    }

    const existingRevoked = this.workspaceManager.getPermissions(ws.id).revokedInviteIds || [];
    if (existingRevoked.includes(inviteId)) {
      return { success: true, inviteId, alreadyRevoked: true };
    }

    const result = await this.updateWorkspacePermissions({
      revokedInviteIds: [...existingRevoked, inviteId],
    });
    if (!result.success) return result;

    return { success: true, inviteId };
  }

  async updateWorkspaceInfo(updates: { name?: string; description?: string }): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.updateWorkspaceInfo(wsId, this.state.myPeerId, updates);
    if (!result.success) return result;

    await this.persistWorkspace(wsId);

    // Broadcast full workspace state so all peers get the updated name/description
    for (const connectedPeerId of this.state.connectedPeers) {
      this.sendWorkspaceState(connectedPeerId);
    }

    this.ui?.updateSidebar();
    this.ui?.updateChannelHeader();
    return { success: true };
  }

  /** Set the ECDSA signing key pair for signing admin events */
  async setSigningKeyPair(keyPair: { publicKey: CryptoKey; privateKey: CryptoKey }): Promise<void> {
    this.signingKeyPair = keyPair;
    // Export and store our signing public key on our workspace members
    const exportedKey = await this.cryptoManager.exportPublicKey(keyPair.publicKey);
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const myMember = ws.members.find(m => m.peerId === this.state.myPeerId);
      if (myMember && myMember.signingPublicKey !== exportedKey) {
        myMember.signingPublicKey = exportedKey;
        this.persistWorkspace(ws.id).catch(() => {});
      }
    }
  }

  /** Sign an admin event. Payload includes workspaceId + actorPeerId for cross-context replay protection. */
  private async signAdminEvent(type: string, workspaceId: string, fields: string, timestamp: number): Promise<string> {
    if (!this.signingKeyPair) throw new Error('Signing key pair not available');
    const data = `${type}:${workspaceId}:${this.state.myPeerId}:${fields}:${timestamp}`;
    const cipher = new MessageCipher();
    return cipher.sign(data, this.signingKeyPair.privateKey);
  }

  /** Verify an admin event signature against a stored public key. */
  private async verifyAdminEvent(
    type: string, workspaceId: string, actorPeerId: string, fields: string,
    timestamp: number, signature: string, signerPublicKeyBase64: string,
  ): Promise<boolean> {
    try {
      const publicKey = await this.cryptoManager.importSigningPublicKey(signerPublicKeyBase64);
      const data = `${type}:${workspaceId}:${actorPeerId}:${fields}:${timestamp}`;
      const cipher = new MessageCipher();
      return cipher.verify(data, signature, publicKey);
    } catch (e) {
      console.warn('[Security] Failed to verify admin event signature:', e);
      return false;
    }
  }

  private async signRoleEvent(wsId: string, payload: { targetPeerId: string; newRole: string; timestamp: number }): Promise<string> {
    return this.signAdminEvent('role', wsId, `${payload.targetPeerId}:${payload.newRole}`, payload.timestamp);
  }

  private async verifyRoleEvent(wsId: string, actorPeerId: string,
    payload: { targetPeerId: string; newRole: string; timestamp: number; signature: string },
    signerPublicKeyBase64: string): Promise<boolean> {
    return this.verifyAdminEvent('role', wsId, actorPeerId, `${payload.targetPeerId}:${payload.newRole}`,
      payload.timestamp, payload.signature, signerPublicKeyBase64);
  }

  private async signSettingsEvent(wsId: string, payload: { settings: any; timestamp: number }): Promise<string> {
    return this.signAdminEvent('settings', wsId, JSON.stringify(payload.settings), payload.timestamp);
  }

  private async verifySettingsEvent(wsId: string, actorPeerId: string,
    payload: { settings: any; timestamp: number; signature: string },
    signerPublicKeyBase64: string): Promise<boolean> {
    return this.verifyAdminEvent('settings', wsId, actorPeerId, JSON.stringify(payload.settings),
      payload.timestamp, payload.signature, signerPublicKeyBase64);
  }

  private async signRemoveEvent(wsId: string, payload: { peerId: string; timestamp: number }): Promise<string> {
    return this.signAdminEvent('remove', wsId, payload.peerId, payload.timestamp);
  }

  private async verifyRemoveEvent(wsId: string, actorPeerId: string,
    payload: { peerId: string; timestamp: number; signature: string },
    signerPublicKeyBase64: string): Promise<boolean> {
    return this.verifyAdminEvent('remove', wsId, actorPeerId, payload.peerId,
      payload.timestamp, payload.signature, signerPublicKeyBase64);
  }

  // =========================================================================
  // Contacts
  // =========================================================================

  async addContact(contact: Contact): Promise<void> {
    await this.contactStore.add(contact);
    await this.persistentStore.saveContact(contact);
    // Also persist the peer's public key so the decrypt path can find it
    // (receive path checks persistentStore.getPeer before decrypting)
    if (contact.publicKey) {
      await this.persistentStore.savePeer({
        peerId: contact.peerId,
        publicKey: contact.publicKey,
        lastSeen: Date.now(),
        alias: contact.displayName,
      });
    }
    this.ui?.updateSidebar();
  }

  async removeContact(peerId: string): Promise<void> {
    await this.contactStore.remove(peerId);
    await this.persistentStore.deleteContact(peerId);
    this.ui?.updateSidebar();
  }

  async getContacts(): Promise<Contact[]> {
    return this.contactStore.list();
  }

  // =========================================================================
  // Standalone Direct Messages
  // =========================================================================

  async startDirectMessage(contactPeerId: string): Promise<DirectConversation> {
    const conv = await this.directConversationStore.create(contactPeerId);
    await this.persistentStore.saveDirectConversation(conv);
    this.ui?.updateSidebar();
    return conv;
  }

  async getDirectConversations(): Promise<DirectConversation[]> {
    const conversations = await this.directConversationStore.list();
    return conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  async sendDirectMessage(conversationId: string, content: string, threadId?: string): Promise<void> {
    if (!content.trim()) return;

    const conv = await this.directConversationStore.get(conversationId);
    if (!conv) return;

    const msg = await this.messageStore.createMessage(
      conversationId,
      this.state.myPeerId,
      content.trim(),
      'text',
      threadId,
    );
    if (this.myIdentityId) (msg as any).senderIdentityId = this.myIdentityId;
    (msg as any).recipientPeerIds = [conv.contactPeerId];
    (msg as any).ackedBy = [] as string[];
    (msg as any).ackedAt = {} as Record<string, number>;
    (msg as any).readBy = [] as string[];
    (msg as any).readAt = {} as Record<string, number>;

    const result = await this.messageStore.addMessage(msg);
    if (!result.success) {
      this.ui?.showToast('Failed to create message: ' + result.error, 'error');
      return;
    }

    const crdt = this.getOrCreateCRDT(conversationId);
    const crdtMsg = crdt.createMessage(conversationId, content.trim(), 'text', threadId);
    (msg as any).vectorClock = crdtMsg.vectorClock;

    await this.persistMessage(msg);

    // Ensure thread root snapshot exists for DM thread replies
    if (threadId) {
      await this.ensureThreadRoot(threadId, conversationId);
    }

    await this.directConversationStore.updateLastMessage(conversationId, msg.timestamp);
    const updatedConv = await this.directConversationStore.get(conversationId);
    if (updatedConv) {
      await this.persistentStore.saveDirectConversation(updatedConv);
    } else {
      await this.persistentStore.saveDirectConversation(conv);
    }
    this.ui?.updateSidebar();

    if (conversationId === this.state.activeChannelId) {
      if (threadId && this.state.threadOpen) {
        this.ui?.renderThreadMessages();
      } else if (!threadId) {
        this.ui?.appendMessageToDOM(msg, true);
      }
      // Update reply count on parent message for the sender
      if (threadId) {
        this.ui?.updateThreadIndicator(threadId, conversationId);
      }
    }

    // Encrypt and send to the contact
    const peerId = conv.contactPeerId;
    let attemptedDispatch = false;
    try {
      const envelope = await this.messageProtocol!.encryptMessage(peerId, content.trim(), 'text');
      (envelope as any).channelId = conversationId;
      (envelope as any).threadId = threadId;
      (envelope as any).vectorClock = (msg as any).vectorClock;
      (envelope as any).isDirect = true;

      // Include thread root snapshot for DM thread replies
      if (threadId) {
        const threadRoot = this.messageStore.getThreadRoot(threadId);
        if (threadRoot) {
          (envelope as any).threadRootSnapshot = {
            senderId: threadRoot.senderId,
            senderIdentityId: (threadRoot as any).senderIdentityId,
            content: threadRoot.content,
            timestamp: threadRoot.timestamp,
            attachments: (threadRoot as any).attachments,
          };
        }
      }

      if (this.state.readyPeers.has(peerId)) {
        this.transport.send(peerId, envelope);
      } else {
        await this.offlineQueue.enqueue(peerId, envelope);
      }
      attemptedDispatch = true;
    } catch (err) {
      console.error('Direct message send failed:', err);
    }

    if (attemptedDispatch && msg.status !== 'sent' && msg.status !== 'delivered') {
      msg.status = 'sent';
      await this.persistentStore.saveMessage({
        ...msg,
        status: 'sent',
        recipientPeerIds: [peerId],
        ackedBy: [],
        ackedAt: {},
        readBy: [],
        readAt: {},
      });
      this.ui?.updateMessageStatus?.(msg.id, 'sent', { acked: 0, total: 1, read: 0 });
    }

  }

  async restoreContacts(): Promise<void> {
    const contacts = await this.persistentStore.getAllContacts();
    for (const c of contacts) {
      await this.contactStore.add(c);
    }

    const conversations = await this.persistentStore.getAllDirectConversations();
    for (const conv of conversations) {
      await this.directConversationStore.create(conv.contactPeerId);
      // Restore the actual conversation object with its ID
      const existing = await this.directConversationStore.getByContact(conv.contactPeerId);
      if (existing && existing.id !== conv.id) {
        // The in-memory store generated a new ID; we need the persisted one
        await this.directConversationStore.remove(existing.id);
      }
    }

    // Re-import persisted conversations directly to preserve IDs
    for (const conv of conversations) {
      (this.directConversationStore as any).conversations?.set(conv.id, conv);
      // Restore messages for this conversation
      const messages = await this.persistentStore.getChannelMessages(conv.id);
      const crdt = this.getOrCreateCRDT(conv.id);
      for (const msg of messages) {
        try { this.messageStore.forceAdd(msg); } catch {}
        try {
          const crdtMsg = {
            id: msg.id,
            channelId: msg.channelId,
            senderId: msg.senderId,
            content: msg.content,
            type: (msg.type || 'text') as any,
            vectorClock: msg.vectorClock || {},
            wallTime: msg.timestamp,
            prevHash: msg.prevHash || '',
          };
          crdt.addMessage(crdtMsg);
        } catch {}
      }
    }
  }

  // =========================================================================
  // Typing / Presence
  // =========================================================================

  /** Generate a full invite URL for a workspace (signed, expiring by default). */
  async generateInviteURL(workspaceId: string, opts?: { permanent?: boolean }): Promise<string> {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return '';

    const permanent = opts?.permanent === true;

    // Parse primary signaling server
    const defaultServer = getDefaultSignalingServer();
    const { host, port, secure, path } = this.parseSignalingURL(defaultServer);

    // Collect up to 3 online workspace member peer IDs for multi-peer join resilience.
    // Priority: connected peers first, then known members (excluding self).
    const connectedSet = new Set(this.transport.getConnectedPeers());
    const additionalPeers: string[] = [];
    const MAX_PEERS = 3;

    // First pass: connected peers
    for (const member of ws.members) {
      if (additionalPeers.length >= MAX_PEERS) break;
      if (member.peerId === this.state.myPeerId) continue;
      if (connectedSet.has(member.peerId)) {
        additionalPeers.push(member.peerId);
      }
    }

    // Second pass: offline members (as fallback — they may come online by join time)
    if (additionalPeers.length < MAX_PEERS) {
      for (const member of ws.members) {
        if (additionalPeers.length >= MAX_PEERS) break;
        if (member.peerId === this.state.myPeerId) continue;
        if (additionalPeers.includes(member.peerId)) continue;
        additionalPeers.push(member.peerId);
      }
    }

    // Build InviteData with security fields
    const inviteData: InviteData = {
      host,
      port,
      inviteCode: ws.inviteCode,
      secure,
      path,
      fallbackServers: [],
      turnServers: [],
      peerId: this.state.myPeerId,
      peers: additionalPeers.length > 0 ? additionalPeers : undefined,
      publicKey: this.myPublicKey || undefined,
      workspaceName: ws.name || undefined,
      workspaceId: ws.id,
      // Invite security: 7-day expiration by default, unlimited uses, signed by inviter
      expiresAt: permanent ? undefined : Date.now() + 7 * 24 * 60 * 60 * 1000,
      maxUses: 0,
      inviteId: this.createInviteId(),
      inviterId: this.state.myPeerId,
    };

    // Sign invite with ECDSA key if available
    if (this.signingKeyPair?.privateKey) {
      try {
        inviteData.signature = await signInvite(this.signingKeyPair.privateKey, inviteData);
      } catch (err) {
        console.warn('[DecentChat] Failed to sign invite:', err);
        // Continue without signature — backward compatible
      }
    }

    // Use InviteURI.encode to generate proper URL (InviteURI hardcodes https, fix for localhost)
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const webDomain = isLocal ? `${window.location.hostname}:${window.location.port}` : 'decentchat.app';
    const url = InviteURI.encode(inviteData, webDomain);
    return isLocal ? url.replace('https://', 'http://') : url;
  }

  private createInviteId(): string {
    // 12-char stable token for this invite instance (short but collision-resistant enough for local admin revocation lists).
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }

  private findMessageById(messageId: string): PlaintextMessage | null {
    for (const channelId of this.messageStore.getAllChannelIds()) {
      const msg = this.messageStore.getMessages(channelId).find(m => m.id === messageId);
      if (msg) return msg;
    }
    return null;
  }

  /** Parse a WebSocket signaling URL into host/port/secure/path components */
  private parseSignalingURL(url: string): { host: string; port: number; secure: boolean; path: string } {
    // Handle ws://host:port/path or wss://host:port/path
    const match = url.match(/^(wss?):\/\/([^:/]+)(?::(\d+))?(\/.*)?$/);
    if (!match) {
      throw new Error(`Invalid signaling URL: ${url}`);
    }

    const [, protocol, host, portStr, path] = match;
    const secure = protocol === 'wss';
    const port = portStr ? parseInt(portStr, 10) : (secure ? 443 : 80);

    return { host, port, secure, path: path || '/peerjs' };
  }

  /** Toggle a reaction on a message and broadcast to peers */
  toggleReaction(messageId: string, emoji: string): void {
    const event = this.reactions.toggleReaction(messageId, emoji, this.state.myPeerId);
    if (event && this.state.activeChannelId) {
      event.channelId = this.state.activeChannelId;
      event.workspaceId = this.state.activeWorkspaceId ?? undefined;
      this.broadcastToWorkspacePeers(event);
    }
  }

  /** Broadcast typing indicator to workspace peers */
  broadcastTyping(): void {
    if (!this.state.activeChannelId) return;
    const event = this.presence.createTypingEvent(this.state.activeChannelId, this.state.myPeerId);
    if (!event) return; // Throttled

    this.broadcastToWorkspacePeers(event);
  }

  /** Broadcast stop typing */
  broadcastStopTyping(): void {
    if (!this.state.activeChannelId) return;
    const event = this.presence.createStopTypingEvent(this.state.activeChannelId, this.state.myPeerId);
    this.broadcastToWorkspacePeers(event);
  }

  // =========================================================================
  // Huddle (voice calling)
  // =========================================================================

  /** Initialize HuddleManager — call after myPeerId is known */
  initHuddle(): void {
    this.huddle = new HuddleManager(this.state.myPeerId, {
      onStateChange: (state, channelId) => {
        this.ui?.onHuddleStateChange?.(state, channelId);
      },
      onParticipantsChange: (participants) => {
        this.ui?.onHuddleParticipantsChange?.(participants);
      },
      onError: (msg) => {
        this.ui?.showToast(msg, 'error');
      },
      sendSignal: (peerId, data) => {
        this.transport.send(peerId, data);
      },
      broadcastSignal: (data) => {
        for (const peerId of this.getWorkspaceRecipientPeerIds()) {
          try { this.transport.send(peerId, data); } catch {}
        }
      },
      getConnectedPeers: () => this.transport.getConnectedPeers(),
      getDisplayName: (peerId) => this.getDisplayNameForPeer(peerId),
    });
  }

  async startHuddle(channelId: string): Promise<void> {
    await this.huddle?.startHuddle(channelId);
  }

  async joinHuddle(channelId: string): Promise<void> {
    await this.huddle?.joinHuddle(channelId);
  }

  async leaveHuddle(): Promise<void> {
    await this.huddle?.leaveHuddle();
  }

  toggleHuddleMute(): boolean {
    return this.huddle?.toggleMute() ?? false;
  }

  /** Send read receipt for a message */
  sendReadReceipt(channelId: string, messageId: string): void {
    const receipt = this.presence.createReadReceipt(channelId, messageId, this.state.myPeerId);
    this.broadcastToWorkspacePeers(receipt);
  }

  /** Send a message to all workspace peers */
  private broadcastToWorkspacePeers(data: any): void {
    const recipients = this.getWorkspaceRecipientPeerIds();
    for (const peerId of recipients) {
      if (this.state.readyPeers.has(peerId)) {
        try { this.transport.send(peerId, data); } catch {}
      }
    }
  }

  // =========================================================================
  // Media / Attachments
  // =========================================================================

  /**
   * Send a message with a file attachment.
   * Encrypts blob, creates metadata + thumbnail, sends message,
   * then streams chunks to peers on demand.
   */
  async sendAttachment(file: File, text?: string, threadId?: string): Promise<void> {
    if (!this.state.activeChannelId) return;

    // Read file
    const arrayBuffer = await file.arrayBuffer();
    const hash = await hashBlob(arrayBuffer);

    // Generate thumbnail (browser-only, async)
    let thumbnail: string | undefined;
    let width: number | undefined;
    let height: number | undefined;

    if (file.type.startsWith('image/')) {
      try {
        const result = await generateImageThumbnail(file);
        if (result) {
          thumbnail = result.data;
          width = result.width;
          height = result.height;
        } else {
          console.warn('[sendAttachment] generateImageThumbnail returned null for', file.name, file.type);
        }
      } catch (err) {
        console.warn('[sendAttachment] generateImageThumbnail failed:', err);
      }
    }

    // Create attachment metadata
    const meta = await createAttachmentMeta(
      { name: file.name, size: file.size, type: file.type },
      hash,
      { thumbnail, width, height },
    );

    const encrypted = await this.encryptAttachmentBlob(arrayBuffer);
    meta.iv = encrypted.iv;
    meta.encryptionKey = encrypted.encryptionKey;
    meta.encryptedHash = await hashBlob(encrypted.ciphertext);

    // Store locally
    const wsId = this.state.activeWorkspaceId || 'default';
    await this.mediaStore.store(wsId, meta, encrypted.ciphertext);

    // Create chunked sender for when peers request it
    this.activeSenders.set(meta.id, new ChunkedSender(meta.id, arrayBuffer));

    // Send message with attachment metadata
    const content = text || `📎 ${file.name}`;
    const msg = await this.messageStore.createMessage(
      this.state.activeChannelId,
      this.state.myPeerId,
      content,
      'text',
      threadId,
    );
    if (this.myIdentityId) (msg as any).senderIdentityId = this.myIdentityId;
    (msg as any).attachments = [meta];
    const recipientPeerIds = this.getWorkspaceRecipientPeerIds();
    (msg as any).recipientPeerIds = recipientPeerIds;
    (msg as any).ackedBy = [] as string[];
    (msg as any).ackedAt = {} as Record<string, number>;
    (msg as any).readBy = [] as string[];
    (msg as any).readAt = {} as Record<string, number>;

    const result = await this.messageStore.addMessage(msg);
    if (!result.success) return;

    const crdt = this.getOrCreateCRDT(this.state.activeChannelId);
    const crdtResult = crdt.createMessage(this.state.myPeerId, content);
    (msg as any).vectorClock = crdtResult.vectorClock;

    await this.persistMessage(msg);
    if (threadId && this.state.threadOpen) {
      this.ui?.renderThreadMessages();
      this.ui?.updateThreadIndicator(threadId, this.state.activeChannelId);
    } else if (!threadId) {
      this.ui?.appendMessageToDOM(msg, true);
    }

    // Send to workspace peers
    let attemptedDispatch = false;
    for (const peerId of recipientPeerIds) {
      try {
        const envelope = await this.messageProtocol!.encryptMessage(peerId, content, 'text');
        (envelope as any).channelId = this.state.activeChannelId;
        (envelope as any).workspaceId = this.state.activeWorkspaceId;
        (envelope as any).threadId = threadId;
        (envelope as any).messageId = msg.id;  // receiver must use same ID so reactions sync
        (envelope as any).timestamp = msg.timestamp;
        (envelope as any).vectorClock = (msg as any).vectorClock;
        (envelope as any).attachments = [meta]; // Metadata travels with message

        if (this.state.readyPeers.has(peerId)) {
          this.transport.send(peerId, envelope);
        } else {
          await this.offlineQueue.enqueue(peerId, envelope);
        }
        attemptedDispatch = true;
      } catch (err) {
        console.error('Send attachment to', peerId, 'failed:', err);
      }
    }

    if (attemptedDispatch && msg.status !== 'sent' && msg.status !== 'delivered') {
      msg.status = 'sent';
      await this.persistentStore.saveMessage({
        ...msg,
        status: 'sent',
        recipientPeerIds,
        ackedBy: [],
        ackedAt: {},
        readBy: [],
        readAt: {},
      });
      this.ui?.updateMessageStatus?.(msg.id, 'sent', { acked: 0, total: recipientPeerIds.length, read: 0 });
    }
  }

  /**
   * Request a media blob from a peer
   */
  requestMedia(peerId: string, attachmentId: string): void {
    const request: MediaRequest = { type: 'media-request', attachmentId };
    this.transport.send(peerId, request);
  }

  async resolveAttachmentImageUrl(attachmentId: string): Promise<string | null> {
    const attachment = this.mediaStore.getAttachment(attachmentId) as AttachmentMeta | undefined;
    if (!attachment) return null;

    let encryptedBlob = await this.mediaStore.getBlob(attachmentId);

    // If not available locally, request from currently connected peers and wait briefly.
    if (!encryptedBlob) {
      for (const peerId of this.state.connectedPeers) {
        this.requestMedia(peerId, attachmentId);
      }

      const timeoutAt = Date.now() + 8000;
      while (Date.now() < timeoutAt) {
        await new Promise(resolve => setTimeout(resolve, 250));
        encryptedBlob = await this.mediaStore.getBlob(attachmentId);
        if (encryptedBlob) break;
      }
    }

    if (!encryptedBlob) return null;

    const clearBlob = await this.decryptStoredAttachmentBlob(attachmentId, encryptedBlob);
    const mimeType = attachment.mimeType || 'image/jpeg';
    return URL.createObjectURL(new Blob([clearBlob], { type: mimeType }));
  }

  /** Handle incoming media request — start sending chunks */
  private async handleMediaRequest(peerId: string, request: MediaRequest): Promise<void> {
    // Create sender if needed
    if (!this.activeSenders.has(request.attachmentId)) {
      const encryptedBlob = await this.mediaStore.getBlob(request.attachmentId);
      if (!encryptedBlob) {
        // We don't have this blob — tell the requester
        const response: MediaResponse = {
          type: 'media-response',
          attachmentId: request.attachmentId,
          available: false,
        };
        this.transport.send(peerId, response);
        return;
      }

      const blob = await this.decryptStoredAttachmentBlob(request.attachmentId, encryptedBlob);
      this.activeSenders.set(request.attachmentId, new ChunkedSender(request.attachmentId, blob));
    }
    const sender = this.activeSenders.get(request.attachmentId)!;

    // Send availability response
    const response: MediaResponse = {
      type: 'media-response',
      attachmentId: request.attachmentId,
      available: true,
      totalChunks: sender.totalChunks,
    };
    this.transport.send(peerId, response);

    // Stream all chunks
    const fromChunk = request.fromChunk ?? 0;
    for await (const chunk of sender.chunks(fromChunk)) {
      this.transport.send(peerId, { type: 'media-chunk', ...chunk });
    }
  }

  /** Handle media availability response */
  private async handleMediaResponse(peerId: string, response: MediaResponse): Promise<void> {
    if (!response.available) {
      // Silent no-op: peer doesn't have requested media.
      return;
    }

    // Create receiver
    const att = this.mediaStore.getAttachment(response.attachmentId);
    if (!att) return;

    const receiver = new ChunkedReceiver(
      response.attachmentId,
      response.totalChunks!,
      att.hash,
    );
    this.activeTransfers.set(response.attachmentId, receiver);
  }

  /** Handle incoming media chunk */
  private async handleMediaChunk(_peerId: string, chunk: MediaChunk): Promise<void> {
    const receiver = this.activeTransfers.get(chunk.attachmentId);
    if (!receiver) return;

    try {
      const progress = await receiver.addChunk(chunk);

      // Update UI with progress
      // TODO: show progress bar in message attachment

      if (receiver.isComplete()) {
        const blob = await receiver.assemble();
        const wsId = this.state.activeWorkspaceId || 'default';
        const att = this.mediaStore.getAttachment(chunk.attachmentId);
        if (att) {
          const encrypted = await this.encryptAttachmentBlob(blob, att);
          await this.mediaStore.store(wsId, {
            ...att,
            iv: encrypted.iv,
            encryptionKey: encrypted.encryptionKey,
            encryptedHash: await hashBlob(encrypted.ciphertext),
          } as AttachmentMeta, encrypted.ciphertext);
        }
        this.activeTransfers.delete(chunk.attachmentId);
        this.ui?.showToast(`📥 Downloaded ${att?.name || 'attachment'}`, 'success');
      }
    } catch (err) {
      this.ui?.showToast(`Download failed: ${(err as Error).message}`, 'error');
      this.activeTransfers.delete(chunk.attachmentId);
    }
  }

  /**
   * Get storage stats for display
   */
  getStorageStats() {
    return this.mediaStore.getStats();
  }

  getWorkspaceStorageStats(workspaceId: string) {
    return this.mediaStore.getWorkspaceStats(workspaceId);
  }

  async pruneWorkspaceMedia(workspaceId: string): Promise<number> {
    return this.mediaStore.pruneWorkspace(workspaceId);
  }

  async pruneOldMedia(ageMs: number): Promise<number> {
    return this.mediaStore.pruneOlderThan(ageMs);
  }

  private async encryptAttachmentBlob(
    data: ArrayBuffer,
    existingMeta?: Partial<AttachmentMeta> & { encryptionKey?: string }
  ): Promise<{ ciphertext: ArrayBuffer; iv: string; encryptionKey: string }> {
    let aesKey: CryptoKey;
    let encryptionKey = existingMeta?.encryptionKey;
    let ivBytes: Uint8Array<ArrayBuffer>;

    if (encryptionKey) {
      aesKey = await this.importAesKeyFromBase64Jwk(encryptionKey);
    } else {
      aesKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );
      encryptionKey = await this.exportAesKeyToBase64Jwk(aesKey);
    }

    if (existingMeta?.iv) {
      ivBytes = new Uint8Array(this.base64ToArrayBuffer(existingMeta.iv));
    } else {
      ivBytes = new Uint8Array(crypto.getRandomValues(new Uint8Array(12)));
    }

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivBytes },
      aesKey,
      data,
    );

    return {
      ciphertext,
      iv: this.arrayBufferToBase64(ivBytes.buffer as ArrayBuffer),
      encryptionKey,
    };
  }

  private async decryptStoredAttachmentBlob(attachmentId: string, encryptedBlob: ArrayBuffer): Promise<ArrayBuffer> {
    const attachment = this.mediaStore.getAttachment(attachmentId) as (AttachmentMeta & { encryptionKey?: string }) | undefined;
    if (!attachment?.encryptionKey || !attachment.iv) {
      return encryptedBlob;
    }

    const key = await this.importAesKeyFromBase64Jwk(attachment.encryptionKey);
    const iv = this.base64ToArrayBuffer(attachment.iv);
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      encryptedBlob,
    );
  }

  private async exportAesKeyToBase64Jwk(key: CryptoKey): Promise<string> {
    const jwk = await crypto.subtle.exportKey('jwk', key);
    return btoa(JSON.stringify(jwk));
  }

  private async importAesKeyFromBase64Jwk(keyBase64: string): Promise<CryptoKey> {
    const jwk = JSON.parse(atob(keyBase64));
    return await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  private getIceServersFromEnv(): RTCIceServer[] | undefined {
    const env = (import.meta as any).env || {};
    const turnUrls: string[] = [];

    if (typeof env.VITE_TURN_URL === 'string' && env.VITE_TURN_URL.trim()) {
      turnUrls.push(env.VITE_TURN_URL.trim());
    }
    if (typeof env.VITE_TURNS_URL === 'string' && env.VITE_TURNS_URL.trim()) {
      turnUrls.push(env.VITE_TURNS_URL.trim());
    }
    if (typeof env.VITE_TURN_URLS === 'string' && env.VITE_TURN_URLS.trim()) {
      turnUrls.push(...env.VITE_TURN_URLS.split(',').map((s: string) => s.trim()).filter(Boolean));
    }

    // No custom TURN configured — let PeerTransport._resolveIceServers() decide (uses DEFAULT_TURN_SERVERS)
    if (turnUrls.length === 0) return undefined;

    const username = typeof env.VITE_TURN_USERNAME === 'string' ? env.VITE_TURN_USERNAME : '';
    const credential = typeof env.VITE_TURN_CREDENTIAL === 'string'
      ? env.VITE_TURN_CREDENTIAL
      : (typeof env.VITE_TURN_PASSWORD === 'string' ? env.VITE_TURN_PASSWORD : '');

    const customTurn: RTCIceServer[] = turnUrls.map((url) => ({
      urls: url,
      ...(username ? { username } : {}),
      ...(credential ? { credential } : {}),
    }));

    // Always include STUN alongside custom TURN for best connectivity
    return [...ICE_SERVERS_WITH_TURN, ...customTurn];
  }

  // =========================================================================
  // Message sync (reconnect catch-up)
  // =========================================================================

  private async requestMessageSync(peerId: string): Promise<void> {
    // Use Negentropy (set reconciliation) when peer supports it — efficient
    // for reconnects where both sides have mostly the same data.
    // Falls back to timestamp sync for peers without Negentropy support.
    if (this.peerSupportsCapability(peerId, NEGENTROPY_SYNC_CAPABILITY)) {
      console.log(`[Sync] Using Negentropy sync with ${peerId.slice(0, 8)}`);
      await this.requestNegentropyMessageSync(peerId);
    } else {
      console.log(`[Sync] Peer ${peerId.slice(0, 8)} lacks Negentropy, falling back to timestamp sync`);
      await this.requestTimestampMessageSync(peerId);
    }
  }

  private peerSupportsCapability(peerId: string, capability: string): boolean {
    return this.peerCapabilities.get(peerId)?.has(capability) === true;
  }

  private async requestTimestampMessageSync(peerId: string): Promise<void> {
    // Find the workspace where this peer is a member, not activeWorkspaceId
    let wsId: string | null = null;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      if (ws.members.some(m => m.peerId === peerId)) {
        wsId = ws.id;
        break;
      }
    }
    if (!wsId) wsId = this.state.activeWorkspaceId;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;

    const channelTimestamps: Record<string, number> = {};
    for (const ch of ws.channels) {
      const msgs = this.messageStore.getMessages(ch.id);
      const last = msgs[msgs.length - 1];
      channelTimestamps[ch.id] = last?.timestamp ?? 0;
    }

    // Ask peer for messages we're missing
    this.sendControlWithRetry(peerId, {
      type: 'message-sync-request',
      workspaceId: wsId,
      channelTimestamps,
    }, { label: 'message-sync-request' });

    // Proactive push removed — Negentropy handles bidirectional sync efficiently.
    // Timestamp sync is now only a fallback for peers without Negentropy support.
  }

  /** Negentropy-based sync — efficient set reconciliation for reconnects. */
  private async requestNegentropyMessageSync(peerId: string): Promise<void> {
    const wsId = this.state.activeWorkspaceId;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;

    const messageIdsByChannel: Record<string, string[]> = {};
    const pushMessages: any[] = [];
    for (const ch of ws.channels) {
      const localMessages = this.messageStore.getMessages(ch.id);
      const localItems = localMessages.map((m) => ({ id: m.id, timestamp: m.timestamp }));
      const negentropy = new Negentropy();
      await negentropy.build(localItems);

      const result = await negentropy.reconcile(
        async (query: NegentropyQuery) => this.sendNegentropyQuery(peerId, wsId, ch.id, query),
      );
      if (result.need.length > 0) {
        messageIdsByChannel[ch.id] = result.need;
      }

      // Push messages that remote is missing
      if (result.excess.length > 0) {
        const excessSet = new Set(result.excess);
        for (const m of localMessages) {
          if (excessSet.has(m.id)) {
            pushMessages.push({
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
      }
    }

    if (Object.keys(messageIdsByChannel).length > 0) {
      this.sendControlWithRetry(peerId, {
        type: 'message-sync-fetch-request',
        workspaceId: wsId,
        messageIdsByChannel,
      }, { label: 'message-sync-fetch-request' });
    }

    // Proactively push messages the remote is missing
    if (pushMessages.length > 0) {
      this.transport.send(peerId, {
        type: 'message-sync-response',
        workspaceId: wsId,
        messages: pushMessages,
      });
    }
  }

  private async sendNegentropyQuery(
    peerId: string,
    workspaceId: string,
    channelId: string,
    query: NegentropyQuery,
  ): Promise<NegentropyResponse> {
    const requestId = crypto.randomUUID();
    return await new Promise<NegentropyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingNegentropyQueries.delete(requestId);
        reject(new Error(`Negentropy query timeout for ${peerId.slice(0, 8)}`));
      }, NEGENTROPY_QUERY_TIMEOUT_MS);
      this.pendingNegentropyQueries.set(requestId, { peerId, resolve, reject, timer });
      this.sendControlWithRetry(peerId, {
        type: 'message-sync-negentropy-query',
        requestId,
        workspaceId,
        channelId,
        query,
      }, { label: 'message-sync-negentropy-query' });
    });
  }

  private async handleNegentropySyncQuery(peerId: string, data: any): Promise<void> {
    const wsId = data.workspaceId as string | undefined;
    const channelId = data.channelId as string | undefined;
    const requestId = data.requestId as string | undefined;
    const query = data.query as NegentropyQuery | undefined;
    if (!wsId || !channelId || !requestId || !query) return;

    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === peerId)) return;
    if (!ws.channels.some((ch: any) => ch.id === channelId)) return;

    const localItems = this.messageStore.getMessages(channelId).map((m) => ({ id: m.id, timestamp: m.timestamp }));
    const negentropy = new Negentropy();
    await negentropy.build(localItems);
    const response = await negentropy.processQuery(query);

    this.transport.send(peerId, {
      type: 'message-sync-negentropy-response',
      requestId,
      workspaceId: wsId,
      channelId,
      response,
    });
  }

  private handleNegentropySyncResponse(peerId: string, data: any): void {
    const requestId = data.requestId as string | undefined;
    if (!requestId) return;

    const pending = this.pendingNegentropyQueries.get(requestId);
    if (!pending) return;
    if (pending.peerId !== peerId) return;

    clearTimeout(pending.timer);
    this.pendingNegentropyQueries.delete(requestId);
    pending.resolve(data.response as NegentropyResponse);
  }

  private async handleMessageSyncFetchRequest(peerId: string, data: any): Promise<void> {
    const wsId = data.workspaceId as string | undefined;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === peerId)) return;

    const requested: Record<string, string[]> = data.messageIdsByChannel || {};
    const allMessages: any[] = [];

    for (const ch of ws.channels) {
      const requestedIds = Array.isArray(requested[ch.id]) ? requested[ch.id] : [];
      if (requestedIds.length === 0) continue;
      const idSet = new Set(requestedIds.filter((id) => typeof id === 'string'));
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

    this.transport.send(peerId, {
      type: 'message-sync-response',
      workspaceId: wsId,
      messages: allMessages,
    });
  }

  private async handleMessageSyncRequest(peerId: string, data: any): Promise<void> {
    const wsId = data.workspaceId;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === peerId)) return;

    const allMessages: any[] = [];
    const channelTimestamps: Record<string, number> = data.channelTimestamps || {};
    const MAX_SYNC_MESSAGES = 10_000;

    for (const ch of ws.channels) {
      const since = channelTimestamps[ch.id] ?? 0;
      const msgs = this.messageStore.getMessages(ch.id);
      const newer = msgs.filter(m => m.timestamp > since);
      for (const m of newer) {
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

    if (allMessages.length > MAX_SYNC_MESSAGES) {
      const originalCount = allMessages.length;
      allMessages.length = MAX_SYNC_MESSAGES;
      console.warn(`[Sync] Truncated message-sync-response for ${peerId.slice(0, 8)}: ${originalCount} -> ${MAX_SYNC_MESSAGES} messages`);
    }

    // Chunk to avoid WebSocket frame size limits
    const CHUNK_SIZE = 100;
    for (let i = 0; i < allMessages.length; i += CHUNK_SIZE) {
      this.transport.send(peerId, {
        type: 'message-sync-response',
        workspaceId: wsId,
        messages: allMessages.slice(i, i + CHUNK_SIZE),
      });
    }
  }

  private async handleMessageSyncResponse(_peerId: string, data: any): Promise<void> {
    try {
      const wsId = data.workspaceId;
      if (!wsId) { console.log('[Sync] handleMessageSyncResponse: no wsId'); return; }
      const ws = this.workspaceManager.getWorkspace(wsId);
      if (!ws) { console.log('[Sync] handleMessageSyncResponse: no workspace for', wsId); return; }
      if (!ws.members.some((m: any) => m.peerId === _peerId)) { console.log('[Sync] handleMessageSyncResponse: peer not member', _peerId.slice(0, 8)); return; }

      const messages: any[] = data.messages || [];
      console.log(`[Sync] handleMessageSyncResponse: ${messages.length} msgs from ${_peerId.slice(0, 8)} at ${Date.now()}`);
      if (messages.length === 0) return;

      const channelIds = new Set(ws.channels.map((ch: any) => ch.id));
      // Pre-build dedup sets per channel — O(1) lookup instead of O(n) per message
      const existingIds = new Map<string, Set<string>>();
      for (const chId of channelIds) {
        existingIds.set(chId, new Set(this.messageStore.getMessages(chId).map(m => m.id)));
      }

      // Build reverse channel mapping: if message has an unknown channelId,
      // map it to ANY local channel with the same name (handles post-remap mismatches)
      const unknownChannelRemap = new Map<string, string>();

      let added = 0;
      let touchedActiveChannel = false;
      const toSync: any[] = [];

      // Phase 1: bulk insert via bulkAdd — O(n log n) instead of O(n²)
      const toInsert: any[] = [];
      for (const msg of messages) {
        let targetChannelId = msg.channelId;
        if (!channelIds.has(targetChannelId)) {
          // Channel ID mismatch — try to map to a local channel
          if (unknownChannelRemap.has(targetChannelId)) {
            targetChannelId = unknownChannelRemap.get(targetChannelId)!;
          } else {
            // Incoming sync payloads do not carry channel names, so only remap when
            // this workspace has exactly one local channel.
            if (ws.channels.length === 1) {
              const firstLocalCh = ws.channels[0]?.id;
              if (firstLocalCh) {
                unknownChannelRemap.set(targetChannelId, firstLocalCh);
                targetChannelId = firstLocalCh;
                console.log(`[Sync] Remapping unknown channel ${msg.channelId.slice(0, 8)} → ${firstLocalCh.slice(0, 8)}`);
              } else {
                continue;
              }
            } else {
              console.warn(`[Sync] Skipping message ${msg.id?.slice?.(0, 8) || 'unknown'}: unknown channel ${msg.channelId?.slice?.(0, 8) || 'unknown'} in multi-channel workspace ${ws.id.slice(0, 8)}`);
              continue;
            }
          }
        }
        if (!existingIds.has(targetChannelId)) {
          existingIds.set(targetChannelId, new Set(this.messageStore.getMessages(targetChannelId).map(m => m.id)));
        }
        if (existingIds.get(targetChannelId)!.has(msg.id)) continue;

        const syncMsg = {
          id: msg.id,
          channelId: targetChannelId,
          senderId: msg.senderId,
          content: msg.content,
          timestamp: msg.timestamp,
          type: (msg.type || 'text') as 'text' | 'file' | 'system',
          threadId: msg.threadId,
          prevHash: msg.prevHash || '',
          status: 'delivered' as const,
          vectorClock: msg.vectorClock,
        };

        toInsert.push(syncMsg);
        existingIds.get(targetChannelId)!.add(msg.id);
        toSync.push(syncMsg);
        if (msg.channelId === this.state.activeChannelId) touchedActiveChannel = true;
      }
      this.messageStore.bulkAdd(toInsert);

      added = toSync.length;

      // Phase 2: CRDT + persist — deferred to not block message availability
      // Messages are already in-memory and queryable via bulkAdd above.
      setTimeout(() => {
        const persistTasks: Array<Promise<void>> = [];
        for (const msg of toSync) {
          try {
            const crdt = this.getOrCreateCRDT(msg.channelId);
            crdt.addMessage({
              id: msg.id, channelId: msg.channelId, senderId: msg.senderId,
              content: msg.content, type: msg.type,
              vectorClock: msg.vectorClock || {}, wallTime: msg.timestamp,
              prevHash: msg.prevHash || '',
            });
          } catch { /* CRDT dup safe to ignore */ }
          persistTasks.push(this.persistMessage(msg));
        }
        if (persistTasks.length > 0) {
          Promise.all(persistTasks).catch(err =>
            console.warn('[Sync] Batch persist error:', err),
          );
        }
      }, 0);
      if (touchedActiveChannel) {
        this.ui?.renderMessages();
      }

      // Record activity for synced thread replies + mentions (batch)
      let syncActivityChanged = false;
      for (const msg of toSync) {
        if (msg.senderId === this.state.myPeerId) continue;
        const wsId = this.resolveWorkspaceIdByChannelId(msg.channelId);
        if (wsId) {
          const before = this.activityItems.length;
          this.maybeRecordMentionActivity(msg as any, msg.channelId, wsId);
          if (this.activityItems.length !== before) syncActivityChanged = true;
        }
        if (msg.threadId) {
          const before = this.activityItems.length;
          this.maybeRecordThreadActivity(msg as any, msg.channelId);
          if (this.activityItems.length !== before) syncActivityChanged = true;
        }
      }
      if (syncActivityChanged) {
        this.ui?.updateChannelHeader();
        this.ui?.updateWorkspaceRail?.();
      }
    } catch (err) {
      console.error('[Sync] handleMessageSyncResponse FATAL:', (err as any)?.message, (err as any)?.stack);
    }
  }

  // =========================================================================
  // CRDT / offline queue
  // =========================================================================

  getOrCreateCRDT(channelId: string): MessageCRDT {
    if (!this.messageCRDTs.has(channelId)) {
      this.messageCRDTs.set(channelId, new MessageCRDT(this.state.myPeerId));
    }
    return this.messageCRDTs.get(channelId)!;
  }

  private async flushOfflineQueue(peerId: string): Promise<void> {
    // Non-destructive replay: never dequeue before successful transport.send().
    // This prevents message loss during reconnect/refresh races.
    const queued = await this.offlineQueue.getQueued(peerId);

    let delivered = 0;
    let failed = 0;
    let hitBackpressure = false;

    for (const item of queued as any[]) {
      let envelope = item?.data ?? item;

      // Handle deferred plaintext messages: encrypt now that the handshake is complete
      if (envelope?._deferred) {
        try {
          const encrypted = await this.messageProtocol!.encryptMessage(peerId, envelope.content, 'text');
          (encrypted as any).channelId = envelope.channelId;
          (encrypted as any).workspaceId = envelope.workspaceId;
          (encrypted as any).threadId = envelope.threadId;
          (encrypted as any).vectorClock = envelope.vectorClock;
          (encrypted as any).messageId = envelope.messageId;

          // Include thread root snapshot for thread messages
          if (envelope.threadId) {
            const threadRoot = this.messageStore.getThreadRoot(envelope.threadId);
            if (threadRoot) {
              (encrypted as any).threadRootSnapshot = {
                senderId: threadRoot.senderId,
                senderIdentityId: (threadRoot as any).senderIdentityId,
                content: threadRoot.content,
                timestamp: threadRoot.timestamp,
                attachments: (threadRoot as any).attachments,
              };
            }
          }

          envelope = encrypted;
        } catch (encryptErr) {
          console.error('[OfflineQueue] deferred encrypt failed for', peerId, encryptErr);
          failed += 1;
          if (typeof item?.id === 'number') {
            await this.offlineQueue.markAttempt(peerId, item.id);
          }
          continue;
        }
      }

      // Mark replayed outbox traffic so receiver can route it through trusted
      // replay lane instead of normal chat throttling.
      (envelope as any)._offlineReplay = 1;
      try {
        const sent = this.transport.send(peerId, envelope);
        if (!sent) {
          // Transport backpressure/transient readiness race. Keep item queued
          // and retry shortly without increasing attempt counters.
          hitBackpressure = true;
          break;
        }
        // Remove only after successful transport acceptance.
        if (typeof item?.id === 'number') {
          await this.offlineQueue.remove(peerId, item.id);
        }
        delivered += 1;

        // Update message status from pending → sent for deferred messages
        const msgId = envelope?.messageId ?? (item?.data ?? item)?.messageId;
        if (msgId) {
          this.ui?.updateMessageStatus?.(msgId, 'sent', undefined);
        }
      } catch (err) {
        failed += 1;
        if (typeof item?.id === 'number') {
          await this.offlineQueue.markAttempt(peerId, item.id);
        }
        console.error('Failed to deliver queued message to', peerId, err);
      }
    }

    if (delivered > 0) {
      this.ui?.showToast(
        `📬 Delivered ${delivered} queued message${delivered > 1 ? 's' : ''} to ${peerId.slice(0, 8)}`,
        'success',
      );
    }
    if (failed > 0) {
      this.ui?.showToast(
        `⚠️ ${failed} queued message${failed > 1 ? 's' : ''} still pending for ${peerId.slice(0, 8)}`,
        'error',
      );
    }

    // Retry pending queue shortly while peer remains ready.
    // Use fast retry after transient backpressure, otherwise normal retry.
    if (failed > 0 || hitBackpressure) {
      setTimeout(() => {
        if (this.state.readyPeers.has(peerId)) {
          this.flushOfflineQueue(peerId).catch((err) => {
            console.warn('[OfflineQueue] retry flush failed:', (err as Error)?.message || err);
          });
        }
      }, hitBackpressure ? 250 : 1_500);
    }
  }

  private getWorkspaceRecipientPeerIds(): string[] {
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;

    if (!ws) {
      // SECURITY: Do NOT fallback to readyPeers — that sends to ALL connected peers
      // regardless of workspace membership, leaking messages across workspaces.
      return [];
    }

    // Build recipient set: for each member, include their primary peerId
    // plus all known device peerIds from the device registry.
    const myPeerId = this.state.myPeerId;
    const recipientSet = new Set<string>();

    for (const member of ws.members) {
      if (member.peerId === myPeerId) continue;

      // Add the member's primary peerId
      recipientSet.add(member.peerId);

      // Multi-device: if this member has a known identityId, add all their device peerIds
      if (member.identityId) {
        for (const devicePeerId of this.deviceRegistry.getAllPeerIds(member.identityId)) {
          if (devicePeerId !== myPeerId) {
            recipientSet.add(devicePeerId);
          }
        }
      }

      // Also include devices from workspace member data
      if (member.devices) {
        for (const device of member.devices) {
          if (device.peerId !== myPeerId) {
            recipientSet.add(device.peerId);
          }
        }
      }
    }

    return Array.from(recipientSet);
  }

  private ensurePeerInActiveWorkspace(peerId: string, publicKey = ''): void {
    // If peer already exists in any workspace, do nothing.
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      if (ws.members.some((m: any) => m.peerId === peerId)) return;
    }

    // Safe fallback: auto-add only when there is exactly one workspace.
    // In multi-workspace sessions, membership should come from workspace-state sync
    // to avoid attaching peers to the wrong workspace.
    const all = this.workspaceManager.getAllWorkspaces();
    if (all.length !== 1) return;

    const ws = all[0];
    this.workspaceManager.addMember(ws.id, {
      peerId,
      alias: peerId.slice(0, 8),
      publicKey,
      joinedAt: Date.now(),
      role: 'member',
    });

    this.persistWorkspace(ws.id).catch(() => {});
    this.ui?.updateSidebar();
  }

  /** Resolve a peer's display name given a channel context (looks through workspace members) */
  private getPeerAliasForChannel(peerId: string, channelId: string): string {
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      if (ws.channels.some((ch: any) => ch.id === channelId)) {
        const member = ws.members.find((m: any) => m.peerId === peerId);
        if (member?.alias) return member.alias;
      }
    }
    return peerId.slice(0, 8);
  }

  /**
   * Best available display name for a peer — checks all sources in priority order:
   * 1. Explicit contacts (user-chosen name)
   * 2. Any workspace member alias (synced via name-announce)
   * 3. Truncated peer ID fallback
   */
  getDisplayNameForPeer(peerId: string): string {
    // 1. Explicit contact (highest priority — user-named)
    const contact = this.contactStore.getSync?.(peerId);
    if (contact?.displayName) return contact.displayName;

    // 2. Any workspace member alias
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const member = ws.members.find((m: any) => m.peerId === peerId);
      if (member?.alias && member.alias.trim()) return member.alias;
    }

    // 3. Truncated peer ID
    return peerId.slice(0, 8);
  }

  /** Returns display name for the given workspace, falling back to global alias or peer ID slice */
  getMyAliasForWorkspace(wsId: string | null): string {
    if (wsId && this.state.workspaceAliases?.[wsId]) return this.state.workspaceAliases[wsId];
    return this.state.myAlias || this.state.myPeerId.slice(0, 8);
  }

  private findWorkspaceByChannelId(channelId: string): Workspace | null {
    const workspaces = this.workspaceManager.getAllWorkspaces();
    return workspaces.find((ws) => ws.channels.some((ch: Channel) => ch.id === channelId)) || null;
  }

  private getMessageRecipients(msg: PlaintextMessage, receiptPeerId?: string): string[] {
    const explicit = Array.isArray((msg as any).recipientPeerIds)
      ? (msg as any).recipientPeerIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (explicit.length > 0) return Array.from(new Set(explicit));

    const ws = this.findWorkspaceByChannelId(msg.channelId);
    if (ws) {
      return ws.members.map((m: any) => m.peerId).filter((id: string) => id !== this.state.myPeerId);
    }

    const convMap = (this.directConversationStore as any).conversations as Map<string, { contactPeerId: string }> | undefined;
    const dmPeer = convMap?.get(msg.channelId)?.contactPeerId;
    if (dmPeer) return [dmPeer];

    if (receiptPeerId) return [receiptPeerId];
    return [];
  }

  private isValidInboundReceipt(peerId: string, channelId: string, messageId: string, type: 'ack' | 'read'): { valid: true; msg: PlaintextMessage; recipients: string[] } | { valid: false } {
    const msgs = this.messageStore.getMessages(channelId) as PlaintextMessage[];
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg) {
      console.warn(`[Security] Rejecting ${type}: message ${messageId} not found in ${channelId}`);
      return { valid: false };
    }
    if (msg.channelId !== channelId) {
      console.warn(`[Security] Rejecting ${type}: channel mismatch for message ${messageId}`);
      return { valid: false };
    }
    if (msg.senderId !== this.state.myPeerId) {
      console.warn(`[Security] Rejecting ${type}: message ${messageId} is not outgoing`);
      return { valid: false };
    }

    const recipients = this.getMessageRecipients(msg, peerId);
    if (!recipients.includes(peerId)) {
      console.warn(`[Security] Rejecting ${type}: peer ${peerId.slice(0, 8)} is not an intended recipient for ${messageId}`);
      return { valid: false };
    }

    const ws = this.findWorkspaceByChannelId(channelId);
    if (ws && !ws.members.some((m: any) => m.peerId === peerId)) {
      console.warn(`[Security] Rejecting ${type}: peer ${peerId.slice(0, 8)} is not member of workspace ${ws.id}`);
      return { valid: false };
    }

    return { valid: true, msg, recipients };
  }

  async onChannelViewed(channelId: string): Promise<void> {
    if (!this.channelViewInFlight) this.channelViewInFlight = new Map<string, Promise<void>>();
    if (!this.pendingReadReceiptKeys) this.pendingReadReceiptKeys = new Set<string>();

    const current = this.channelViewInFlight.get(channelId);
    if (current) {
      await current;
      return;
    }

    const run = (async () => {
      const messages = this.messageStore.getMessages(channelId);
      for (const msg of messages as any[]) {
        if (msg.channelId !== channelId) continue;
        // Only receipt incoming messages from other peers.
        if (msg.senderId === this.state.myPeerId) continue;
        if ((msg as any).localReadAt) continue;

        // Mark in-memory first to avoid race duplicates.
        (msg as any).localReadAt = Date.now();

        const payload = { type: 'read', messageId: msg.id, channelId };
        const dedupeKey = `${msg.senderId}:${msg.id}:${channelId}`;

        try {
          if (this.state.readyPeers.has(msg.senderId)) {
            this.transport.send(msg.senderId, payload);
          } else if (!this.pendingReadReceiptKeys.has(dedupeKey)) {
            this.pendingReadReceiptKeys.add(dedupeKey);
            await this.offlineQueue.enqueue(msg.senderId, payload);
          }
          await this.persistentStore.saveMessage({ ...(msg as any), localReadAt: (msg as any).localReadAt });
        } catch (err) {
          console.warn('[ReadReceipt] Failed to emit late read receipt', err);
        }
      }
    })();

    this.channelViewInFlight.set(channelId, run);
    try {
      await run;
    } finally {
      this.channelViewInFlight.delete(channelId);
    }
  }

  getMessageReceiptInfo(messageId: string): {
    messageId: string;
    channelId: string;
    recipients: Array<{ peerId: string; name: string; at?: number }>;
    delivered: Array<{ peerId: string; name: string; at?: number }>;
    read: Array<{ peerId: string; name: string; at?: number }>;
    pending: Array<{ peerId: string; name: string; at?: number }>;
  } | null {
    const channelId = this.state.activeChannelId;
    if (!channelId) return null;

    const msg = this.messageStore.getMessages(channelId).find((m: any) => m.id === messageId);
    if (!msg) return null;

    const recipients: string[] = this.getMessageRecipients(msg as PlaintextMessage);
    const deliveredSet = new Set<string>(Array.isArray((msg as any).ackedBy) ? (msg as any).ackedBy : []);
    const readSet = new Set<string>(Array.isArray((msg as any).readBy) ? (msg as any).readBy : []);
    const ackedAt: Record<string, number> = (msg as any).ackedAt || {};
    const readAt: Record<string, number> = (msg as any).readAt || {};

    const toUser = (peerId: string, at?: number) => ({ peerId, name: this.getDisplayNameForPeer(peerId), at });

    return {
      messageId,
      channelId,
      recipients: recipients.map((p) => toUser(p)),
      delivered: recipients.filter((p) => deliveredSet.has(p)).map((p) => toUser(p, ackedAt[p])),
      read: recipients.filter((p) => readSet.has(p)).map((p) => toUser(p, readAt[p])),
      pending: recipients.filter((p) => !deliveredSet.has(p)).map((p) => toUser(p)),
    };
  }

  /** Set a workspace-specific display name and persist it */
  setWorkspaceAlias(wsId: string, alias: string): void {
    if (!this.state.workspaceAliases) this.state.workspaceAliases = {};
    this.state.workspaceAliases[wsId] = alias;
    this.persistentStore.saveSetting('workspaceAliases', JSON.stringify(this.state.workspaceAliases));

    // Update our own member entry in the workspace
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (ws) {
      const myMember = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
      if (myMember) myMember.alias = alias;
      this.persistWorkspace(wsId).catch(() => {});
    }

    // Announce updated name to all connected peers in this workspace
    const targets = this.getWorkspaceRecipientPeerIds();
    for (const peerId of targets) {
      if (this.state.readyPeers.has(peerId)) {
        this.sendControlWithRetry(peerId, { type: 'name-announce', workspaceId: wsId, alias }, { label: 'name-announce' });
      }
    }
  }
}
