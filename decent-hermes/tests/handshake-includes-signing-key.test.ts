/**
 * Smoke test: NodeMessageProtocol.createHandshake() actually populates
 * `signingPublicKey` after init(). The web client only initiates an
 * `auth-challenge` if `data.signingPublicKey` is truthy in our handshake;
 * if this regresses to undefined silently, the auth-challenge round-trip
 * never starts and our shiny new auth-challenge handler is dead code.
 */
import { describe, expect, test } from 'bun:test';
import { CryptoManager } from '@decentchat/protocol';
import { NodeMessageProtocol } from '../src/peer/NodeMessageProtocol.js';

describe('handshake includes signing public key', () => {
  test('createHandshake() returns signingPublicKey after init()', async () => {
    const cm = new CryptoManager();
    const ecdsa = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    const proto = new NodeMessageProtocol(cm, 'test-peer-id');
    await proto.init(ecdsa);

    const handshake = await proto.createHandshake();
    expect(handshake.signingPublicKey).toBeDefined();
    expect(typeof handshake.signingPublicKey).toBe('string');
    expect((handshake.signingPublicKey as string).length).toBeGreaterThan(20);
  });
});
