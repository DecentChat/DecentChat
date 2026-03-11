import type { PresenceAggregate } from './DirectoryTypes';

export interface PresenceSubscribeMessage {
  type: 'presence-subscribe';
  workspaceId: string;
  channelId: string;
  pageCursor?: string;
  pageSize?: number;
}

export interface PresenceUnsubscribeMessage {
  type: 'presence-unsubscribe';
  workspaceId: string;
  channelId: string;
}

export interface PresenceAggregateMessage {
  type: 'presence-aggregate';
  workspaceId: string;
  aggregate: PresenceAggregate;
}

export interface PresencePeerSlice {
  peerId: string;
  status: 'online' | 'away' | 'offline';
  lastSeen?: number;
  typing?: boolean;
}

export interface PresencePageResponseMessage {
  type: 'presence-page-response';
  workspaceId: string;
  channelId: string;
  pageSize: number;
  cursor?: string;
  nextCursor?: string;
  peers: PresencePeerSlice[];
  updatedAt: number;
}

export type PresenceMessage =
  | PresenceSubscribeMessage
  | PresenceUnsubscribeMessage
  | PresenceAggregateMessage
  | PresencePageResponseMessage;

export class PresenceProtocol {
  private static readonly DEFAULT_PAGE_SIZE = 50;
  private static readonly MAX_PAGE_SIZE = 200;

  buildSubscribeMessage(
    workspaceId: string,
    channelId: string,
    options: { pageCursor?: string; pageSize?: number } = {},
  ): PresenceSubscribeMessage {
    return {
      type: 'presence-subscribe',
      workspaceId,
      channelId,
      pageCursor: options.pageCursor,
      pageSize: this.clampPageSize(options.pageSize),
    };
  }

  buildUnsubscribeMessage(workspaceId: string, channelId: string): PresenceUnsubscribeMessage {
    return {
      type: 'presence-unsubscribe',
      workspaceId,
      channelId,
    };
  }

  buildAggregateMessage(
    workspaceId: string,
    aggregate: {
      onlineCount: number;
      awayCount?: number;
      activeChannelId?: string;
      updatedAt?: number;
    },
  ): PresenceAggregateMessage {
    return {
      type: 'presence-aggregate',
      workspaceId,
      aggregate: {
        workspaceId,
        onlineCount: Math.max(0, Math.floor(aggregate.onlineCount || 0)),
        awayCount: aggregate.awayCount != null ? Math.max(0, Math.floor(aggregate.awayCount)) : undefined,
        activeChannelId: aggregate.activeChannelId,
        updatedAt: aggregate.updatedAt ?? Date.now(),
      },
    };
  }

  buildPageResponseMessage(
    workspaceId: string,
    channelId: string,
    peers: PresencePeerSlice[],
    options: { cursor?: string; pageSize?: number; updatedAt?: number } = {},
  ): PresencePageResponseMessage {
    const pageSize = this.clampPageSize(options.pageSize);
    const sorted = [...peers].sort((a, b) => a.peerId.localeCompare(b.peerId));
    const cursor = options.cursor;

    const startIndex = cursor
      ? (() => {
          const idx = sorted.findIndex((peer) => peer.peerId > cursor);
          return idx >= 0 ? idx : sorted.length;
        })()
      : 0;

    const page = sorted.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < sorted.length;

    return {
      type: 'presence-page-response',
      workspaceId,
      channelId,
      pageSize,
      cursor,
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1]!.peerId : undefined,
      peers: page,
      updatedAt: options.updatedAt ?? Date.now(),
    };
  }

  private clampPageSize(pageSize?: number): number {
    if (!pageSize || pageSize <= 0) return PresenceProtocol.DEFAULT_PAGE_SIZE;
    return Math.min(pageSize, PresenceProtocol.MAX_PAGE_SIZE);
  }
}
