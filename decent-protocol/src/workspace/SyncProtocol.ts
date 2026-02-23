/**
 * SyncProtocol - P2P workspace synchronization
 * 
 * Handles: join requests, workspace state exchange,
 * member announcements, channel creation broadcast,
 * and message history sync.
 */

import type { Workspace, WorkspaceMember, Channel, SyncMessage, PEXServer } from './types';
import type { PlaintextMessage } from '../messages/types';
import { WorkspaceManager } from './WorkspaceManager';
import { MessageStore } from '../messages/MessageStore';
import type { ServerDiscovery } from './ServerDiscovery';

type SyncedHistoryMessage = Omit<PlaintextMessage, 'content'> & { content?: string };

export type SendFn = (peerId: string, data: any) => boolean;
export type OnEvent = (event: SyncEvent) => void;

export type SyncEvent =
  | { type: 'member-joined'; workspaceId: string; member: WorkspaceMember }
  | { type: 'member-left'; workspaceId: string; peerId: string }
  | { type: 'channel-created'; workspaceId: string; channel: Channel }
  | { type: 'channel-removed'; workspaceId: string; channelId: string }
  | { type: 'workspace-deleted'; workspaceId: string; deletedBy: string }
  // Message history sent during sync intentionally omits plaintext `content`.
  | { type: 'workspace-joined'; workspace: Workspace; messageHistory: Record<string, SyncedHistoryMessage[]> }
  | { type: 'join-rejected'; reason: string }
  | { type: 'message-received'; channelId: string; message: PlaintextMessage }
  | { type: 'sync-complete'; workspaceId: string };

export class SyncProtocol {
  private workspaceManager: WorkspaceManager;
  private messageStore: MessageStore;
  private sendFn: SendFn;
  private onEvent: OnEvent;
  private myPeerId: string;
  private serverDiscovery?: ServerDiscovery; // DEP-002: Optional PEX support

  // Track pending join requests
  private pendingJoins = new Map<string, { inviteCode: string; member: WorkspaceMember }>();

  constructor(
    workspaceManager: WorkspaceManager,
    messageStore: MessageStore,
    sendFn: SendFn,
    onEvent: OnEvent,
    myPeerId: string,
    serverDiscovery?: ServerDiscovery
  ) {
    this.workspaceManager = workspaceManager;
    this.messageStore = messageStore;
    this.sendFn = sendFn;
    this.onEvent = onEvent;
    this.myPeerId = myPeerId;
    this.serverDiscovery = serverDiscovery;
  }

  /**
   * Handle incoming sync message from a peer
   */
  async handleMessage(fromPeerId: string, msg: SyncMessage): Promise<void> {
    switch (msg.type) {
      case 'join-request':
        this.handleJoinRequest(fromPeerId, msg);
        break;
      case 'join-accepted':
        await this.handleJoinAccepted(msg);
        break;
      case 'join-rejected':
        this.onEvent({ type: 'join-rejected', reason: msg.reason });
        break;
      case 'member-joined':
        this.handleMemberJoined(msg);
        break;
      case 'member-left':
        this.handleMemberLeft(msg);
        break;
      case 'channel-created':
        this.handleChannelCreated(msg);
        break;
      case 'channel-removed':
        this.handleChannelRemoved(msg);
        break;
      case 'workspace-deleted':
        this.handleWorkspaceDeleted(msg);
        break;
      case 'channel-message':
        await this.handleChannelMessage(fromPeerId, msg);
        break;
      case 'sync-request':
        this.handleSyncRequest(fromPeerId, msg);
        break;
      case 'sync-response':
        await this.handleSyncResponse(msg);
        break;
      case 'peer-exchange':
        this.handlePeerExchange(msg);
        break;
    }
  }

  // === Outgoing Actions ===

  /**
   * Send a join request to a peer (I want to join their workspace)
   */
  requestJoin(targetPeerId: string, inviteCode: string, myMember: WorkspaceMember): void {
    const msg: SyncMessage = {
      type: 'join-request',
      inviteCode,
      member: myMember,
      pexServers: this.serverDiscovery?.getHandshakeServers(),
    };
    this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
  }

