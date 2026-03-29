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
    signalingServer: 'https://0.peerjs.com/',
    invites: [],
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-prekey-custody-test-')),
    ...overrides,
  };
}

describe('DecentChatNodePeer pre-key custody recovery', () => {
  test('sendDirectToPeer stores plaintext resend data when transport falls back to custody', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const storeEnvelope = mock(async () => {});
    (peer as any).custodyStore = { storeEnvelope };
    (peer as any).myPeerId = 'self-peer';
    (peer as any).transport = {
      send: mock(() => false),
      getConnectedPeers: mock(() => ['peer-stale'] as string[]),
    };
    (peer as any).messageProtocol = {
      encryptMessage: mock(async () => ({
        id: 'env-stale',
        protocolVersion: 3,
        sessionInit: { preKeyId: 1 },
        signature: 'sig',
      })),
      getPeerPreKeyBundle: mock(async () => ({ version: 1 })),
    };

    await peer.sendDirectToPeer('peer-stale', 'retry me');

    expect(storeEnvelope).toHaveBeenCalledTimes(1);
    expect(storeEnvelope.mock.calls[0]?.[0]).toMatchObject({
      opId: expect.any(String),
      workspaceId: 'direct',
      domain: 'channel-message',
      metadata: {
        isDirect: true,
        senderId: 'self-peer',
        senderName: 'DecentChat Bot',
        resend: {
          content: 'retry me',
          isDirect: true,
        },
      },
    });
  });

  test('flushOfflineQueue re-encrypts custody payloads when plaintext resend data exists', async () => {
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
      getConnectedPeers: mock(() => ['peer-stale'] as string[]),
    };
    (peer as any).messageProtocol = {
      encryptMessage: mock(async () => ({
        id: 'env-fresh',
        protocolVersion: 2,
        ratchet: { header: { dhPublicKey: 'fresh', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
        signature: 'sig',
      })),
      getPeerPreKeyBundle: mock(async () => ({ version: 1 })),
    };

    (peer as any).store.set((peer as any).offlineQueueKey('peer-stale'), [{
      id: 1,
      targetPeerId: 'peer-stale',
      data: {
        envelopeId: 'env-stale',
        opId: 'msg-stale-1',
        recipientPeerIds: ['peer-stale'],
        workspaceId: 'direct',
        domain: 'channel-message',
        ciphertext: {
          id: 'env-stale',
          protocolVersion: 3,
          sessionInit: { preKeyId: 1 },
          signature: 'sig',
        },
        metadata: {
          isDirect: true,
          senderId: 'acct-1',
          senderName: 'DecentChat Bot',
          resend: {
            content: 'retry me',
            isDirect: true,
          },
        },
      },
    }]);

    await (peer as any).flushOfflineQueue('peer-stale');

    expect((peer as any).messageProtocol.encryptMessage).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.peerId).toBe('peer-stale');
    expect(sent[0]?.msg?.id).toBe('env-fresh');
    expect(sent[0]?.msg?._offlineReplay).toBeUndefined();

    const pending = (peer as any).store.get<any[]>((peer as any).pendingAckKey('peer-stale'), []);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      messageId: 'msg-stale-1',
      content: 'retry me',
      isDirect: true,
    });
  });

  test('decrypt recovery sends only one handshake during a burst of repeated failures', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const clearRatchetState = mock(async () => {});
    const clearSharedSecret = mock(() => {});
    const sendHandshake = mock(async () => {});
    (peer as any).transport = {
      send: mock(() => true),
      getConnectedPeers: mock(() => ['peer-main'] as string[]),
    };
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
    (peer as any).sendHandshake = sendHandshake;

    const badEnvelope = {
      id: 'env-recovery-burst',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
      signature: 'sig',
      protocolVersion: 2,
      senderId: 'peer-main',
      senderName: 'Peer Main',
      messageId: 'msg-recovery-burst',
      timestamp: 123,
    };

    await (peer as any).handlePeerMessage('peer-main', badEnvelope);
    await (peer as any).handlePeerMessage('peer-main', badEnvelope);

    expect(clearRatchetState).toHaveBeenCalledTimes(1);
    expect(clearSharedSecret).toHaveBeenCalledTimes(1);
    expect(sendHandshake).toHaveBeenCalledTimes(1);
  });

  test('reconnect burst sends only one outbound handshake and does not repeatedly clear session state', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const clearRatchetState = mock(async () => {});
    const clearSharedSecret = mock(() => {});
    const sendHandshake = mock(async () => {});
    (peer as any).messageProtocol = {
      clearRatchetState,
      clearSharedSecret,
    };
    (peer as any).sendHandshake = sendHandshake;

    await (peer as any).handlePeerConnect('peer-main');
    await (peer as any).handlePeerConnect('peer-main');

    expect(clearRatchetState).toHaveBeenCalledTimes(0);
    expect(clearSharedSecret).toHaveBeenCalledTimes(0);
    expect(sendHandshake).toHaveBeenCalledTimes(1);
  });

  test('reconnect with an existing session resumes sync state without sending a new handshake', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const sendHandshake = mock(async () => {});
    const resendPendingAcks = mock(async () => {});
    const flushOfflineQueue = mock(async () => {});
    const flushPendingReadReceipts = mock(async () => {});
    const requestSyncForPeer = mock(() => {});
    const sendManifestSummary = mock(() => {});
    const requestCustodyRecovery = mock(() => {});

    (peer as any).messageProtocol = {
      hasSharedSecret: mock(() => true),
    };
    (peer as any).sendHandshake = sendHandshake;
    (peer as any).resendPendingAcks = resendPendingAcks;
    (peer as any).flushOfflineQueue = flushOfflineQueue;
    (peer as any).flushPendingReadReceipts = flushPendingReadReceipts;
    (peer as any).requestSyncForPeer = requestSyncForPeer;
    (peer as any).sendManifestSummary = sendManifestSummary;
    (peer as any).requestCustodyRecovery = requestCustodyRecovery;

    await (peer as any).handlePeerConnect('peer-main');

    expect(sendHandshake).toHaveBeenCalledTimes(0);
    expect(resendPendingAcks).toHaveBeenCalledWith('peer-main');
    expect(flushOfflineQueue).toHaveBeenCalledWith('peer-main');
    expect(flushPendingReadReceipts).toHaveBeenCalledWith('peer-main');
    expect(requestSyncForPeer).toHaveBeenCalledWith('peer-main');
    expect(sendManifestSummary).toHaveBeenCalledWith('peer-main');
    expect(requestCustodyRecovery).toHaveBeenCalledWith('peer-main');
  });

  test('duplicate inbound handshakes in a reconnect burst are ignored after the first one', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const clearRatchetState = mock(async () => {});
    const clearSharedSecret = mock(() => {});
    const processHandshake = mock(async () => {});
    const publishPreKeyBundle = mock(async () => {});
    const requestSyncForPeer = mock(() => {});
    const sendManifestSummary = mock(() => {});
    const requestCustodyRecovery = mock(() => {});

    (peer as any).transport = {
      send: mock(() => true),
      getConnectedPeers: mock(() => ['peer-main'] as string[]),
    };
    (peer as any).syncProtocol = {};
    (peer as any).messageProtocol = {
      clearRatchetState,
      clearSharedSecret,
      processHandshake,
      hasSharedSecret: mock(() => true),
    };
    (peer as any).publishPreKeyBundle = publishPreKeyBundle;
    (peer as any).requestSyncForPeer = requestSyncForPeer;
    (peer as any).sendManifestSummary = sendManifestSummary;
    (peer as any).requestCustodyRecovery = requestCustodyRecovery;
    (peer as any).resendPendingAcks = mock(async () => {});
    (peer as any).flushOfflineQueue = mock(async () => {});
    (peer as any).flushPendingReadReceipts = mock(async () => {});
    (peer as any).resolveSharedWorkspaceIds = () => [];
    (peer as any).updateWorkspaceMemberKey = mock(() => {});
    (peer as any).store.delete = mock(() => {});
    (peer as any).store.get = mock(() => ({}));
    (peer as any).store.set = mock(() => {});

    const handshake = {
      type: 'handshake',
      publicKey: 'peer-public-key',
      peerId: 'peer-main',
      preKeySupport: true,
    };

    await (peer as any).handlePeerMessage('peer-main', handshake);
    await (peer as any).handlePeerMessage('peer-main', handshake);

    expect(processHandshake).toHaveBeenCalledTimes(1);
    expect(clearRatchetState).toHaveBeenCalledTimes(0);
    expect(clearSharedSecret).toHaveBeenCalledTimes(0);
    expect(publishPreKeyBundle).toHaveBeenCalledTimes(1);
    expect(requestSyncForPeer).toHaveBeenCalledTimes(1);
    expect(sendManifestSummary).toHaveBeenCalledTimes(1);
    expect(requestCustodyRecovery).toHaveBeenCalledTimes(1);
  });

  test('duplicate pre-key session replay errors do not trigger decrypt recovery', async () => {
    for (const errorMessage of [
      'Ratchet already established with peer peer-main',
      'Pre-key one-time:7 unavailable',
    ]) {
      const peer = new DecentChatNodePeer({
        account: makeAccount(),
        onIncomingMessage: async () => {},
        onReply: () => {},
      });

      const clearRatchetState = mock(async () => {});
      const clearSharedSecret = mock(() => {});
      const sendHandshake = mock(async () => {});
      (peer as any).transport = {
        send: mock(() => true),
        getConnectedPeers: mock(() => ['peer-main'] as string[]),
      };
      (peer as any).syncProtocol = {};
      (peer as any).messageProtocol = {
        decryptMessage: mock(async () => {
          throw new Error(errorMessage);
        }),
        clearRatchetState,
        clearSharedSecret,
        hasSharedSecret: mock(() => true),
      };
      (peer as any).cryptoManager = {
        importPublicKey: mock(async () => ({ mocked: true })),
      };
      (peer as any).getPeerPublicKey = () => 'peer-public-key';
      (peer as any).sendHandshake = sendHandshake;

      const replayedEnvelope = {
        id: 'env-prekey-replay',
        protocolVersion: 3,
        sessionInit: {
          type: 'pre-key-session-init',
          selectedPreKeyType: 'one-time',
          selectedPreKeyId: 7,
          senderEphemeralPublicKey: 'sender-ephemeral',
          createdAt: 123,
        },
        ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
        signature: 'sig',
        senderId: 'peer-main',
        senderName: 'Peer Main',
        messageId: 'msg-prekey-replay',
        timestamp: 123,
      };

      await (peer as any).handlePeerMessage('peer-main', replayedEnvelope);

      expect(clearRatchetState).toHaveBeenCalledTimes(0);
      expect(clearSharedSecret).toHaveBeenCalledTimes(0);
      expect(sendHandshake).toHaveBeenCalledTimes(0);
    }
  });
});
