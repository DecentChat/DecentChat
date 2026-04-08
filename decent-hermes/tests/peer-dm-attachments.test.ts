import { describe, expect, mock, test } from 'bun:test';

let capturedPeerOptions: any;

class MockDecentChatNodePeer {
  directoryEntries: Array<{ id: string; name: string }> = [];
  store = {
    get: () => '',
  };

  constructor(opts: any) {
    capturedPeerOptions = opts;
  }

  async start(): Promise<void> {}

  async destroy(): Promise<void> {}

  listDirectoryPeersLive(): Array<{ id: string; name: string }> {
    return this.directoryEntries;
  }
}

mock.module('../src/peer/DecentChatNodePeer.js', () => ({
  DecentChatNodePeer: MockDecentChatNodePeer,
}));

const { DecentHermesPeer } = await import('../src/peer.js');

const TEST_SEED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('DecentHermesPeer DM metadata', () => {
  test('resolves DM display name from peer directory', async () => {
    const bridgePeer = new DecentHermesPeer({ seedPhrase: TEST_SEED });

    const mockPeer = new MockDecentChatNodePeer({});
    mockPeer.directoryEntries = [{ id: 'peer-123', name: '  Alice  ' }];
    mockPeer.store.get = () => 'Cached Alice';

    (bridgePeer as any).peer = mockPeer;

    const info = await bridgePeer.getChatInfo('dm:peer-123');

    expect(info).toEqual({
      name: 'Alice',
      type: 'private',
      chat_id: 'dm:peer-123',
    });
  });

  test('falls back to truncated peer id when no alias exists', async () => {
    const bridgePeer = new DecentHermesPeer({ seedPhrase: TEST_SEED });
    const peerId = 'did:key:z6MkrfA4tFK5nQhP2Y6u9eCyUsQPtq1XrJQvG8FUU9qXt7xP';
    (bridgePeer as any).peer = new MockDecentChatNodePeer({});

    const info = await bridgePeer.getChatInfo(`dm:${peerId}`);

    expect(info).toEqual({
      name: 'did:key:...t7xP',
      type: 'private',
      chat_id: `dm:${peerId}`,
    });
  });

  test('forwards attachments into drained incoming messages', async () => {
    const bridgePeer = new DecentHermesPeer({ seedPhrase: TEST_SEED });
    await bridgePeer.start();

    const attachments = [
      {
        id: 'att-1',
        name: 'image.png',
        type: 'image/png',
        size: 256,
      },
    ];

    await capturedPeerOptions.onIncomingMessage({
      channelId: 'ignored-for-dm',
      workspaceId: 'ws-1',
      content: 'message with image',
      senderId: 'peer-123',
      senderName: 'Alice',
      messageId: 'msg-1',
      chatType: 'direct',
      timestamp: 1710000000000,
      attachments,
    });

    const messages = bridgePeer.drainMessages();

    expect(messages).toHaveLength(1);
    expect(messages[0].chatId).toBe('dm:peer-123');
    expect(messages[0].attachments).toEqual(attachments);

    await bridgePeer.stop();
  });
});
