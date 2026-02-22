/**
 * NodeXenaPeer — Xena as a permanent DecentChat P2P peer.
 */

import { installWebRTCPolyfill } from './polyfill.js';
installWebRTCPolyfill();

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

    // Collect signaling servers from all invites so we can find peers
    // regardless of which PeerJS server they registered on.
    for (const inviteUri of this.opts.account.invites ?? []) {
      try {
        const invite = InviteURI.decode(inviteUri);
        const scheme = invite.secure ? 'https' : 'http';
        const inviteServer = `${scheme}://${invite.host}:${invite.port}${invite.path}`;
        if (!allServers.includes(inviteServer)) {
          allServers.push(inviteServer);
        }
      } catch {
        // malformed invite — skip
      }
    }

    this.transport = new PeerTransport({
      signalingServers: allServers,
      useTurn: false,
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
    this.opts.log?.info(`[xena-peer] online as ${this.myPeerId}, signaling: ${signalingServer}`);

    for (const inviteUri of this.opts.account.invites ?? []) {
      await this.joinWorkspace(inviteUri);
    }
  }

  async sendMessage(channelId: string, workspaceId: string, content: string): Promise<void> {
    if (!this.transport || !this.messageProtocol || !content.trim()) return;

    const msg = await this.messageStore.createMessage(channelId, this.myPeerId, content.trim(), 'text');
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
    this.transport?.destroy();
    this.opts.log?.info('[xena-peer] stopped');
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
    const content = await this.messageProtocol.decryptMessage(fromPeerId, msg, peerPublicKey);
    if (!content) return;

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
    });
  }

  private async sendHandshake(peerId: string): Promise<void> {
    if (!this.transport || !this.messageProtocol) return;
    try {
      const handshake = await this.messageProtocol.createHandshake();
      this.transport.send(peerId, { type: 'handshake', ...handshake });
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

  private findWorkspaceIdForChannel(channelId: string): string {
    const ws = this.workspaceManager
      .getAllWorkspaces()
      .find((workspace) => workspace.channels.some((ch) => ch.id === channelId));
    return ws?.id ?? '';
  }

  private resolveSenderName(workspaceId: string, peerId: string, fallback?: string): string {
    const ws = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : undefined;
    const alias = ws?.members.find((m) => m.peerId === peerId)?.alias;
    return alias ?? fallback ?? peerId.slice(0, 8);
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
}
