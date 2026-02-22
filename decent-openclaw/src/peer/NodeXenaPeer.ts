/**
 * NodeXenaPeer — Xena as a permanent DecentChat P2P peer.
 */

// MUST be first import — installs RTCPeerConnection globals before PeerJS loads
import './polyfill.js';

import {
  CryptoManager,
  InviteURI,
  MessageStore,
  SeedPhraseManager,
  SyncProtocol,
  WorkspaceManager,
} from 'decent-protocol';
import type { SyncEvent, Workspace, WorkspaceMember } from 'decent-protocol';
import { PeerTransport } from 'decent-transport-webrtc';
import { FileStore } from './FileStore.js';
import { NodeMessageProtocol } from './NodeMessageProtocol.js';
import type { ResolvedDecentChatAccount } from '../types.js';

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
  log?: { info: (s: string) => void; warn?: (s: string) => void; error?: (s: string) => void };
}

export class NodeXenaPeer {
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
  private readonly opts: NodeXenaPeerOptions;

  constructor(opts: NodeXenaPeerOptions) {
    this.opts = opts;
    this.store = new FileStore(opts.account.dataDir);
    this.workspaceManager = new WorkspaceManager();
    this.messageStore = new MessageStore();
    this.cryptoManager = new CryptoManager();
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
    });
    await this.messageProtocol.init(ecdsaKeyPair);

    this.restoreWorkspaces();
    this.restoreMessages();

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

  async sendMessage(channelId: string, workspaceId: string, content: string, threadId?: string, replyToId?: string): Promise<void> {
    if (!this.transport || !this.messageProtocol || !content.trim()) return;

    const msg = await this.messageStore.createMessage(channelId, this.myPeerId, content.trim(), 'text', threadId);
    const added = await this.messageStore.addMessage(msg);
    if (added.success) {
      this.persistMessagesForChannel(channelId);
    }

    const workspace = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
    const recipients = workspace
      ? workspace.members.map((m) => m.peerId).filter((p) => p !== this.myPeerId)
      : this.transport.getConnectedPeers().filter((p) => p !== this.myPeerId);

    for (const peerId of recipients) {
      if (!this.transport.getConnectedPeers().includes(peerId)) continue;
      try {
        const envelope = await this.messageProtocol.encryptMessage(peerId, content.trim(), 'text');
        (envelope as any).channelId = channelId;
        (envelope as any).workspaceId = workspaceId;
        (envelope as any).senderId = this.myPeerId;
        (envelope as any).senderName = this.opts.account.alias;
        (envelope as any).messageId = msg.id;
        if (threadId) (envelope as any).threadId = threadId;
        if (replyToId) (envelope as any).replyToId = replyToId;
        this.transport.send(peerId, envelope);
      } catch (err) {
        this.opts.log?.error?.(`[xena-peer] failed to encrypt for ${peerId}: ${String(err)}`);
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

      await this.transport.connect(invite.peerId);

      const member: WorkspaceMember = {
        peerId: this.myPeerId,
        alias: this.opts.account.alias,
        publicKey: this.myPublicKey,
        role: 'member',
        joinedAt: Date.now(),
      };

      this.syncProtocol.requestJoin(invite.peerId, invite.inviteCode, member);
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
    this.transport?.destroy();
    this.opts.log?.info('[xena-peer] stopped');
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

    if (msg?.type === 'ack') return;

    if (msg?.type === 'handshake') {
      await this.messageProtocol.processHandshake(fromPeerId, msg);
      const knownKeys = this.store.get<Record<string, string>>('peer-public-keys', {});
      knownKeys[fromPeerId] = msg.publicKey;
      this.store.set('peer-public-keys', knownKeys);
      this.updateWorkspaceMemberKey(fromPeerId, msg.publicKey);
      // Save sender's display name if provided
      if (msg.alias) {
        this.updateWorkspaceMemberAlias(fromPeerId, msg.alias as string);
      }
      return;
    }

    // Handle name-announce (unencrypted) — must be before the encrypted guard
    if (msg?.type === 'name-announce' && msg.alias) {
      const alias = msg.alias as string;
      this.updateWorkspaceMemberAlias(fromPeerId, alias);
      // Also cache directly so resolveSenderName can find it even before workspace sync
      this.store.set(`peer-alias-${fromPeerId}`, alias);
      return;
    }

    if (msg?.type === 'workspace-sync' && msg.sync) {
      const merged = msg.workspaceId ? { ...msg.sync, workspaceId: msg.workspaceId } : msg.sync;
      await this.syncProtocol.handleMessage(fromPeerId, merged);
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

    this.transport.send(fromPeerId, {
      type: 'ack',
      messageId: created.id,
      channelId,
    });

    const workspaceId = (msg.workspaceId as string | undefined) ?? '';
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

  private async sendHandshake(peerId: string): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;
    try {
      const handshake = await this.messageProtocol.createHandshake();
      this.transport.send(peerId, { type: 'handshake', ...handshake });
      // Announce display name (separate unencrypted message — same pattern as the web client)
      this.transport.send(peerId, { type: 'name-announce', alias: this.opts.account.alias });
    } catch (err) {
      this.opts.log?.error?.(`[xena-peer] handshake failed for ${peerId}: ${String(err)}`);
    }
  }

  private async handleSyncEvent(event: SyncEvent): Promise<void> {
    switch (event.type) {
      case 'workspace-joined': {
        this.opts.log?.info(`[xena-peer] joined workspace: ${event.workspace.id}`);
        this.persistWorkspaces();
        break;
      }
      case 'member-joined':
      case 'member-left':
      case 'channel-created': {
        this.persistWorkspaces();
        break;
      }
      case 'message-received': {
        this.persistMessagesForChannel(event.channelId);
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
      case 'sync-complete':
      default:
        break;
    }
  }

  private restoreWorkspaces(): void {
    const savedWorkspaces = this.store.get<Workspace[]>('workspaces', []);
    for (const ws of savedWorkspaces) {
      this.workspaceManager.importWorkspace(ws);
    }

    const savedPeers = this.store.get<Record<string, string>>('peer-public-keys', {});
    for (const [peerId, pubKey] of Object.entries(savedPeers)) {
      this.updateWorkspaceMemberKey(peerId, pubKey);
    }
  }

  private restoreMessages(): void {
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      for (const ch of ws.channels) {
        const messages = this.store.get<any[]>(`messages-${ch.id}`, []);
        for (const message of messages) {
          this.messageStore.forceAdd(message as any);
        }
      }
    }
  }

  private persistWorkspaces(): void {
    this.store.set('workspaces', this.workspaceManager.getAllWorkspaces());
  }

  private persistMessagesForChannel(channelId: string): void {
    this.store.set(`messages-${channelId}`, this.messageStore.getMessages(channelId));
  }

  /** Public convenience: resolve workspace by channelId then call sendMessage. */
  async sendToChannel(channelId: string, content: string, threadId?: string, replyToId?: string): Promise<void> {
    const workspaceId = this.findWorkspaceIdForChannel(channelId);
    return this.sendMessage(channelId, workspaceId, content, threadId, replyToId);
  }

  /** Send a direct (non-workspace) message to a specific peer with isDirect=true. */
  async sendDirectToPeer(peerId: string, content: string, threadId?: string, replyToId?: string): Promise<void> {
    if (!this.transport || !this.messageProtocol || !content.trim()) return;
    if (!this.transport.getConnectedPeers().includes(peerId)) return;

    try {
      const envelope = await this.messageProtocol.encryptMessage(peerId, content.trim(), 'text');
      (envelope as any).isDirect = true;
      (envelope as any).senderId = this.myPeerId;
      (envelope as any).senderName = this.opts.account.alias;
      if (threadId) (envelope as any).threadId = threadId;
      if (replyToId) (envelope as any).replyToId = replyToId;
      this.transport.send(peerId, envelope);
    } catch (err) {
      this.opts.log?.error?.(`[xena-peer] DM to ${peerId} failed: ${String(err)}`);
    }
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

  private updateWorkspaceMemberAlias(peerId: string, alias: string): void {
    let changed = false;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const member = ws.members.find((m) => m.peerId === peerId);
      if (member && member.alias !== alias) {
        member.alias = alias;
        changed = true;
      }
    }
    if (changed) {
      this.persistWorkspaces();
    }
  }
}
