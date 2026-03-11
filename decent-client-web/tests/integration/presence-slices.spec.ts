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
