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

  ctrl.transport = {};
  ctrl.offlineQueue = { applyReceipt: mock(async () => true) };
  ctrl.messageGuard = { check: mock(() => ({ allowed: true })) };
  ctrl.messageStore = { getMessages: mock(() => [message]) };
  ctrl.workspaceManager = { getAllWorkspaces: mock(() => workspaces) };
  ctrl.directConversationStore = { conversations: new Map<string, any>() };
  ctrl.persistentStore = { getPeer: mock(async () => null), saveMessage: mock(async () => {}) };
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
