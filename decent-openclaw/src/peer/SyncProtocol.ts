/**
 * SyncProtocol - P2P workspace synchronization with Negentropy-based catch-up.
 */

import {
  Negentropy,
  type Channel,
  type PEXServer,
  type PlaintextMessage,
  type SyncMessage,
  type Workspace,
  type WorkspaceMember,
  MessageStore,
  WorkspaceManager,
} from '@decentchat/protocol';
import type { ServerDiscovery } from '@decentchat/protocol';
import type { NegentropyQuery, NegentropyResponse } from '@decentchat/protocol';

export type SendFn = (peerId: string, data: any) => boolean;
export type OnEvent = (event: SyncEvent) => void;

type SyncedHistoryMessage = Omit<PlaintextMessage, 'content'> & { content?: string };

type CapabilityMessage = {
  type: 'sync-capabilities';
  workspaceId: string;
  response?: boolean;
  features: {
    negentropy: boolean;
  };
};

type NegentropyQueryMessage = {
  type: 'negentropy-query';
  workspaceId: string;
  channelId: string;
  query: NegentropyQuery;
};

type NegentropyResponseMessage = {
  type: 'negentropy-response';
  workspaceId: string;
  channelId: string;
  response: NegentropyResponse;
};

type NegentropyRequestMessagesMessage = {
  type: 'negentropy-request-messages';
  workspaceId: string;
  channelId: string;
  ids: string[];
};

type NegentropyMessageBatchMessage = {
  type: 'negentropy-message-batch';
  workspaceId: string;
  channelId: string;
  messages: SyncedHistoryMessage[];
  done: boolean;
};

type ExtendedSyncMessage =
  | SyncMessage
  | CapabilityMessage
  | NegentropyQueryMessage
  | NegentropyResponseMessage
  | NegentropyRequestMessagesMessage
  | NegentropyMessageBatchMessage;

export type SyncEvent =
  | { type: 'member-joined'; workspaceId: string; member: WorkspaceMember }
  | { type: 'member-left'; workspaceId: string; peerId: string }
  | { type: 'channel-created'; workspaceId: string; channel: Channel }
  | { type: 'channel-removed'; workspaceId: string; channelId: string }
  | { type: 'workspace-deleted'; workspaceId: string; deletedBy: string }
  | { type: 'workspace-joined'; workspace: Workspace; messageHistory: Record<string, SyncedHistoryMessage[]> }
  | { type: 'join-rejected'; reason: string }
  | { type: 'message-received'; channelId: string; message: PlaintextMessage }
  | { type: 'sync-complete'; workspaceId: string };

interface SyncProtocolOptions {
  enableNegentropy?: boolean;
  capabilityWaitMs?: number;
  negentropyBatchSize?: number;
}

const DEFAULT_CAPABILITY_WAIT_MS = 800;
const DEFAULT_NEGENTROPY_BATCH_SIZE = 50;

export class SyncProtocol {
  private workspaceManager: WorkspaceManager;
  private messageStore: MessageStore;
  private sendFn: SendFn;
  private onEvent: OnEvent;
  private myPeerId: string;
  private serverDiscovery?: ServerDiscovery;

  private readonly enableNegentropy: boolean;
  private readonly capabilityWaitMs: number;
  private readonly negentropyBatchSize: number;

  private peerCapabilities = new Map<string, { negentropy: boolean; updatedAt: number }>();
  private pendingCapabilityFallback = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingNegentropyResponse = new Map<string, (response: NegentropyResponse) => void>();
  private pendingNegentropyBatches = new Map<string, {
    resolve: (messages: SyncedHistoryMessage[]) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    messages: SyncedHistoryMessage[];
  }>();

  constructor(
    workspaceManager: WorkspaceManager,
    messageStore: MessageStore,
    sendFn: SendFn,
    onEvent: OnEvent,
    myPeerId: string,
    serverDiscovery?: ServerDiscovery,
    options: SyncProtocolOptions = {},
  ) {
    this.workspaceManager = workspaceManager;
    this.messageStore = messageStore;
    this.sendFn = sendFn;
    this.onEvent = onEvent;
    this.myPeerId = myPeerId;
    this.serverDiscovery = serverDiscovery;

    this.enableNegentropy = options.enableNegentropy ?? true;
    this.capabilityWaitMs = options.capabilityWaitMs ?? DEFAULT_CAPABILITY_WAIT_MS;
    this.negentropyBatchSize = options.negentropyBatchSize ?? DEFAULT_NEGENTROPY_BATCH_SIZE;
  }

