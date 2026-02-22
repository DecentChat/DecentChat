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
  verifyHandshakeKey,
  hashBlob,
  createAttachmentMeta,
  generateImageThumbnail,
  CHUNK_SIZE,
  InviteURI,
  MemoryContactStore,
  MemoryDirectConversationStore,
  ServerDiscovery,
} from 'decent-protocol';
import type { InviteData } from 'decent-protocol';
import type {
  PlaintextMessage, Workspace, Channel,
  AttachmentMeta, Attachment, MediaChunk, MediaRequest, MediaResponse,
  TimeSyncRequest, TimeSyncResponse,
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
  appendMessageToDOM: (msg: PlaintextMessage) => void;
  showToast: (message: string, type?: 'info' | 'error' | 'success') => void;
  renderThreadMessages: () => void;
  renderMessages: () => void;
  renderApp: () => void;
  /** Update the thread reply indicator on a parent message in the main list */
  updateThreadIndicator: (parentMessageId: string, channelId: string) => void;
  /** DEP-005: Update delivery status tick on a specific message (avoids full re-render) */
  updateMessageStatus?: (messageId: string, status: 'pending' | 'sent' | 'delivered') => void;
  updateStreamingMessage?: (messageId: string, content: string) => void;
  finalizeStreamingMessage?: (messageId: string) => void;
  /** Huddle state changed (inactive / available / in-call) */
  onHuddleStateChange?: (state: HuddleState, channelId: string | null) => void;
  /** Huddle participants list updated */
  onHuddleParticipantsChange?: (participants: HuddleParticipant[]) => void;
}

// ---------------------------------------------------------------------------
// ChatController
// ---------------------------------------------------------------------------

