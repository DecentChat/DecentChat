import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function createControllerForReadReceipts(
  messages: any[],
  readyPeers: string[] = [],
  enqueueImpl: ((peerId: string, payload: unknown) => Promise<void>) | null = null,
): any {
  const ctrl = Object.create(ChatController.prototype) as any;

  ctrl.state = {
    myPeerId: 'me',
    readyPeers: new Set<string>(readyPeers),
  };

  ctrl.transport = {
    send: mock(() => {}),
  };

  ctrl.offlineQueue = {
    enqueue: mock(enqueueImpl || (async () => {})),
  };

  ctrl.persistentStore = {
    saveMessage: mock(async () => {}),
  };

  ctrl.messageStore = {
    getMessages: mock((_channelId: string) => messages),
  };

  return ctrl;
}

describe('ChatController.onChannelViewed integration', () => {
  test('sends direct read receipts to ready peers and persists localReadAt', async () => {
    const messages = [
      { id: 'm1', channelId: 'ch-1', senderId: 'alice' },
      { id: 'm2', channelId: 'ch-1', senderId: 'bob' },
    ];
    const ctrl = createControllerForReadReceipts(messages, ['alice', 'bob']);

    await ChatController.prototype.onChannelViewed.call(ctrl, 'ch-1');

    expect(ctrl.transport.send).toHaveBeenCalledTimes(2);
    expect(ctrl.transport.send).toHaveBeenCalledWith('alice', { type: 'read', messageId: 'm1', channelId: 'ch-1' });
    expect(ctrl.transport.send).toHaveBeenCalledWith('bob', { type: 'read', messageId: 'm2', channelId: 'ch-1' });

    expect(ctrl.offlineQueue.enqueue).not.toHaveBeenCalled();
    expect(typeof messages[0].localReadAt).toBe('number');
    expect(typeof messages[1].localReadAt).toBe('number');
    expect(ctrl.persistentStore.saveMessage).toHaveBeenCalledTimes(2);
  });

  test('queues read receipts for offline peers', async () => {
    const messages = [
      { id: 'm1', channelId: 'ch-1', senderId: 'alice' },
    ];
    const ctrl = createControllerForReadReceipts(messages, []);

    await ChatController.prototype.onChannelViewed.call(ctrl, 'ch-1');

    expect(ctrl.transport.send).not.toHaveBeenCalled();
    expect(ctrl.offlineQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(ctrl.offlineQueue.enqueue).toHaveBeenCalledWith('alice', { type: 'read', messageId: 'm1', channelId: 'ch-1' });
    expect(typeof messages[0].localReadAt).toBe('number');
  });

  test('does not re-send read receipts for already locally-read or own messages', async () => {
    const messages = [
      { id: 'm1', channelId: 'ch-1', senderId: 'me' },
      { id: 'm2', channelId: 'ch-1', senderId: 'alice', localReadAt: Date.now() - 1000 },
      { id: 'm3', channelId: 'ch-2', senderId: 'alice' },
    ];
    const ctrl = createControllerForReadReceipts(messages, ['alice']);

    await ChatController.prototype.onChannelViewed.call(ctrl, 'ch-1');

    expect(ctrl.transport.send).not.toHaveBeenCalled();
    expect(ctrl.offlineQueue.enqueue).not.toHaveBeenCalled();
    expect(ctrl.persistentStore.saveMessage).not.toHaveBeenCalled();
  });

  test('serializes concurrent onChannelViewed calls and dedupes queued read receipts', async () => {
    const messages = [
      { id: 'm1', channelId: 'ch-1', senderId: 'alice' },
    ];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ctrl = createControllerForReadReceipts(messages, [], async () => {
      await gate;
    });

    const p1 = ChatController.prototype.onChannelViewed.call(ctrl, 'ch-1');
    const p2 = ChatController.prototype.onChannelViewed.call(ctrl, 'ch-1');

    release();
    await Promise.all([p1, p2]);

    expect(ctrl.offlineQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(ctrl.persistentStore.saveMessage).toHaveBeenCalledTimes(1);
  });
});
