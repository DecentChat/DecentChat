/**
 * Tests for bot-side ACK delivery fixes.
 *
 * Fix 2: Bot sends ACK with retry/offline-queue fallback instead of fire-and-forget.
 * Fix 3: Bot sends ACK even for duplicate (rejected) messages.
 */
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
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-ack-fix-test-')),
    ...overrides,
  };
}

// ── Fix 3: Bot sends ACK for duplicate messages ──────────────────────────────

describe('Fix 3 — ACK on duplicate message', () => {
  test('incoming duplicate message still sends ACK back to sender', async () => {
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
      getConnectedPeers: mock(() => ['peer-sender'] as string[]),
    };
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => 'hello duplicate'),
    };
    (peer as any).syncProtocol = {};
    (peer as any).cryptoManager = {
      importPublicKey: mock(async () => ({ mocked: true })),
    };
    (peer as any).getPeerPublicKey = () => 'peer-sender-public-key';

    // First message — should be accepted and ACKed
    await (peer as any).handlePeerMessage('peer-sender', {
      id: 'env-dup-1',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
      signature: 'sig',
      protocolVersion: 2,
      isDirect: true,
      senderId: 'peer-sender',
      senderName: 'Human',
      messageId: 'msg-dup-1',
      timestamp: 100,
    });

    const firstAcks = sent.filter(e => e.msg?.type === 'ack' && e.msg?.messageId === 'msg-dup-1');
    expect(firstAcks).toHaveLength(1);
    expect(firstAcks[0].peerId).toBe('peer-sender');

    // Clear sent log
    sent.length = 0;

    // Second message with same messageId — should be rejected as duplicate but still ACKed
    await (peer as any).handlePeerMessage('peer-sender', {
      id: 'env-dup-2',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 2 }, ciphertext: 'cipher2', iv: 'iv2' },
      signature: 'sig2',
      protocolVersion: 2,
      isDirect: true,
      senderId: 'peer-sender',
      senderName: 'Human',
      messageId: 'msg-dup-1',   // same messageId!
      timestamp: 101,
    });

    // Fix 3: the duplicate should still produce an ACK
    const dupAcks = sent.filter(e => e.msg?.type === 'ack' && e.msg?.messageId === 'msg-dup-1');
    expect(dupAcks).toHaveLength(1);
    expect(dupAcks[0].peerId).toBe('peer-sender');
  });
});

// ── Fix 2: Bot ACK reliability (fallback to offline queue) ───────────────────

