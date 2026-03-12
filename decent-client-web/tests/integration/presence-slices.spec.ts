import { describe, expect, mock, test } from 'bun:test';
import { PresenceProtocol } from 'decent-protocol';
import { ChatController } from '../../src/app/ChatController';
import { PresenceManager } from '../../src/ui/PresenceManager';

describe('presence slices', () => {
  test('broadcastTyping targets only peers subscribed to the active channel scope', () => {
    const presence = new PresenceManager();
    const send = mock(() => true);

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      activeWorkspaceId: 'ws-1',
      activeChannelId: 'chan-a',
      readyPeers: new Set(['peer-a', 'peer-b', 'peer-c']),
    };
    ctrl.presence = presence;
    ctrl.transport = { send };
    ctrl.getWorkspaceRecipientPeerIds = mock(() => ['peer-a', 'peer-b', 'peer-c']);

    presence.trackPeerSubscription('peer-a', 'ws-1', 'chan-a');
    presence.trackPeerSubscription('peer-b', 'ws-1', 'chan-b');

    ChatController.prototype.broadcastTyping.call(ctrl);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'peer-a',
      expect.objectContaining({
        type: 'typing',
        channelId: 'chan-a',
        workspaceId: 'ws-1',
        peerId: 'me',
        typing: true,
      }),
    );

    presence.destroy();
  });

  test('onChannelViewed emits scoped subscribe/unsubscribe transitions', async () => {
    const presence = new PresenceManager();
    const sendControlWithRetry = mock(() => true);

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      activeWorkspaceId: 'ws-1',
      activeChannelId: 'chan-a',
      readyPeers: new Set(['peer-a', 'peer-b']),
    };
    ctrl.presence = presence;
    ctrl.presenceProtocol = new PresenceProtocol();
    ctrl.sendControlWithRetry = sendControlWithRetry;
    ctrl.channelViewInFlight = new Map();
    ctrl.pendingReadReceiptKeys = new Set();
    ctrl.getWorkspaceRecipientPeerIds = mock(() => ['peer-a', 'peer-b']);
    ctrl.messageStore = { getMessages: mock(() => []) };
    ctrl.transport = { send: mock(() => true) };
    ctrl.offlineQueue = { enqueue: mock(async () => {}) };
    ctrl.persistentStore = { saveMessage: mock(async () => {}) };
    ctrl.workspaceManager = {
      getWorkspace: mock(() => ({
        members: [{ peerId: 'peer-a' }, { peerId: 'peer-b' }, { peerId: 'me' }],
      })),
      isMemberAllowedInChannel: mock(() => true),
    };

    await ChatController.prototype.onChannelViewed.call(ctrl, 'chan-a');

    const firstPayloads = sendControlWithRetry.mock.calls.map((call: any[]) => call[1]);
    expect(firstPayloads).toHaveLength(2);
    expect(firstPayloads.every((payload: any) => payload.type === 'presence-subscribe')).toBe(true);
    expect(firstPayloads.every((payload: any) => payload.channelId === 'chan-a')).toBe(true);

    sendControlWithRetry.mockClear();

    await ChatController.prototype.onChannelViewed.call(ctrl, 'chan-b');

    const secondPayloads = sendControlWithRetry.mock.calls.map((call: any[]) => call[1]);
    expect(secondPayloads.filter((payload: any) => payload.type === 'presence-unsubscribe')).toHaveLength(2);
    expect(secondPayloads.filter((payload: any) => payload.type === 'presence-subscribe')).toHaveLength(2);
    expect(secondPayloads.some((payload: any) => payload.type === 'presence-unsubscribe' && payload.channelId === 'chan-a')).toBe(true);
    expect(secondPayloads.some((payload: any) => payload.type === 'presence-subscribe' && payload.channelId === 'chan-b')).toBe(true);

    presence.destroy();
  });

  test('presence page responses auto-advance cursor for active scope when sample is partial', () => {
    const presence = new PresenceManager();
    presence.setActiveScope('ws-1', 'chan-a');
    presence.handlePresenceAggregate({
      workspaceId: 'ws-1',
      onlineCount: 4,
      updatedAt: 100,
      activeChannelId: 'chan-a',
    });

    const sendControlWithRetry = mock(() => true);

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      activeWorkspaceId: 'ws-1',
      activeChannelId: 'chan-a',
      readyPeers: new Set(['peer-a']),
    };
    ctrl.presence = presence;
    ctrl.presenceProtocol = new PresenceProtocol();
    ctrl.presencePageRequestsByScope = new Map();
    ctrl.workspaceManager = {
      getWorkspace: mock(() => ({
        id: 'ws-1',
        members: [{ peerId: 'peer-a' }, { peerId: 'me' }],
      })),
    };
    ctrl.selectWorkspaceSyncTargetPeer = mock(() => 'peer-a');
    ctrl.getWorkspaceRecipientPeerIds = mock(() => ['peer-a']);
    ctrl.sendControlWithRetry = sendControlWithRetry;
    ctrl.ui = { updateSidebar: mock(() => {}), updateChannelHeader: mock(() => {}) };

    ChatController.prototype.handlePresencePageResponse.call(ctrl, 'peer-a', {
      type: 'presence-page-response',
      workspaceId: 'ws-1',
      channelId: 'chan-a',
      cursor: undefined,
      nextCursor: 'peer-c',
      pageSize: 2,
      peers: [
        { peerId: 'peer-a', status: 'online' },
        { peerId: 'peer-b', status: 'offline' },
      ],
      updatedAt: 120,
    });

    const followUp = sendControlWithRetry.mock.calls[0]?.[1];
    expect(followUp).toBeTruthy();
    expect(followUp.type).toBe('presence-subscribe');
    expect(followUp.workspaceId).toBe('ws-1');
    expect(followUp.channelId).toBe('chan-a');
    expect(followUp.pageCursor).toBe('peer-c');

    presence.destroy();
  });

  test('getPresenceScopeState returns aggregate + sampled page summary for sidebar/header consumers', () => {
    const presence = new PresenceManager();
    presence.handlePresenceAggregate({
      workspaceId: 'ws-1',
      onlineCount: 9,
      updatedAt: 200,
      activeChannelId: 'chan-a',
    });
    presence.handlePresencePageResponse({
      type: 'presence-page-response',
      workspaceId: 'ws-1',
      channelId: 'chan-a',
      cursor: undefined,
      nextCursor: 'peer-z',
      pageSize: 3,
      peers: [
        { peerId: 'peer-a', status: 'online' },
        { peerId: 'peer-b', status: 'offline' },
        { peerId: 'peer-c', status: 'online' },
      ],
      updatedAt: 210,
    });

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.presence = presence;

    const scope = ChatController.prototype.getPresenceScopeState.call(ctrl, 'ws-1', 'chan-a');

    expect(scope).toEqual({
      onlineCount: 9,
      sampledOnlineCount: 2,
      sampledPeerCount: 3,
      hasMore: true,
      nextCursor: 'peer-z',
      loadedPages: 1,
      activeChannelId: 'chan-a',
      updatedAt: 210,
    });

    presence.destroy();
  });

  test('loadMorePresenceScope requests next cursor so manual UI affordances can fetch more samples', async () => {
    const presence = new PresenceManager();
    presence.handlePresenceAggregate({
      workspaceId: 'ws-1',
      onlineCount: 4,
      updatedAt: 100,
      activeChannelId: 'chan-a',
    });
    presence.handlePresencePageResponse({
      type: 'presence-page-response',
      workspaceId: 'ws-1',
      channelId: 'chan-a',
      cursor: undefined,
      nextCursor: 'peer-c',
      pageSize: 2,
      peers: [
        { peerId: 'peer-a', status: 'online' },
        { peerId: 'peer-b', status: 'offline' },
      ],
      updatedAt: 110,
    });

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.presence = presence;
    ctrl.getPresenceScopeState = (workspaceId: string, channelId: string) =>
      ChatController.prototype.getPresenceScopeState.call(ctrl, workspaceId, channelId);

    ctrl.requestPresencePage = mock((workspaceId: string, channelId: string, opts: { cursor?: string }) => {
      expect(workspaceId).toBe('ws-1');
      expect(channelId).toBe('chan-a');
      expect(opts.cursor).toBe('peer-c');

      setTimeout(() => {
        presence.handlePresencePageResponse({
          type: 'presence-page-response',
          workspaceId: 'ws-1',
          channelId: 'chan-a',
          cursor: 'peer-c',
          nextCursor: undefined,
          pageSize: 2,
          peers: [
            { peerId: 'peer-d', status: 'online' },
            { peerId: 'peer-e', status: 'offline' },
          ],
          updatedAt: 120,
        });
      }, 20);

      return true;
    });

    const nextScope = await ChatController.prototype.loadMorePresenceScope.call(ctrl, 'ws-1', 'chan-a');

    expect(ctrl.requestPresencePage).toHaveBeenCalledTimes(1);
    expect(nextScope.sampledPeerCount).toBe(4);
    expect(nextScope.loadedPages).toBe(2);
    expect(nextScope.hasMore).toBe(false);

    presence.destroy();
  });

  test('presence aggregates ignore stale updates', () => {
    const presence = new PresenceManager();

    presence.handlePresenceAggregate({
      workspaceId: 'ws-1',
      onlineCount: 12,
      updatedAt: 200,
      activeChannelId: 'chan-a',
    });

    presence.handlePresenceAggregate({
      workspaceId: 'ws-1',
      onlineCount: 3,
      updatedAt: 150,
      activeChannelId: 'chan-b',
    });

    expect(presence.getPresenceAggregate('ws-1')).toEqual({
      workspaceId: 'ws-1',
      onlineCount: 12,
      updatedAt: 200,
      activeChannelId: 'chan-a',
    });

    presence.destroy();
  });
});