  /**
   * Broadcast that a new member joined (to all connected workspace members)
   */
  broadcastMemberJoined(workspaceId: string, member: WorkspaceMember, connectedPeerIds: string[]): void {
    const msg: SyncMessage = { type: 'member-joined', member };
    for (const peerId of connectedPeerIds) {
      if (peerId !== member.peerId && peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: 'workspace-sync', sync: msg, workspaceId });
      }
    }
  }

  /**
   * Broadcast channel creation to all workspace peers
   */
  broadcastChannelCreated(workspaceId: string, channel: Channel, connectedPeerIds: string[]): void {
    const msg: SyncMessage = { type: 'channel-created', channel };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: 'workspace-sync', sync: msg, workspaceId });
      }
    }
  }

  /**
   * Broadcast workspace deletion to all connected workspace peers
   */
  broadcastWorkspaceDeleted(workspaceId: string, deletedBy: string, connectedPeerIds: string[]): void {
    const msg: SyncMessage = { type: 'workspace-deleted', workspaceId, deletedBy } as any;
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: 'workspace-sync', sync: msg, workspaceId });
      }
    }
  }

  /**
   * Broadcast a channel message to all connected workspace peers
   */
  broadcastMessage(channelId: string, message: PlaintextMessage, connectedPeerIds: string[]): void {
    const msg: SyncMessage = { type: 'channel-message', channelId, message: message as any };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: 'workspace-sync', sync: msg });
      }
    }
  }

  /**
   * Request full workspace sync from a peer
   */
  requestSync(targetPeerId: string, workspaceId: string): void {
    const msg: SyncMessage = { type: 'sync-request', workspaceId };
    this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
  }

  // === Incoming Handlers ===

  private handleJoinRequest(fromPeerId: string, msg: Extract<SyncMessage, { type: 'join-request' }>): void {
    // DEP-002: Merge received PEX servers
    if (msg.pexServers && this.serverDiscovery) {
      this.serverDiscovery.mergeReceivedServers(msg.pexServers);
    }

    // Validate invite code
    const workspace = this.workspaceManager.validateInviteCode(msg.inviteCode);

    if (!workspace) {
      this.sendFn(fromPeerId, {
        type: 'workspace-sync',
        sync: { type: 'join-rejected', reason: 'Invalid invite code' } as SyncMessage,
      });
      return;
    }

    // Add member to workspace
    const result = this.workspaceManager.addMember(workspace.id, msg.member);

    if (!result.success) {
      this.sendFn(fromPeerId, {
        type: 'workspace-sync',
        sync: { type: 'join-rejected', reason: result.error || 'Failed to join' } as SyncMessage,
      });
      return;
    }

    // Send full workspace state + message history
    // Sync history intentionally excludes plaintext content; encrypted payloads are sent separately.
    const messageHistory: Record<string, SyncedHistoryMessage[]> = {};
    for (const channel of workspace.channels) {
      const msgs = this.messageStore.getMessages(channel.id);
      if (msgs.length > 0) {
        messageHistory[channel.id] = msgs.map((msg) => {
          const { content, ...safeMsg } = msg;
          return safeMsg;
        });
      }
    }

    const acceptMsg: SyncMessage = {
      type: 'join-accepted',
      workspace: this.workspaceManager.exportWorkspace(workspace.id)!,
      messageHistory,
      pexServers: this.serverDiscovery?.getHandshakeServers(),
    };

    this.sendFn(fromPeerId, { type: 'workspace-sync', sync: acceptMsg });

    // Notify locally
    this.onEvent({ type: 'member-joined', workspaceId: workspace.id, member: msg.member });
  }

  private async handleJoinAccepted(msg: Extract<SyncMessage, { type: 'join-accepted' }>): Promise<void> {
    // DEP-002: Merge received PEX servers
    if (msg.pexServers && this.serverDiscovery) {
      this.serverDiscovery.mergeReceivedServers(msg.pexServers);
    }

    // Import workspace
    this.workspaceManager.importWorkspace(msg.workspace);

    // Import message histories (with chain verification)
    for (const [channelId, messages] of Object.entries(msg.messageHistory)) {
      await this.messageStore.importMessages(channelId, messages as SyncedHistoryMessage[]);
    }

    this.onEvent({
      type: 'workspace-joined',
      workspace: msg.workspace,
      messageHistory: msg.messageHistory,
    });
  }

  private handleMemberJoined(msg: Extract<SyncMessage, { type: 'member-joined' }> & { workspaceId?: string }): void {
    if (!msg.workspaceId) {
      console.warn('handleMemberJoined: missing workspaceId, ignoring message');
      return;
    }
    const result = this.workspaceManager.addMember(msg.workspaceId, msg.member);
    if (result.success) {
      this.onEvent({ type: 'member-joined', workspaceId: msg.workspaceId, member: msg.member });
    }
  }

  private handleMemberLeft(msg: Extract<SyncMessage, { type: 'member-left' }> & { workspaceId?: string }): void {
    if (!msg.workspaceId) {
      console.warn('handleMemberLeft: missing workspaceId, ignoring message');
      return;
    }
    this.onEvent({ type: 'member-left', workspaceId: msg.workspaceId, peerId: msg.peerId });
  }

  private handleChannelCreated(msg: Extract<SyncMessage, { type: 'channel-created' }> & { workspaceId?: string }): void {
    const targetWsId = msg.workspaceId || msg.channel.workspaceId;
    if (!targetWsId) {
      console.warn('handleChannelCreated: missing workspaceId, ignoring message');
      return;
    }

    const ws = this.workspaceManager.getWorkspace(targetWsId);
    if (!ws) return;

    const existing = ws.channels.find((c: Channel) => c.id === msg.channel.id);
    if (!existing) {
      ws.channels.push(msg.channel);
      this.onEvent({ type: 'channel-created', workspaceId: ws.id, channel: msg.channel });
    }
  }

  private handleChannelRemoved(msg: Extract<SyncMessage, { type: 'channel-removed' }> & { workspaceId?: string }): void {
    if (!msg.workspaceId) {
      console.warn('handleChannelRemoved: missing workspaceId, ignoring message');
      return;
    }

    const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!ws) return;

    const idx = ws.channels.findIndex((c: Channel) => c.id === msg.channelId && c.type === 'channel');
    if (idx >= 0) {
      ws.channels.splice(idx, 1);
      this.onEvent({ type: 'channel-removed', workspaceId: ws.id, channelId: msg.channelId });
    }
  }

  private handleWorkspaceDeleted(msg: Extract<SyncMessage, { type: 'workspace-deleted' }> & { workspaceId?: string }): void {
    const wsId = msg.workspaceId;
    if (!wsId) {
      console.warn('handleWorkspaceDeleted: missing workspaceId, ignoring message');
      return;
    }

    this.workspaceManager.removeWorkspace(wsId);
    this.onEvent({ type: 'workspace-deleted', workspaceId: wsId, deletedBy: msg.deletedBy });
  }

  private async handleChannelMessage(fromPeerId: string, msg: Extract<SyncMessage, { type: 'channel-message' }>): Promise<void> {
    const message = msg.message as unknown as PlaintextMessage;

    const result = await this.messageStore.addMessage(message);
    if (result.success) {
      this.onEvent({ type: 'message-received', channelId: msg.channelId, message });
    } else {
      console.warn('Rejected message from', fromPeerId, ':', result.error);
    }
  }

  private handleSyncRequest(fromPeerId: string, msg: Extract<SyncMessage, { type: 'sync-request' }>): void {
    const workspace = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!workspace) return;

    // Sync history intentionally excludes plaintext content; encrypted payloads are sent separately.
    const messageHistory: Record<string, SyncedHistoryMessage[]> = {};
    for (const channel of workspace.channels) {
      const msgs = this.messageStore.getMessages(channel.id);
      if (msgs.length > 0) {
        messageHistory[channel.id] = msgs.map((msg) => {
          const { content, ...safeMsg } = msg;
          return safeMsg;
        });
      }
    }

    const response: SyncMessage = {
      type: 'sync-response',
      workspace,
      messageHistory,
    };

    this.sendFn(fromPeerId, { type: 'workspace-sync', sync: response });
  }

  private async handleSyncResponse(msg: Extract<SyncMessage, { type: 'sync-response' }>): Promise<void> {
    // Update workspace
    this.workspaceManager.importWorkspace(msg.workspace);

    // Import verified message histories
    for (const [channelId, messages] of Object.entries(msg.messageHistory)) {
      await this.messageStore.importMessages(channelId, messages as SyncedHistoryMessage[]);
    }

    this.onEvent({ type: 'sync-complete', workspaceId: msg.workspace.id });
  }

  /**
   * DEP-002: Handle peer exchange message
   */
  private handlePeerExchange(msg: Extract<SyncMessage, { type: 'peer-exchange' }>): void {
    if (this.serverDiscovery && msg.servers) {
      this.serverDiscovery.mergeReceivedServers(msg.servers);
    }
  }

  /**
   * DEP-002: Broadcast PEX update to all connected peers
   * Call this periodically (e.g. every 5 minutes) or when servers change
   */
  broadcastPeerExchange(connectedPeerIds: string[]): void {
    if (!this.serverDiscovery) return;

    const msg: SyncMessage = {
      type: 'peer-exchange',
      servers: this.serverDiscovery.getHandshakeServers(),
    };

    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: 'workspace-sync', sync: msg });
      }
    }
  }

  /**
   * DEP-002: Get server discovery instance (for external integration)
   */
  getServerDiscovery(): ServerDiscovery | undefined {
    return this.serverDiscovery;
  }
}