  async handleMessage(fromPeerId: string, msg: ExtendedSyncMessage): Promise<void> {
    switch (msg.type) {
      case 'sync-capabilities':
        this.handleCapabilities(fromPeerId, msg);
        break;
      case 'negentropy-query':
        await this.handleNegentropyQuery(fromPeerId, msg);
        break;
      case 'negentropy-response':
        this.handleNegentropyResponse(fromPeerId, msg);
        break;
      case 'negentropy-request-messages':
        this.handleNegentropyRequestMessages(fromPeerId, msg);
        break;
      case 'negentropy-message-batch':
        this.handleNegentropyMessageBatch(fromPeerId, msg);
        break;
      case 'join-request':
        this.handleJoinRequest(fromPeerId, msg);
        break;
      case 'join-accepted':
        await this.handleJoinAccepted(fromPeerId, msg);
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
      default:
        break;
    }
  }

  requestJoin(targetPeerId: string, inviteCode: string, myMember: WorkspaceMember, inviteId?: string): void {
    const msg: SyncMessage = {
      type: 'join-request',
      inviteCode,
      member: myMember,
      inviteId,
      pexServers: this.serverDiscovery?.getHandshakeServers(),
    };
    this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
  }

  broadcastMemberJoined(workspaceId: string, member: WorkspaceMember, connectedPeerIds: string[]): void {
    const msg: SyncMessage = { type: 'member-joined', member };
    for (const peerId of connectedPeerIds) {
      if (peerId !== member.peerId && peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: 'workspace-sync', sync: msg, workspaceId });
      }
    }
  }

  broadcastChannelCreated(workspaceId: string, channel: Channel, connectedPeerIds: string[]): void {
    const msg: SyncMessage = { type: 'channel-created', channel };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: 'workspace-sync', sync: msg, workspaceId });
      }
    }
  }

  broadcastWorkspaceDeleted(workspaceId: string, deletedBy: string, connectedPeerIds: string[]): void {
    const msg: SyncMessage = { type: 'workspace-deleted', workspaceId, deletedBy } as any;
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: 'workspace-sync', sync: msg, workspaceId });
      }
    }
  }

  broadcastMessage(channelId: string, message: PlaintextMessage, connectedPeerIds: string[]): void {
    const msg: SyncMessage = { type: 'channel-message', channelId, message: message as any };
    for (const peerId of connectedPeerIds) {
      if (peerId !== this.myPeerId) {
        this.sendFn(peerId, { type: 'workspace-sync', sync: msg });
      }
    }
  }

  requestSync(targetPeerId: string, workspaceId: string): void {
    if (!this.enableNegentropy) {
      this.sendLegacySyncRequest(targetPeerId, workspaceId);
      return;
    }

    const known = this.peerCapabilities.get(targetPeerId);
    if (known?.negentropy) {
      this.startNegentropySyncSafely(targetPeerId, workspaceId);
      return;
    }

    this.sendCapabilities(targetPeerId, workspaceId);

    const key = `${targetPeerId}:${workspaceId}`;
    const existing = this.pendingCapabilityFallback.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingCapabilityFallback.delete(key);
      const current = this.peerCapabilities.get(targetPeerId);
      if (current?.negentropy) {
        this.startNegentropySyncSafely(targetPeerId, workspaceId);
      } else {
        this.sendLegacySyncRequest(targetPeerId, workspaceId);
      }
    }, this.capabilityWaitMs);

    this.pendingCapabilityFallback.set(key, timer);
  }

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

  getServerDiscovery(): ServerDiscovery | undefined {
    return this.serverDiscovery;
  }

  private sendCapabilities(peerId: string, workspaceId: string, response = false): void {
    const msg: CapabilityMessage = {
      type: 'sync-capabilities',
      workspaceId,
      response,
      features: { negentropy: this.enableNegentropy },
    };
    this.sendFn(peerId, { type: 'workspace-sync', sync: msg });
  }

  private handleCapabilities(fromPeerId: string, msg: CapabilityMessage): void {
    this.peerCapabilities.set(fromPeerId, {
      negentropy: Boolean(msg.features?.negentropy),
      updatedAt: Date.now(),
    });

    if (!msg.response) {
      this.sendCapabilities(fromPeerId, msg.workspaceId, true);
    }

    const key = `${fromPeerId}:${msg.workspaceId}`;
    const pending = this.pendingCapabilityFallback.get(key);
    if (!pending) return;

    clearTimeout(pending);
    this.pendingCapabilityFallback.delete(key);

    if (msg.features?.negentropy && this.enableNegentropy) {
      this.startNegentropySyncSafely(fromPeerId, msg.workspaceId);
    } else {
      this.sendLegacySyncRequest(fromPeerId, msg.workspaceId);
    }
  }

  private startNegentropySyncSafely(targetPeerId: string, workspaceId: string): void {
    void this.startNegentropySync(targetPeerId, workspaceId).catch(() => {
      this.sendLegacySyncRequest(targetPeerId, workspaceId);
    });
  }

  private async startNegentropySync(targetPeerId: string, workspaceId: string): Promise<void> {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return;

    for (const channel of workspace.channels) {
      await this.syncChannelWithNegentropy(targetPeerId, workspaceId, channel.id);
    }

    this.onEvent({ type: 'sync-complete', workspaceId });
  }

  private async syncChannelWithNegentropy(targetPeerId: string, workspaceId: string, channelId: string): Promise<void> {
    const localMessages = this.messageStore.getMessages(channelId);
    const negentropy = new Negentropy();
    await negentropy.build(localMessages.map((message) => ({ id: message.id, timestamp: message.timestamp })));

    const needResult = await negentropy.reconcile(async (query) => {
      return this.sendNegentropyQuery(targetPeerId, workspaceId, channelId, query);
    });

    if (needResult.need.length === 0) return;

    const fetched = await this.requestMissingMessages(targetPeerId, workspaceId, channelId, needResult.need);
    if (fetched.length === 0) return;

    await this.mergeSyncedMessages(channelId, fetched);
  }

  private async sendNegentropyQuery(
    targetPeerId: string,
    workspaceId: string,
    channelId: string,
    query: NegentropyQuery,
  ): Promise<NegentropyResponse> {
    const key = `${targetPeerId}:${workspaceId}:${channelId}`;

    return await new Promise<NegentropyResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingNegentropyResponse.delete(key);
        reject(new Error(`Negentropy response timeout from ${targetPeerId}`));
      }, 5000);

      this.pendingNegentropyResponse.set(key, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      const msg: NegentropyQueryMessage = {
        type: 'negentropy-query',
        workspaceId,
        channelId,
        query,
      };

      const sent = this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
      if (!sent) {
        clearTimeout(timeout);
        this.pendingNegentropyResponse.delete(key);
        reject(new Error(`Failed to send negentropy query to ${targetPeerId}`));
      }
    });
  }

  private async handleNegentropyQuery(fromPeerId: string, msg: NegentropyQueryMessage): Promise<void> {
    const localMessages = this.messageStore.getMessages(msg.channelId);
    const negentropy = new Negentropy();
    await negentropy.build(localMessages.map((message) => ({ id: message.id, timestamp: message.timestamp })));
    const response = await negentropy.processQuery(msg.query);

    const payload: NegentropyResponseMessage = {
      type: 'negentropy-response',
      workspaceId: msg.workspaceId,
      channelId: msg.channelId,
      response,
    };

    this.sendFn(fromPeerId, { type: 'workspace-sync', sync: payload });
  }

  private handleNegentropyResponse(fromPeerId: string, msg: NegentropyResponseMessage): void {
    const key = `${fromPeerId}:${msg.workspaceId}:${msg.channelId}`;
    const resolver = this.pendingNegentropyResponse.get(key);
    if (!resolver) return;
    this.pendingNegentropyResponse.delete(key);
    resolver(msg.response);
  }

  private async requestMissingMessages(
    targetPeerId: string,
    workspaceId: string,
    channelId: string,
    ids: string[],
  ): Promise<SyncedHistoryMessage[]> {
    const key = `${targetPeerId}:${workspaceId}:${channelId}`;

    return await new Promise<SyncedHistoryMessage[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingNegentropyBatches.delete(key);
        reject(new Error(`Negentropy message batch timeout from ${targetPeerId}`));
      }, 5000);

      this.pendingNegentropyBatches.set(key, {
        resolve,
        reject,
        timer: timeout,
        messages: [],
      });

      const msg: NegentropyRequestMessagesMessage = {
        type: 'negentropy-request-messages',
        workspaceId,
        channelId,
        ids,
      };

      const sent = this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
      if (!sent) {
        clearTimeout(timeout);
        this.pendingNegentropyBatches.delete(key);
        reject(new Error(`Failed to request missing messages from ${targetPeerId}`));
      }
    });
  }

  private handleNegentropyRequestMessages(fromPeerId: string, msg: NegentropyRequestMessagesMessage): void {
    const requested = new Set(msg.ids);
    const messages = this.messageStore
      .getMessages(msg.channelId)
      .filter((message) => requested.has(message.id))
      .map((message) => {
        const { content, ...safe } = message;
        return safe;
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    if (messages.length === 0) {
      const emptyDone: NegentropyMessageBatchMessage = {
        type: 'negentropy-message-batch',
        workspaceId: msg.workspaceId,
        channelId: msg.channelId,
        messages: [],
        done: true,
      };
      this.sendFn(fromPeerId, { type: 'workspace-sync', sync: emptyDone });
      return;
    }

    for (let i = 0; i < messages.length; i += this.negentropyBatchSize) {
      const batch = messages.slice(i, i + this.negentropyBatchSize);
      const payload: NegentropyMessageBatchMessage = {
        type: 'negentropy-message-batch',
        workspaceId: msg.workspaceId,
        channelId: msg.channelId,
        messages: batch,
        done: i + this.negentropyBatchSize >= messages.length,
      };
      this.sendFn(fromPeerId, { type: 'workspace-sync', sync: payload });
    }
  }

  private handleNegentropyMessageBatch(fromPeerId: string, msg: NegentropyMessageBatchMessage): void {
    const key = `${fromPeerId}:${msg.workspaceId}:${msg.channelId}`;
    const pending = this.pendingNegentropyBatches.get(key);
    if (!pending) return;

    pending.messages.push(...msg.messages);

    if (!msg.done) return;

    clearTimeout(pending.timer);
    this.pendingNegentropyBatches.delete(key);
    pending.resolve(pending.messages);
  }

  private async mergeSyncedMessages(channelId: string, incoming: SyncedHistoryMessage[]): Promise<void> {
    const existing = this.messageStore.getMessages(channelId);
    const merged = new Map<string, SyncedHistoryMessage>();

    for (const message of existing) {
      const { content, ...safe } = message;
      merged.set(message.id, safe);
    }

    for (const message of incoming) {
      if (!merged.has(message.id)) {
        merged.set(message.id, { ...message });
      }
    }

    const sorted = Array.from(merged.values()).sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id);
    });

    await this.messageStore.importMessages(channelId, sorted);
  }

  private sendLegacySyncRequest(targetPeerId: string, workspaceId: string): void {
    const msg: SyncMessage = { type: 'sync-request', workspaceId };
    this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
  }

  private handleJoinRequest(fromPeerId: string, msg: Extract<SyncMessage, { type: 'join-request' }>): void {
    if (msg.pexServers && this.serverDiscovery) {
      this.serverDiscovery.mergeReceivedServers(msg.pexServers);
    }

    const workspace = this.workspaceManager.validateInviteCode(msg.inviteCode);

    if (!workspace) {
      this.sendFn(fromPeerId, {
        type: 'workspace-sync',
        sync: { type: 'join-rejected', reason: 'Invalid invite code' } as SyncMessage,
      });
      return;
    }

    if (msg.inviteId && this.workspaceManager.isInviteRevoked(workspace.id, msg.inviteId)) {
      this.sendFn(fromPeerId, {
        type: 'workspace-sync',
        sync: { type: 'join-rejected', reason: 'This invite link has been revoked by an admin' } as SyncMessage,
      });
      return;
    }

    const result = this.workspaceManager.addMember(workspace.id, msg.member);

    if (!result.success) {
      this.sendFn(fromPeerId, {
        type: 'workspace-sync',
        sync: { type: 'join-rejected', reason: result.error || 'Failed to join' } as SyncMessage,
      });
      return;
    }

    const messageHistory: Record<string, SyncedHistoryMessage[]> = {};
    for (const channel of workspace.channels) {
      const msgs = this.messageStore.getMessages(channel.id);
      if (msgs.length > 0) {
        messageHistory[channel.id] = msgs.map((message) => {
          const { content, ...safeMsg } = message;
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
    this.onEvent({ type: 'member-joined', workspaceId: workspace.id, member: msg.member });
  }

  private async handleJoinAccepted(fromPeerId: string, msg: Extract<SyncMessage, { type: 'join-accepted' }>): Promise<void> {
    if (msg.pexServers && this.serverDiscovery) {
      this.serverDiscovery.mergeReceivedServers(msg.pexServers);
    }

    this.workspaceManager.importWorkspace(msg.workspace);

    for (const [channelId, messages] of Object.entries(msg.messageHistory)) {
      await this.messageStore.importMessages(channelId, messages as SyncedHistoryMessage[]);
    }

    this.onEvent({
      type: 'workspace-joined',
      workspace: msg.workspace,
      messageHistory: msg.messageHistory,
    });

    this.startNegentropySyncSafely(fromPeerId, msg.workspace.id);
  }

  private handleMemberJoined(msg: Extract<SyncMessage, { type: 'member-joined' }> & { workspaceId?: string }): void {
    if (!msg.workspaceId) return;
    const result = this.workspaceManager.addMember(msg.workspaceId, msg.member);
    if (result.success) {
      this.onEvent({ type: 'member-joined', workspaceId: msg.workspaceId, member: msg.member });
    }
  }

  private handleMemberLeft(msg: Extract<SyncMessage, { type: 'member-left' }> & { workspaceId?: string }): void {
    if (!msg.workspaceId) return;
    this.onEvent({ type: 'member-left', workspaceId: msg.workspaceId, peerId: msg.peerId });
  }

  private handleChannelCreated(msg: Extract<SyncMessage, { type: 'channel-created' }> & { workspaceId?: string }): void {
    const targetWsId = msg.workspaceId || msg.channel.workspaceId;
    if (!targetWsId) return;

    const ws = this.workspaceManager.getWorkspace(targetWsId);
    if (!ws) return;

    const existing = ws.channels.find((channel: Channel) => channel.id === msg.channel.id);
    if (!existing) {
      ws.channels.push(msg.channel);
      this.onEvent({ type: 'channel-created', workspaceId: ws.id, channel: msg.channel });
    }
  }

  private handleChannelRemoved(msg: Extract<SyncMessage, { type: 'channel-removed' }> & { workspaceId?: string }): void {
    if (!msg.workspaceId) return;

    const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!ws) return;

    const index = ws.channels.findIndex((channel: Channel) => channel.id === msg.channelId && channel.type === 'channel');
    if (index >= 0) {
      ws.channels.splice(index, 1);
      this.onEvent({ type: 'channel-removed', workspaceId: ws.id, channelId: msg.channelId });
    }
  }

  private handleWorkspaceDeleted(msg: Extract<SyncMessage, { type: 'workspace-deleted' }> & { workspaceId?: string }): void {
    const workspaceId = msg.workspaceId;
    if (!workspaceId) return;

    this.workspaceManager.removeWorkspace(workspaceId);
    this.onEvent({ type: 'workspace-deleted', workspaceId, deletedBy: msg.deletedBy });
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

    const messageHistory: Record<string, SyncedHistoryMessage[]> = {};
    for (const channel of workspace.channels) {
      const messages = this.messageStore.getMessages(channel.id);
      if (messages.length > 0) {
        messageHistory[channel.id] = messages.map((message) => {
          const { content, ...safeMsg } = message;
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
    this.workspaceManager.importWorkspace(msg.workspace);

    for (const [channelId, messages] of Object.entries(msg.messageHistory)) {
      await this.messageStore.importMessages(channelId, messages as SyncedHistoryMessage[]);
    }

    this.onEvent({ type: 'sync-complete', workspaceId: msg.workspace.id });
  }

  private handlePeerExchange(msg: Extract<SyncMessage, { type: 'peer-exchange' }>): void {
    if (this.serverDiscovery && msg.servers) {
      this.serverDiscovery.mergeReceivedServers(msg.servers);
    }
  }
}
