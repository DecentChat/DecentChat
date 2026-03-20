import { describe, expect, mock, test } from 'bun:test';
import { MobileController } from '../../src/app/MobileController';

function makeBaseController(): any {
  const ctrl = Object.create(MobileController.prototype) as any;

  ctrl.messageProtocol = {
    decryptMessage: mock(async () => 'hello'),
  };

  ctrl.resolvePeerPublicKey = mock(async () => 'peer-public-key');
  ctrl.cryptoManager = {
    importPublicKey: mock(async () => ({ imported: true })),
  };

  ctrl.directConversationsById = new Map<string, any>();
  ctrl.transport = {
    send: mock(() => true),
  };

  ctrl.messageStore = {
    createMessage: mock(async () => ({
      id: 'local-msg',
      channelId: 'ch-1',
      senderId: 'peer-a',
      content: 'hello',
      type: 'text',
      status: 'pending',
    })),
    getMessages: mock(() => []),
    addMessage: mock(async () => ({ success: true })),
    forceAdd: mock(() => {}),
  };

  ctrl.persistentStore = {
    saveMessage: mock(async () => {}),
    saveWorkspace: mock(async () => {}),
  };

  ctrl.workspaceManager = {
    getAllWorkspaces: mock(() => []),
    isMemberAllowedInChannel: mock(() => true),
    addMember: mock(() => ({ success: true })),
  };

  ctrl.syncChannelMessages = mock(() => {});
  ctrl.syncWorkspaceStores = mock(() => {});
  ctrl.getEnvelopeMessageType = mock(() => 'text');
  ctrl.hasMetadata = mock(() => false);
  ctrl.registerAttachmentIndex = mock(() => {});
  ctrl.requestMissingAttachments = mock(() => {});

  return ctrl;
}

describe('MobileController encrypted envelope routing security', () => {
  test('drops message with unknown explicit workspaceId when channel does not map to a known workspace', async () => {
    const ctrl = makeBaseController();
    ctrl.workspaceManager.getAllWorkspaces = mock(() => [{
      id: 'ws-1',
      members: [{ peerId: 'peer-a' }],
      channels: [{ id: 'ch-1' }],
    }]);

    await (MobileController.prototype as any).handleEncryptedEnvelope.call(ctrl, 'peer-a', {
      workspaceId: 'unknown-ws',
      channelId: 'unknown-channel',
      messageId: 'msg-1',
    });

    expect(ctrl.messageStore.createMessage).not.toHaveBeenCalled();
    expect(ctrl.transport.send).not.toHaveBeenCalled();
  });

  test('drops message from peer that is not a workspace member instead of auto-adding them', async () => {
    const ctrl = makeBaseController();
    ctrl.workspaceManager.getAllWorkspaces = mock(() => [{
      id: 'ws-1',
      members: [{ peerId: 'me' }],
      channels: [{ id: 'ch-1' }],
    }]);

    await (MobileController.prototype as any).handleEncryptedEnvelope.call(ctrl, 'peer-a', {
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      messageId: 'msg-2',
    });

    expect(ctrl.workspaceManager.addMember).not.toHaveBeenCalled();
    expect(ctrl.messageStore.createMessage).not.toHaveBeenCalled();
    expect(ctrl.transport.send).not.toHaveBeenCalled();
  });

  test('drops message with unknown explicit channel instead of falling back to first workspace channel', async () => {
    const ctrl = makeBaseController();
    ctrl.workspaceManager.getAllWorkspaces = mock(() => [{
      id: 'ws-1',
      members: [{ peerId: 'peer-a' }],
      channels: [{ id: 'ch-1' }],
    }]);

    await (MobileController.prototype as any).handleEncryptedEnvelope.call(ctrl, 'peer-a', {
      workspaceId: 'ws-1',
      channelId: 'unknown-channel',
      messageId: 'msg-3',
    });

    expect(ctrl.messageStore.createMessage).not.toHaveBeenCalled();
    expect(ctrl.transport.send).not.toHaveBeenCalled();
  });
});
