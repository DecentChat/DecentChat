import { describe, expect, mock, test } from 'bun:test';

type IncomingEnvelope = {
  channelId: string;
  workspaceId: string;
  content: string;
  senderId: string;
  senderName: string;
  messageId: string;
  chatType: 'direct' | 'channel';
  timestamp: number;
  threadId?: string;
  replyToId?: string;
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    size?: number;
  }>;
};

let latestPeer: MockDecentChatNodePeer | null = null;
let onIncomingMessageHandler: ((payload: IncomingEnvelope) => Promise<void>) | null = null;

class MockPeerTransport {
  connectedPeers: string[] = ['peer-remote'];
  addSignalingCalls: Array<{ key: string; url: string }> = [];

  getConnectedPeers(): string[] {
    return [...this.connectedPeers];
  }

  async addSignalingServer(key: string, url: string): Promise<boolean> {
    this.addSignalingCalls.push({ key, url });
    return true;
  }

  async emitInbound(payload: IncomingEnvelope): Promise<void> {
    if (!onIncomingMessageHandler) throw new Error('Inbound handler was not wired');
    await onIncomingMessageHandler(payload);
  }
}

class MockDecentChatNodePeer {
  transport = new MockPeerTransport();
  startCalls = 0;
  destroyCalls = 0;
  sendDirectCalls: Array<{
    peerId: string;
    body: string;
    threadId: string | undefined;
    replyToId: string | undefined;
    messageId: string | undefined;
  }> = [];
  startDirectStreamCalls: Array<{ peerId: string; messageId: string }> = [];
  streamDeltaCalls: Array<{ peerId: string; messageId: string; content: string }> = [];
  streamDoneCalls: Array<{ peerId: string; messageId: string }> = [];
  persistedMessages: Array<{
    channelId: string;
    workspaceId: string;
    content: string;
    threadId: string | undefined;
    replyToId: string | undefined;
    messageId: string | undefined;
  }> = [];

  constructor(opts: { onIncomingMessage: (payload: IncomingEnvelope) => Promise<void> }) {
    onIncomingMessageHandler = opts.onIncomingMessage;
    latestPeer = this;
  }

  async start(): Promise<void> {
    this.startCalls += 1;
  }

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
  }

  async sendDirectToPeer(
    peerId: string,
    body: string,
    threadId?: string,
    replyToId?: string,
    messageId?: string,
  ): Promise<void> {
    this.sendDirectCalls.push({ peerId, body, threadId, replyToId, messageId });
  }

  async startDirectStream(params: { peerId: string; messageId: string }): Promise<void> {
    this.startDirectStreamCalls.push(params);
  }

  async sendDirectStreamDelta(params: { peerId: string; messageId: string; content: string }): Promise<void> {
    this.streamDeltaCalls.push(params);
  }

  async sendDirectStreamDone(params: { peerId: string; messageId: string }): Promise<void> {
    this.streamDoneCalls.push(params);
  }

  async persistMessageLocally(
    channelId: string,
    workspaceId: string,
    content: string,
    threadId?: string,
    replyToId?: string,
    messageId?: string,
  ): Promise<void> {
    this.persistedMessages.push({
      channelId,
      workspaceId,
      content,
      threadId,
      replyToId,
      messageId,
    });
  }
}

mock.module('../../src/peer/DecentChatNodePeer.js', () => ({
  DecentChatNodePeer: MockDecentChatNodePeer,
}));

const { DecentHermesPeer } = await import('../../src/peer.js');

const TEST_SEED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('DecentHermesPeer lifecycle integration', () => {
  test('covers start -> receive -> drainMessages -> sendMessage -> stop', async () => {
    const bridgePeer = new DecentHermesPeer({ seedPhrase: TEST_SEED });

    await bridgePeer.start();
    expect(bridgePeer.isConnected()).toBe(true);
    expect(latestPeer).not.toBeNull();
    expect(latestPeer!.startCalls).toBe(1);

    await latestPeer!.transport.emitInbound({
      channelId: 'ignored-for-dm',
      workspaceId: 'ws-1',
      content: 'inbound hello',
      senderId: 'peer-remote',
      senderName: 'Remote Peer',
      messageId: 'msg-1',
      chatType: 'direct',
      timestamp: 1710000000000,
    });

    const drained = bridgePeer.drainMessages();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({
      id: 'msg-1',
      chatId: 'dm:peer-remote',
      senderId: 'peer-remote',
      senderAlias: 'Remote Peer',
      body: 'inbound hello',
      timestamp: 1710000000000,
      chatType: 'direct',
      isGroup: false,
      workspaceId: 'ws-1',
    });
    expect(bridgePeer.drainMessages()).toEqual([]);

    const sentMessageId = await bridgePeer.sendMessage('dm:peer-remote', 'outbound hello', false, 'reply-1');
    expect(typeof sentMessageId).toBe('string');
    expect(latestPeer!.sendDirectCalls).toEqual([
      {
        peerId: 'peer-remote',
        body: 'outbound hello',
        threadId: 'reply-1',
        replyToId: 'reply-1',
        messageId: sentMessageId,
      },
    ]);

    const stopResult = await Promise.race([
      bridgePeer.stop().then(() => 'stopped'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
    ]);
    expect(stopResult).toBe('stopped');
    expect(latestPeer!.destroyCalls).toBe(1);
    expect(bridgePeer.isConnected()).toBe(false);
  });

  test('supports direct-message stream lifecycle with a stable message id', async () => {
    const bridgePeer = new DecentHermesPeer({ seedPhrase: TEST_SEED });
    await bridgePeer.start();

    const messageId = await bridgePeer.startStream('dm:peer-remote', {
      messageId: 'stream-msg-1',
      replyTo: 'parent-1',
    });
    expect(messageId).toBe('stream-msg-1');

    await bridgePeer.appendStream('dm:peer-remote', messageId, 'Hello ');
    await bridgePeer.appendStream('dm:peer-remote', messageId, 'world');
    await bridgePeer.finishStream('dm:peer-remote', messageId);

    expect(latestPeer!.startDirectStreamCalls).toEqual([
      { peerId: 'peer-remote', messageId: 'stream-msg-1' },
    ]);
    expect(latestPeer!.streamDeltaCalls).toEqual([
      { peerId: 'peer-remote', messageId: 'stream-msg-1', content: 'Hello ' },
      { peerId: 'peer-remote', messageId: 'stream-msg-1', content: 'world' },
    ]);
    expect(latestPeer!.streamDoneCalls).toEqual([
      { peerId: 'peer-remote', messageId: 'stream-msg-1' },
    ]);
    expect(latestPeer!.persistedMessages).toEqual([
      {
        channelId: 'peer-remote',
        workspaceId: 'direct',
        content: 'Hello world',
        threadId: 'parent-1',
        replyToId: 'parent-1',
        messageId: 'stream-msg-1',
      },
    ]);

    await bridgePeer.stop();
  });
});