export class ChatController {
  // Protocol instances
  readonly cryptoManager: CryptoManager;
  readonly keyStore: KeyStore;
  readonly transport: PeerTransport | any;
  messageProtocol: MessageProtocol | null = null;
  readonly messageStore: MessageStore;
  readonly workspaceManager: WorkspaceManager;
  readonly persistentStore: PersistentStore;
  readonly offlineQueue: OfflineQueue;
  readonly messageCRDTs: Map<string, MessageCRDT> = new Map();
  readonly mediaStore: MediaStore;
  readonly clockSync: ClockSync;
  readonly messageGuard: MessageGuard;
  readonly presence: PresenceManager;
  readonly reactions: ReactionManager;
  readonly notifications: NotificationManager;
  readonly contactStore: MemoryContactStore;
  readonly directConversationStore: MemoryDirectConversationStore;
  private networkOnlineListenerBound = false;
  private transportReinitInFlight: Promise<boolean> | null = null;
  private lastTransportReinitAt = 0;

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
  /** Cleanup interval for the seen-set (every 5 min) */
  private _gossipCleanupInterval: ReturnType<typeof setInterval> | null = null;

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
  huddle: HuddleManager | null = null;
  private ui: UIUpdater | null = null;
  private reactionsPersistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private state: AppState) {
    this.cryptoManager = new CryptoManager();
    this.keyStore = new KeyStore(this.cryptoManager);
    const MockT = typeof window !== 'undefined' && (window as any).__MockTransport;
    this.transport = MockT ? new MockT() : new PeerTransport({
      iceServers: this.getIceServersFromEnv(),
    });
    this.messageStore = new MessageStore();
    this.workspaceManager = new WorkspaceManager();
    this.persistentStore = new PersistentStore();
    this.offlineQueue = new OfflineQueue({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    this.mediaStore = new MediaStore(new IndexedDBBlobStorage());
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
  }

  /** Inject UI callbacks after construction (breaks circular dep). */
  setUI(ui: UIUpdater): void {
    this.ui = ui;
  }

  // =========================================================================
  // Transport event wiring
  // =========================================================================

  setupTransportHandlers(): void {
    this.transport.onConnect = async (peerId: string) => {
      this.state.connectedPeers.add(peerId);
      this.state.connectingPeers.delete(peerId);
      this.ui?.updateSidebar();

      try {
        const handshake = await this.messageProtocol!.createHandshake();
        this.transport.send(peerId, { type: 'handshake', ...handshake });
      } catch (err) {
        console.error('Handshake failed:', err);
      }
    };

    this.transport.onDisconnect = (peerId: string) => {
      this.state.connectedPeers.delete(peerId);
      this.state.connectingPeers.delete(peerId);
      this.state.readyPeers.delete(peerId);
      this.messageProtocol?.clearSharedSecret(peerId);
      this.ui?.updateSidebar();
    };

    this.transport.onMessage = async (peerId: string, rawData: unknown) => {
      const data = rawData as any;

      // Rate limit + validate before any processing
      const guardResult = this.messageGuard.check(peerId, data);
      if (!guardResult.allowed) {
        console.warn(`[Guard] Blocked message from ${peerId.slice(0, 8)}: ${guardResult.reason}`);
        return;
      }

      try {
        // --- DEP-005: Delivery ACK (control message — handle before decrypt) ---
        if (data?.type === 'ack') {
          const channelId = data.channelId as string;
          const messageId = data.messageId as string;
          if (channelId && messageId) {
            const msgs = this.messageStore.getMessages(channelId);
            const msg = msgs.find(m => m.id === messageId);
            if (msg && msg.status !== 'delivered') {
              msg.status = 'delivered';
              await this.persistentStore.saveMessage({ ...msg, status: 'delivered' });
              // Targeted DOM update — no full re-render needed
              this.ui?.updateMessageStatus?.(messageId, 'delivered');
            }
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

          const streamThreadId = isDirect ? undefined : (threadId ?? replyToId);
          this.pendingStreams.set(messageId, {
            channelId: targetChannelId,
            senderId: streamSenderId,
            senderName,
            threadId: streamThreadId,
            isDirect: !!isDirect,
          });
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
            let existing = this.findMessageById(messageId);
            if (!existing) {
              const msg = await this.messageStore.createMessage(
                pending.channelId,
                pending.senderId,
                '',
                'text',
                pending.threadId,
              );
              msg.id = messageId;
              (msg as any).senderName = pending.senderName;
              (msg as any).streaming = true;
              msg.content = normalizedContent;
              await this.messageStore.addMessage(msg);
              await this.persistMessage(msg);
              if (pending.channelId === this.state.activeChannelId) {
                this.ui?.appendMessageToDOM(msg);
              }
              existing = msg;
            } else {
              existing.content = normalizedContent;
              (existing as any).streaming = true;
              await this.persistMessage(existing);
            }
          }
          this.ui?.updateStreamingMessage?.(messageId, normalizedContent);
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

          // Protocol version check (DEP-004)
          if (data.protocolVersion != null && data.protocolVersion > PROTOCOL_VERSION) {
            console.warn(
              `[Protocol] Peer ${peerId.slice(0, 8)} uses protocol v${data.protocolVersion} ` +
              `(we support v${PROTOCOL_VERSION}). Some features may not work.`,
            );
          }

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
          this.ui?.showToast(
            ratchetActive
              ? `🔐 Forward-secret connection with ${peerId.slice(0, 8)}...`
              : `🔐 Encrypted connection with ${peerId.slice(0, 8)}...`,
            'success',
          );

          await this.flushOfflineQueue(peerId);
          this.requestMessageSync(peerId).catch(err => console.warn('[Sync] Message sync request failed:', err));

          // Send workspace state to new peer (channels, members, name)
          this.sendWorkspaceState(peerId);

          // Announce our display name for this workspace
          if (this.state.activeWorkspaceId) {
            this.transport.send(peerId, {
              type: 'name-announce',
              workspaceId: this.state.activeWorkspaceId,
              alias: this.getMyAliasForWorkspace(this.state.activeWorkspaceId),
            });
          }

          // Start clock sync with new peer
          const syncReq = this.clockSync.startSync(peerId);
          this.transport.send(peerId, syncReq);
          return;
        }

        // --- Clock sync ---
        if (data?.type === 'time-sync-request') {
          const response = this.clockSync.handleRequest(data as TimeSyncRequest);
          this.transport.send(peerId, response);
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
        // Note: data.workspaceId is the SENDER's workspace ID (different from ours).
        // We must use our own activeWorkspaceId to find the local workspace.
        if (data?.type === 'name-announce' && data.alias) {
          const localWsId = this.state.activeWorkspaceId;
          const ws = localWsId ? this.workspaceManager.getWorkspace(localWsId) : null;
          if (ws) {
            const member = ws.members.find((m: any) => m.peerId === peerId);
            if (member) {
              member.alias = data.alias;
            } else {
              ws.members.push({ peerId, alias: data.alias, publicKey: '', joinedAt: Date.now(), role: 'member' });
            }
            this.persistWorkspace(ws.id).catch(() => {});
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
        // Use persistentStore as the single source of truth for peer public keys.
        const peerData = await this.persistentStore.getPeer(peerId);
        if (!peerData) return;

        const peerPublicKey = await this.cryptoManager.importPublicKey(peerData.publicKey);
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
              this.ui?.appendMessageToDOM(msg);
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
                if (channelId === this.state.activeChannelId) this.ui?.appendMessageToDOM(msg);
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
            console.warn(`[Security] Dropping message from ${peerId.slice(0, 8)}: not a member of workspace ${targetWs.id}`);
            return;
          }

          // Resolve channelId: use the declared one if it exists in the workspace,
          // otherwise fall back to the first channel (handles channel-id drift on first sync)
          if (data.channelId && targetWs.channels.some((ch: any) => ch.id === data.channelId)) {
            channelId = data.channelId;
          } else {
            channelId = targetWs.channels[0]?.id || data.channelId || 'default';
          }
        }

        // Pass threadId so replies land in the correct thread (not the main channel)
        // T3.2: For gossip-relayed messages, use the original sender's peerId (not the relay node)
        const actualSenderId: string = (data._gossipOriginalSender as string | undefined) ?? peerId;
        const msg = await this.messageStore.createMessage(channelId, actualSenderId, content, 'text', data.threadId);
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

        // T3.2 Gossip dedup (post-decryption): if we already processed this exact message
        // ID via any path (direct or gossip), skip it now.  This covers the gossip-first
        // ordering where _originalMessageId was added to _gossipSeen before the direct
        // copy arrived (which has no _originalMessageId to check at the top of the handler).
        if (this._gossipSeen.has(msg.id)) return;

        const result = await this.messageStore.addMessage(msg);

        if (result.success) {
          const crdt = this.getOrCreateCRDT(channelId);
          crdt.addMessage({
            id: msg.id,
            channelId: msg.channelId,
            senderId: msg.senderId,
            content: msg.content,
            type: (msg.type || 'text') as any,
            threadId: data.threadId,     // propagate threadId to CRDT
            vectorClock: data.vectorClock || {},
            wallTime: msg.timestamp,
            prevHash: msg.prevHash || '',
          });

          await this.persistMessage(msg);

          // DEP-005: Send delivery ACK back to sender
          this.transport.send(peerId, { type: 'ack', messageId: msg.id, channelId });

          // T3.2: Seed gossip seen-set with the canonical message ID so that a later
          // gossip-relayed copy of this same message (which uses msg.id as _originalMessageId)
          // is caught by the early dedup check and dropped without re-rendering.
          this._gossipSeen.set(msg.id, Date.now());

          // T3.2: Gossip relay — re-encrypt and forward to workspace peers who might not have received this
          void this._gossipRelay(peerId, msg.id, msg.senderId, content, channelId, data);

          if (channelId === this.state.activeChannelId) {
            if (msg.threadId) {
              // It's a thread reply — update the parent message's reply indicator and
              // re-render the thread panel if it's open and showing the right thread
              this.ui?.updateThreadIndicator(msg.threadId, channelId);
              if (this.state.threadOpen && this.state.activeThreadId === msg.threadId) {
                this.ui?.renderThreadMessages();
              }
            } else {
              this.ui?.appendMessageToDOM(msg);
            }
          }

          // Notify
          const ws = this.state.activeWorkspaceId
            ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId) : null;
          const ch = ws ? this.workspaceManager.getChannel(ws.id, channelId) : null;
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
      // Signaling server briefly dropped — PeerTransport auto-reconnects within ~3s.
      if (error.message?.includes('disconnecting from server') ||
          error.message?.includes('disconnected from server')) return;
      // Peer is simply offline — expected, no need to disturb the user.
      if (error.message?.includes('Could not connect to peer') ||
          error.message?.includes('Failed to connect to') ||
          error.message?.includes('peer-unavailable')) return;
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

  private sendWorkspaceState(peerId: string): void {
    if (!this.state.activeWorkspaceId) return;
    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    if (!ws) return;

    console.log(`[Sync] Sending workspace state to ${peerId.slice(0, 8)}:`, {
      name: ws.name, channels: ws.channels.length, members: ws.members.length,
    });

    this.transport.send(peerId, {
      type: 'workspace-sync',
      workspaceId: ws.id,
      sync: {
        type: 'workspace-state',
        name: ws.name,
        channels: ws.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
        members: ws.members.map(m => ({ peerId: m.peerId, alias: m.alias, publicKey: m.publicKey, role: m.role })),
        inviteCode: ws.inviteCode,
      },
    });
  }

  private async handleSyncMessage(_peerId: string, msg: any): Promise<void> {
    // Handle workspace state sync (channels, members, name)
    if (msg.sync?.type === 'workspace-state' && msg.workspaceId) {
      await this.handleWorkspaceStateSync(_peerId, msg.workspaceId, msg.sync);
      return;
    }

    // Handle real-time channel creation broadcast
    if (msg.sync?.type === 'channel-created' && msg.workspaceId && msg.sync.channel) {
      this.handleChannelCreated(msg.workspaceId, msg.sync.channel);
      return;
    }

    // DEP-002: Handle peer-exchange messages
    if (msg.sync?.type === 'peer-exchange' && msg.workspaceId) {
      const discovery = this.serverDiscovery.get(msg.workspaceId);
      if (discovery && msg.sync.servers) {
        discovery.mergeReceivedServers(msg.sync.servers);
        this.saveServerDiscovery(msg.workspaceId); // Persist updated state
        console.log(`[PEX] Merged ${msg.sync.servers.length} servers from ${_peerId.slice(0, 8)}`);

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

    // Find our local workspace that matches (by invite code or active workspace)
    let localWs = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;

    // If our active workspace's invite code matches the remote one, or we have only 1 workspace
    if (!localWs) return;

    // Tracks the stale workspace ID to delete AFTER the new one is safely persisted.
    let _staleId: string | null = null;

    // Remap workspace ID so both peers agree on the same ID.
    // Deterministic rule: the lexicographically smaller ID wins.
    // Both peers see both IDs and converge on the same canonical one.
    if (remoteWorkspaceId && localWs.id !== remoteWorkspaceId && remoteWorkspaceId < localWs.id) {
      const oldId = localWs.id;
      _staleId = oldId;
      console.log(`[Sync] Remapping workspace ID: ${oldId.slice(0, 8)} → ${remoteWorkspaceId.slice(0, 8)}`);

      // Remove old entry and re-insert with canonical ID
      this.workspaceManager.removeWorkspace(oldId);
      localWs.id = remoteWorkspaceId;

      // Update channel workspace references
      for (const ch of localWs.channels) {
        if ((ch as any).workspaceId === oldId) {
          (ch as any).workspaceId = remoteWorkspaceId;
        }
      }

      // Re-add with new ID
      this.workspaceManager.importWorkspace(localWs);

      // Update active state
      if (this.state.activeWorkspaceId === oldId) {
        this.state.activeWorkspaceId = remoteWorkspaceId;
      }

      // Old entry will be deleted AFTER new ID is safely persisted (see below).
    }

    // Update workspace name if it was using the invite code as name
    if (sync.name && localWs.name !== sync.name) {
      const isPlaceholder = localWs.name === localWs.inviteCode || localWs.name.length === 8;
      if (isPlaceholder) {
        localWs.name = sync.name;
      }
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
          localWs.members.push({
            peerId: remoteMember.peerId,
            alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
            publicKey: remoteMember.publicKey || '',
            joinedAt: Date.now(),
            role: remoteMember.role || 'member',
          });
        } else {
          // Update alias if the remote has a better (non-empty, non-hex-id) name
          if (remoteMember.alias && remoteMember.alias.trim()) {
            existing.alias = remoteMember.alias;
          }
          if (remoteMember.publicKey) existing.publicKey = remoteMember.publicKey;
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

    // Persist with new ID first, then delete the stale entry — guarantees the DB
    // never has a window where the workspace exists under neither ID.
    await this.persistWorkspace(localWs.id);
    if (_staleId) {
      await this.persistentStore.deleteWorkspace(_staleId).catch(() => {});
    }
    this.ui?.renderApp();
    console.log(`[Sync] Workspace state synced from ${peerId.slice(0, 8)}`);
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
        this.transport.destroy();
        await this.transport.init(this.state.myPeerId || undefined);
        this.setupTransportHandlers();
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
    let attempted = 0;

    for (const member of ws.members) {
      if (member.peerId === this.state.myPeerId) continue;
      if (connectedPeers.has(member.peerId)) continue;
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

  async restoreFromStorage(): Promise<void> {
    const savedAlias = await this.persistentStore.getSetting('myAlias');
    if (savedAlias) this.state.myAlias = savedAlias;

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
            this.transport.send(peerId, { type: 'name-announce', workspaceId: wsId, alias });
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

    const result = await this.messageStore.addMessage(msg);
    if (!result.success) {
      this.ui?.showToast('Failed to create message: ' + result.error, 'error');
      return;
    }

    const crdt = this.getOrCreateCRDT(this.state.activeChannelId);
    const crdtMsg = crdt.createMessage(this.state.activeChannelId, content.trim(), 'text', threadId);
    (msg as any).vectorClock = crdtMsg.vectorClock;

    await this.persistMessage(msg);

    if (threadId && this.state.threadOpen) {
      this.ui?.renderThreadMessages();
    } else if (!threadId) {
      this.ui?.appendMessageToDOM(msg);
    }
    // Update reply count on parent message for the sender (peer events handle remote side)
    if (threadId) {
      this.ui?.updateThreadIndicator(threadId, this.state.activeChannelId);
    }

    // Deliver to workspace peers (or queue if offline)
    let sentDirectly = false;
    for (const peerId of this.getWorkspaceRecipientPeerIds()) {
      try {
        const envelope = await this.messageProtocol!.encryptMessage(peerId, content.trim(), 'text');
        (envelope as any).channelId = this.state.activeChannelId;
        (envelope as any).workspaceId = this.state.activeWorkspaceId;
        (envelope as any).threadId = threadId;
        (envelope as any).vectorClock = (msg as any).vectorClock;
        (envelope as any).messageId = msg.id; // For reaction targeting — receiver must use same ID

        if (this.state.readyPeers.has(peerId)) {
          this.transport.send(peerId, envelope);
          sentDirectly = true;
        } else {
          await this.offlineQueue.enqueue(peerId, envelope);
        }
      } catch (err) {
        console.error('Send to', peerId, 'failed:', err);
      }
    }

    // DEP-005: Transition pending → sent once dispatched to at least one live peer
    if (sentDirectly && msg.status !== 'sent' && msg.status !== 'delivered') {
      msg.status = 'sent';
      await this.persistentStore.saveMessage({ ...msg, status: 'sent' });
      this.ui?.updateMessageStatus?.(msg.id, 'sent');
    }

  }

  // =========================================================================
  // Workspace / channel helpers (delegated to by UIRenderer callbacks)
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

  async joinWorkspace(code: string, alias: string, peerId: string, inviteData?: InviteData): Promise<void> {
    console.log('[DecentChat] joinWorkspace called:', { code, alias, peerId, hasUI: !!this.ui });
    // Create the workspace locally for the joining user
    const ws = this.workspaceManager.createWorkspace(
      code, // use invite code as workspace name (will be updated from peer)
      this.state.myPeerId,
      alias,
      this.myPublicKey,
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

    // Bootstrap local member list so outbound messages can target inviter
    this.workspaceManager.addMember(ws.id, {
      peerId,
      alias: peerId.slice(0, 8),
      publicKey: inviteData?.publicKey || '',
      joinedAt: Date.now(),
      role: 'member',
    });

    // Set as active workspace
    this.state.activeWorkspaceId = ws.id;
    this.state.activeChannelId = ws.channels[0]?.id || null;

    // Persist BEFORE rendering — if this fails the workspace would be lost on refresh
    await this.persistWorkspace(ws.id);

    // Render the app UI
    this.ui?.renderApp();

    // Connect to the peer who invited us
    this.transport.connect(peerId);
  }

  connectPeer(peerId: string): void {
    this.transport.connect(peerId);
  }

  createChannel(name: string): { success: boolean; channel?: Channel; error?: string } {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };
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

  createDM(peerId: string): { success: boolean; channel?: Channel } {
    if (!this.state.activeWorkspaceId) return { success: false };
    return this.workspaceManager.createDM(
      this.state.activeWorkspaceId,
      this.state.myPeerId,
      peerId,
    );
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

    const result = await this.messageStore.addMessage(msg);
    if (!result.success) {
      this.ui?.showToast('Failed to create message: ' + result.error, 'error');
      return;
    }

    const crdt = this.getOrCreateCRDT(conversationId);
    const crdtMsg = crdt.createMessage(conversationId, content.trim(), 'text', threadId);
    (msg as any).vectorClock = crdtMsg.vectorClock;

    await this.persistMessage(msg);
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
        this.ui?.appendMessageToDOM(msg);
      }
      // Update reply count on parent message for the sender
      if (threadId) {
        this.ui?.updateThreadIndicator(threadId, conversationId);
      }
    }

    // Encrypt and send to the contact
    const peerId = conv.contactPeerId;
    try {
      const envelope = await this.messageProtocol!.encryptMessage(peerId, content.trim(), 'text');
      (envelope as any).channelId = conversationId;
      (envelope as any).threadId = threadId;
      (envelope as any).vectorClock = (msg as any).vectorClock;
      (envelope as any).isDirect = true;

      if (this.state.readyPeers.has(peerId)) {
        this.transport.send(peerId, envelope);
      } else {
        await this.offlineQueue.enqueue(peerId, envelope);
      }
    } catch (err) {
      console.error('Direct message send failed:', err);
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

  /** Generate a full invite URL for a workspace */
  generateInviteURL(workspaceId: string): string {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return '';

    // Parse primary signaling server
    const defaultServer = getDefaultSignalingServer();
    const { host, port, secure, path } = this.parseSignalingURL(defaultServer);

    // Build InviteData
    const inviteData: InviteData = {
      host,
      port,
      inviteCode: ws.inviteCode,
      secure,
      path,
      fallbackServers: [],
      turnServers: [],
      peerId: this.state.myPeerId,
      publicKey: this.myPublicKey || undefined,
      workspaceName: ws.name || undefined,
    };

    // Use InviteURI.encode to generate proper URL (InviteURI hardcodes https, fix for localhost)
    const isLocal = window.location.hostname === 'localhost';
    const webDomain = isLocal ? `localhost:${window.location.port}` : 'decentchat.app';
    const url = InviteURI.encode(inviteData, webDomain);
    return isLocal ? url.replace('https://', 'http://') : url;
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
    (msg as any).attachments = [meta];

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
      this.ui?.appendMessageToDOM(msg);
    }

    // Send to workspace peers
    for (const peerId of this.getWorkspaceRecipientPeerIds()) {
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
      } catch (err) {
        console.error('Send attachment to', peerId, 'failed:', err);
      }
    }
  }

  /**
   * Request a media blob from a peer
   */
  requestMedia(peerId: string, attachmentId: string): void {
    const request: MediaRequest = { type: 'media-request', attachmentId };
    this.transport.send(peerId, request);
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
      this.ui?.showToast(`Media not available from ${peerId.slice(0, 8)}`, 'error');
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
    const wsId = this.state.activeWorkspaceId;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;

    const channelTimestamps: Record<string, number> = {};
    for (const ch of ws.channels) {
      const msgs = this.messageStore.getMessages(ch.id);
      const last = msgs[msgs.length - 1];
      channelTimestamps[ch.id] = last?.timestamp ?? 0;
    }

    this.transport.send(peerId, {
      type: 'message-sync-request',
      workspaceId: wsId,
      channelTimestamps,
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

    for (const ch of ws.channels) {
      const since = channelTimestamps[ch.id] ?? 0;
      const msgs = this.messageStore.getMessages(ch.id);
      const newer = msgs.filter(m => m.timestamp > since);
      // Limit to 50 per channel
      const limited = newer.slice(0, 50);
      for (const m of limited) {
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

  private async handleMessageSyncResponse(_peerId: string, data: any): Promise<void> {
    const wsId = data.workspaceId;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === _peerId)) return;

    const messages: any[] = data.messages || [];
    let added = 0;

    for (const msg of messages) {
      // Skip if we already have this message
      const existing = this.messageStore.getMessages(msg.channelId);
      if (existing.some(m => m.id === msg.id)) continue;

      // Skip if channel not in this workspace
      if (!ws.channels.some((ch: any) => ch.id === msg.channelId)) continue;

      // Create and add the message
      const newMsg = await this.messageStore.createMessage(
        msg.channelId, msg.senderId, msg.content, msg.type || 'text', msg.threadId,
      );
      newMsg.id = msg.id;
      newMsg.timestamp = msg.timestamp;
      (newMsg as any).vectorClock = msg.vectorClock;

      const result = await this.messageStore.addMessage(newMsg);
      if (result.success) {
        const crdt = this.getOrCreateCRDT(msg.channelId);
        crdt.addMessage({
          id: newMsg.id,
          channelId: newMsg.channelId,
          senderId: newMsg.senderId,
          content: newMsg.content,
          type: (newMsg.type || 'text') as any,
          vectorClock: msg.vectorClock || {},
          wallTime: newMsg.timestamp,
          prevHash: newMsg.prevHash || '',
        });
        await this.persistMessage(newMsg);
        added++;

        // Re-render if this is the active channel
        if (msg.channelId === this.state.activeChannelId) {
          this.ui?.renderMessages();
        }
      }
    }

    if (added > 0) {
      console.log(`[Sync] Message sync: added ${added} missing message(s)`);
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
    const queued = await this.offlineQueue.flush(peerId);
    for (const envelope of queued) {
      try {
        this.transport.send(peerId, envelope);
      } catch (err) {
        console.error('Failed to deliver queued message to', peerId, err);
      }
    }
    if (queued.length > 0) {
      this.ui?.showToast(
        `📬 Delivered ${queued.length} queued message${queued.length > 1 ? 's' : ''} to ${peerId.slice(0, 8)}`,
        'success',
      );
    }
  }

  private getWorkspaceRecipientPeerIds(): string[] {
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    if (!ws) return [];
    // ONLY send to peers who are members of the active workspace AND have a ready connection.
    // Do NOT union with readyPeers globally — that would leak messages across workspaces.
    return ws.members
      .map((m: any) => m.peerId)
      .filter((p: string) => p !== this.state.myPeerId && this.state.readyPeers.has(p));
  }

  private ensurePeerInActiveWorkspace(peerId: string, publicKey = ''): void {
    const wsId = this.state.activeWorkspaceId;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws || ws.members.some(m => m.peerId === peerId)) return;

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
        this.transport.send(peerId, { type: 'name-announce', workspaceId: wsId, alias });
      }
    }
  }
}
