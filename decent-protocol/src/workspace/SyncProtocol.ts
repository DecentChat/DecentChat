/**
 * SyncProtocol - P2P workspace synchronization
 * 
 * Handles: join requests, workspace state exchange,
 * member announcements, channel creation broadcast,
 * and message history sync.
 */

import type {
  Workspace,
  WorkspaceMember,
  Channel,
  SyncMessage,
  MemberDirectoryPage,
  DirectoryShardRef,
  HistoryPageRef,
  HistoryPageSnapshot,
  HistoryReplicaHint,
  HistoryReplicaTier,
  HistorySyncCapabilities,
} from './types';
import { WorkspaceDeltaProtocol } from './WorkspaceDeltaProtocol';
import { DirectoryProtocol } from './DirectoryProtocol';
import { HistoryPageProtocol } from '../history/HistoryPageProtocol';
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
  | { type: 'member-page-received'; workspaceId: string; page: MemberDirectoryPage }
  | { type: 'history-page-received'; workspaceId: string; channelId: string; page: HistoryPageSnapshot }
  | { type: 'history-replica-hints'; workspaceId: string; hints: HistoryReplicaHint[] }
  | { type: 'directory-shards-updated'; workspaceId: string; shards: DirectoryShardRef[] }
  // Message history sent during sync intentionally omits plaintext `content`.
  | {
      type: 'workspace-joined';
      workspace: Workspace;
      messageHistory: Record<string, SyncedHistoryMessage[]>;
      historyReplicaHints?: HistoryReplicaHint[];
    }
  | { type: 'join-rejected'; reason: string }
  | { type: 'message-received'; channelId: string; message: PlaintextMessage }
  | { type: 'sync-complete'; workspaceId: string };

export class SyncProtocol {
  private static readonly HISTORY_PAGING_CAPABILITY = 'history-pages-v1';
  private static readonly HISTORY_BOOTSTRAP_PAGE_SIZE = 25;
  private static readonly HISTORY_BOOTSTRAP_CHANNEL_LIMIT = 6;
  private static readonly HISTORY_BOOTSTRAP_TTL_MS = 15_000;

