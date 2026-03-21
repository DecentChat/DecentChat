import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function makeReceiptController(message: any, workspaces: any[] = []): any {
  const ctrl = Object.create(ChatController.prototype) as any;

  ctrl.state = {
    myPeerId: 'me',
    myAlias: 'me',
    readyPeers: new Set<string>(),
    connectedPeers: new Set<string>(),
    connectingPeers: new Set<string>(),
    activeWorkspaceId: null,
    activeChannelId: null,
    activeThreadId: null,
    threadOpen: false,
    sidebarOpen: false,
    activeDirectConversationId: null,
    workspaceAliases: {},
  };

  ctrl.transport = { send: mock(() => true) };
  ctrl.deferredGossipIntents = new Map();
  ctrl.pendingDeliveryWatchTimers = new Map();
  ctrl.pendingDeliveryRecoveryCooldowns = new Map();
  ctrl.offlineQueue = { applyReceipt: mock(async () => true) };
  ctrl.messageGuard = { check: mock(() => ({ allowed: true })) };
  ctrl.messageStore = { getMessages: mock(() => [message]) };
  ctrl.workspaceManager = { getAllWorkspaces: mock(() => workspaces) };
  ctrl.directConversationStore = { conversations: new Map<string, any>() };
  ctrl.persistentStore = { getPeer: mock(async () => null), saveMessage: mock(async () => {}), saveSetting: mock(async () => {}) };
  ctrl.ui = { updateMessageStatus: mock(() => {}) };

  ChatController.prototype.setupTransportHandlers.call(ctrl);
  return ctrl;
}

