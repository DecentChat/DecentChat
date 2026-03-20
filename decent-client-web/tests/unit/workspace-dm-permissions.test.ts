import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('Workspace DM privacy — sender side', () => {
  test('startDirectMessage blocks workspace-origin DM when target disallows', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;

    ctrl.workspaceManager = {
      getWorkspace: mock((_wsId: string) => ({
        id: 'ws-1',
        members: [
          { peerId: 'target', allowWorkspaceDMs: false },
        ],
      })),
    };
    ctrl.directConversationStore = {
      create: mock(async () => ({ id: 'conv-1', contactPeerId: 'target', createdAt: Date.now(), lastMessageAt: 0 })),
    };
    ctrl.persistentStore = { saveDirectConversation: mock(async () => {}) };
    ctrl.ui = { updateSidebar: mock(() => {}) };

    await expect(
      ChatController.prototype.startDirectMessage.call(ctrl, 'target', { sourceWorkspaceId: 'ws-1' }),
    ).rejects.toThrow('disallows workspace DMs');

    expect(ctrl.directConversationStore.create).not.toHaveBeenCalled();
    expect(ctrl.persistentStore.saveDirectConversation).not.toHaveBeenCalled();
  });

  test('startDirectMessage allows DM from contacts flow (no workspace context)', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    const conv = { id: 'conv-1', contactPeerId: 'target', createdAt: Date.now(), lastMessageAt: 0 };

    ctrl.workspaceManager = { getWorkspace: mock(() => null) };
    ctrl.directConversationStore = {
      create: mock(async (_peerId: string, opts?: { originWorkspaceId?: string }) => ({ ...conv, originWorkspaceId: opts?.originWorkspaceId })),
    };
    ctrl.persistentStore = { saveDirectConversation: mock(async () => {}) };
    ctrl.ui = { updateSidebar: mock(() => {}) };

    const result = await ChatController.prototype.startDirectMessage.call(ctrl, 'target');

    expect(result.id).toBe('conv-1');
    expect((result as any).originWorkspaceId).toBeUndefined();
    expect(ctrl.directConversationStore.create).toHaveBeenCalledTimes(1);
  });

  test('startDirectMessage blocks workspace-origin DM when directory-only target disallows', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;

    ctrl.workspaceManager = {
      getWorkspace: mock((_wsId: string) => ({
        id: 'ws-1',
        members: [],
      })),
    };
    ctrl.getWorkspaceMemberDirectory = mock((_wsId: string) => ({
      members: [
        { peerId: 'target', allowWorkspaceDMs: false },
      ],
      loadedCount: 1,
      totalCount: 1,
      hasMore: false,
    }));
    ctrl.directConversationStore = {
      create: mock(async () => ({ id: 'conv-1', contactPeerId: 'target', createdAt: Date.now(), lastMessageAt: 0 })),
    };
    ctrl.persistentStore = { saveDirectConversation: mock(async () => {}) };
    ctrl.ui = { updateSidebar: mock(() => {}) };

    await expect(
      ChatController.prototype.startDirectMessage.call(ctrl, 'target', { sourceWorkspaceId: 'ws-1' }),
    ).rejects.toThrow('disallows workspace DMs');

    expect(ctrl.directConversationStore.create).not.toHaveBeenCalled();
    expect(ctrl.persistentStore.saveDirectConversation).not.toHaveBeenCalled();
  });
});

