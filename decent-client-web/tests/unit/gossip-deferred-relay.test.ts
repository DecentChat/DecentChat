import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function makeRelayController(): any {
  const ctrl = Object.create(ChatController.prototype) as any;

  ctrl.state = {
    myPeerId: 'relay-peer',
    activeWorkspaceId: 'ws-1',
    readyPeers: new Set<string>(),
  };

  ctrl.workspaceManager = {
    getWorkspace: mock(() => ({
      id: 'ws-1',
      members: [
        { peerId: 'relay-peer' },
        { peerId: 'from-peer' },
        { peerId: 'origin-peer' },
        { peerId: 'offline-peer' },
      ],
    })),
  };

  ctrl.transport = {
    getConnectedPeers: mock(() => []),
    send: mock(() => true),
  };

  ctrl.messageProtocol = {
    hasSharedSecret: mock(() => false),
    encryptMessage: mock(async () => ({ id: 'cipher-1' })),
  };

  ctrl.encryptMessageWithPreKeyBootstrap = mock(async () => ({ id: 'cipher-1' }));
  ctrl.offlineQueue = {
    enqueue: mock(async () => {}),
  };

  return ctrl;
}

describe('ChatController deferred gossip relay', () => {
  test('queues deferred gossip relay for workspace members that are not currently reachable', async () => {
    const ctrl = makeRelayController();
    ctrl.encryptMessageWithPreKeyBootstrap = mock(async () => { throw new Error('no relay session yet'); });

    await (ChatController.prototype as any)._gossipRelay.call(
      ctrl,
      'from-peer',
      'msg-1',
      'origin-peer',
      'hello from relay',
      'ch-1',
      {
        workspaceId: 'ws-1',
        metadata: { source: 'test' },
        vectorClock: { relay: 1 },
        threadId: 'thread-1',
        attachments: [{ id: 'att-1' }],
      },
    );

    expect(ctrl.offlineQueue.enqueue).toHaveBeenCalledWith(
      'offline-peer',
      expect.objectContaining({
        _deferred: true,
        _gossipDeferred: true,
        content: 'hello from relay',
        channelId: 'ch-1',
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        messageId: 'msg-1',
        vectorClock: { relay: 1 },
        metadata: { source: 'test' },
        attachments: [{ id: 'att-1' }],
        _originalMessageId: 'msg-1',
        _gossipOriginalSender: 'origin-peer',
        _gossipHop: 1,
      }),
      expect.objectContaining({
        opId: 'msg-1',
        domain: 'channel-message',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        recipientPeerIds: ['offline-peer'],
      }),
    );
  });


  test('queues custody-backed relay ciphertext for offline peers when relay encryption is already possible', async () => {
    const ctrl = makeRelayController();
    ctrl.queueCustodyEnvelope = mock(async () => {});
    ctrl.replicateToCustodians = mock(async () => {});

    await (ChatController.prototype as any)._gossipRelay.call(
      ctrl,
      'from-peer',
      'msg-2',
      'origin-peer',
      'encryptable relay',
      'ch-1',
      {
        workspaceId: 'ws-1',
        metadata: { source: 'test' },
        vectorClock: { relay: 2 },
        threadId: 'thread-2',
      },
    );

    expect(ctrl.queueCustodyEnvelope).toHaveBeenCalledWith(
      'offline-peer',
      expect.objectContaining({
        opId: 'msg-2',
        domain: 'channel-message',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        threadId: 'thread-2',
        recipientPeerIds: ['offline-peer'],
        ciphertext: expect.objectContaining({
          messageId: 'msg-2',
          channelId: 'ch-1',
          workspaceId: 'ws-1',
          threadId: 'thread-2',
          vectorClock: { relay: 2 },
          metadata: { source: 'test' },
          _originalMessageId: 'msg-2',
          _gossipOriginalSender: 'origin-peer',
          _gossipHop: 1,
        }),
      }),
      expect.objectContaining({
        messageId: 'msg-2',
        _gossipOriginalSender: 'origin-peer',
      }),
    );
    expect(ctrl.replicateToCustodians).toHaveBeenCalledWith('offline-peer', expect.objectContaining({
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      opId: 'msg-2',
      domain: 'channel-message',
    }));
    expect(ctrl.offlineQueue.enqueue).not.toHaveBeenCalled();
  });


  test('flushOfflineQueue preserves deferred gossip relay metadata when the peer comes back', async () => {
    const ctrl = makeRelayController();
    ctrl.state.readyPeers = new Set<string>(['offline-peer']);
    ctrl.transport = {
      send: mock(() => true),
    };
    ctrl.encryptMessageWithPreKeyBootstrap = mock(async () => ({ id: 'cipher-2' }));
    ctrl.offlineQueue = {
      getQueued: mock(async () => [{
        id: 7,
        data: {
          _deferred: true,
          _gossipDeferred: true,
          content: 'hello from relay',
          channelId: 'ch-1',
          workspaceId: 'ws-1',
          threadId: 'thread-1',
          messageId: 'msg-1',
          vectorClock: { relay: 1 },
          metadata: { source: 'test' },
          attachments: [{ id: 'att-1' }],
          threadRootSnapshot: { senderId: 'origin-peer', content: 'root', timestamp: 123 },
          _originalMessageId: 'msg-1',
          _gossipOriginalSender: 'origin-peer',
          _gossipHop: 1,
        },
      }]),
      remove: mock(async () => {}),
      markAttempt: mock(async () => {}),
    };
    ctrl.messageStore = {
      getThreadRoot: mock(() => null),
    };
    ctrl.reconcileReplayedOutgoingMessage = mock(async () => {});
    ctrl.ui = {
      showToast: mock(() => {}),
    };

    await (ChatController.prototype as any).flushOfflineQueue.call(ctrl, 'offline-peer');

    expect(ctrl.transport.send).toHaveBeenCalledWith('offline-peer', expect.objectContaining({
      _offlineReplay: 1,
      messageId: 'msg-1',
      channelId: 'ch-1',
      workspaceId: 'ws-1',
      threadId: 'thread-1',
      vectorClock: { relay: 1 },
      metadata: { source: 'test' },
      attachments: [{ id: 'att-1' }],
      threadRootSnapshot: { senderId: 'origin-peer', content: 'root', timestamp: 123 },
      _originalMessageId: 'msg-1',
      _gossipOriginalSender: 'origin-peer',
      _gossipHop: 1,
    }));
  });

});
