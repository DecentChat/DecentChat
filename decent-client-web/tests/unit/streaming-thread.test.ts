import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function createControllerStub(): any {
  const ctrl = Object.create(ChatController.prototype) as any;
  ctrl.state = {
    myPeerId: 'me',
    myAlias: 'me',
    workspaceAliases: {},
    connectedPeers: new Set<string>(),
    connectingPeers: new Set<string>(),
    readyPeers: new Set<string>(),
    activeWorkspaceId: 'ws-1',
    activeChannelId: 'ch-1',
    activeThreadId: null,
    threadOpen: false,
    sidebarOpen: false,
    activeDirectConversationId: null,
  };

  ctrl.pendingStreams = new Map();
  ctrl._gossipSeen = new Map();
  ctrl.activityItems = [];
  ctrl.messageGuard = { check: () => ({ allowed: true }) };
  ctrl.findMessageById = () => undefined;
  ctrl.getDisplayNameForPeer = () => 'Alice';
  ctrl.persistMessage = mock(async () => {});
  ctrl.getOrCreateCRDT = () => ({ addMessage: mock(() => {}) });
  ctrl.notifications = { notify: mock(() => {}) };
  ctrl.mediaStore = { registerMeta: mock(() => {}) };
  ctrl.directConversationStore = {
    getByContact: mock(async () => null),
    create: mock(async () => ({ id: 'dm-1' })),
    updateLastMessage: mock(async () => {}),
    get: mock(async () => ({ id: 'dm-1' })),
  };
  ctrl.persistentStore = {
    getPeer: mock(async () => ({ publicKey: 'peer-pub' })),
    saveDirectConversation: mock(async () => {}),
    saveMessage: mock(async () => {}),
  };

  ctrl.cryptoManager = {
    importPublicKey: mock(async () => ({ key: 'pub' })),
  };

  ctrl.messageProtocol = {
    decryptMessage: mock(async (_peerId: string, data: any) => data.content ?? null),
    clearSharedSecret: mock(() => {}),
  };

  ctrl.workspaceManager = {
    getAllWorkspaces: () => [
      {
        id: 'ws-1',
        members: [{ peerId: 'peer-a' }],
        channels: [{ id: 'ch-1' }],
      },
    ],
    getWorkspace: () => ({
      id: 'ws-1',
      members: [{ peerId: 'peer-a', alias: 'Alice' }],
      channels: [{ id: 'ch-1', name: 'general' }],
    }),
    getChannel: () => ({ id: 'ch-1', name: 'general' }),
  };

  ctrl._gossipRelay = mock(async () => {});

  ctrl.messageStore = {
    createMessage: mock(async (channelId: string, senderId: string, content: string, _type = 'text', threadId?: string) => ({
      id: 'msg-1',
      channelId,
      senderId,
      content,
      threadId,
      timestamp: Date.now(),
      prevHash: '',
      type: 'text',
    })),
    getMessages: mock(() => []),
    addMessage: mock(async () => ({ success: true })),
  };

  ctrl.transport = {
    send: mock(() => {}),
    onMessage: undefined,
    onDataConnectionOpen: undefined,
    onConnect: undefined,
    onDisconnect: undefined,
  };

  ctrl.ui = {
    appendMessageToDOM: mock(() => {}),
    updateSidebar: mock(() => {}),
    updateChannelHeader: mock(() => {}),
    updateStreamingMessage: mock(() => {}),
    finalizeStreamingMessage: mock(() => {}),
    updateThreadIndicator: mock(() => {}),
    renderThreadMessages: mock(() => {}),
    openThread: mock((threadId: string) => {
      ctrl.state.threadOpen = true;
      ctrl.state.activeThreadId = threadId;
    }),
  };

  return ctrl;
}

describe('streaming thread routing', () => {
  test('normalizedThreadId uses only explicit threadId (replyToId is ignored)', async () => {
    const ctrl = createControllerStub();
    ctrl.setupTransportHandlers = ChatController.prototype.setupTransportHandlers;
    ctrl.setupTransportHandlers();

    await ctrl.transport.onMessage('peer-a', {
      messageId: 'm-thread-id',
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      content: 'hello',
      threadId: 'thread-root-1',
      replyToId: 'root-msg-ignored',
      timestamp: Date.now(),
      vectorClock: {},
    });

    await ctrl.transport.onMessage('peer-a', {
      messageId: 'm-reply-fallback',
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      content: 'hello again',
      replyToId: 'root-msg-2',
      timestamp: Date.now(),
      vectorClock: {},
    });

    const calls = ctrl.messageStore.createMessage.mock.calls;
    expect(calls[0][4]).toBe('thread-root-1');
    expect(calls[1][4]).toBeUndefined();
  });

  test('stream-start with threadId auto-opens thread panel on stream-delta', async () => {
    const ctrl = createControllerStub();
    ctrl.setupTransportHandlers = ChatController.prototype.setupTransportHandlers;
    ctrl.setupTransportHandlers();

    await ctrl.transport.onMessage('peer-a', {
      type: 'stream-start',
      messageId: 'stream-1',
      channelId: 'ch-1',
      senderId: 'peer-a',
      senderName: 'Alice',
      threadId: 'thread-root-99',
      replyToId: 'root-msg',
      isDirect: false,
    });

    await ctrl.transport.onMessage('peer-a', {
      type: 'stream-delta',
      messageId: 'stream-1',
      content: 'partial text',
    });

    expect(ctrl.ui.openThread).toHaveBeenCalledWith('thread-root-99');
    expect(ctrl.state.threadOpen).toBe(true);
    expect(ctrl.state.activeThreadId).toBe('thread-root-99');
  });
});