describe('Workspace DM privacy — direct envelope metadata', () => {
  test('sendDirectMessage includes workspaceContextId when conversation has origin workspace', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      readyPeers: new Set<string>(['alice']),
      activeChannelId: 'conv-1',
      threadOpen: false,
    };

    const msg = { id: 'dm-1', channelId: 'conv-1', senderId: 'me', timestamp: Date.now(), status: 'pending' } as any;

    ctrl.directConversationStore = {
      get: mock(async () => ({
        id: 'conv-1',
        contactPeerId: 'alice',
        originWorkspaceId: 'ws-123',
        lastMessageAt: 0,
      })),
      updateLastMessage: mock(async () => {}),
    };
    ctrl.messageStore = {
      createMessage: mock(async () => msg),
      addMessage: mock(async () => ({ success: true })),
    };
    ctrl.getOrCreateCRDT = mock(() => ({ createMessage: mock(() => ({ vectorClock: {} })) }));
    ctrl.persistMessage = mock(async () => {});
    ctrl.persistentStore = { saveDirectConversation: mock(async () => {}), saveMessage: mock(async () => {}) };
    ctrl.ui = {
      updateSidebar: mock(() => {}),
      appendMessageToDOM: mock(() => {}),
      updateMessageStatus: mock(() => {}),
      renderThreadMessages: mock(() => {}),
      updateThreadIndicator: mock(() => {}),
    };

    const encryptedEnvelope = {} as any;
    ctrl.messageProtocol = { encryptMessage: mock(async () => encryptedEnvelope) };
    ctrl.transport = { send: mock(() => {}) };
    ctrl.offlineQueue = { enqueue: mock(async () => {}) };

    await ChatController.prototype.sendDirectMessage.call(ctrl, 'conv-1', 'hello');

    expect(ctrl.transport.send).toHaveBeenCalledTimes(1);
    const sentEnvelope = ctrl.transport.send.mock.calls[0][1] as any;
    expect(sentEnvelope.isDirect).toBe(true);
    expect(sentEnvelope.workspaceContextId).toBe('ws-123');
  });
});