describe('Fix 2 — ACK reliability with offline queue fallback', () => {
  test('ACK falls back to offline queue when transport.send() returns false', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    let sendCallCount = 0;
    const send = mock((_peerId: string, _msg: any) => {
      sendCallCount++;
      return false; // transport rejects the send
    });
    (peer as any).transport = {
      send,
      getConnectedPeers: mock(() => ['peer-sender'] as string[]),
    };
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => 'hello from sender'),
    };
    (peer as any).syncProtocol = {};
    (peer as any).cryptoManager = {
      importPublicKey: mock(async () => ({ mocked: true })),
    };
    (peer as any).getPeerPublicKey = () => 'peer-sender-public-key';

    await (peer as any).handlePeerMessage('peer-sender', {
      id: 'env-fail-1',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
      signature: 'sig',
      protocolVersion: 2,
      isDirect: true,
      senderId: 'peer-sender',
      senderName: 'Human',
      messageId: 'msg-fail-1',
      timestamp: 200,
    });

    // Transport.send was called (and returned false)
    expect(sendCallCount).toBeGreaterThan(0);

    // Fix 2: the ACK should have been queued offline as a fallback.
    // enqueueOffline routes receipts through custodyStore.storeEnvelope(),
    // so check the custody store, not the regular offlineQueue.
    const custodyEnvelopes = await (peer as any).custodyStore.listAllForRecipient('peer-sender');
    const ackInCustody = custodyEnvelopes.some((env: any) =>
      env?.domain === 'receipt' && env?.ciphertext?.type === 'ack' && env?.ciphertext?.messageId === 'msg-fail-1',
    );
    expect(ackInCustody).toBe(true);
  });

  test('ACK falls back to offline queue when transport.send() throws', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const send = mock((_peerId: string, _msg: any) => {
      throw new Error('WebRTC data channel closed');
    });
    (peer as any).transport = {
      send,
      getConnectedPeers: mock(() => ['peer-sender'] as string[]),
    };
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => 'hello from sender'),
    };
    (peer as any).syncProtocol = {};
    (peer as any).cryptoManager = {
      importPublicKey: mock(async () => ({ mocked: true })),
    };
    (peer as any).getPeerPublicKey = () => 'peer-sender-public-key';

    await (peer as any).handlePeerMessage('peer-sender', {
      id: 'env-throw-1',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
      signature: 'sig',
      protocolVersion: 2,
      isDirect: true,
      senderId: 'peer-sender',
      senderName: 'Human',
      messageId: 'msg-throw-1',
      timestamp: 300,
    });

    // Fix 2: ACK should be in custody store after transport exception
    const custodyEnvelopes = await (peer as any).custodyStore.listAllForRecipient('peer-sender');
    const ackInCustody = custodyEnvelopes.some((env: any) =>
      env?.domain === 'receipt' && env?.ciphertext?.type === 'ack' && env?.ciphertext?.messageId === 'msg-throw-1',
    );
    expect(ackInCustody).toBe(true);
  });

  test('ACK is sent directly when transport.send() succeeds', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    const send = mock((peerId: string, msg: any) => {
      sent.push({ peerId, msg });
      return true; // transport accepts
    });
    (peer as any).transport = {
      send,
      getConnectedPeers: mock(() => ['peer-sender'] as string[]),
    };
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => 'hello happy path'),
    };
    (peer as any).syncProtocol = {};
    (peer as any).cryptoManager = {
      importPublicKey: mock(async () => ({ mocked: true })),
    };
    (peer as any).getPeerPublicKey = () => 'peer-sender-public-key';

    await (peer as any).handlePeerMessage('peer-sender', {
      id: 'env-ok-1',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
      signature: 'sig',
      protocolVersion: 2,
      isDirect: true,
      senderId: 'peer-sender',
      senderName: 'Human',
      messageId: 'msg-ok-1',
      timestamp: 400,
    });

    // ACK was sent directly
    const acks = sent.filter(e => e.msg?.type === 'ack' && e.msg?.messageId === 'msg-ok-1');
    expect(acks).toHaveLength(1);
    expect(acks[0].peerId).toBe('peer-sender');

    // No offline/custody fallback needed
    const custodyEnvelopes = await (peer as any).custodyStore.listAllForRecipient('peer-sender');
    const ackInCustody = custodyEnvelopes.some((env: any) =>
      env?.domain === 'receipt' && env?.ciphertext?.type === 'ack' && env?.ciphertext?.messageId === 'msg-ok-1',
    );
    expect(ackInCustody).toBe(false);
  });

  test('duplicate message ACK also falls back to offline queue when transport rejects', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    let callCount = 0;
    const send = mock((_peerId: string, _msg: any) => {
      callCount++;
      // First call succeeds (original message ACK), second fails (duplicate ACK)
      return callCount <= 1;
    });
    (peer as any).transport = {
      send,
      getConnectedPeers: mock(() => ['peer-sender'] as string[]),
    };
    (peer as any).messageProtocol = {
      decryptMessage: mock(async () => 'original message'),
    };
    (peer as any).syncProtocol = {};
    (peer as any).cryptoManager = {
      importPublicKey: mock(async () => ({ mocked: true })),
    };
    (peer as any).getPeerPublicKey = () => 'peer-sender-public-key';

    // First message — accepted, ACK succeeds
    await (peer as any).handlePeerMessage('peer-sender', {
      id: 'env-dup-ack-1',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 }, ciphertext: 'cipher', iv: 'iv' },
      signature: 'sig',
      protocolVersion: 2,
      isDirect: true,
      senderId: 'peer-sender',
      senderName: 'Human',
      messageId: 'msg-dup-ack-1',
      timestamp: 500,
    });

    // Second message — duplicate, transport rejects ACK
    await (peer as any).handlePeerMessage('peer-sender', {
      id: 'env-dup-ack-2',
      ratchet: { header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 2 }, ciphertext: 'cipher2', iv: 'iv2' },
      signature: 'sig2',
      protocolVersion: 2,
      isDirect: true,
      senderId: 'peer-sender',
      senderName: 'Human',
      messageId: 'msg-dup-ack-1',  // same messageId
      timestamp: 501,
    });

    // Fix 2 + Fix 3: duplicate ACK should be in custody store
    const custodyEnvelopes = await (peer as any).custodyStore.listAllForRecipient('peer-sender');
    const ackInCustody = custodyEnvelopes.some((env: any) =>
      env?.domain === 'receipt' && env?.ciphertext?.type === 'ack' && env?.ciphertext?.messageId === 'msg-dup-ack-1',
    );
    expect(ackInCustody).toBe(true);
  });
});
