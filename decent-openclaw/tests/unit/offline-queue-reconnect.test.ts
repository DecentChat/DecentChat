import { describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';

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
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-offline-queue-test-')),
    ...overrides,
  };
}

describe('DecentChatNodePeer offline queue reconnect flush', () => {
  test('sendDirectToPeer queues while offline and flushes after reconnect handshake', async () => {
    const peer = new DecentChatNodePeer({
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
    const peer = new DecentChatNodePeer({
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

  test('channel send respects explicit channel members instead of all workspace members', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount({ alias: 'Mira PM' }),
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
      getConnectedPeers: mock(() => ['peer-backend', 'peer-qa', 'peer-alino']),
    };

    (peer as any).messageProtocol = {
      encryptMessage: mock(async () => ({ id: 'env-explicit', type: 'text' })),
    };

    (peer as any).workspaceManager.getWorkspace = () => ({
      id: 'workspace-1',
      members: [
        { peerId: (peer as any).myPeerId },
        { peerId: 'peer-backend' },
        { peerId: 'peer-qa' },
        { peerId: 'peer-alino' },
      ],
      channels: [
        {
          id: 'leadership',
          accessPolicy: {
            mode: 'explicit',
            explicitMemberPeerIds: [(peer as any).myPeerId, 'peer-backend'],
          },
        },
      ],
    });

    await peer.sendMessage('leadership', 'workspace-1', 'private leadership note');

    expect(send).toHaveBeenCalledTimes(1);
    expect(sent.map((entry) => entry.peerId)).toEqual(['peer-backend']);
    expect((peer as any).store.get<any[]>((peer as any).pendingAckKey('peer-backend'), []).length).toBe(1);
    expect((peer as any).store.get<any[]>((peer as any).pendingAckKey('peer-qa'), []).length).toBe(0);
    expect((peer as any).store.get<any[]>((peer as any).pendingAckKey('peer-alino'), []).length).toBe(0);
  });


  test('keeps pending message until ack and clears after ack', async () => {
    const peer = new DecentChatNodePeer({
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
    const peer = new DecentChatNodePeer({
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


  test('incoming handshake preserves existing session state while re-processing', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const send = mock(() => true);
    (peer as any).transport = {
      send,
      getConnectedPeers: mock(() => ['peer-1'] as string[]),
    };

    const clearRatchetState = mock(async () => {});
    const clearSharedSecret = mock(() => {});
    const processHandshake = mock(async () => {});
    const createPreKeyBundle = mock(async () => ({ version: 1, peerId: 'acct-1', signedPreKey: { keyId: 1 }, oneTimePreKeys: [] }));
    (peer as any).messageProtocol = {
      clearRatchetState,
      clearSharedSecret,
      processHandshake,
      createPreKeyBundle,
    };
    (peer as any).syncProtocol = { requestSync: mock(() => {}) };

    await (peer as any).handlePeerMessage('peer-1', {
      type: 'handshake',
      publicKey: 'peer-public-key',
      peerId: 'peer-1',
      protocolVersion: 2,
      ratchetDHPublicKey: 'ratchet-public-key',
      preKeySupport: false,
    });

    expect(clearRatchetState).toHaveBeenCalledTimes(0);
    expect(clearSharedSecret).toHaveBeenCalledTimes(0);
    expect(processHandshake).toHaveBeenCalledWith('peer-1', expect.any(Object));
  });

  test('decrypt failure triggers ratchet reset and recovery handshake', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const clearRatchetState = mock(async () => {});
    const clearSharedSecret = mock(() => {});
    (peer as any).transport = { send: mock(() => true), getConnectedPeers: mock(() => ['peer-main'] as string[]) };
    (peer as any).syncProtocol = {};
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => {
        throw new Error('No ratchet state with peer peer-main');
      }),
      clearRatchetState,
      clearSharedSecret,
    };
    (peer as any).cryptoManager = {
      importPublicKey: mock(async () => ({ mocked: true })),
    };
    (peer as any).getPeerPublicKey = () => 'peer-public-key';
    const sendHandshake = mock(async () => {});
    (peer as any).sendHandshake = sendHandshake;

    await (peer as any).handlePeerMessage('peer-main', {
      id: 'env-recovery-1',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
      signature: 'sig',
      protocolVersion: 2,
      senderId: 'peer-main',
      senderName: 'Peer Main',
      messageId: 'msg-recovery-1',
      timestamp: 123,
    });

    expect(clearRatchetState).toHaveBeenCalledWith('peer-main');
    expect(clearSharedSecret).toHaveBeenCalledWith('peer-main');
    expect(sendHandshake).toHaveBeenCalledWith('peer-main');
  });

  test('incoming direct encrypted message without channelId is delivered as a DM and ACKed', async () => {
    const incoming: any[] = [];
    const peer = new DecentChatNodePeer({
      account: makeAccount({ alias: 'Mira PM' }),
      onIncomingMessage: async (msg) => { incoming.push(msg); },
      onReply: () => {},
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: mock((peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      }),
      getConnectedPeers: mock(() => ['peer-main'] as string[]),
    };
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => 'hello from direct DM'),
    };
    (peer as any).syncProtocol = {};
    (peer as any).cryptoManager = {
      importPublicKey: mock(async () => ({ mocked: true })),
    };
    (peer as any).getPeerPublicKey = () => 'peer-main-public-key';

    await (peer as any).handlePeerMessage('peer-main', {
      id: 'env-direct-1',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
      signature: 'sig',
      protocolVersion: 2,
      isDirect: true,
      senderId: 'peer-main',
      senderName: 'DecentChat Bot',
      messageId: 'msg-direct-1',
      timestamp: 123,
    });

    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({
      channelId: 'peer-main',
      workspaceId: 'direct',
      senderId: 'peer-main',
      senderName: 'DecentChat Bot',
      messageId: 'msg-direct-1',
      content: 'hello from direct DM',
      chatType: 'direct',
    });

    expect(sent.some((entry) => entry.peerId === 'peer-main'
      && entry.msg?.type === 'ack'
      && entry.msg?.messageId === 'msg-direct-1'
      && entry.msg?.channelId === 'peer-main')).toBe(true);
  });

  test('handshake still resends pre-existing pending ACK messages', async () => {
    const peer = new DecentChatNodePeer({
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
      senderName: 'DecentChat Bot',
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
    const peer = new DecentChatNodePeer({
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

    const peer1 = new DecentChatNodePeer({
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

    const peer2 = new DecentChatNodePeer({
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
    const peer = new DecentChatNodePeer({
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
    const peer = new DecentChatNodePeer({
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

  test('handshake publishes pre-key bundles into custody-backed domain and offers replication', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer as any).myPeerId = 'peer-self';
    const workspace = {
      id: 'ws-prekey',
      members: [
        { peerId: 'peer-self' },
        { peerId: 'peer-target' },
        { peerId: 'custodian-1' },
      ],
      channels: [],
    };

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: mock((peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      }),
      getConnectedPeers: mock(() => ['peer-target', 'custodian-1'] as string[]),
    };
    (peer as any).syncProtocol = { requestSync: mock(() => {}) };
    (peer as any).messageProtocol = {
      processHandshake: mock(async () => {}),
      createPreKeyBundle: mock(async () => ({
        version: 1,
        peerId: 'peer-self',
        generatedAt: 123,
        signingPublicKey: 'signing-key',
        signedPreKey: {
          keyId: 7,
          publicKey: 'signed-key',
          signature: 'sig',
          createdAt: 100,
          expiresAt: 9999,
        },
        oneTimePreKeys: [{ keyId: 11, publicKey: 'otk-11' }],
      })),
    };
    (peer as any).workspaceManager.getAllWorkspaces = () => [workspace];
    (peer as any).workspaceManager.getWorkspace = () => workspace;

    await (peer as any).publishPreKeyBundle('peer-target');

    const storedForTarget = await (peer as any).custodyStore.listAllForRecipient('peer-target');
    expect(storedForTarget.some((envelope: any) => envelope.domain === 'pre-key-bundle')).toBe(true);

    const preKeyOffers = sent.filter((entry) => (
      entry.msg?.type === 'custody.offer' && entry.msg?.envelope?.domain === 'pre-key-bundle'
    ));
    expect(preKeyOffers.length).toBeGreaterThan(0);
    expect((peer as any).manifestStore.getVersion('ws-prekey', 'pre-key-bundle')).toBeGreaterThan(0);
  });

  test('offline first send fetches peer pre-key bundle before falling back to deferred plaintext queue', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer as any).myPeerId = 'peer-self';
    const workspace = {
      id: 'ws-send',
      members: [
        { peerId: 'peer-self' },
        { peerId: 'peer-target' },
        { peerId: 'peer-relay' },
      ],
      channels: [{ id: 'channel-1', name: 'General', type: 'channel' }],
    };

    let hasTargetBundle = false;
    const targetBundle = {
      version: 1,
      peerId: 'peer-target',
      generatedAt: 456,
      signingPublicKey: 'signing-key-target',
      signedPreKey: {
        keyId: 9,
        publicKey: 'signed-key-target',
        signature: 'sig',
        createdAt: 120,
        expiresAt: 10_000,
      },
      oneTimePreKeys: [{ keyId: 12, publicKey: 'otk-12' }],
    };

    const storePeerPreKeyBundle = mock(async (ownerPeerId: string) => {
      if (ownerPeerId === 'peer-target') hasTargetBundle = true;
      return true;
    });

    (peer as any).messageProtocol = {
      encryptMessage: mock(async (recipientPeerId: string) => {
        if (recipientPeerId === 'peer-target' && !hasTargetBundle) {
          throw new Error('No shared secret with peer peer-target. Exchange handshakes first.');
        }
        return { id: `env-${recipientPeerId}-${Date.now()}`, encrypted: 'ciphertext', ratchet: { n: 1 } };
      }),
      getPeerPreKeyBundle: mock(async () => null),
      storePeerPreKeyBundle,
    };

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: mock((recipientPeerId: string, msg: any) => {
        sent.push({ peerId: recipientPeerId, msg });
        if (msg?.type === 'pre-key-bundle.fetch') {
          setTimeout(() => {
            void (peer as any).handlePeerMessage('peer-relay', {
              type: 'pre-key-bundle.fetch-response',
              requestId: msg.requestId,
              ownerPeerId: 'peer-target',
              workspaceId: 'ws-send',
              bundle: targetBundle,
            });
          }, 0);
        }
        return true;
      }),
      getConnectedPeers: mock(() => ['peer-relay'] as string[]),
    };

    (peer as any).syncProtocol = {};
    (peer as any).workspaceManager.getWorkspace = () => workspace;
    (peer as any).workspaceManager.getAllWorkspaces = () => [workspace];

    await peer.sendMessage('channel-1', 'ws-send', 'hello offline first contact');

    expect(storePeerPreKeyBundle).toHaveBeenCalledWith('peer-target', targetBundle);
    expect(sent.some((entry) => entry.msg?.type === 'pre-key-bundle.fetch')).toBe(true);

    const pendingTarget = await (peer as any).custodyStore.getPendingForRecipient('peer-target');
    const channelEnvelope = pendingTarget.find((envelope: any) => envelope.domain === 'channel-message');
    expect(channelEnvelope).toBeDefined();
    expect((channelEnvelope as any).ciphertext?.encrypted).toBe('ciphertext');

    const queuedForTarget = await (peer as any).offlineQueue.listQueued('peer-target');
    expect(queuedForTarget.length).toBeGreaterThan(0);
    expect(queuedForTarget.some((entry: any) => (entry?.data ?? entry)?._deferred === true)).toBe(false);
  });


  test('pre-key bootstrap falls back from custodian-targeted lookup to broader peer lookup', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer as any).myPeerId = 'peer-self';

    const workspace = {
      id: 'ws-send',
      members: [
        { peerId: 'peer-self' },
        { peerId: 'peer-target' },
        { peerId: 'custodian-1' },
        { peerId: 'peer-relay' },
      ],
      channels: [],
    };

    let hasTargetBundle = false;
    const targetBundle = {
      version: 1,
      peerId: 'peer-target',
      generatedAt: 999,
      signingPublicKey: 'signing-key-target',
      signedPreKey: {
        keyId: 42,
        publicKey: 'signed-key-target',
        signature: 'sig',
        createdAt: 120,
        expiresAt: 10_000,
      },
      oneTimePreKeys: [{ keyId: 13, publicKey: 'otk-13' }],
    };

    const storePeerPreKeyBundle = mock(async (ownerPeerId: string) => {
      if (ownerPeerId === 'peer-target') hasTargetBundle = true;
      return true;
    });

    (peer as any).messageProtocol = {
      encryptMessage: mock(async (recipientPeerId: string) => {
        if (recipientPeerId === 'peer-target' && !hasTargetBundle) {
          throw new Error('No shared secret with peer peer-target. Exchange handshakes first.');
        }
        return { id: 'env-target', encrypted: 'ciphertext', ratchet: { n: 1 } };
      }),
      getPeerPreKeyBundle: mock(async () => null),
      storePeerPreKeyBundle,
    };

    const fetchTargets: string[] = [];
    (peer as any).transport = {
      send: mock((recipientPeerId: string, msg: any) => {
        if (msg?.type === 'pre-key-bundle.fetch') {
          fetchTargets.push(`${recipientPeerId}:${msg.querySource}`);
          if (recipientPeerId === 'custodian-1') {
            setTimeout(() => {
              void (peer as any).handlePeerMessage('custodian-1', {
                type: 'pre-key-bundle.fetch-response',
                requestId: msg.requestId,
                ownerPeerId: 'peer-target',
                workspaceId: 'ws-send',
                querySource: msg.querySource,
                notAvailable: true,
              });
            }, 0);
          }
          if (recipientPeerId === 'peer-relay') {
            setTimeout(() => {
              void (peer as any).handlePeerMessage('peer-relay', {
                type: 'pre-key-bundle.fetch-response',
                requestId: msg.requestId,
                ownerPeerId: 'peer-target',
                workspaceId: 'ws-send',
                querySource: msg.querySource,
                bundle: targetBundle,
              });
            }, 0);
          }
        }
        return true;
      }),
      getConnectedPeers: mock(() => ['custodian-1', 'peer-relay'] as string[]),
    };

    (peer as any).syncProtocol = {};
    (peer as any).workspaceManager.getWorkspace = () => workspace;
    (peer as any).workspaceManager.getAllWorkspaces = () => [workspace];
    (peer as any).selectCustodianPeers = mock(() => ['custodian-1']);

    const envelope = await (peer as any).encryptMessageWithPreKeyBootstrap('peer-target', 'hello', undefined, 'ws-send');

    expect(envelope).toEqual({ id: 'env-target', encrypted: 'ciphertext', ratchet: { n: 1 } });
    expect(fetchTargets).toEqual([
      'custodian-1:custodian-targeted',
      'peer-relay:peer-broadcast',
    ]);
    expect(storePeerPreKeyBundle).toHaveBeenCalledWith('peer-target', targetBundle);
  });


});
