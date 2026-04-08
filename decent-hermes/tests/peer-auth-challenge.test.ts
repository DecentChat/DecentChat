/**
 * Regression test for the "auth-challenge not responded to" fix.
 *
 * Before the fix, DecentChatNodePeer.handlePeerMessage had no case for
 * `auth-challenge` messages. When the web client sent one right after our
 * handshake, the bridge silently dropped it and the client's `AUTH_TIMEOUT_MS`
 * eventually fired, logging `[Auth] Peer ... did not respond to auth challenge
 * — TOFU fallback`. Functional but noisy, and defeats the point of the
 * challenge-response (we never actually prove we own our signing key).
 *
 * This test asserts:
 *   1. The bridge DOES handle `auth-challenge` and sends back an `auth-response`
 *      message with a signature.
 *   2. The signature validates under `PeerAuth.verifyResponse` when given the
 *      bridge's own ECDSA public signing key. i.e. the signature we produced
 *      is cryptographically correct and the peer's side of the flow will pass.
 *   3. If no signing key is available (null keypair), the bridge logs a
 *      warning and does NOT send a malformed response.
 */

import { describe, expect, mock, test } from 'bun:test';
import { PeerAuth } from '@decentchat/protocol';

// Generate an ECDSA key pair similar to how the bridge derives one from the
// seed phrase. We don't need the bridge's full seed-derivation path here —
// any P-256 ECDSA keypair with sign/verify usages is good enough for the
// signature round-trip check.
async function generateEcdsaKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

describe('DecentChatNodePeer auth-challenge handling', () => {
  test('responds to auth-challenge with a verifiable signature', async () => {
    const { DecentChatNodePeer } = await import(
      `../src/peer/DecentChatNodePeer.js?real=${Date.now()}`
    );
    const peer = Object.create((DecentChatNodePeer as any).prototype) as any;

    const keyPair = await generateEcdsaKeyPair();
    peer.signingKeyPair = keyPair;
    peer.destroyed = false;
    peer.messageProtocol = {};
    peer.syncProtocol = {};

    const sent: any[] = [];
    peer.transport = {
      send: (_peerId: string, payload: any) => {
        sent.push(payload);
        return true;
      },
    };

    const infoLines: string[] = [];
    const warnLines: string[] = [];
    peer.opts = {
      log: {
        info: (line: string) => infoLines.push(line),
        debug: () => {},
        warn: (line: string) => warnLines.push(line),
        error: () => {},
      },
    };

    // Challenger identity sentinel used to exercise payload binding
    const challengerPeerId = 'peer-37603fd5-d5a8b7acce';
    const challenge = PeerAuth.createChallenge();

    // Simulate the incoming auth-challenge message
    await (peer as any).handlePeerMessage(challengerPeerId, {
      type: 'auth-challenge',
      nonce: challenge.nonce,
    });

    // Assertion 1: bridge sent exactly one auth-response message
    const responses = sent.filter((p) => p?.type === 'auth-response');
    expect(responses).toHaveLength(1);
    expect(typeof responses[0].signature).toBe('string');
    expect(responses[0].signature.length).toBeGreaterThan(0);

    // Assertion 2: signature verifies with PeerAuth.verifyResponse
    // The challenger's side calls verifyResponse(nonce, ourPeerId=challenger, signature, peerSigningKey=ours)
    const valid = await PeerAuth.verifyResponse(
      challenge.nonce,
      challengerPeerId,
      responses[0].signature,
      keyPair.publicKey,
    );
    expect(valid).toBeTrue();

    // Assertion 3: info log recorded the send (info-level so it lands in
    // bridge.log without debug stream wiring)
    expect(infoLines.some((l) => l.includes('auth-response sent to peer-376'))).toBeTrue();
    expect(warnLines).toHaveLength(0);
  });

  test('logs a warning and does not send anything if signing key is missing', async () => {
    const { DecentChatNodePeer } = await import(
      `../src/peer/DecentChatNodePeer.js?real=${Date.now()}`
    );
    const peer = Object.create((DecentChatNodePeer as any).prototype) as any;

    peer.signingKeyPair = null;
    peer.destroyed = false;
    peer.messageProtocol = {};
    peer.syncProtocol = {};

    const sent: any[] = [];
    peer.transport = {
      send: (_peerId: string, payload: any) => {
        sent.push(payload);
        return true;
      },
    };

    const warnLines: string[] = [];
    peer.opts = {
      log: {
        info: () => {},
        debug: () => {},
        warn: (line: string) => warnLines.push(line),
        error: () => {},
      },
    };

    await (peer as any).handlePeerMessage('peer-37603fd5-d5a8b7acce', {
      type: 'auth-challenge',
      nonce: 'some-nonce-base64',
    });

    expect(sent.filter((p) => p?.type === 'auth-response')).toHaveLength(0);
    expect(warnLines.some((l) => l.includes('no signing key available'))).toBeTrue();
  });

  test('ignores malformed auth-challenge (missing nonce)', async () => {
    const { DecentChatNodePeer } = await import(
      `../src/peer/DecentChatNodePeer.js?real=${Date.now()}`
    );
    const peer = Object.create((DecentChatNodePeer as any).prototype) as any;

    peer.signingKeyPair = await generateEcdsaKeyPair();
    peer.destroyed = false;
    peer.messageProtocol = {};
    peer.syncProtocol = {};

    const sent: any[] = [];
    peer.transport = {
      send: (_peerId: string, payload: any) => {
        sent.push(payload);
        return true;
      },
    };
    peer.opts = { log: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} } };

    // Missing nonce entirely
    await (peer as any).handlePeerMessage('peer-37603fd5-d5a8b7acce', {
      type: 'auth-challenge',
    });

    // Nonce present but not a string
    await (peer as any).handlePeerMessage('peer-37603fd5-d5a8b7acce', {
      type: 'auth-challenge',
      nonce: 42,
    });

    expect(sent.filter((p) => p?.type === 'auth-response')).toHaveLength(0);
  });
});
