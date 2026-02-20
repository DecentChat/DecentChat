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

import { PeerTransport } from 'decent-transport-webrtc';
import { KeyStore } from '../crypto/KeyStore';
import { IndexedDBBlobStorage } from '../storage/IndexedDBBlobStorage';
// Database.ts is kept on disk (task #8 — not deleted yet) but is no longer
// instantiated here; PersistentStore is the single source of truth.
import { MessageProtocol } from '../messages/MessageProtocol';
import { PresenceManager } from '../ui/PresenceManager';
import { ReactionManager } from '../ui/ReactionManager';
import type { ReactionEvent } from '../ui/ReactionManager';
import type { TypingEvent, ReadReceipt } from '../ui/PresenceManager';
import { NotificationManager } from '../ui/NotificationManager';
import type { AppState } from '../main';

const DEV_SIGNAL_PORT = Number((import.meta as any).env?.VITE_SIGNAL_PORT || 9000);
const DEV_SIGNAL_WS = `ws://localhost:${DEV_SIGNAL_PORT}`;
const PROD_SIGNAL_WS = 'wss://0.peerjs.com/myapp'; // Free PeerJS cloud service

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

  /** DEP-002: Peer Exchange for signaling server discovery */
  private serverDiscovery: Map<string, ServerDiscovery> = new Map();
  private pexBroadcastInterval: number | null = null;

  /** Active chunked transfers (receiving) */
  private activeTransfers = new Map<string, ChunkedReceiver>();
  /** Active chunked transfers (sending) */
  private activeSenders = new Map<string, ChunkedSender>();

  myPublicKey: string = '';

  private ui: UIUpdater | null = null;

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
    this.transport.onConnect = async (peerId) => {
      this.state.connectedPeers.add(peerId);
      this.ui?.updateSidebar();

      try {
        const handshake = await this.messageProtocol!.createHandshake();
        this.transport.send(peerId, { type: 'handshake', ...handshake });
      } catch (err) {
        console.error('Handshake failed:', err);
      }
    };

    this.transport.onDisconnect = (peerId) => {
      this.state.connectedPeers.delete(peerId);
      this.state.readyPeers.delete(peerId);
      this.messageProtocol?.clearSharedSecret(peerId);
      this.ui?.updateSidebar();
    };

    this.transport.onMessage = async (peerId, rawData) => {
      const data = rawData as any;

      // Rate limit + validate before any processing
      const guardResult = this.messageGuard.check(peerId, data);
      if (!guardResult.allowed) {
        console.warn(`[Guard] Blocked message from ${peerId.slice(0, 8)}: ${guardResult.reason}`);
        return;
      }

      try {
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

          await this.messageProtocol!.processHandshake(peerId, data);
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
          // Also update the contact record if this peer is a contact
          this.contactStore.get(peerId).then(contact => {
            if (contact && contact.displayName !== data.alias) {
              this.contactStore.update(peerId, { displayName: data.alias }).catch(() => {});
              this.persistentStore.saveContact({ ...contact, displayName: data.alias }).catch(() => {});
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

        // --- Encrypted chat message ---
        // Use persistentStore as the single source of truth for peer public keys.
        const peerData = await this.persistentStore.getPeer(peerId);
        if (!peerData) return;

        const peerPublicKey = await this.cryptoManager.importPublicKey(peerData.publicKey);
        const content = await this.messageProtocol!.decryptMessage(peerId, data, peerPublicKey);
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
        const msg = await this.messageStore.createMessage(channelId, peerId, content, 'text', data.threadId);
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

    this.transport.onError = (error) => {
      // 'unavailable-id' is a transient race on page reload — PeerTransport retries silently.
      if ((error as any).type === 'unavailable-id' || error.message?.includes('is taken')) return;
      // Signaling server briefly dropped — PeerTransport auto-reconnects within ~3s.
      if (error.message?.includes('disconnecting from server') ||
          error.message?.includes('disconnected from server')) return;
      this.ui?.showToast(error.message, 'error');
    };
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

    // Remap workspace ID so both peers agree on the same ID.
    // Deterministic rule: the lexicographically smaller ID wins.
    // Both peers see both IDs and converge on the same canonical one.
    if (remoteWorkspaceId && localWs.id !== remoteWorkspaceId && remoteWorkspaceId < localWs.id) {
      const oldId = localWs.id;
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

      // Delete old persisted workspace and persist with new ID
      this.persistentStore.deleteWorkspace(oldId).catch(() => {});
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
        if (localCh && localCh.id !== remoteCh.id) {
          // Remap: adopt the remote channel ID so both peers use the same ID
          console.log(`[Sync] Remapping channel "${remoteCh.name}": ${localCh.id.slice(0, 8)} → ${remoteCh.id.slice(0, 8)}`);
          const oldId = localCh.id;
          localCh.id = remoteCh.id;

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

    // Persist and re-render
    await this.persistWorkspace(localWs.id);
    this.ui?.renderApp();
    console.log(`[Sync] Workspace state synced from ${peerId.slice(0, 8)}`);
  }

  /**
   * DEP-002: Try to connect to high-ranked servers we're not yet connected to
   */
  private async connectToDiscoveredServers(discovery: ServerDiscovery): Promise<void> {
    const ranked = discovery.getRankedServers();
    const currentServers = this.transport.getSignalingStatus().map(s => s.url);

    // Try to connect to top 3 servers we're not connected to
    let attempted = 0;
    for (const server of ranked) {
      if (attempted >= 3) break;
      if (currentServers.includes(server.url)) continue;

      attempted++;
      // Don't await - connect in background
      this.transport.addSignalingServer(server.url, `PEX:${server.url}`).then(success => {
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
            await this.messageStore.addMessage(msg);
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

    // DEP-002: Start periodic PEX broadcasts
    if (workspaces.length > 0) {
      this.startPEXBroadcasts();
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
        } else {
          await this.offlineQueue.enqueue(peerId, envelope);
        }
      } catch (err) {
        console.error('Send to', peerId, 'failed:', err);
      }
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

    return ws;
  }

  joinWorkspace(code: string, alias: string, peerId: string, inviteData?: InviteData): void {
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

    // Persist the workspace
    this.persistWorkspace(ws.id);

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
        try { await this.messageStore.addMessage(msg); } catch {}
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
  async sendAttachment(file: File, text?: string): Promise<void> {
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
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — generateImageThumbnail is not yet exported; gracefully skipped
        const { generateImageThumbnail } = await import('decent-protocol');
        const result = await generateImageThumbnail(file);
        if (result) {
          thumbnail = result.data;
          width = result.width;
          height = result.height;
        }
      } catch {}
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
    );
    (msg as any).attachments = [meta];

    const result = await this.messageStore.addMessage(msg);
    if (!result.success) return;

    const crdt = this.getOrCreateCRDT(this.state.activeChannelId);
    const crdtResult = crdt.createMessage(this.state.myPeerId, content);
    (msg as any).vectorClock = crdtResult.vectorClock;

    await this.persistMessage(msg);
    this.ui?.appendMessageToDOM(msg);

    // Send to workspace peers
    for (const peerId of this.getWorkspaceRecipientPeerIds()) {
      try {
        const envelope = await this.messageProtocol!.encryptMessage(peerId, content, 'text');
        (envelope as any).channelId = this.state.activeChannelId;
        (envelope as any).workspaceId = this.state.activeWorkspaceId;
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
    let ivBytes: Uint8Array;

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
      ivBytes = crypto.getRandomValues(new Uint8Array(12));
    }

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivBytes },
      aesKey,
      data,
    );

    return {
      ciphertext,
      iv: this.arrayBufferToBase64(ivBytes.buffer),
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

    if (turnUrls.length === 0) return undefined;

    const username = typeof env.VITE_TURN_USERNAME === 'string' ? env.VITE_TURN_USERNAME : '';
    const credential = typeof env.VITE_TURN_CREDENTIAL === 'string'
      ? env.VITE_TURN_CREDENTIAL
      : (typeof env.VITE_TURN_PASSWORD === 'string' ? env.VITE_TURN_PASSWORD : '');

    return turnUrls.map((url) => ({
      urls: url,
      ...(username ? { username } : {}),
      ...(credential ? { credential } : {}),
    }));
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
