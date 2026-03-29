import { describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';

const VALID_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-gossip',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://0.peerjs.com/',
    invites: [],
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-gossip-test-')),
    ...overrides,
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 1200): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

describe('DecentChatNodePeer gossip relay runtime', () => {
  test('relays inbound channel message to other connected workspace members', async () => {
    const incoming: Array<any> = [];
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async (params) => {
        incoming.push(params);
      },
      onReply: () => {},
    });

    (peer as any).myPeerId = 'peer-self';
    (peer as any).syncProtocol = {};

    const decryptMessage = mock(async () => 'hello via relay');
    const encryptMessage = mock(async (_peerId: string, content: string) => ({
      id: `env-${Date.now()}`,
      encrypted: `cipher:${content}`,
      ratchet: { n: 1 },
    }));
    const verifyData = mock(async (_data: string, signature: string, peerId: string) => (
      signature === 'sig-msg-1-channel-1' && peerId === 'peer-origin'
    ));

    (peer as any).messageProtocol = {
      decryptMessage,
      encryptMessage,
      verifyData,
      signData: mock(async () => 'sig-msg-1-channel-1'),
    };
    (peer as any).cryptoManager.importPublicKey = mock(async () => ({}));
    (peer as any).getPeerPublicKey = () => 'public-key';

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: mock((peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      }),
      getConnectedPeers: mock(() => ['peer-relay', 'peer-target'] as string[]),
    };

    const workspace = {
      id: 'ws-1',
      members: [
        { peerId: 'peer-self' },
        { peerId: 'peer-relay' },
        { peerId: 'peer-target' },
        { peerId: 'peer-origin' },
      ],
      channels: [{ id: 'channel-1', name: 'General', type: 'channel' }],
    };
    (peer as any).workspaceManager.getWorkspace = () => workspace;

    await (peer as any).handlePeerMessage('peer-relay', {
      encrypted: 'ciphertext',
      ratchet: { n: 7 },
      workspaceId: 'ws-1',
      channelId: 'channel-1',
      messageId: 'msg-1',
      _originalMessageId: 'msg-1',
      _gossipOriginalSender: 'peer-origin',
      _gossipOriginSignature: 'sig-msg-1-channel-1',
      _gossipHop: 0,
      timestamp: Date.now(),
    });

    expect(incoming).toHaveLength(1);
    expect(incoming[0].senderId).toBe('peer-origin');

    const ack = sent.find((entry) => entry.peerId === 'peer-relay' && entry.msg?.type === 'ack');
    expect(ack).toBeDefined();

    await waitFor(() => sent.some((entry) => entry.peerId === 'peer-target' && entry.msg?.encrypted));

    const relay = sent.find((entry) => entry.peerId === 'peer-target' && entry.msg?.encrypted);
    expect(relay).toBeDefined();
    expect(relay?.msg?.messageId).toBe('msg-1');
    expect(relay?.msg?._originalMessageId).toBe('msg-1');
    expect(relay?.msg?._gossipOriginalSender).toBe('peer-origin');
    expect(relay?.msg?._gossipOriginSignature).toBe('sig-msg-1-channel-1');
    expect(relay?.msg?._gossipHop).toBe(1);

    await (peer as any).handlePeerMessage('peer-relay', {
      encrypted: 'ciphertext',
      ratchet: { n: 7 },
      workspaceId: 'ws-1',
      channelId: 'channel-1',
      messageId: 'msg-1',
      _originalMessageId: 'msg-1',
      _gossipOriginalSender: 'peer-origin',
      _gossipOriginSignature: 'sig-msg-1-channel-1',
      _gossipHop: 0,
      timestamp: Date.now(),
    });

    expect(decryptMessage).toHaveBeenCalledTimes(1);
    expect(verifyData).toHaveBeenCalled();
  });

  test('falls back to relay sender when gossip origin signature is missing', async () => {
    const incoming: Array<any> = [];
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async (params) => {
        incoming.push(params);
      },
      onReply: () => {},
    });

    (peer as any).myPeerId = 'peer-self';
    (peer as any).syncProtocol = {};
    const createMessage = mock(async (channelId: string, senderId: string, content: string, type: string, threadId?: string) => ({
      id: 'msg-missing-sig',
      channelId,
      senderId,
      content,
      type,
      threadId,
      timestamp: Date.now(),
    }));
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => 'unsigned relayed message'),
      encryptMessage: mock(async () => ({ id: 'env-1', encrypted: 'cipher', ratchet: { n: 1 } })),
      verifyData: mock(async () => true),
    };
    (peer as any).cryptoManager.importPublicKey = mock(async () => ({}));
    (peer as any).getPeerPublicKey = () => 'public-key';
    (peer as any).transport = {
      send: mock(() => true),
      getConnectedPeers: mock(() => [] as string[]),
    };
    (peer as any).messageStore = {
      createMessage,
      addMessage: async () => ({ success: true }),
      getMessages: () => [] as any[],
    };
    (peer as any).persistMessagesForChannel = () => {};
    (peer as any).recordManifestDomain = () => {};

    await (peer as any).handlePeerMessage('peer-relay', {
      encrypted: 'ciphertext',
      ratchet: { n: 2 },
      workspaceId: 'ws-1',
      channelId: 'channel-1',
      messageId: 'msg-missing-sig',
      _originalMessageId: 'msg-missing-sig',
      _gossipOriginalSender: 'peer-origin',
      _gossipHop: 0,
      timestamp: Date.now(),
    });

    expect(incoming).toHaveLength(1);
    expect(incoming[0].senderId).toBe('peer-relay');
    expect(createMessage.mock.calls[0]?.[1]).toBe('peer-relay');
  });

  test('falls back to relay sender when gossip origin signature is invalid', async () => {
    const incoming: Array<any> = [];
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async (params) => {
        incoming.push(params);
      },
      onReply: () => {},
    });

    (peer as any).myPeerId = 'peer-self';
    (peer as any).syncProtocol = {};
    const createMessage = mock(async (channelId: string, senderId: string, content: string, type: string, threadId?: string) => ({
      id: 'msg-bad-sig',
      channelId,
      senderId,
      content,
      type,
      threadId,
      timestamp: Date.now(),
    }));
    const verifyData = mock(async () => false);
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => 'invalid-signature relayed message'),
      encryptMessage: mock(async () => ({ id: 'env-1', encrypted: 'cipher', ratchet: { n: 1 } })),
      verifyData,
    };
    (peer as any).cryptoManager.importPublicKey = mock(async () => ({}));
    (peer as any).getPeerPublicKey = () => 'public-key';
    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: mock((peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      }),
      getConnectedPeers: mock(() => ['peer-relay', 'peer-target'] as string[]),
    };
    (peer as any).workspaceManager.getWorkspace = () => ({
      id: 'ws-1',
      members: [{ peerId: 'peer-self' }, { peerId: 'peer-relay' }, { peerId: 'peer-target' }, { peerId: 'peer-origin' }],
      channels: [{ id: 'channel-1', name: 'General', type: 'channel' }],
    });
    (peer as any).messageStore = {
      createMessage,
      addMessage: async () => ({ success: true }),
      getMessages: () => [] as any[],
    };
    (peer as any).persistMessagesForChannel = () => {};
    (peer as any).recordManifestDomain = () => {};

    await (peer as any).handlePeerMessage('peer-relay', {
      encrypted: 'ciphertext',
      ratchet: { n: 2 },
      workspaceId: 'ws-1',
      channelId: 'channel-1',
      messageId: 'msg-bad-sig',
      _originalMessageId: 'msg-bad-sig',
      _gossipOriginalSender: 'peer-origin',
      _gossipOriginSignature: 'forged-signature',
      _gossipHop: 0,
      timestamp: Date.now(),
    });

    expect(incoming).toHaveLength(1);
    expect(incoming[0].senderId).toBe('peer-relay');
    expect(createMessage.mock.calls[0]?.[1]).toBe('peer-relay');
    expect(verifyData).toHaveBeenCalled();
    expect(sent.some((entry) => entry.peerId === 'peer-target' && entry.msg?.encrypted)).toBe(false);
  });

  test('does not trust arbitrary senderId from wire envelopes', async () => {
    const incoming: Array<any> = [];
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async (params) => {
        incoming.push(params);
      },
      onReply: () => {},
    });

    (peer as any).myPeerId = 'peer-self';
    (peer as any).syncProtocol = {};
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => 'forged sender attempt'),
      encryptMessage: mock(async () => ({ id: 'env-1', encrypted: 'cipher', ratchet: { n: 1 } })),
    };
    (peer as any).cryptoManager.importPublicKey = mock(async () => ({}));
    (peer as any).getPeerPublicKey = () => 'public-key';
    (peer as any).transport = {
      send: mock(() => true),
      getConnectedPeers: mock(() => [] as string[]),
    };
    const createMessage = mock(async (channelId: string, senderId: string, content: string, type: string, threadId?: string) => ({
        id: 'msg-forge-1',
        channelId,
        senderId,
        content,
        type,
        threadId,
        timestamp: Date.now(),
      }));
    (peer as any).messageStore = {
      createMessage,
      addMessage: async () => ({ success: true }),
      getMessages: () => [] as any[],
    };
    (peer as any).persistMessagesForChannel = () => {};
    (peer as any).recordManifestDomain = () => {};

    await (peer as any).handlePeerMessage('peer-attacker', {
      encrypted: 'ciphertext',
      ratchet: { n: 2 },
      isDirect: true,
      channelId: 'peer-attacker',
      senderId: 'peer-victim',
      messageId: 'msg-forge-1',
      timestamp: Date.now(),
    });

    expect(createMessage).toHaveBeenCalled();
    expect(createMessage.mock.calls[0]?.[1]).toBe('peer-attacker');
  });

});
