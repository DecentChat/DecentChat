import type { MessageStore } from '../messages/MessageStore';
import type { PlaintextMessage } from '../messages/types';
import type {
  HistoryPageDirection,
  HistoryPageSnapshot,
  HistoryReplicaHint,
  HistoryReplicaTier,
  PeerCapabilities,
  SyncMessage,
  Workspace,
} from '../workspace/types';
import type { WorkspaceManager } from '../workspace/WorkspaceManager';

export interface HistoryPageRequestOptions {
  cursor?: string;
  pageSize?: number;
  direction?: HistoryPageDirection;
  tier?: HistoryReplicaTier;
}

type SyncedHistoryMessage = Omit<PlaintextMessage, 'content' | 'metadata'> & {
  content?: string;
  metadata?: Record<string, unknown>;
};

export class HistoryPageProtocol {
  private static readonly DEFAULT_PAGE_SIZE = 50;
  private static readonly MAX_PAGE_SIZE = 200;

  constructor(
    private readonly messageStore: MessageStore,
    private readonly workspaceManager: WorkspaceManager,
    private readonly now: () => number = () => Date.now(),
  ) {}

  getHistoryPage(
    workspaceId: string,
    channelId: string,
    options: HistoryPageRequestOptions = {},
  ): HistoryPageSnapshot {
    const pageSize = this.clampPageSize(options.pageSize);
    const direction: HistoryPageDirection = options.direction ?? 'older';
    const tier: HistoryReplicaTier = options.tier ?? 'recent';

    const normalized = this.messageStore
      .getMessages(channelId)
      .map((message) => this.toSyncedMessage(message))
      .sort((a, b) => this.compareCursor(this.messageCursor(a), this.messageCursor(b)));

    const cursor = options.cursor;
    const filtered = cursor
      ? normalized.filter((message) =>
          direction === 'older'
            ? this.messageCursor(message) < cursor
            : this.messageCursor(message) > cursor,
        )
      : normalized;

    let pageMessages: SyncedHistoryMessage[];
    let hasMore = false;

    if (direction === 'older') {
      const startIndex = Math.max(0, filtered.length - pageSize);
      pageMessages = filtered.slice(startIndex);
      hasMore = startIndex > 0;
    } else {
      pageMessages = filtered.slice(0, pageSize);
      hasMore = filtered.length > pageSize;
    }

    const startCursor = pageMessages[0] ? this.messageCursor(pageMessages[0]) : undefined;
    const endCursor = pageMessages[pageMessages.length - 1]
      ? this.messageCursor(pageMessages[pageMessages.length - 1]!)
      : undefined;

    const nextCursor = hasMore
      ? direction === 'older'
        ? startCursor
        : endCursor
      : undefined;

    const replicaHint = this.buildReplicaHints(workspaceId).find((hint) => hint.channelId === channelId);
    const replicaPeerIds = tier === 'archive'
      ? (replicaHint?.archiveReplicaPeerIds ?? replicaHint?.recentReplicaPeerIds)
      : replicaHint?.recentReplicaPeerIds;

    return {
      workspaceId,
      channelId,
      pageId: this.toPageId(direction, startCursor, endCursor),
      pageSize,
      direction,
      tier,
      cursor: options.cursor,
      nextCursor,
      startCursor,
      endCursor,
      hasMore,
      generatedAt: this.now(),
      replicaPeerIds,
      messages: pageMessages,
    };
  }

  buildHistoryPageResponse(
    workspaceId: string,
    channelId: string,
    options: HistoryPageRequestOptions = {},
  ): Extract<SyncMessage, { type: 'history-page-response' }> {
    return {
      type: 'history-page-response',
      workspaceId,
      channelId,
      page: this.getHistoryPage(workspaceId, channelId, options),
      historyReplicaHints: this.buildReplicaHints(workspaceId),
    };
  }

  buildReplicaHints(workspaceId: string): HistoryReplicaHint[] {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return [];

    const archivePeers = this.sortedUniquePeers(
      Object.entries(workspace.peerCapabilities ?? {})
        .filter(([, capabilities]) => capabilities?.archive)
        .map(([peerId]) => peerId),
    );

    return workspace.channels
      .filter((channel) => channel.type === 'channel')
      .map((channel) => {
        const recentRelayPeers = this.sortedUniquePeers(
          Object.entries(workspace.peerCapabilities ?? {})
            .filter(([, capabilities]) => this.isRelayForChannel(capabilities, channel.id))
            .map(([peerId]) => peerId),
        );

        const fallbackMembers = workspace.members
          .map((member) => member.peerId)
          .filter((peerId) => peerId !== this.workspaceCreator(workspace))
          .sort()
          .slice(0, 3);

        const recentReplicaPeerIds = this.sortedUniquePeers([
          this.workspaceCreator(workspace),
          ...recentRelayPeers,
          ...archivePeers,
          ...fallbackMembers,
        ]);

        const archiveReplicaPeerIds = this.sortedUniquePeers([
          ...archivePeers,
          ...recentRelayPeers,
          this.workspaceCreator(workspace),
        ]);

        return {
          workspaceId,
          channelId: channel.id,
          recentReplicaPeerIds,
          archiveReplicaPeerIds,
          updatedAt: this.now(),
        } satisfies HistoryReplicaHint;
      });
  }

  buildReplicaHintsMessage(workspaceId: string): Extract<SyncMessage, { type: 'history-replica-hints' }> {
    return {
      type: 'history-replica-hints',
      workspaceId,
      hints: this.buildReplicaHints(workspaceId),
    };
  }

  private clampPageSize(pageSize?: number): number {
    if (!pageSize || pageSize <= 0) return HistoryPageProtocol.DEFAULT_PAGE_SIZE;
    return Math.min(pageSize, HistoryPageProtocol.MAX_PAGE_SIZE);
  }

  private toSyncedMessage(message: PlaintextMessage): SyncedHistoryMessage {
    const { content, metadata, ...rest } = message;
    return {
      ...rest,
      metadata: metadata ? { ...(metadata as unknown as Record<string, unknown>) } : undefined,
    };
  }

  private messageCursor(message: Pick<PlaintextMessage, 'timestamp' | 'id'>): string {
    return `${String(message.timestamp).padStart(16, '0')}:${message.id}`;
  }

  private compareCursor(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  private toPageId(direction: HistoryPageDirection, startCursor?: string, endCursor?: string): string {
    const start = encodeURIComponent(startCursor ?? 'start');
    const end = encodeURIComponent(endCursor ?? 'end');
    return `${direction}:${start}:${end}`;
  }

  private sortedUniquePeers(peerIds: Array<string | undefined>): string[] {
    return [...new Set(peerIds.filter((peerId): peerId is string => Boolean(peerId)))].sort();
  }

  private workspaceCreator(workspace: Workspace): string {
    return workspace.createdBy;
  }

  private isRelayForChannel(
    capabilities: PeerCapabilities | undefined,
    channelId: string,
  ): boolean {
    if (!capabilities?.relay) return false;
    const channels = capabilities.relay.channels;
    return !channels?.length || channels.includes(channelId);
  }
}

export type { SyncedHistoryMessage as HistoryPageMessage };
