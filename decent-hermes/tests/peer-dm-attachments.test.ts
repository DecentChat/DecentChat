import { describe, expect, mock, test } from 'bun:test';

let capturedPeerOptions: any;
const BOT_PEER_ID = 'did:key:z6MktestHermesPeerId1234567890';

class MockDecentChatNodePeer {
  directoryEntries: Array<{ id: string; name: string }> = [];
  peerId = BOT_PEER_ID;
  store = {
    get: () => '',
  };
  // Per-test override so "Xena already posted in this thread" tests can
  // seed the lookup without driving a real MessageStore hash chain.
  activeThreadIds = new Set<string>();

  constructor(opts: any) {
    capturedPeerOptions = opts;
  }

  async start(): Promise<void> {}

  async destroy(): Promise<void> {}

  listDirectoryPeersLive(): Array<{ id: string; name: string }> {
    return this.directoryEntries;
  }

  hasMyMessageInChannelThread(channelId: string, threadId: string | null | undefined): boolean {
    if (!threadId || !channelId) return false;
    return this.activeThreadIds.has(`${channelId}::${threadId}`);
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

  test('forwards channel messages when bot alias is @mentioned', async () => {
    const bridgePeer = new DecentHermesPeer({
      seedPhrase: TEST_SEED,
      alias: 'Hermes Agent',
    });
    await bridgePeer.start();

    await capturedPeerOptions.onIncomingMessage({
      channelId: 'chan-1',
      workspaceId: 'ws-1',
      content: 'Hey @Hermes-Agent, can you help?',
      senderId: 'peer-456',
      senderName: 'Bob',
      messageId: 'msg-chan-mention',
      chatType: 'channel',
      timestamp: 1710000000001,
    });

    const messages = bridgePeer.drainMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].chatId).toBe('ws-1:chan-1');
    expect(messages[0].body).toContain('@Hermes-Agent');

    await bridgePeer.stop();
  });

  test('forwards channel messages when bot peer id is @mentioned', async () => {
    const bridgePeer = new DecentHermesPeer({ seedPhrase: TEST_SEED });
    await bridgePeer.start();

    await capturedPeerOptions.onIncomingMessage({
      channelId: 'chan-1',
      workspaceId: 'ws-1',
      content: `Hey @${BOT_PEER_ID}, can you help?`,
      senderId: 'peer-456',
      senderName: 'Bob',
      messageId: 'msg-chan-peerid-mention',
      chatType: 'channel',
      timestamp: 1710000000002,
    });

    const messages = bridgePeer.drainMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-chan-peerid-mention');

    await bridgePeer.stop();
  });

  test('ignores channel messages without bot @mention', async () => {
    const bridgePeer = new DecentHermesPeer({ seedPhrase: TEST_SEED });
    await bridgePeer.start();

    await capturedPeerOptions.onIncomingMessage({
      channelId: 'chan-1',
      workspaceId: 'ws-1',
      content: 'General channel chatter without mention',
      senderId: 'peer-456',
      senderName: 'Bob',
      messageId: 'msg-chan-no-mention',
      chatType: 'channel',
      timestamp: 1710000000003,
    });

    const messages = bridgePeer.drainMessages();
    expect(messages).toHaveLength(0);

    await bridgePeer.stop();
  });

  test('forwards channel messages with bare alias mention (no @ prefix)', async () => {
    // Regression: the user said "hi Xena how are ya" in a channel and the
    // bot silently dropped it because the old heuristic required a literal
    // `@Xena`. Natural addressing-by-name should wake the bot.
    const bridgePeer = new DecentHermesPeer({
      seedPhrase: TEST_SEED,
      alias: 'Xena',
    });
    await bridgePeer.start();

    await capturedPeerOptions.onIncomingMessage({
      channelId: 'chan-1',
      workspaceId: 'ws-1',
      content: 'hi Xena how are ya',
      senderId: 'peer-456',
      senderName: 'Alino',
      messageId: 'msg-chan-bare-name',
      chatType: 'channel',
      timestamp: 1710000000004,
    });

    const messages = bridgePeer.drainMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('hi Xena how are ya');

    await bridgePeer.stop();
  });

  test('forwards thread replies without @mention if Xena already posted in that thread', async () => {
    // Regression for: "it should work in thread that xena replied to
    // without mention then". Once Xena has contributed a message inside
    // a thread, subsequent messages in that same thread are clearly
    // addressed to her — users shouldn't need to re-@-mention every turn.
    const bridgePeer = new DecentHermesPeer({
      seedPhrase: TEST_SEED,
      alias: 'Xena',
    });
    await bridgePeer.start();

    // Seed: pretend Xena already replied in thread "root-msg-1".
    // The mock's activeThreadIds set answers hasMyMessageInChannelThread
    // without driving a real MessageStore / hash-chain.
    const innerPeer = (bridgePeer as any).peer;
    innerPeer.activeThreadIds.add('chan-1::root-msg-1');

    // Alex's bare "how are u" inside an active Xena thread → forward.
    await capturedPeerOptions.onIncomingMessage({
      channelId: 'chan-1',
      workspaceId: 'ws-1',
      content: 'how are u',
      senderId: 'peer-456',
      senderName: 'Alino',
      messageId: 'msg-thread-reply-1',
      chatType: 'channel',
      threadId: 'root-msg-1',
      timestamp: 1710000000010,
    });

    // A bare "how are u" in a DIFFERENT thread Xena has NOT touched → drop.
    await capturedPeerOptions.onIncomingMessage({
      channelId: 'chan-1',
      workspaceId: 'ws-1',
      content: 'how are u',
      senderId: 'peer-456',
      senderName: 'Alino',
      messageId: 'msg-thread-reply-2',
      chatType: 'channel',
      threadId: 'other-thread-xena-never-posted-in',
      timestamp: 1710000000011,
    });

    // A bare message with NO thread at all → still drop (no thread context).
    await capturedPeerOptions.onIncomingMessage({
      channelId: 'chan-1',
      workspaceId: 'ws-1',
      content: 'how are u',
      senderId: 'peer-456',
      senderName: 'Alino',
      messageId: 'msg-no-thread',
      chatType: 'channel',
      timestamp: 1710000000012,
    });

    const messages = bridgePeer.drainMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-thread-reply-1');
    expect(messages[0].body).toBe('how are u');
    expect(messages[0].threadId).toBe('root-msg-1');

    await bridgePeer.stop();
  });

  test('bare alias matching is case-insensitive and word-bounded', async () => {
    const bridgePeer = new DecentHermesPeer({
      seedPhrase: TEST_SEED,
      alias: 'Xena',
    });
    await bridgePeer.start();

    // Lowercase bare mention should still match
    await capturedPeerOptions.onIncomingMessage({
      channelId: 'chan-1',
      workspaceId: 'ws-1',
      content: 'yo xena what do you think?',
      senderId: 'peer-456',
      senderName: 'Alino',
      messageId: 'msg-bare-lowercase',
      chatType: 'channel',
      timestamp: 1710000000005,
    });

    // "xenomorph" must NOT match (would be false positive on "xen" prefix
    // without word boundaries, but \bXena\b needs a non-word char right
    // after "xena" — the "m" in "xenomorph" is a word char, so no match).
    await capturedPeerOptions.onIncomingMessage({
      channelId: 'chan-1',
      workspaceId: 'ws-1',
      content: 'just watched a movie about a xenomorph',
      senderId: 'peer-456',
      senderName: 'Alino',
      messageId: 'msg-xenomorph',
      chatType: 'channel',
      timestamp: 1710000000006,
    });

    const messages = bridgePeer.drainMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-bare-lowercase');

    await bridgePeer.stop();
  });
});
