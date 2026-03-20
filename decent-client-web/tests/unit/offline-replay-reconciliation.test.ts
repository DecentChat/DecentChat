import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function makeBaseController(): any {
  const ctrl = Object.create(ChatController.prototype) as any;

  ctrl.state = {
    myPeerId: 'me',
    readyPeers: new Set<string>(['peer-a']),
  };

  ctrl.workspaceManager = {
    getAllWorkspaces: mock(() => []),
  };
  ctrl.directConversationStore = {
    conversations: new Map<string, any>(),
  };

  ctrl.persistentStore = {
    saveMessage: mock(async () => {}),
  };

  ctrl.ui = {
    updateMessageStatus: mock(() => {}),
    showToast: mock(() => {}),
  };

  ctrl.getDisplayNameForPeer = mock(() => 'Me');

  return ctrl;
}

describe('ChatController offline replay reconciliation', () => {
  test('flushOfflineQueue persists replayed status/state (not UI-only)', async () => {
    const ctrl = makeBaseController();
    const outgoing = {
      id: 'msg-1',
      channelId: 'ch-1',
      senderId: 'me',
      content: 'hello',
      timestamp: 1700000000000,
      type: 'text',
      prevHash: 'x',
      status: 'pending',
      recipientPeerIds: ['peer-a'],
      ackedBy: [],
      ackedAt: {},
      readBy: [],
      readAt: {},
    };

    ctrl.messageStore = {
      getAllChannelIds: mock(() => ['ch-1']),
      getMessages: mock(() => [outgoing]),
      getThreadRoot: mock(() => null),
    };

    ctrl.transport = {
      send: mock(() => true),
    };

    ctrl.offlineQueue = {
      getQueued: mock(async () => [{
        id: 10,
        data: {
          _deferred: true,
          content: 'hello',
          channelId: 'ch-1',
          workspaceId: 'ws-1',
          messageId: 'msg-1',
          timestamp: 1700000000000,
        },
      }]),
      remove: mock(async () => {}),
      markAttempt: mock(async () => {}),
    };

    ctrl.encryptMessageWithPreKeyBootstrap = mock(async () => ({ encrypted: { body: 'cipher' } }));

    await (ChatController.prototype as any).flushOfflineQueue.call(ctrl, 'peer-a');

    expect(ctrl.transport.send).toHaveBeenCalledTimes(1);
    expect(ctrl.persistentStore.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-1',
      status: 'sent',
      recipientPeerIds: ['peer-a'],
    }));
    expect(ctrl.ui.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'sent', { acked: 0, total: 1, read: 0 });
  });

  test('retryUnackedOutgoingForPeer resends old outgoing when peer becomes ready', async () => {
    const ctrl = makeBaseController();
    const outgoing = {
      id: 'msg-2',
      channelId: 'dm-1',
      senderId: 'me',
      content: 'missed while unavailable',
      timestamp: 1700000001000,
      type: 'text',
      prevHash: 'y',
      status: 'pending',
      recipientPeerIds: ['peer-a'],
      ackedBy: [],
      ackedAt: {},
      readBy: [],
      readAt: {},
    };

    ctrl.messageStore = {
      getAllChannelIds: mock(() => ['dm-1']),
      getMessages: mock(() => [outgoing]),
      getThreadRoot: mock(() => null),
    };

    ctrl.directConversationStore = {
      conversations: new Map<string, any>([
        ['dm-1', { contactPeerId: 'peer-a', originWorkspaceId: 'ws-origin' }],
      ]),
    };

    ctrl.transport = {
      send: mock(() => true),
    };

    ctrl.offlineQueue = {
      listQueued: mock(async () => []),
    };

    ctrl.encryptMessageWithPreKeyBootstrap = mock(async () => ({ encrypted: { body: 'cipher' } }));
    ctrl.queueCustodyEnvelope = mock(async () => {});

    await (ChatController.prototype as any).retryUnackedOutgoingForPeer.call(ctrl, 'peer-a');

    expect(ctrl.transport.send).toHaveBeenCalledTimes(1);
    expect(ctrl.transport.send).toHaveBeenCalledWith('peer-a', expect.objectContaining({
      messageId: 'msg-2',
      channelId: 'dm-1',
      isDirect: true,
      workspaceContextId: 'ws-origin',
      _offlineReplay: 1,
    }));
    expect(ctrl.persistentStore.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-2',
      status: 'sent',
      recipientPeerIds: ['peer-a'],
    }));
  });

  test('retryUnackedOutgoingForPeer skips messages already queued for replay', async () => {
    const ctrl = makeBaseController();
    const outgoing = {
      id: 'msg-3',
      channelId: 'ch-1',
      senderId: 'me',
      content: 'already queued',
      timestamp: 1700000002000,
      type: 'text',
      prevHash: 'z',
      status: 'pending',
      recipientPeerIds: ['peer-a'],
      ackedBy: [],
      readBy: [],
    };

    ctrl.messageStore = {
      getAllChannelIds: mock(() => ['ch-1']),
      getMessages: mock(() => [outgoing]),
      getThreadRoot: mock(() => null),
    };

    ctrl.transport = {
      send: mock(() => true),
    };

    ctrl.offlineQueue = {
      listQueued: mock(async () => [{ id: 99, data: { messageId: 'msg-3' } }]),
    };

    ctrl.encryptMessageWithPreKeyBootstrap = mock(async () => ({ encrypted: { body: 'cipher' } }));

    await (ChatController.prototype as any).retryUnackedOutgoingForPeer.call(ctrl, 'peer-a');

    expect(ctrl.transport.send).not.toHaveBeenCalled();
    expect(ctrl.persistentStore.saveMessage).not.toHaveBeenCalled();
  });

  test('retryUnackedOutgoingForPeer skips messages already pending in custody store', async () => {
    const ctrl = makeBaseController();
    const outgoing = {
      id: 'msg-4',
      channelId: 'ch-1',
      senderId: 'me',
      content: 'already in custody',
      timestamp: 1700000003000,
      type: 'text',
      prevHash: 'q',
      status: 'pending',
      recipientPeerIds: ['peer-a'],
      ackedBy: [],
      readBy: [],
    };

    ctrl.messageStore = {
      getAllChannelIds: mock(() => ['ch-1']),
      getMessages: mock(() => [outgoing]),
      getThreadRoot: mock(() => null),
    };

    ctrl.transport = {
      send: mock(() => true),
    };

    ctrl.offlineQueue = {
      listQueued: mock(async () => []),
    };

    ctrl.custodyStore = {
      listAllForRecipient: mock(async () => [{ opId: 'msg-4' }]),
    };

    ctrl.encryptMessageWithPreKeyBootstrap = mock(async () => ({ encrypted: { body: 'cipher' } }));

    await (ChatController.prototype as any).retryUnackedOutgoingForPeer.call(ctrl, 'peer-a');

    expect(ctrl.transport.send).not.toHaveBeenCalled();
    expect(ctrl.persistentStore.saveMessage).not.toHaveBeenCalled();
  });

  test('reconcileReplayedOutgoingMessage preserves explicit multi-recipient state during single-peer replay', async () => {
    const ctrl = makeBaseController();
    const outgoing = {
      id: 'msg-5',
      channelId: 'ch-1',
      senderId: 'me',
      content: 'group message',
      timestamp: 1700000004000,
      type: 'text',
      prevHash: 'r',
      status: 'pending',
      recipientPeerIds: ['peer-a', 'peer-b', 'peer-c'],
      ackedBy: ['peer-a'],
      ackedAt: { 'peer-a': 1700000004500 },
      readBy: [],
      readAt: {},
    };

    ctrl.messageStore = {
      getAllChannelIds: mock(() => ['ch-1']),
      getMessages: mock(() => [outgoing]),
      getThreadRoot: mock(() => null),
    };

    await (ChatController.prototype as any).reconcileReplayedOutgoingMessage.call(ctrl, 'peer-a', 'msg-5');

    expect(ctrl.persistentStore.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-5',
      recipientPeerIds: ['peer-a', 'peer-b', 'peer-c'],
      status: 'sent',
      ackedBy: ['peer-a'],
    }));
    expect(ctrl.ui.updateMessageStatus).toHaveBeenCalledWith('msg-5', 'sent', { acked: 1, total: 3, read: 0 });
  });

  test('reconcileReplayedOutgoingMessage does not persist peer-specific fallback when recipients are unresolved', async () => {
    const ctrl = makeBaseController();
    const outgoing = {
      id: 'msg-6',
      channelId: 'unknown-channel',
      senderId: 'me',
      content: 'legacy message',
      timestamp: 1700000005000,
      type: 'text',
      prevHash: 's',
      status: 'pending',
      ackedBy: [],
      ackedAt: {},
      readBy: [],
      readAt: {},
    };

    ctrl.messageStore = {
      getAllChannelIds: mock(() => ['unknown-channel']),
      getMessages: mock(() => [outgoing]),
      getThreadRoot: mock(() => null),
    };
    ctrl.directConversationStore = {
      conversations: new Map<string, any>(),
    };
    ctrl.workspaceManager = {
      getAllWorkspaces: mock(() => []),
    };

    await (ChatController.prototype as any).reconcileReplayedOutgoingMessage.call(ctrl, 'peer-a', 'msg-6');

    expect(ctrl.persistentStore.saveMessage).toHaveBeenCalledTimes(1);
    const persisted = ctrl.persistentStore.saveMessage.mock.calls[0][0];
    expect(persisted.id).toBe('msg-6');
    expect(persisted.status).toBe('sent');
    expect(persisted.recipientPeerIds).toBeUndefined();
    expect(ctrl.ui.updateMessageStatus).toHaveBeenCalledWith('msg-6', 'sent', { acked: 0, total: 0, read: 0 });
  });

});
