import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

type AddMessageResult = { success: boolean; error?: string };

function makeWorkspaceInboundController(options?: {
  existingMessage?: any;
  addMessageResult?: AddMessageResult;
}): any {
  const ctrl = Object.create(ChatController.prototype) as any;

  ctrl.state = {
    myPeerId: 'me',
    myAlias: 'me',
    readyPeers: new Set<string>(),
    connectedPeers: new Set<string>(),
    connectingPeers: new Set<string>(),
    activeWorkspaceId: 'ws-1',
    activeChannelId: null,
    activeThreadId: null,
    threadOpen: false,
    sidebarOpen: false,
    activeDirectConversationId: null,
    workspaceAliases: {},
  };

  const existingMessage = options?.existingMessage ?? null;
  const channelMessages = existingMessage ? [existingMessage] : [];

  ctrl.transport = { send: mock(() => true) };
  ctrl.cryptoManager = { importPublicKey: mock(async () => ({})) };
  ctrl.messageProtocol = {
    decryptMessage: mock(async () => 'hello from alice'),
    clearSharedSecret: mock(() => {}),
  };
  ctrl.messageGuard = { check: mock(() => ({ allowed: true })) };
  ctrl._gossipSeen = new Map<string, number>();
  ctrl._gossipReceiptRoutes = new Map<string, any>();
  ctrl.deferredGossipIntents = new Map<string, any>();

  ctrl.workspaceManager = {
    getAllWorkspaces: mock(() => [{
      id: 'ws-1',
      members: [{ peerId: 'alice' }, { peerId: 'me' }],
      channels: [{ id: 'ch-1', name: 'general', type: 'channel' }],
    }]),
    getWorkspace: mock(() => null),
    getChannel: mock(() => null),
  };

  ctrl.messageStore = {
    getAllChannelIds: mock(() => ['ch-1']),
    getMessages: mock((channelId: string) => (channelId === 'ch-1' ? channelMessages : [])),
    createMessage: mock(async () => ({
      id: 'tmp-id',
      channelId: 'ch-1',
      senderId: 'alice',
      timestamp: Date.now(),
      content: 'hello from alice',
      type: 'text',
      prevHash: 'prev-hash',
      status: 'sent',
    })),
    addMessage: mock(async () => options?.addMessageResult ?? { success: true }),
  };

  ctrl.directConversationStore = {
    getByContact: mock(async () => null),
    conversations: new Map<string, any>(),
  };

  ctrl.persistentStore = {
    getPeer: mock(async () => ({ peerId: 'alice', publicKey: 'pk-alice' })),
    saveMessage: mock(async () => {}),
    saveSetting: mock(async () => {}),
  };

  ctrl.persistMessage = mock(async () => {});
  ctrl.notifications = { notify: mock(() => {}) };
  ctrl.ui = {
    updateStreamingMessage: mock(() => {}),
    updateSidebar: mock(() => {}),
    appendMessageToDOM: mock(() => {}),
    updateThreadIndicator: mock(() => {}),
    renderThreadMessages: mock(() => {}),
    updateWorkspaceRail: mock(() => {}),
    refreshActivityPanel: mock(() => {}),
    updateChannelHeader: mock(() => {}),
  };

  ctrl.offlineQueue = { applyReceipt: mock(async () => true) };
  ctrl.pendingDeliveryWatchTimers = new Map();
  ctrl.pendingDeliveryRecoveryCooldowns = new Map();
  ctrl.handshakeInFlight = new Set<string>();
  ctrl.messageSyncInFlight = new Map<string, Promise<void>>();
  ctrl.retryUnackedInFlight = new Map<string, Promise<void>>();
  ctrl.activityItems = [];

  ChatController.prototype.setupTransportHandlers.call(ctrl);
  return ctrl;
}

describe('Workspace inbound duplicate ACK behavior', () => {
  test('sends ACK when duplicate message already exists locally', async () => {
    const ctrl = makeWorkspaceInboundController({
      existingMessage: {
        id: 'msg-dup-1',
        channelId: 'ch-1',
        senderId: 'alice',
        timestamp: Date.now() - 10,
        content: 'older content',
        type: 'text',
        prevHash: 'prev-hash',
        status: 'sent',
        streaming: true,
      },
    });

    await ctrl.transport.onMessage('alice', {
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      messageId: 'msg-dup-1',
      vectorClock: { alice: 1 },
      timestamp: Date.now(),
    });

    expect(ctrl.transport.send).toHaveBeenCalledWith('alice', {
      type: 'ack',
      messageId: 'msg-dup-1',
      channelId: 'ch-1',
    });
  });

  test('sends ACK when MessageStore rejects duplicate addMessage', async () => {
    const ctrl = makeWorkspaceInboundController({
      addMessageResult: {
        success: false,
        error: 'Duplicate message ID: msg-dup-2',
      },
    });

    await ctrl.transport.onMessage('alice', {
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      messageId: 'msg-dup-2',
      vectorClock: { alice: 2 },
      timestamp: Date.now(),
    });

    expect(ctrl.transport.send).toHaveBeenCalledWith('alice', {
      type: 'ack',
      messageId: 'msg-dup-2',
      channelId: 'ch-1',
    });
  });
});