  private workspaceManager: WorkspaceManager;
  private messageStore: MessageStore;
  private sendFn: SendFn;
  private onEvent: OnEvent;
  private myPeerId: string;
  private serverDiscovery?: ServerDiscovery; // DEP-002: Optional PEX support
  private workspaceDelta: WorkspaceDeltaProtocol;
  private directoryProtocol: DirectoryProtocol;
  private historyPageProtocol: HistoryPageProtocol;
  private historyBootstrapPendingUntil = new Map<string, number>();

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
    this.workspaceDelta = new WorkspaceDeltaProtocol(this.workspaceManager);
    this.directoryProtocol = new DirectoryProtocol(this.workspaceManager);
    this.historyPageProtocol = new HistoryPageProtocol(this.messageStore, this.workspaceManager);
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
        await this.handleSyncResponse(fromPeerId, msg);
        break;
      case 'workspace-shell-request':
        this.handleWorkspaceShellRequest(fromPeerId, msg);
        break;
      case 'workspace-shell-response':
        this.handleWorkspaceShellResponse(msg);
        break;
      case 'workspace-delta':
        this.handleWorkspaceDelta(fromPeerId, msg);
        break;
      case 'workspace-delta-ack':
        break;
      case 'member-page-request':
        this.handleMemberPageRequest(fromPeerId, msg);
        break;
      case 'member-page-response':
        this.handleMemberPageResponse(msg);
        break;
      case 'history-page-request':
        this.handleHistoryPageRequest(fromPeerId, msg);
        break;
      case 'history-page-response':
        this.handleHistoryPageResponse(msg);
        break;
      case 'history-replica-hints':
        this.handleHistoryReplicaHints(msg);
        break;
      case 'directory-shard-advertisement':
        this.handleDirectoryShardAdvertisement(msg);
        break;
      case 'directory-shard-repair':
        this.handleDirectoryShardRepair(fromPeerId, msg);
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
  requestJoin(
    targetPeerId: string,
    inviteCode: string,
    myMember: WorkspaceMember,
    inviteId?: string,
    options: {
      historySyncMode?: 'legacy' | 'paged';
      historyCapabilities?: HistorySyncCapabilities;
    } = {},
  ): void {
    const msg: SyncMessage = {
      type: 'join-request',
      inviteCode,
      member: myMember,
      inviteId,
      pexServers: this.serverDiscovery?.getHandshakeServers(),
      historySyncMode: options.historySyncMode,
      historyCapabilities: options.historyCapabilities ?? this.defaultHistoryCapabilities(),
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
  requestSync(
    targetPeerId: string,
    workspaceId: string,
    options: {
      historySyncMode?: 'legacy' | 'paged';
      historyCapabilities?: HistorySyncCapabilities;
    } = {},
  ): void {
    const msg: SyncMessage = {
      type: 'sync-request',
      workspaceId,
      historySyncMode: options.historySyncMode,
      historyCapabilities: options.historyCapabilities ?? this.defaultHistoryCapabilities(),
    };
    this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
  }

  requestWorkspaceShell(targetPeerId: string, workspaceId: string): void {
    const msg: SyncMessage = { type: 'workspace-shell-request', workspaceId };
    this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
  }

  requestMemberPage(
    targetPeerId: string,
    workspaceId: string,
    options: { cursor?: string; pageSize?: number; shardPrefix?: string } = {},
  ): void {
    const msg: SyncMessage = {
      type: 'member-page-request',
      workspaceId,
      cursor: options.cursor,
      pageSize: options.pageSize,
      shardPrefix: options.shardPrefix,
    };
    this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
  }

  requestHistoryPage(
    targetPeerId: string,
    workspaceId: string,
    channelId: string,
    options: {
      cursor?: string;
      pageSize?: number;
      direction?: 'older' | 'newer';
      tier?: 'recent' | 'archive';
    } = {},
  ): void {
    const msg: SyncMessage = {
      type: 'history-page-request',
      workspaceId,
      channelId,
      cursor: options.cursor,
      pageSize: options.pageSize,
      direction: options.direction,
      tier: options.tier,
    };
    this.sendFn(targetPeerId, { type: 'workspace-sync', sync: msg });
  }

  selectHistoryPageSource(
    workspaceId: string,
    channelId: string,
    tier: HistoryReplicaTier = 'recent',
    availablePeerIds: string[] = [],
  ): string | undefined {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return undefined;

    const channel = workspace.channels.find((candidate) => candidate.id === channelId);
    if (!channel) return undefined;

    const availableSet = availablePeerIds.length > 0 ? new Set(availablePeerIds) : undefined;

    const refs = [...(channel.historyPages ?? [])];
    const latestMatchingRef = refs
      .reverse()
      .find((ref) => ref.tier === tier || ref.tier === undefined);

    const fallbackHint = channel.historyReplicaHint;

    const recentCandidates = this.uniqueOrderedPeers([
      ...(latestMatchingRef?.recentReplicaPeerIds ?? []),
      ...(latestMatchingRef?.selectionPolicy === 'fallback-to-recent'
        ? latestMatchingRef.selectedReplicaPeerIds ?? []
        : []),
      ...(fallbackHint?.recentReplicaPeerIds ?? []),
    ]);

    const archiveCandidates = this.uniqueOrderedPeers([
      ...(latestMatchingRef?.archiveReplicaPeerIds ?? []),
      ...(latestMatchingRef?.selectionPolicy === 'fallback-to-archive'
        ? latestMatchingRef.selectedReplicaPeerIds ?? []
        : []),
      ...(fallbackHint?.archiveReplicaPeerIds ?? []),
    ]);

    const selectionOrder = tier === 'archive'
      ? this.uniqueOrderedPeers([
          ...(latestMatchingRef?.selectedReplicaPeerIds ?? []),
          ...archiveCandidates,
          ...recentCandidates,
        ])
      : this.uniqueOrderedPeers([
          ...(latestMatchingRef?.selectedReplicaPeerIds ?? []),
          ...recentCandidates,
          ...archiveCandidates,
        ]);

    return selectionOrder.find((peerId) => {
      if (peerId === this.myPeerId) return false;
      if (!availableSet) return true;
      return availableSet.has(peerId);
    });
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

    // Reject revoked invite links (if invite has a stable id)
    if (msg.inviteId && this.workspaceManager.isInviteRevoked(workspace.id, msg.inviteId)) {
      this.sendFn(fromPeerId, {
        type: 'workspace-sync',
        sync: { type: 'join-rejected', reason: 'This invite link has been revoked by an admin' } as SyncMessage,
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

    const historySyncMode = this.resolveHistorySyncMode(msg, workspace);
    const shouldUsePagedHistory = historySyncMode === 'paged';

    // Legacy clients still receive metadata-only full history during join.
    // Paged-capable clients fetch history windows on demand via history-page-request.
    const messageHistory = shouldUsePagedHistory ? {} : this.buildLegacyMessageHistory(workspace.id);

    const historyReplicaHints = shouldUsePagedHistory
      ? this.historyPageProtocol.buildReplicaHints(workspace.id)
      : undefined;

    const acceptMsg: SyncMessage = {
      type: 'join-accepted',
      workspace: this.workspaceManager.exportWorkspace(workspace.id)!,
      messageHistory,
      pexServers: this.serverDiscovery?.getHandshakeServers(),
      historyReplicaHints,
      historyCapabilities: shouldUsePagedHistory ? this.defaultHistoryCapabilities() : undefined,
    };

    this.sendFn(fromPeerId, { type: 'workspace-sync', sync: acceptMsg });

    // Notify locally
    this.onEvent({ type: 'member-joined', workspaceId: workspace.id, member: msg.member });
  }

  private async handleJoinAccepted(
    fromPeerId: string,
    msg: Extract<SyncMessage, { type: 'join-accepted' }>,
  ): Promise<void> {
    // DEP-002: Merge received PEX servers
    if (msg.pexServers && this.serverDiscovery) {
      this.serverDiscovery.mergeReceivedServers(msg.pexServers);
    }

    // Import workspace
    this.workspaceManager.importWorkspace(msg.workspace);

    // Import message histories (with chain verification)
    for (const [channelId, messages] of Object.entries(msg.messageHistory || {})) {
      await this.messageStore.importMessages(channelId, messages as SyncedHistoryMessage[]);
    }

    if (msg.historyReplicaHints?.length) {
      this.applyHistoryReplicaHints(msg.workspace.id, msg.historyReplicaHints);
    }

    this.onEvent({
      type: 'workspace-joined',
      workspace: msg.workspace,
      messageHistory: msg.messageHistory || {},
      historyReplicaHints: msg.historyReplicaHints,
    });

    if (msg.historyReplicaHints?.length) {
      this.onEvent({
        type: 'history-replica-hints',
        workspaceId: msg.workspace.id,
        hints: msg.historyReplicaHints,
      });
    }

    this.maybeBootstrapRecentHistory(fromPeerId, msg.workspace.id, msg.messageHistory || {}, msg.historyCapabilities);
  }

  private handleWorkspaceShellRequest(fromPeerId: string, msg: Extract<SyncMessage, { type: 'workspace-shell-request' }>): void {
    const shell = this.workspaceDelta.buildWorkspaceShell(msg.workspaceId);
    const workspace = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!shell || !workspace) return;

    const response: SyncMessage = {
      type: 'workspace-shell-response',
      shell,
      inviteCode: workspace.inviteCode,
    };
    this.sendFn(fromPeerId, { type: 'workspace-sync', sync: response });
  }

  private handleWorkspaceShellResponse(msg: Extract<SyncMessage, { type: 'workspace-shell-response' }>): void {
    this.workspaceDelta.applyWorkspaceShell(this.workspaceManager, msg.shell, msg.inviteCode);
    this.onEvent({ type: 'sync-complete', workspaceId: msg.shell.id });
  }

  private handleWorkspaceDelta(fromPeerId: string, msg: Extract<SyncMessage, { type: 'workspace-delta' }>): void {
    const result = this.workspaceDelta.applyDelta(this.workspaceManager, msg.delta);
    if (result.applied) {
      const ack: SyncMessage = {
        type: 'workspace-delta-ack',
        workspaceId: msg.delta.workspaceId,
        version: msg.delta.version,
        checkpointId: msg.delta.checkpointId,
      };
      this.sendFn(fromPeerId, { type: 'workspace-sync', sync: ack, workspaceId: msg.delta.workspaceId });
      this.onEvent({ type: 'sync-complete', workspaceId: msg.delta.workspaceId });
    }
  }

  private handleMemberPageRequest(fromPeerId: string, msg: Extract<SyncMessage, { type: 'member-page-request' }>): void {
    const response = this.directoryProtocol.buildMemberPageResponse(msg.workspaceId, {
      cursor: msg.cursor,
      pageSize: msg.pageSize,
      shardPrefix: msg.shardPrefix,
    });
    this.sendFn(fromPeerId, { type: 'workspace-sync', sync: response, workspaceId: msg.workspaceId });
  }

  private handleMemberPageResponse(msg: Extract<SyncMessage, { type: 'member-page-response' }>): void {
    this.onEvent({
      type: 'member-page-received',
      workspaceId: msg.page.workspaceId,
      page: msg.page,
    });
  }

  private handleHistoryPageRequest(fromPeerId: string, msg: Extract<SyncMessage, { type: 'history-page-request' }>): void {
    const response = this.historyPageProtocol.buildHistoryPageResponse(msg.workspaceId, msg.channelId, {
      cursor: msg.cursor,
      pageSize: msg.pageSize,
      direction: msg.direction,
      tier: msg.tier,
    });
    this.sendFn(fromPeerId, {
      type: 'workspace-sync',
      sync: response,
      workspaceId: msg.workspaceId,
    });
  }

  private handleHistoryPageResponse(msg: Extract<SyncMessage, { type: 'history-page-response' }>): void {
    const normalized = msg.page.messages.map((message) => ({
      ...message,
      content: typeof message.content === 'string' ? message.content : '',
    })) as PlaintextMessage[];

    this.messageStore.bulkAdd(normalized);
    this.upsertHistoryPageRef(msg.workspaceId, msg.channelId, msg.page);
    this.clearPendingHistoryBootstrap(msg.workspaceId, msg.channelId);

    if (msg.historyReplicaHints?.length) {
      this.applyHistoryReplicaHints(msg.workspaceId, msg.historyReplicaHints);
    }

    this.onEvent({
      type: 'history-page-received',
      workspaceId: msg.workspaceId,
      channelId: msg.channelId,
      page: msg.page,
    });

    if (msg.historyReplicaHints?.length) {
      this.onEvent({
        type: 'history-replica-hints',
        workspaceId: msg.workspaceId,
        hints: msg.historyReplicaHints,
      });
    }
  }

  private handleHistoryReplicaHints(msg: Extract<SyncMessage, { type: 'history-replica-hints' }>): void {
    this.applyHistoryReplicaHints(msg.workspaceId, msg.hints);
    this.onEvent({
      type: 'history-replica-hints',
      workspaceId: msg.workspaceId,
      hints: msg.hints,
    });
  }

  private handleDirectoryShardAdvertisement(msg: Extract<SyncMessage, { type: 'directory-shard-advertisement' }>): void {
    const workspace = this.workspaceManager.getWorkspace(msg.shard.workspaceId);
    if (!workspace) return;

    const shards = [...(workspace.directoryShards ?? [])];
    const existingIndex = shards.findIndex((shard) => shard.shardId === msg.shard.shardId);
    if (existingIndex >= 0) {
      const existing = shards[existingIndex]!;
      const nextVersion = msg.shard.version ?? 0;
      const currentVersion = existing.version ?? 0;
      if (nextVersion < currentVersion) return;
      shards[existingIndex] = {
        ...existing,
        ...msg.shard,
        replicaPeerIds: [...new Set([...(existing.replicaPeerIds ?? []), ...(msg.shard.replicaPeerIds ?? [])])].sort(),
      };
    } else {
      shards.push({
        ...msg.shard,
        replicaPeerIds: [...new Set(msg.shard.replicaPeerIds ?? [])].sort(),
      });
    }

    workspace.directoryShards = shards.sort((a, b) => a.shardId.localeCompare(b.shardId));
    this.onEvent({
      type: 'directory-shards-updated',
      workspaceId: workspace.id,
      shards: workspace.directoryShards,
    });
  }

  private handleDirectoryShardRepair(fromPeerId: string, msg: Extract<SyncMessage, { type: 'directory-shard-repair' }>): void {
    const shouldReply = !msg.targetReplicaPeerIds?.length || msg.targetReplicaPeerIds.includes(this.myPeerId);
    if (!shouldReply) return;

    const workspace = this.workspaceManager.getWorkspace(msg.workspaceId);
    if (!workspace) return;

    const shard = workspace.directoryShards?.find((entry) => entry.shardId === msg.shardId);
    if (!shard) return;

    this.sendFn(fromPeerId, {
      type: 'workspace-sync',
      sync: { type: 'directory-shard-advertisement', shard } satisfies SyncMessage,
      workspaceId: msg.workspaceId,
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

    const historySyncMode = this.resolveHistorySyncMode(msg, workspace);
    const usePagedHistory = historySyncMode === 'paged';
    const messageHistory = usePagedHistory ? {} : this.buildLegacyMessageHistory(msg.workspaceId);

    const response: SyncMessage = {
      type: 'sync-response',
      workspace,
      messageHistory,
      historyReplicaHints: usePagedHistory ? this.historyPageProtocol.buildReplicaHints(msg.workspaceId) : undefined,
      historyCapabilities: usePagedHistory ? this.defaultHistoryCapabilities() : undefined,
    };

    this.sendFn(fromPeerId, { type: 'workspace-sync', sync: response });
  }

  private async handleSyncResponse(
    fromPeerId: string,
    msg: Extract<SyncMessage, { type: 'sync-response' }>,
  ): Promise<void> {
    // Update workspace
    this.workspaceManager.importWorkspace(msg.workspace);

    // Import verified message histories
    for (const [channelId, messages] of Object.entries(msg.messageHistory || {})) {
      await this.messageStore.importMessages(channelId, messages as SyncedHistoryMessage[]);
    }

    if (msg.historyReplicaHints?.length) {
      this.applyHistoryReplicaHints(msg.workspace.id, msg.historyReplicaHints);
      this.onEvent({
        type: 'history-replica-hints',
        workspaceId: msg.workspace.id,
        hints: msg.historyReplicaHints,
      });
    }

    this.maybeBootstrapRecentHistory(fromPeerId, msg.workspace.id, msg.messageHistory || {}, msg.historyCapabilities);
    this.onEvent({ type: 'sync-complete', workspaceId: msg.workspace.id });
  }

  private maybeBootstrapRecentHistory(
    fromPeerId: string,
    workspaceId: string,
    messageHistory: Record<string, SyncedHistoryMessage[]>,
    historyCapabilities?: HistorySyncCapabilities,
  ): void {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return;
    if (!this.shouldAutoBootstrapRecentHistory(workspace, messageHistory, historyCapabilities)) return;

    const channels = workspace.channels
      .filter((channel) => channel.type === 'channel')
      .filter((channel) => this.messageStore.getMessages(channel.id).length === 0)
      .slice(0, SyncProtocol.HISTORY_BOOTSTRAP_CHANNEL_LIMIT);

    for (const channel of channels) {
      if (!this.markPendingHistoryBootstrap(workspace.id, channel.id)) continue;

      const selectedPeer = this.selectHistoryPageSource(workspace.id, channel.id, 'recent');
      const targetPeerId = selectedPeer && selectedPeer !== this.myPeerId
        ? selectedPeer
        : fromPeerId !== this.myPeerId
          ? fromPeerId
          : undefined;

      if (!targetPeerId) {
        this.clearPendingHistoryBootstrap(workspace.id, channel.id);
        continue;
      }

      this.requestHistoryPage(targetPeerId, workspace.id, channel.id, {
        direction: 'older',
        tier: 'recent',
        pageSize: SyncProtocol.HISTORY_BOOTSTRAP_PAGE_SIZE,
      });
    }
  }

  private shouldAutoBootstrapRecentHistory(
    workspace: Workspace,
    messageHistory: Record<string, SyncedHistoryMessage[]>,
    historyCapabilities?: HistorySyncCapabilities,
  ): boolean {
    if (Object.keys(messageHistory).length > 0) return false;
    if (historyCapabilities?.supportsPaged === false) return false;
    if (historyCapabilities?.supportedTiers && !historyCapabilities.supportedTiers.includes('recent')) return false;

    const hasReplicaHints = workspace.channels.some(
      (channel) => (channel.historyReplicaHint?.recentReplicaPeerIds?.length ?? 0) > 0,
    );

    if (!this.workspaceSupportsPagedHistory(workspace) && historyCapabilities?.supportsPaged !== true && !hasReplicaHints) {
      return false;
    }

    return true;
  }

  private markPendingHistoryBootstrap(workspaceId: string, channelId: string): boolean {
    const key = `${workspaceId}:${channelId}`;
    const now = Date.now();
    const pendingUntil = this.historyBootstrapPendingUntil.get(key) ?? 0;
    if (pendingUntil > now) return false;

    this.historyBootstrapPendingUntil.set(key, now + SyncProtocol.HISTORY_BOOTSTRAP_TTL_MS);
    return true;
  }

  private clearPendingHistoryBootstrap(workspaceId: string, channelId: string): void {
    this.historyBootstrapPendingUntil.delete(`${workspaceId}:${channelId}`);
  }

  private resolveHistorySyncMode(
    msg:
      | Extract<SyncMessage, { type: 'join-request' }>
      | Extract<SyncMessage, { type: 'sync-request' }>,
    workspace: Workspace,
  ): 'legacy' | 'paged' {
    if (msg.historySyncMode === 'legacy') return 'legacy';
    if (msg.historySyncMode === 'paged') return 'paged';

    const supportsPagedHistory = msg.historyCapabilities?.supportsPaged === true;
    if (supportsPagedHistory && this.workspaceSupportsPagedHistory(workspace)) {
      return 'paged';
    }

    return 'legacy';
  }

  private workspaceSupportsPagedHistory(workspace: Workspace): boolean {
    return workspace.shell?.capabilityFlags?.includes(SyncProtocol.HISTORY_PAGING_CAPABILITY) === true;
  }

  private defaultHistoryCapabilities(): HistorySyncCapabilities {
    return {
      supportsPaged: true,
      supportedTiers: ['recent', 'archive'],
    };
  }

  private applyHistoryReplicaHints(workspaceId: string, hints: HistoryReplicaHint[]): void {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace || hints.length === 0) return;

    let changed = false;

    for (const hint of hints) {
      const channel = workspace.channels.find((entry) => entry.id === hint.channelId);
      if (!channel) continue;

      const prev = channel.historyReplicaHint;
      const mergedHint: HistoryReplicaHint = {
        workspaceId: hint.workspaceId,
        channelId: hint.channelId,
        recentReplicaPeerIds: this.uniqueOrderedPeers([
          ...(hint.recentReplicaPeerIds ?? []),
          ...(prev?.recentReplicaPeerIds ?? []),
        ]),
        archiveReplicaPeerIds: this.uniqueOrderedPeers([
          ...(hint.archiveReplicaPeerIds ?? []),
          ...(prev?.archiveReplicaPeerIds ?? []),
        ]),
        updatedAt: Math.max(prev?.updatedAt ?? 0, hint.updatedAt ?? 0),
      };

      channel.historyReplicaHint = mergedHint;
      changed = true;
    }

    if (changed) {
      this.workspaceManager.importWorkspace(structuredClone(workspace));
    }
  }

  private upsertHistoryPageRef(workspaceId: string, channelId: string, page: HistoryPageSnapshot): void {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return;

    const channel = workspace.channels.find((entry) => entry.id === channelId);
    if (!channel) return;

    const refs = [...(channel.historyPages ?? [])];
    const nextRef: HistoryPageRef = {
      workspaceId,
      channelId,
      pageId: page.pageId,
      tier: page.tier,
      startCursor: page.startCursor,
      endCursor: page.endCursor,
      replicaPeerIds: this.uniqueOrderedPeers(page.replicaPeerIds ?? page.selectedReplicaPeerIds ?? []),
      recentReplicaPeerIds: this.uniqueOrderedPeers(page.recentReplicaPeerIds ?? []),
      archiveReplicaPeerIds: this.uniqueOrderedPeers(page.archiveReplicaPeerIds ?? []),
      selectedReplicaPeerIds: this.uniqueOrderedPeers(page.selectedReplicaPeerIds ?? page.replicaPeerIds ?? []),
      selectionPolicy: page.selectionPolicy,
    };

    const existingIndex = refs.findIndex((ref) => ref.pageId === page.pageId);
    if (existingIndex >= 0) {
      refs[existingIndex] = this.mergeHistoryPageRefs(refs[existingIndex]!, nextRef);
    } else {
      refs.push(nextRef);
    }

    channel.historyPages = refs;
    this.workspaceManager.importWorkspace(structuredClone(workspace));
  }

  private mergeHistoryPageRefs(current: HistoryPageRef, incoming: HistoryPageRef): HistoryPageRef {
    return {
      ...current,
      ...incoming,
      replicaPeerIds: this.uniqueOrderedPeers([...(incoming.replicaPeerIds ?? []), ...(current.replicaPeerIds ?? [])]),
      recentReplicaPeerIds: this.uniqueOrderedPeers([
        ...(incoming.recentReplicaPeerIds ?? []),
        ...(current.recentReplicaPeerIds ?? []),
      ]),
      archiveReplicaPeerIds: this.uniqueOrderedPeers([
        ...(incoming.archiveReplicaPeerIds ?? []),
        ...(current.archiveReplicaPeerIds ?? []),
      ]),
      selectedReplicaPeerIds: this.uniqueOrderedPeers([
        ...(incoming.selectedReplicaPeerIds ?? incoming.replicaPeerIds ?? []),
        ...(current.selectedReplicaPeerIds ?? current.replicaPeerIds ?? []),
      ]),
      selectionPolicy: incoming.selectionPolicy ?? current.selectionPolicy,
      tier: incoming.tier ?? current.tier,
      startCursor: incoming.startCursor ?? current.startCursor,
      endCursor: incoming.endCursor ?? current.endCursor,
    };
  }

  private uniqueOrderedPeers(peerIds: Array<string | undefined>): string[] {
    return [...new Set(peerIds.filter((peerId): peerId is string => Boolean(peerId)))];
  }

  private buildLegacyMessageHistory(workspaceId: string): Record<string, SyncedHistoryMessage[]> {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return {};

    // Sync history intentionally excludes plaintext content; encrypted payloads are sent separately.
    const messageHistory: Record<string, SyncedHistoryMessage[]> = {};
    for (const channel of workspace.channels) {
      const messages = this.messageStore.getMessages(channel.id);
      if (messages.length > 0) {
        messageHistory[channel.id] = messages.map((message) => {
          const { content, ...safeMessage } = message;
          return safeMessage;
        });
      }
    }

    return messageHistory;
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
