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
    (peer as any).syncProtocol = { requestSync: mock(() => {}) };

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
    expect(encryptMessage).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
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

    expect(send).toHaveBeenCalledTimes(1);
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

  test('ACK can clear a queued offline payload by messageId before reconnect flush', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer as any).transport = {
      send: mock(() => true),
      getConnectedPeers: mock(() => [] as string[]),
    };
    (peer as any).messageProtocol = { processHandshake: mock(async () => {}) };
    (peer as any).syncProtocol = {};

    await peer.sendDirectToPeer('peer-ack', 'queued message', undefined, undefined, 'msg-clear-1');
    expect((await (peer as any).offlineQueue.listQueued('peer-ack')).length).toBe(1);

    await (peer as any).handlePeerMessage('peer-ack', { type: 'ack', messageId: 'msg-clear-1' });
    expect((await (peer as any).offlineQueue.listQueued('peer-ack')).length).toBe(0);
  });

  test('handshake still resends pre-existing pending ACK messages', async () => {
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
      encryptMessage: mock(async () => ({ id: 'env-resend', type: 'text' })),
    };

    const pendingKey = (peer as any).pendingAckKey('peer-ack');
    (peer as any).store.set(pendingKey, [{
      messageId: 'pending-1',
      content: 'resend me',
      senderId: 'self',
      senderName: 'Xena',
      queuedAt: Date.now(),
    }]);

    await (peer as any).handlePeerMessage('peer-ack', {
      type: 'handshake',
      publicKey: 'peer-public-key',
      peerId: 'peer-ack',
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(sent[0]?.peerId).toBe('peer-ack');
    expect(sent[0]?.msg?.messageId).toBe('pending-1');
  });

  test('handshake announces manifest summary and requests custody recovery', async () => {
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

    (peer as any).transport = {
      send,
      getConnectedPeers: mock(() => ['peer-manifest'] as string[]),
    };
    (peer as any).messageProtocol = {
      processHandshake: mock(async () => {}),
    };
    (peer as any).syncProtocol = { requestSync: mock(() => {}) };
    (peer as any).workspaceManager.getAllWorkspaces = () => ([
      {
        id: 'ws-manifest',
        members: [{ peerId: 'peer-manifest' }],
        channels: [],
      },
    ]);

    await (peer as any).handlePeerMessage('peer-manifest', {
      type: 'handshake',
      publicKey: 'peer-public-key',
      peerId: 'peer-manifest',
    });

    const sentTypes = sent.map((entry) => entry.msg?.type);
    expect(sentTypes).toContain('sync.summary');
    expect(sentTypes).toContain('custody.fetch_index');
  });


  test('restores persisted manifest state on peer restart', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'openclaw-manifest-state-test-'));

    const peer1 = new NodeXenaPeer({
      account: makeAccount({ dataDir }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer1 as any).manifestStore.updateDomain({
      domain: 'membership',
      workspaceId: 'ws-manifest',
      author: 'peer-a',
      itemCount: 2,
      operation: 'update',
      subject: 'members',
    });
    (peer1 as any).manifestStore.saveSnapshot({
      domain: 'channel-message',
      workspaceId: 'ws-manifest',
      channelId: 'ch-1',
      version: 1,
      snapshotId: 'snap-restore-1',
      basedOnVersion: 1,
      messageCount: 1,
      messageIds: ['msg-1'],
      minTimestamp: 100,
      maxTimestamp: 100,
      createdAt: 100,
      createdBy: 'peer-a',
    });
    (peer1 as any).persistManifestState();
    peer1.destroy();

    const peer2 = new NodeXenaPeer({
      account: makeAccount({ dataDir }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer2 as any).restoreManifestState();

    expect((peer2 as any).manifestStore.getVersion('ws-manifest', 'membership')).toBe(1);
    const restoredSnapshot = (peer2 as any).manifestStore.getSnapshot('ws-manifest', 'channel-message', 'ch-1');
    expect(restoredSnapshot?.snapshotId).toBe('snap-restore-1');

    peer2.destroy();
  });

  test('offline workspace send offers custody replication to selected custodian peers', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: mock((peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      }),
      getConnectedPeers: mock(() => ['custodian-1'] as string[]),
    };
    (peer as any).messageProtocol = {
      encryptMessage: mock(async () => ({ id: 'env-repl', encrypted: 'cipher', ratchet: { n: 1 } })),
    };
    (peer as any).syncProtocol = {};

    (peer as any).workspaceManager.getWorkspace = () => ({
      members: [
        { peerId: 'recipient-1' },
        { peerId: 'custodian-1' },
      ],
    });

    await peer.sendMessage('channel-1', 'workspace-1', 'replicate me');

    const offers = sent.filter((entry) => entry.msg?.type === 'custody.offer');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.some((entry) => entry.peerId === 'custodian-1')).toBe(true);
    expect(offers.some((entry) => entry.msg?.recipientPeerId === 'recipient-1')).toBe(true);
  });

  test('sync.summary from a newer peer requests manifest diff', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: mock((peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      }),
      getConnectedPeers: mock(() => ['peer-sync'] as string[]),
    };
    (peer as any).syncProtocol = {};
    (peer as any).workspaceManager.getWorkspace = () => ({
      id: 'ws-sync',
      members: [{ peerId: 'peer-sync' }],
    });

    const summaryPayload = {
      workspaceId: 'ws-sync',
      generatedAt: Date.now(),
      versions: [
        {
          domain: 'membership',
          workspaceId: 'ws-sync',
          version: 2,
          itemCount: 2,
          lastUpdatedAt: Date.now(),
          lastUpdatedBy: 'peer-sync',
        },
      ],
    };

    const planned = (peer as any).manifestStore.buildDiffRequest('ws-sync', summaryPayload);
    expect(planned.length).toBeGreaterThan(0);

    await (peer as any).handleManifestSummary('peer-sync', {
      type: 'sync.summary',
      workspaceId: 'ws-sync',
      summary: summaryPayload,
    });

    const diffRequest = sent.find((entry) => entry.msg?.type === 'sync.diff_request');
    expect(diffRequest).toBeDefined();
    expect(diffRequest?.msg?.requests?.[0]?.domain).toBe('membership');
    expect(diffRequest?.msg?.requests?.[0]?.fromVersion).toBe(0);
    expect(diffRequest?.msg?.requests?.[0]?.toVersion).toBe(2);
  });

});
