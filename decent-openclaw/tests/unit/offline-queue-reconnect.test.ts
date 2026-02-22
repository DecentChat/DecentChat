import { describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeXenaPeer } from '../../src/peer/NodeXenaPeer.ts';

const VALID_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-1',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://decentchat.app/peerjs',
    invites: [],
    alias: 'Xena',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-offline-queue-test-')),
    ...overrides,
  };
}

describe('NodeXenaPeer offline queue reconnect flush', () => {
  test('sendDirectToPeer queues while offline and flushes after reconnect handshake', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    const send = mock((peerId: string, msg: any) => {
      sent.push({ peerId, msg });
      return true;
    });
    const getConnectedPeers = mock(() => [] as string[]);
    (peer as any).transport = {
      send,
      getConnectedPeers,
    };

    const processHandshake = mock(async () => {});
    const encryptMessage = mock(async () => ({ id: 'env-1', type: 'text' }));
    (peer as any).messageProtocol = {
      processHandshake,
      encryptMessage,
    };
    (peer as any).syncProtocol = {};

    await peer.sendDirectToPeer('peer-1', 'hello from offline');
    expect(send).toHaveBeenCalledTimes(0);
    expect((await (peer as any).offlineQueue.getQueued('peer-1')).length).toBe(1);

    getConnectedPeers.mockImplementation(() => ['peer-1']);
    await (peer as any).handlePeerMessage('peer-1', {
      type: 'handshake',
      publicKey: 'peer-public-key',
      peerId: 'peer-1',
    });

    expect(processHandshake).toHaveBeenCalledTimes(1);
    expect(encryptMessage).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[0]?.peerId).toBe('peer-1');
    expect(sent[0]?.msg.isDirect).toBe(true);
    expect((await (peer as any).offlineQueue.getQueued('peer-1')).length).toBe(0);
  });

  test('channel send queues offline recipient and flushes with channel metadata after reconnect handshake', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    const send = mock((peerId: string, msg: any) => {
      sent.push({ peerId, msg });
      return true;
    });
    const getConnectedPeers = mock(() => [] as string[]);
    (peer as any).transport = {
      send,
      getConnectedPeers,
    };

    const processHandshake = mock(async () => {});
    const encryptMessage = mock(async () => ({ id: 'env-2', type: 'text' }));
    (peer as any).messageProtocol = {
      processHandshake,
      encryptMessage,
    };
    (peer as any).syncProtocol = {};

    (peer as any).workspaceManager.getWorkspace = () => ({
      members: [{ peerId: 'peer-2' }],
    });

    await peer.sendMessage('channel-1', 'workspace-1', 'queued channel message');
    expect(send).toHaveBeenCalledTimes(0);
    expect((await (peer as any).offlineQueue.getQueued('peer-2')).length).toBe(1);

    getConnectedPeers.mockImplementation(() => ['peer-2']);
    await (peer as any).handlePeerMessage('peer-2', {
      type: 'handshake',
      publicKey: 'peer-public-key',
      peerId: 'peer-2',
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[0]?.peerId).toBe('peer-2');
    expect(sent[0]?.msg.channelId).toBe('channel-1');
    expect(sent[0]?.msg.workspaceId).toBe('workspace-1');
    expect(typeof sent[0]?.msg.messageId).toBe('string');
    expect((await (peer as any).offlineQueue.getQueued('peer-2')).length).toBe(0);
  });

  test('keeps pending message until ack and clears after ack', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    const send = mock((peerId: string, msg: any) => {
      sent.push({ peerId, msg });
      return true;
    });
    const getConnectedPeers = mock(() => ['peer-ack'] as string[]);
    (peer as any).transport = { send, getConnectedPeers };
    (peer as any).syncProtocol = {};
    (peer as any).messageProtocol = {
      processHandshake: mock(async () => {}),
      encryptMessage: mock(async () => ({ id: 'env-ack', type: 'text' })),
    };

    await peer.sendDirectToPeer('peer-ack', 'ack me');

    expect(sent).toHaveLength(1);
    const messageId = sent[0]?.msg?.messageId as string;
    expect(typeof messageId).toBe('string');

    const pendingKey = (peer as any).pendingAckKey('peer-ack');
    const beforeAck = (peer as any).store.get<any[]>(pendingKey, []);
    expect(beforeAck.some((m) => m?.messageId === messageId)).toBe(true);

    await (peer as any).handlePeerMessage('peer-ack', { type: 'ack', messageId, channelId: 'peer-ack' });

    const afterAck = (peer as any).store.get<any[]>(pendingKey, []);
    expect(afterAck.some((m) => m?.messageId === messageId)).toBe(false);
  });
});