describe('ChatController inbound receipt security + consistency', () => {
  test('rejects forged ACK from non-recipient peer', async () => {
    const msg = {
      id: 'm1',
      channelId: 'ch-1',
      senderId: 'me',
      status: 'sent',
      recipientPeerIds: ['alice'],
      ackedBy: [],
      readBy: [],
    };
    const ctrl = makeReceiptController(msg);

    await ctrl.transport.onMessage('mallory', { type: 'ack', channelId: 'ch-1', messageId: 'm1' });

    expect(ctrl.persistentStore.saveMessage).not.toHaveBeenCalled();
    expect(ctrl.ui.updateMessageStatus).not.toHaveBeenCalled();
    expect(msg.ackedBy).toEqual([]);
    expect(ctrl.offlineQueue.applyReceipt).not.toHaveBeenCalled();
  });

  test('read implies delivered (upserts ack markers)', async () => {
    const msg = {
      id: 'm1',
      channelId: 'ch-1',
      senderId: 'me',
      status: 'sent',
      recipientPeerIds: ['alice'],
      ackedBy: [],
      ackedAt: {},
      readBy: [],
      readAt: {},
    };
    const ctrl = makeReceiptController(msg);

    await ctrl.transport.onMessage('alice', { type: 'read', channelId: 'ch-1', messageId: 'm1' });

    expect(msg.ackedBy).toContain('alice');
    expect(msg.readBy).toContain('alice');
    expect(msg.status).toBe('read');
    expect(ctrl.persistentStore.saveMessage).toHaveBeenCalledTimes(1);
    expect(ctrl.offlineQueue.applyReceipt).toHaveBeenCalledTimes(1);
  });
});


  test('pending delivery watchdog retries unreplied ready peer without forced reconnect churn', async () => {
    const msg = {
      id: 'm-watch-1',
      channelId: 'ch-1',
      senderId: 'me',
      status: 'sent',
      recipientPeerIds: ['alice'],
      ackedBy: [],
      readBy: [],
    };
    const ctrl = makeReceiptController(msg);
    ctrl.state.readyPeers = new Set<string>(['alice']);
    ctrl.retryUnackedOutgoingForPeer = mock(async () => {});
    ctrl.scheduleOfflineQueueFlush = mock(() => {});
    ctrl.requestCustodyRecovery = mock(() => {});
    ctrl.requestMessageSync = mock(async () => {});
    ctrl.transport = { disconnect: mock(() => {}), connect: mock(async () => {}) };
    ctrl.pendingDeliveryWatchTimers = new Map();
    ctrl.pendingDeliveryRecoveryCooldowns = new Map();

    ChatController.prototype.schedulePendingDeliveryWatch.call(ctrl, 'alice', 'ch-1', 'm-watch-1', 'ws-1', 5);
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(ctrl.retryUnackedOutgoingForPeer).toHaveBeenCalledWith('alice');
    expect(ctrl.scheduleOfflineQueueFlush).toHaveBeenCalledWith('alice', 250);
    expect(ctrl.requestCustodyRecovery).toHaveBeenCalledWith('alice');
    expect(ctrl.requestMessageSync).toHaveBeenCalledWith('alice');
    expect(ctrl.transport.disconnect).not.toHaveBeenCalled();
    expect(ctrl.transport.connect).not.toHaveBeenCalled();
  });

  test('pending delivery watchdog stays quiet once peer already acked', async () => {
    const msg = {
      id: 'm-watch-2',
      channelId: 'ch-1',
      senderId: 'me',
      status: 'delivered',
      recipientPeerIds: ['alice'],
      ackedBy: ['alice'],
      readBy: [],
    };
    const ctrl = makeReceiptController(msg);
    ctrl.state.readyPeers = new Set<string>(['alice']);
    ctrl.retryUnackedOutgoingForPeer = mock(async () => {});
    ctrl.scheduleOfflineQueueFlush = mock(() => {});
    ctrl.requestCustodyRecovery = mock(() => {});
    ctrl.requestMessageSync = mock(async () => {});
    ctrl.transport = { disconnect: mock(() => {}), connect: mock(async () => {}) };
    ctrl.pendingDeliveryWatchTimers = new Map();
    ctrl.pendingDeliveryRecoveryCooldowns = new Map();

    ChatController.prototype.schedulePendingDeliveryWatch.call(ctrl, 'alice', 'ch-1', 'm-watch-2', 'ws-1', 5);
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(ctrl.retryUnackedOutgoingForPeer).not.toHaveBeenCalled();
    expect(ctrl.transport.disconnect).not.toHaveBeenCalled();
  });


  test('pending delivery watchdog coalesces multiple pending messages for the same peer', async () => {
    const msgA = {
      id: 'm-watch-3a',
      channelId: 'ch-1',
      senderId: 'me',
      status: 'sent',
      recipientPeerIds: ['alice'],
      ackedBy: [],
      readBy: [],
    };
    const msgB = { ...msgA, id: 'm-watch-3b' };
    const ctrl = makeReceiptController(msgA);
    ctrl.messageStore = {
      getMessages: mock(() => [msgA, msgB]),
    };
    ctrl.state.readyPeers = new Set<string>(['alice']);
    ctrl.retryUnackedOutgoingForPeer = mock(async () => {});
    ctrl.scheduleOfflineQueueFlush = mock(() => {});
    ctrl.requestCustodyRecovery = mock(() => {});
    ctrl.requestMessageSync = mock(async () => {});
    ctrl.transport = { disconnect: mock(() => {}), connect: mock(async () => {}) };
    ctrl.pendingDeliveryWatchTimers = new Map();
    ctrl.pendingDeliveryRecoveryCooldowns = new Map();

    ChatController.prototype.schedulePendingDeliveryWatch.call(ctrl, 'alice', 'ch-1', 'm-watch-3a', 'ws-1', 5);
    ChatController.prototype.schedulePendingDeliveryWatch.call(ctrl, 'alice', 'ch-1', 'm-watch-3b', 'ws-1', 5);
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(ctrl.retryUnackedOutgoingForPeer).toHaveBeenCalledTimes(1);
    expect(ctrl.scheduleOfflineQueueFlush).toHaveBeenCalledTimes(1);
    expect(ctrl.requestCustodyRecovery).toHaveBeenCalledTimes(1);
    expect(ctrl.requestMessageSync).toHaveBeenCalledTimes(1);
    expect(ctrl.transport.disconnect).not.toHaveBeenCalled();
    expect(ctrl.transport.connect).not.toHaveBeenCalled();
  });


