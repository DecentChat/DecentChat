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
  MemoryBlobStorage,
  ChunkedSender,
  ChunkedReceiver,
  ClockSync,
  MessageGuard,
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
  renderApp: () => void;
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
    this.transport = MockT ? new MockT() : new PeerTransport();
    this.messageStore = new MessageStore();
    this.workspaceManager = new WorkspaceManager();
    this.persistentStore = new PersistentStore();
    this.offlineQueue = new OfflineQueue({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    // TODO: Replace MemoryBlobStorage with IndexedDB-backed storage for production
    this.mediaStore = new MediaStore(new MemoryBlobStorage());
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

  private tracePrefix(): string {
    const alias = (this.state.myAlias || '').trim();
    if (/^alice$/i.test(alias)) return '[TRACE Alice]';
    if (/^bob$/i.test(alias)) return '[TRACE Bob]';
    return `[TRACE ${alias || this.state.myPeerId.slice(0, 8)}]`;
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
      console.log(this.tracePrefix(), 'onMessage inbound', {
        fromPeerId: peerId,
        type: data?.type,
        channelId: data?.channelId,
      });

      // Rate limit + validate before any processing
      const guardResult = this.messageGuard.check(peerId, data);
      if (!guardResult.allowed) {
        console.warn(`[Guard] Blocked message from ${peerId.slice(0, 8)}: ${guardResult.reason}`);
        return;
      }

      try {
        // --- Handshake ---
        if (data?.type === 'handshake') {
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

        // --- Workspace sync ---
        if (data?.type === 'workspace-sync') {
          this.handleSyncMessage(peerId, data);
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
          msg.timestamp = data.timestamp;
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

            const contactInfo = await this.contactStore.get(peerId);
            const senderName = contactInfo?.displayName || peerId.slice(0, 8);
            this.notifications.notify(channelId, senderName, senderName, content);
            this.ui?.updateSidebar();
          }
          return;
        }

        let channelId = data.channelId || this.state.activeChannelId || 'default';
        const wsForChannel = this.state.activeWorkspaceId
          ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
          : null;
        if (
          wsForChannel &&
          data.channelId &&
          !this.workspaceManager.getChannel(wsForChannel.id, data.channelId) &&
          wsForChannel.channels.length === 1
        ) {
          channelId = wsForChannel.channels[0].id;
        }
        const msg = await this.messageStore.createMessage(channelId, peerId, content);
        msg.timestamp = data.timestamp;
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

          if (channelId === this.state.activeChannelId) {
            this.ui?.appendMessageToDOM(msg);
          }

          // Notify
          const ws = this.state.activeWorkspaceId
            ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId) : null;
          const ch = ws ? this.workspaceManager.getChannel(ws.id, channelId) : null;
          this.notifications.notify(
            channelId,
            ch ? (ch.type === 'dm' ? ch.name : '#' + ch.name) : 'channel',
            peerId.slice(0, 8),
            content,
          );
        }
      } catch (error) {
        console.error('Message processing failed:', error);
      }
    };

    this.transport.onError = (error) => {
      this.ui?.showToast(error.message, 'error');
    };
  }

  private async handleSyncMessage(_peerId: string, msg: any): Promise<void> {
    console.log('Sync message from', _peerId, msg);

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
    const workspacePeers = this.getWorkspaceRecipientPeerIds();
    console.log(this.tracePrefix(), 'sendMessage entry', {
      content: content.slice(0, 200),
      activeChannelId: this.state.activeChannelId,
      workspacePeers,
    });
    console.log('[DecentChat] sendMessage called:', { content: content.slice(0, 50), channelId: this.state.activeChannelId, threadId });
    if (!content.trim() || !this.state.activeChannelId) return;

    const msg = await this.messageStore.createMessage(
      this.state.activeChannelId,
      this.state.myPeerId,
      content.trim(),
      'text',
      threadId,
    );

    const result = await this.messageStore.addMessage(msg);
    console.log('[DecentChat] addMessage result:', JSON.stringify(result), 'msgId:', msg.id);
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

    // Deliver to workspace peers (or queue if offline)
    for (const peerId of this.getWorkspaceRecipientPeerIds()) {
      try {
        const envelope = await this.messageProtocol!.encryptMessage(peerId, content.trim(), 'text');
        (envelope as any).channelId = this.state.activeChannelId;
        (envelope as any).threadId = threadId;
        (envelope as any).vectorClock = (msg as any).vectorClock;

        if (this.state.readyPeers.has(peerId)) {
          console.log(this.tracePrefix(), 'before transport.send', {
            peerId,
            envelope,
          });
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
    return this.workspaceManager.createChannel(
      this.state.activeWorkspaceId,
      name,
      this.state.myPeerId,
    );
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
    console.log(this.tracePrefix(), 'broadcastToWorkspacePeers', {
      recipients,
      readyPeers: Array.from(this.state.readyPeers),
      type: data?.type,
      channelId: data?.channelId,
    });
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

    // Encrypt blob with workspace key (for now, using self-encryption)
    // TODO: Use workspace shared key for proper E2E
    const encryptedBlob = arrayBuffer; // Placeholder — encrypt in production

    // Store locally
    const wsId = this.state.activeWorkspaceId || 'default';
    await this.mediaStore.store(wsId, meta, encryptedBlob);

    // Create chunked sender for when peers request it
    this.activeSenders.set(meta.id, new ChunkedSender(meta.id, encryptedBlob));

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
    (msg as any).vectorClock = crdtResult.clock.toJSON();

    await this.persistMessage(msg);
    this.ui?.appendMessageToDOM(msg);

    // Send to workspace peers
    for (const peerId of this.getWorkspaceRecipientPeerIds()) {
      try {
        const envelope = await this.messageProtocol!.encryptMessage(peerId, content, 'text');
        (envelope as any).channelId = this.state.activeChannelId;
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
    const blob = await this.mediaStore.getBlob(request.attachmentId);

    if (!blob) {
      // We don't have this blob — tell the requester
      const response: MediaResponse = {
        type: 'media-response',
        attachmentId: request.attachmentId,
        available: false,
      };
      this.transport.send(peerId, response);
      return;
    }

    // Create sender if needed
    if (!this.activeSenders.has(request.attachmentId)) {
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
          await this.mediaStore.store(wsId, att, blob);
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
    const workspacePeers = ws
      ? ws.members.map((m: any) => m.peerId).filter((p: string) => p !== this.state.myPeerId)
      : [];
    const readyPeers = Array.from(this.state.readyPeers).filter(p => p !== this.state.myPeerId);
    return Array.from(new Set([...workspacePeers, ...readyPeers]));
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
}
