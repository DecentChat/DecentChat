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
  ctrl.persistentStore = {
    saveSetting: mock(async () => {}),
    getSetting: mock(async () => null),
  };
  ctrl.sendControlWithRetry = mock(() => {});
  ctrl.selectCustodianPeers = mock(() => ['custodian-peer']);
  ctrl.deferredGossipIntents = new Map();
  ctrl._gossipReceiptRoutes = new Map();

  return ctrl;
}

describe('ChatController deferred gossip relay', () => {
  test('stores and replicates deferred gossip intent when relay cannot encrypt yet', async () => {
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

    expect(ctrl.deferredGossipIntents.get('gossip-intent:msg-1:offline-peer')).toEqual(expect.objectContaining({
      targetPeerId: 'offline-peer',
      originalMessageId: 'msg-1',
      originalSenderId: 'origin-peer',
      plaintext: 'hello from relay',
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      threadId: 'thread-1',
      vectorClock: { relay: 1 },
      metadata: { source: 'test' },
      attachments: [{ id: 'att-1' }],
      hop: 1,
    }));
    expect(ctrl.sendControlWithRetry).toHaveBeenCalledWith('custodian-peer', expect.objectContaining({
      type: 'gossip.intent.store',
      workspaceId: 'ws-1',
      recipientPeerId: 'offline-peer',
      intent: expect.objectContaining({
        intentId: 'gossip-intent:msg-1:offline-peer',
        originalMessageId: 'msg-1',
      }),
    }), { label: 'gossip.intent.store' });
    expect(ctrl.persistentStore.saveSetting).toHaveBeenCalled();
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
  });

  test('custodian materializes stored gossip intent when the missing peer reconnects', async () => {
    const ctrl = makeRelayController();
    ctrl.state.readyPeers = new Set<string>(['offline-peer']);
    ctrl.transport = {
      send: mock(() => true),
    };
    ctrl.queueCustodyEnvelope = mock(async () => {});
    ctrl.replicateToCustodians = mock(async () => {});
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:msg-3:offline-peer', {
        intentId: 'gossip-intent:msg-3:offline-peer',
        targetPeerId: 'offline-peer',
        originalMessageId: 'msg-3',
        originalSenderId: 'origin-peer',
        plaintext: 'late spread',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        threadId: 'thread-3',
        vectorClock: { relay: 3 },
        metadata: { source: 'intent' },
        hop: 1,
        createdAt: Date.now(),
      }],
    ]);

    await (ChatController.prototype as any).processDeferredGossipIntentsForPeer.call(ctrl, 'offline-peer');

    expect(ctrl.transport.send).toHaveBeenCalledWith('offline-peer', expect.objectContaining({
      messageId: 'msg-3',
      channelId: 'ch-1',
      workspaceId: 'ws-1',
      threadId: 'thread-3',
      vectorClock: { relay: 3 },
      metadata: { source: 'intent' },
      _originalMessageId: 'msg-3',
      _gossipOriginalSender: 'origin-peer',
      _gossipHop: 1,
    }));
    expect(ctrl.deferredGossipIntents.size).toBe(0);
    expect(ctrl._gossipReceiptRoutes.get('msg-3')).toEqual(expect.objectContaining({
      upstreamPeerId: 'origin-peer',
      originalSenderId: 'origin-peer',
    }));
  });

  test('re-offers stored deferred gossip intents to a custodian that connects later', async () => {
    const ctrl = makeRelayController();
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:msg-4:offline-peer', {
        intentId: 'gossip-intent:msg-4:offline-peer',
        targetPeerId: 'offline-peer',
        originalMessageId: 'msg-4',
        originalSenderId: 'origin-peer',
        plaintext: 'persist me',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: Date.now(),
      }],
    ]);
    ctrl.selectCustodianPeers = mock(() => ['late-custodian']);

    await (ChatController.prototype as any).offerDeferredGossipIntentsToPeer.call(ctrl, 'late-custodian');

    expect(ctrl.sendControlWithRetry).toHaveBeenCalledWith('late-custodian', expect.objectContaining({
      type: 'gossip.intent.store',
      workspaceId: 'ws-1',
      recipientPeerId: 'offline-peer',
      intent: expect.objectContaining({
        intentId: 'gossip-intent:msg-4:offline-peer',
        originalMessageId: 'msg-4',
      }),
    }), { label: 'gossip.intent.store' });
  });


  test('custodian keeps actual upstream relay for receipt forwarding when materializing an intent', async () => {
    const ctrl = makeRelayController();
    ctrl.state.readyPeers = new Set<string>(['offline-peer']);
    ctrl.transport = { send: mock(() => true) };
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:msg-5:offline-peer', {
        intentId: 'gossip-intent:msg-5:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'relay-peer-bob',
        originalMessageId: 'msg-5',
        originalSenderId: 'origin-peer',
        plaintext: 'route receipts back correctly',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: Date.now(),
      }],
    ]);

    await (ChatController.prototype as any).processDeferredGossipIntentsForPeer.call(ctrl, 'offline-peer');

    expect(ctrl._gossipReceiptRoutes.get('msg-5')).toEqual(expect.objectContaining({
      upstreamPeerId: 'relay-peer-bob',
      originalSenderId: 'origin-peer',
    }));
  });

  test('rejects deferred gossip intent that targets a non-member peer', async () => {
    const ctrl = makeRelayController();
    ctrl.workspaceManager = {
      getWorkspace: mock(() => ({
        id: 'ws-1',
        members: [
          { peerId: 'relay-peer' },
          { peerId: 'origin-peer' },
          { peerId: 'custodian-peer' },
        ],
      })),
    };

    await (ChatController.prototype as any).handleDeferredGossipIntentControl.call(ctrl, 'from-peer', {
      type: 'gossip.intent.store',
      workspaceId: 'ws-1',
      recipientPeerId: 'non-member-peer',
      intent: {
        intentId: 'gossip-intent:msg-6:non-member-peer',
        targetPeerId: 'non-member-peer',
        upstreamPeerId: 'from-peer',
        originalMessageId: 'msg-6',
        originalSenderId: 'origin-peer',
        plaintext: 'should be rejected',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: Date.now(),
      },
    });

    expect(ctrl.deferredGossipIntents.size).toBe(0);
  });


  test('loadDeferredGossipIntents drops expired intents and persists the pruned set', async () => {
    const ctrl = makeRelayController();
    const now = Date.now();
    ctrl.persistentStore.getSetting = mock(async (key: string) => key === 'deferredGossipIntents'
      ? JSON.stringify([
          {
            intentId: 'gossip-intent:fresh:offline-peer',
            targetPeerId: 'offline-peer',
            upstreamPeerId: 'relay-peer',
            originalMessageId: 'fresh',
            originalSenderId: 'origin-peer',
            plaintext: 'keep me',
            workspaceId: 'ws-1',
            channelId: 'ch-1',
            hop: 1,
            createdAt: now - (60 * 60 * 1000),
          },
          {
            intentId: 'gossip-intent:expired:offline-peer',
            targetPeerId: 'offline-peer',
            upstreamPeerId: 'relay-peer',
            originalMessageId: 'expired',
            originalSenderId: 'origin-peer',
            plaintext: 'drop me',
            workspaceId: 'ws-1',
            channelId: 'ch-1',
            hop: 1,
            createdAt: now - (49 * 60 * 60 * 1000),
          },
        ])
      : null);

    await (ChatController.prototype as any).loadDeferredGossipIntents.call(ctrl, now);

    expect([...ctrl.deferredGossipIntents.keys()]).toEqual(['gossip-intent:fresh:offline-peer']);
    expect(ctrl.persistentStore.saveSetting).toHaveBeenCalledWith('deferredGossipIntents', expect.stringContaining('gossip-intent:fresh:offline-peer'));
    expect(ctrl.persistentStore.saveSetting).not.toHaveBeenCalledWith('deferredGossipIntents', expect.stringContaining('gossip-intent:expired:offline-peer'));
  });

  test('pruneExpiredDeferredGossipIntents removes stale intents from memory', async () => {
    const ctrl = makeRelayController();
    const now = Date.now();
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:fresh:offline-peer', {
        intentId: 'gossip-intent:fresh:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'relay-peer',
        originalMessageId: 'fresh',
        originalSenderId: 'origin-peer',
        plaintext: 'keep me',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: now - (60 * 60 * 1000),
      }],
      ['gossip-intent:expired:offline-peer', {
        intentId: 'gossip-intent:expired:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'relay-peer',
        originalMessageId: 'expired',
        originalSenderId: 'origin-peer',
        plaintext: 'drop me',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: now - (49 * 60 * 60 * 1000),
      }],
    ]);

    await (ChatController.prototype as any).pruneExpiredDeferredGossipIntents.call(ctrl, now);

    expect([...ctrl.deferredGossipIntents.keys()]).toEqual(['gossip-intent:fresh:offline-peer']);
  });


  test('does not re-offer the same deferred intent to the same custodian inside cooldown window', async () => {
    const ctrl = makeRelayController();
    const now = Date.now();
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:msg-7:offline-peer', {
        intentId: 'gossip-intent:msg-7:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'relay-peer',
        originalMessageId: 'msg-7',
        originalSenderId: 'origin-peer',
        plaintext: 'cooldown me',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: now,
      }],
    ]);
    ctrl.deferredGossipIntentOfferState = new Map([
      ['gossip-intent:msg-7:offline-peer::late-custodian', now],
    ]);
    ctrl.selectCustodianPeers = mock(() => ['late-custodian']);

    await (ChatController.prototype as any).offerDeferredGossipIntentsToPeer.call(ctrl, 'late-custodian', now + 1_000);

    expect(ctrl.sendControlWithRetry).not.toHaveBeenCalled();
  });

  test('re-offers the same deferred intent to the same custodian after cooldown expires', async () => {
    const ctrl = makeRelayController();
    const now = Date.now();
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:msg-8:offline-peer', {
        intentId: 'gossip-intent:msg-8:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'relay-peer',
        originalMessageId: 'msg-8',
        originalSenderId: 'origin-peer',
        plaintext: 'cooldown expired',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: now,
      }],
    ]);
    ctrl.deferredGossipIntentOfferState = new Map([
      ['gossip-intent:msg-8:offline-peer::late-custodian', now - 120_000],
    ]);
    ctrl.selectCustodianPeers = mock(() => ['late-custodian']);

    await (ChatController.prototype as any).offerDeferredGossipIntentsToPeer.call(ctrl, 'late-custodian', now);

    expect(ctrl.sendControlWithRetry).toHaveBeenCalledWith('late-custodian', expect.objectContaining({
      type: 'gossip.intent.store',
      intent: expect.objectContaining({ intentId: 'gossip-intent:msg-8:offline-peer' }),
    }), { label: 'gossip.intent.store' });
  });

  test('deleting a deferred intent also clears its offer-throttle entries', async () => {
    const ctrl = makeRelayController();
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:msg-9:offline-peer', {
        intentId: 'gossip-intent:msg-9:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'relay-peer',
        originalMessageId: 'msg-9',
        originalSenderId: 'origin-peer',
        plaintext: 'delete me',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: Date.now(),
      }],
    ]);
    ctrl.deferredGossipIntentOfferState = new Map([
      ['gossip-intent:msg-9:offline-peer::custodian-a', Date.now()],
      ['gossip-intent:msg-9:offline-peer::custodian-b', Date.now()],
    ]);

    await (ChatController.prototype as any).deleteDeferredGossipIntent.call(ctrl, 'gossip-intent:msg-9:offline-peer');

    expect(ctrl.deferredGossipIntents.size).toBe(0);
    expect(ctrl.deferredGossipIntentOfferState.size).toBe(0);
  });


  test('duplicate incoming gossip.intent.store inside cooldown does not re-persist or re-process identical intent', async () => {
    const ctrl = makeRelayController();
    const now = Date.now();
    ctrl.state.readyPeers = new Set<string>(['offline-peer']);
    ctrl.processDeferredGossipIntentsForPeer = mock(async () => {});
    ctrl.deferredGossipIntentInboundState = new Map([
      ['from-peer::gossip-intent:msg-10:offline-peer', now],
    ]);
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:msg-10:offline-peer', {
        intentId: 'gossip-intent:msg-10:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'from-peer',
        originalMessageId: 'msg-10',
        originalSenderId: 'origin-peer',
        plaintext: 'same intent',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: now,
      }],
    ]);
    ctrl.persistentStore.saveSetting.mockClear();

    await (ChatController.prototype as any).handleDeferredGossipIntentControl.call(ctrl, 'from-peer', {
      type: 'gossip.intent.store',
      workspaceId: 'ws-1',
      recipientPeerId: 'offline-peer',
      intent: {
        intentId: 'gossip-intent:msg-10:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'custodian-peer',
        originalMessageId: 'msg-10',
        originalSenderId: 'origin-peer',
        plaintext: 'same intent',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: now,
      },
    }, now + 1_000);

    expect(ctrl.persistentStore.saveSetting).not.toHaveBeenCalled();
    expect(ctrl.processDeferredGossipIntentsForPeer).not.toHaveBeenCalled();
  });

  test('duplicate incoming gossip.intent.store after cooldown can re-trigger processing without persisting identical payload', async () => {
    const ctrl = makeRelayController();
    const now = Date.now();
    ctrl.state.readyPeers = new Set<string>(['offline-peer']);
    ctrl.processDeferredGossipIntentsForPeer = mock(async () => {});
    ctrl.deferredGossipIntentInboundState = new Map([
      ['from-peer::gossip-intent:msg-11:offline-peer', now - 120_000],
    ]);
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:msg-11:offline-peer', {
        intentId: 'gossip-intent:msg-11:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'from-peer',
        originalMessageId: 'msg-11',
        originalSenderId: 'origin-peer',
        plaintext: 'same intent later',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: now,
      }],
    ]);
    ctrl.persistentStore.saveSetting.mockClear();

    await (ChatController.prototype as any).handleDeferredGossipIntentControl.call(ctrl, 'from-peer', {
      type: 'gossip.intent.store',
      workspaceId: 'ws-1',
      recipientPeerId: 'offline-peer',
      intent: {
        intentId: 'gossip-intent:msg-11:offline-peer',
        targetPeerId: 'offline-peer',
        upstreamPeerId: 'from-peer',
        originalMessageId: 'msg-11',
        originalSenderId: 'origin-peer',
        plaintext: 'same intent later',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: now,
      },
    }, now);

    expect(ctrl.persistentStore.saveSetting).not.toHaveBeenCalled();
    expect(ctrl.processDeferredGossipIntentsForPeer).toHaveBeenCalledWith('offline-peer');
  });

});