describe('Workspace DM privacy — receiver enforcement', () => {
  test('receiver stores sender canonical messageId for accepted direct messages', async () => {
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

    const localMsg = { id: 'local-temp', channelId: 'conv-1', senderId: 'alice', content: 'hello', timestamp: 0 } as any;

    ctrl.transport = { send: mock(() => {}) };
    ctrl.sendControlWithRetry = mock(() => {});
    ctrl.messageGuard = { check: mock(() => ({ allowed: true })) };
    ctrl.presence = { handleTypingEvent: mock(() => {}), handleReadReceipt: mock(() => {}) };
    ctrl.workspaceManager = {
      getWorkspace: mock(() => null),
      getAllWorkspaces: mock(() => []),
      isOwner: mock(() => false),
    };
    ctrl.persistentStore = {
      getPeer: mock(async () => ({ publicKey: 'pub-key' })),
      saveMessage: mock(async () => {}),
      saveDirectConversation: mock(async () => {}),
    };
    ctrl.cryptoManager = { importPublicKey: mock(async () => ({})) };
    ctrl.messageProtocol = {
      decryptMessage: mock(async () => 'hello'),
      clearSharedSecret: mock(() => {}),
    };
    ctrl.directConversationStore = {
      getByContact: mock(async () => undefined),
      create: mock(async () => ({ id: 'conv-1', contactPeerId: 'alice', createdAt: Date.now(), lastMessageAt: 0 })),
      updateLastMessage: mock(async () => {}),
      get: mock(async () => ({ id: 'conv-1', contactPeerId: 'alice', createdAt: Date.now(), lastMessageAt: 0 })),
    };
    ctrl.messageStore = {
      createMessage: mock(async () => localMsg),
      addMessage: mock(async () => ({ success: true })),
      getMessages: mock(() => []),
    };
    ctrl.mediaStore = { registerMeta: mock(() => {}) };
    ctrl.notifications = { notify: mock(() => {}) };
    ctrl.ui = { updateSidebar: mock(() => {}), appendMessageToDOM: mock(() => {}), showToast: mock(() => {}) };
    ctrl.multiDeviceDedup = { isDuplicate: mock(() => false), markSeen: mock(() => {}) };
    ctrl._gossipSeen = new Set<string>();
    ctrl.getDisplayNameForPeer = mock(() => 'Alice');
    ctrl.getOrCreateCRDT = mock(() => ({ addMessage: mock(() => {}) }));
    ctrl.persistMessage = mock(async () => {});
    ctrl.recordManifestDomain = mock(() => {});
    ctrl.getChannelMessageCount = mock(() => 1);

    ChatController.prototype.setupTransportHandlers.call(ctrl);

    await ctrl.transport.onMessage('alice', {
      isDirect: true,
      messageId: 'canonical-dm-1',
      timestamp: Date.now(),
    });

    expect(ctrl.messageStore.addMessage).toHaveBeenCalledTimes(1);
    expect(ctrl.messageStore.addMessage.mock.calls[0][0].id).toBe('canonical-dm-1');
    expect(ctrl.transport.send).toHaveBeenCalledWith('alice', expect.objectContaining({
      type: 'ack',
      messageId: 'canonical-dm-1',
      channelId: 'conv-1',
    }));
  });

  test('receiver rejects workspace-context direct message when own preference is disabled', async () => {
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

    ctrl.transport = {};
    ctrl.sendControlWithRetry = mock(() => {});
    ctrl.messageGuard = { check: mock(() => ({ allowed: true })) };
    ctrl.presence = { handleTypingEvent: mock(() => {}), handleReadReceipt: mock(() => {}) };
    ctrl.workspaceManager = {
      getWorkspace: mock((wsId: string) => {
        if (wsId !== 'ws-1') return null;
        return {
          id: 'ws-1',
          members: [
            { peerId: 'me', allowWorkspaceDMs: false, alias: 'Me', role: 'member' },
            { peerId: 'alice', alias: 'Alice', role: 'member' },
          ],
          channels: [],
        };
      }),
      getAllWorkspaces: mock(() => []),
      isOwner: mock(() => false),
    };
    ctrl.persistentStore = {
      getPeer: mock(async () => ({ publicKey: 'pub-key' })),
      saveMessage: mock(async () => {}),
      saveDirectConversation: mock(async () => {}),
    };
    ctrl.cryptoManager = { importPublicKey: mock(async () => ({})) };
    ctrl.messageProtocol = {
      decryptMessage: mock(async () => 'hello'),
      clearSharedSecret: mock(() => {}),
    };
    ctrl.directConversationStore = {
      getByContact: mock(async () => undefined),
      create: mock(async () => ({ id: 'conv-1', contactPeerId: 'alice', createdAt: Date.now(), lastMessageAt: 0 })),
      updateLastMessage: mock(async () => {}),
      get: mock(async () => ({ id: 'conv-1', contactPeerId: 'alice', createdAt: Date.now(), lastMessageAt: 0 })),
    };
    ctrl.messageStore = {
      createMessage: mock(async () => ({ id: 'm1' })),
      addMessage: mock(async () => ({ success: true })),
      getMessages: mock(() => []),
    };
    ctrl.mediaStore = { registerMeta: mock(() => {}) };
    ctrl.notifications = { notify: mock(() => {}) };
    ctrl.ui = { updateSidebar: mock(() => {}), appendMessageToDOM: mock(() => {}), showToast: mock(() => {}) };
    ctrl.multiDeviceDedup = { isDuplicate: mock(() => false), markSeen: mock(() => {}) };
    ctrl._gossipSeen = new Set<string>();
    ctrl.getDisplayNameForPeer = mock(() => 'Alice');
    ctrl.getOrCreateCRDT = mock(() => ({ addMessage: mock(() => {}) }));
    ctrl.persistMessage = mock(async () => {});

    ChatController.prototype.setupTransportHandlers.call(ctrl);

    await ctrl.transport.onMessage('alice', {
      isDirect: true,
      workspaceContextId: 'ws-1',
      messageId: 'msg-1',
      timestamp: Date.now(),
    });

    expect(ctrl.sendControlWithRetry).toHaveBeenCalledTimes(1);
    const denialPayload = ctrl.sendControlWithRetry.mock.calls[0][1];
    expect(denialPayload.type).toBe('direct-denied');
    expect(denialPayload.workspaceId).toBe('ws-1');
    expect(denialPayload.reason).toBe('workspace-dm-disabled');

    // Message is dropped before conversation/message persistence
    expect(ctrl.directConversationStore.create).not.toHaveBeenCalled();
    expect(ctrl.messageStore.addMessage).not.toHaveBeenCalled();
  });
});