describe('ChatController outbound receipt field initialization', () => {
  test('sendDirectMessage initializes receipt fields and advances to sent', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = { myPeerId: 'me', readyPeers: new Set<string>(['alice']), activeChannelId: 'conv-1', threadOpen: false };
    const msg = { id: 'dm-1', channelId: 'conv-1', senderId: 'me', timestamp: Date.now(), status: 'pending' } as any;

    ctrl.directConversationStore = {
      get: mock(async () => ({ id: 'conv-1', contactPeerId: 'alice', lastMessageAt: 0 })),
      updateLastMessage: mock(async () => {}),
    };
    ctrl.messageStore = {
      createMessage: mock(async () => msg),
      addMessage: mock(async () => ({ success: true })),
    };
    ctrl.getOrCreateCRDT = mock(() => ({ createMessage: mock(() => ({ vectorClock: {} })) }));
    ctrl.persistMessage = mock(async () => {});
    ctrl.persistentStore = { saveDirectConversation: mock(async () => {}), saveMessage: mock(async () => {}) };
    ctrl.ui = { updateSidebar: mock(() => {}), appendMessageToDOM: mock(() => {}), updateMessageStatus: mock(() => {}), renderThreadMessages: mock(() => {}), updateThreadIndicator: mock(() => {}) };
    ctrl.messageProtocol = { encryptMessage: mock(async () => ({})) };
    ctrl.transport = { send: mock(() => {}) };
    ctrl.pendingDeliveryWatchTimers = new Map();
    ctrl.offlineQueue = { enqueue: mock(async () => {}) };

    await ChatController.prototype.sendDirectMessage.call(ctrl, 'conv-1', 'hello');

    expect(msg.recipientPeerIds).toEqual(['alice']);
    expect(msg.ackedBy).toEqual([]);
    expect(msg.readBy).toEqual([]);
    expect(msg.status).toBe('sent');
    expect(ctrl.transport.send).toHaveBeenCalledWith('alice', expect.objectContaining({
      messageId: 'dm-1',
      timestamp: msg.timestamp,
      isDirect: true,
    }));
    expect(ctrl.ui.updateMessageStatus).toHaveBeenCalledWith('dm-1', 'sent', { acked: 0, total: 1, read: 0 });
  });


  test('sendDirectMessage schedules queued flush when live send is rejected for a ready peer', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = { myPeerId: 'me', readyPeers: new Set<string>(['alice']), activeChannelId: 'conv-1', threadOpen: false };
    const msg = { id: 'dm-2', channelId: 'conv-1', senderId: 'me', timestamp: Date.now(), status: 'pending' } as any;

    ctrl.directConversationStore = {
      get: mock(async () => ({ id: 'conv-1', contactPeerId: 'alice', lastMessageAt: 0 })),
      updateLastMessage: mock(async () => {}),
    };
    ctrl.messageStore = {
      createMessage: mock(async () => msg),
      addMessage: mock(async () => ({ success: true })),
    };
    ctrl.getOrCreateCRDT = mock(() => ({ createMessage: mock(() => ({ vectorClock: {} })) }));
    ctrl.persistMessage = mock(async () => {});
    ctrl.persistentStore = { saveDirectConversation: mock(async () => {}), saveMessage: mock(async () => {}) };
    ctrl.ui = { updateSidebar: mock(() => {}), appendMessageToDOM: mock(() => {}), updateMessageStatus: mock(() => {}), renderThreadMessages: mock(() => {}), updateThreadIndicator: mock(() => {}) };
    ctrl.messageProtocol = { encryptMessage: mock(async () => ({})) };
    ctrl.transport = { send: mock(() => false) };
    ctrl.getDisplayNameForPeer = mock(() => 'Me');
    ctrl.queueCustodyEnvelope = mock(async () => {});
    ctrl.scheduleOfflineQueueFlush = mock(() => {});

    await ChatController.prototype.sendDirectMessage.call(ctrl, 'conv-1', 'hello');

    expect(ctrl.queueCustodyEnvelope).toHaveBeenCalledTimes(1);
    expect(ctrl.scheduleOfflineQueueFlush).toHaveBeenCalledWith('alice');
  });

  test('sendMessage schedules queued flush when live send is rejected for a ready workspace peer', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      readyPeers: new Set<string>(['alice']),
      activeChannelId: 'ch-1',
      activeWorkspaceId: 'ws-1',
      threadOpen: false,
    };
    const msg = { id: 'm-queue-1', channelId: 'ch-1', senderId: 'me', timestamp: Date.now(), status: 'pending' } as any;

    ctrl.messageStore = {
      createMessage: mock(async () => msg),
      addMessage: mock(async () => ({ success: true })),
      getThreadRoot: mock(() => null),
    };
    ctrl.getOrCreateCRDT = mock(() => ({ createMessage: mock(() => ({ vectorClock: {} })) }));
    ctrl.persistMessage = mock(async () => {});
    ctrl.recordManifestDomain = mock(() => {});
    ctrl.getChannelMessageCount = mock(() => 1);
    ctrl.persistentStore = { saveMessage: mock(async () => {}) };
    ctrl.ui = { showToast: mock(() => {}), appendMessageToDOM: mock(() => {}), renderThreadMessages: mock(() => {}), updateThreadIndicator: mock(() => {}), updateMessageStatus: mock(() => {}) };
    ctrl.getChannelDeliveryPeerIds = mock(() => ['alice']);
    ctrl.encryptMessageWithPreKeyBootstrap = mock(async () => ({}));
    ctrl.transport = { send: mock(() => false) };
    ctrl.getDisplayNameForPeer = mock(() => 'Me');
    ctrl.offlineQueue = { enqueue: mock(async () => {}) };
    ctrl.queueCustodyEnvelope = mock(async () => {});
    ctrl.replicateToCustodians = mock(async () => {});
    ctrl.scheduleOfflineQueueFlush = mock(() => {});

    await ChatController.prototype.sendMessage.call(ctrl, 'hello workspace');

    expect(ctrl.queueCustodyEnvelope).toHaveBeenCalledTimes(1);
    expect(ctrl.replicateToCustodians).toHaveBeenCalledWith('alice', expect.objectContaining({
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      opId: 'm-queue-1',
      domain: 'channel-message',
    }));
    expect(ctrl.scheduleOfflineQueueFlush).toHaveBeenCalledWith('alice');
  });

  test('sendAttachment initializes receipt fields and advances to sent', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = { myPeerId: 'me', activeChannelId: 'ch-1', activeWorkspaceId: 'ws-1', readyPeers: new Set<string>(['alice']), threadOpen: false };
    const msg = { id: 'att-1', channelId: 'ch-1', senderId: 'me', timestamp: Date.now(), status: 'pending' } as any;

    ctrl.encryptAttachmentBlob = mock(async (_buf: ArrayBuffer) => ({ iv: 'iv', encryptionKey: 'k', ciphertext: new Uint8Array([1, 2, 3]) }));
    ctrl.mediaStore = { store: mock(async () => {}) };
    ctrl.activeSenders = new Map();
    ctrl.messageStore = {
      createMessage: mock(async () => msg),
      addMessage: mock(async () => ({ success: true })),
    };
    ctrl.getOrCreateCRDT = mock(() => ({ createMessage: mock(() => ({ vectorClock: {} })) }));
    ctrl.persistMessage = mock(async () => {});
    ctrl.getWorkspaceRecipientPeerIds = mock(() => ['alice']);
    ctrl.messageProtocol = { encryptMessage: mock(async () => ({})) };
    ctrl.transport = { send: mock(() => {}) };
    ctrl.offlineQueue = { enqueue: mock(async () => {}) };
    ctrl.persistentStore = { saveMessage: mock(async () => {}) };
    ctrl.ui = { appendMessageToDOM: mock(() => {}), renderThreadMessages: mock(() => {}), updateThreadIndicator: mock(() => {}), updateMessageStatus: mock(() => {}) };

    const file = new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' });
    await ChatController.prototype.sendAttachment.call(ctrl, file, 'file');

    expect(msg.recipientPeerIds).toEqual(['alice']);
    expect(msg.ackedBy).toEqual([]);
    expect(msg.readBy).toEqual([]);
    expect(msg.status).toBe('sent');
    expect(ctrl.ui.updateMessageStatus).toHaveBeenCalledWith('att-1', 'sent', { acked: 0, total: 1, read: 0 });
  });
});


describe('ChatController gossip receipt routing', () => {
  test('sendInboundReceipt returns relayed receipt to immediate hop with original sender target', () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = { myPeerId: 'carol' };
    ctrl.transport = { send: mock(() => true) };

    (ChatController.prototype as any).sendInboundReceipt.call(
      ctrl,
      'bob',
      { _gossipOriginalSender: 'alice' },
      'ch-1',
      'm1',
      'ack',
    );

    expect(ctrl.transport.send).toHaveBeenCalledWith('bob', {
      type: 'ack',
      messageId: 'm1',
      channelId: 'ch-1',
      _receiptFromPeerId: 'carol',
      _receiptTargetPeerId: 'alice',
    });
  });

  test('relay forwards forwarded ACK upstream without mutating local state', async () => {
    const msg = {
      id: 'm1',
      channelId: 'ch-1',
      senderId: 'alice',
      status: 'sent',
      recipientPeerIds: ['carol'],
      ackedBy: [],
      readBy: [],
    };
    const ctrl = makeReceiptController(msg);
    ctrl.state.myPeerId = 'bob';
    ctrl._gossipReceiptRoutes = new Map([
      ['m1', { upstreamPeerId: 'alice', originalSenderId: 'alice', timestamp: Date.now() }],
    ]);

    await ctrl.transport.onMessage('carol', {
      type: 'ack',
      channelId: 'ch-1',
      messageId: 'm1',
      _receiptFromPeerId: 'carol',
      _receiptTargetPeerId: 'alice',
    });

    expect(ctrl.transport.send).toHaveBeenCalledWith('alice', {
      type: 'ack',
      channelId: 'ch-1',
      messageId: 'm1',
      _receiptFromPeerId: 'carol',
      _receiptTargetPeerId: 'alice',
    });
    expect(ctrl.persistentStore.saveMessage).not.toHaveBeenCalled();
    expect(msg.ackedBy).toEqual([]);
  });


  test('relay forwarding ACK also clears matching deferred gossip intent for that recipient', async () => {
    const msg = {
      id: 'm1',
      channelId: 'ch-1',
      senderId: 'alice',
      status: 'sent',
      recipientPeerIds: ['carol'],
      ackedBy: [],
      readBy: [],
    };
    const ctrl = makeReceiptController(msg);
    ctrl.state.myPeerId = 'bob';
    ctrl._gossipReceiptRoutes = new Map([
      ['m1', { upstreamPeerId: 'alice', originalSenderId: 'alice', timestamp: Date.now() }],
    ]);
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:m1:carol', {
        intentId: 'gossip-intent:m1:carol',
        targetPeerId: 'carol',
        upstreamPeerId: 'bob',
        originalMessageId: 'm1',
        originalSenderId: 'alice',
        plaintext: 'hello',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: Date.now(),
      }],
    ]);

    await ctrl.transport.onMessage('carol', {
      type: 'ack',
      channelId: 'ch-1',
      messageId: 'm1',
      _receiptFromPeerId: 'carol',
      _receiptTargetPeerId: 'alice',
    });

    expect(ctrl.deferredGossipIntents.size).toBe(0);
    expect(ctrl.persistentStore.saveSetting).toHaveBeenCalledWith('deferredGossipIntents', '[]');
  });

  test('original sender clears matching deferred gossip intent on direct read receipt', async () => {
    const msg = {
      id: 'm1',
      channelId: 'ch-1',
      senderId: 'alice',
      status: 'sent',
      recipientPeerIds: ['carol'],
      ackedBy: [],
      ackedAt: {},
      readBy: [],
      readAt: {},
    };
    const ctrl = makeReceiptController(msg);
    ctrl.state.myPeerId = 'alice';
    ctrl.deferredGossipIntents = new Map([
      ['gossip-intent:m1:carol', {
        intentId: 'gossip-intent:m1:carol',
        targetPeerId: 'carol',
        upstreamPeerId: 'bob',
        originalMessageId: 'm1',
        originalSenderId: 'alice',
        plaintext: 'hello',
        workspaceId: 'ws-1',
        channelId: 'ch-1',
        hop: 1,
        createdAt: Date.now(),
      }],
    ]);

    await ctrl.transport.onMessage('carol', {
      type: 'read',
      channelId: 'ch-1',
      messageId: 'm1',
    });

    expect(ctrl.deferredGossipIntents.size).toBe(0);
    expect(msg.readBy).toEqual(['carol']);
  });

  test('original sender attributes forwarded ACK to logical recipient, not relay peer', async () => {    const msg = {
      id: 'm1',
      channelId: 'ch-1',
      senderId: 'alice',
      status: 'sent',
      recipientPeerIds: ['carol'],
      ackedBy: [],
      ackedAt: {},
      readBy: [],
      readAt: {},
    };
    const ctrl = makeReceiptController(msg);
    ctrl.state.myPeerId = 'alice';

    await ctrl.transport.onMessage('bob', {
      type: 'ack',
      channelId: 'ch-1',
      messageId: 'm1',
      _receiptFromPeerId: 'carol',
      _receiptTargetPeerId: 'alice',
    });

    expect(msg.ackedBy).toEqual(['carol']);
    expect(msg.ackedAt.carol).toEqual(expect.any(Number));
    expect(msg.ackedBy).not.toContain('bob');
    expect(ctrl.persistentStore.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'm1',
      ackedBy: ['carol'],
    }));
  });
});
