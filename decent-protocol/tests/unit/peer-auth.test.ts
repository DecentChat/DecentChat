import { describe, test, expect } from 'bun:test';
import { PeerAuth } from '../../src/security/PeerAuth';

describe('PeerAuth', () => {
  // Helper to generate ECDSA signing key pair
  async function generateSigningKeys() {
    return crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
  }

  test('createChallenge returns 32-byte nonce as base64', () => {
    const challenge = PeerAuth.createChallenge();
    // 32 bytes → 44 chars base64 (with padding)
    expect(challenge.nonce.length).toBe(44);
    expect(challenge.timestamp).toBeGreaterThan(0);
    // Decode to verify it's valid base64 with 32 bytes
    const decoded = Uint8Array.from(atob(challenge.nonce), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(32);
  });

  test('createChallenge produces unique nonces', () => {
    const c1 = PeerAuth.createChallenge();
    const c2 = PeerAuth.createChallenge();
    expect(c1.nonce).not.toBe(c2.nonce);
  });

  test('full round-trip: createChallenge → respondToChallenge → verifyResponse', async () => {
    const keys = await generateSigningKeys();
    const bobPeerId = 'bob123456789012345';

    const challenge = PeerAuth.createChallenge();
    const response = await PeerAuth.respondToChallenge(
      challenge.nonce,
      bobPeerId,
      keys.privateKey,
    );
    expect(response.signature).toBeTruthy();

    const valid = await PeerAuth.verifyResponse(
      challenge.nonce,
      bobPeerId,
      response.signature,
      keys.publicKey,
    );
    expect(valid).toBe(true);
  });

  test('reject wrong nonce', async () => {
    const keys = await generateSigningKeys();
    const bobPeerId = 'bob123456789012345';

    const challenge = PeerAuth.createChallenge();
    const response = await PeerAuth.respondToChallenge(
      challenge.nonce,
      bobPeerId,
      keys.privateKey,
    );

    // Verify with a different nonce
    const wrongChallenge = PeerAuth.createChallenge();
    const valid = await PeerAuth.verifyResponse(
      wrongChallenge.nonce,
      bobPeerId,
      response.signature,
      keys.publicKey,
    );
    expect(valid).toBe(false);
  });

  test('reject wrong bobPeerId (replay prevention)', async () => {
    const keys = await generateSigningKeys();
    const bobPeerId = 'bob123456789012345';

    const challenge = PeerAuth.createChallenge();
    const response = await PeerAuth.respondToChallenge(
      challenge.nonce,
      bobPeerId,
      keys.privateKey,
    );

    // Verify with a different peer ID (simulates replay to another peer)
    const valid = await PeerAuth.verifyResponse(
      challenge.nonce,
      'eve123456789012345',
      response.signature,
      keys.publicKey,
    );
    expect(valid).toBe(false);
  });

  test('reject wrong signing key', async () => {
    const aliceKeys = await generateSigningKeys();
    const eveKeys = await generateSigningKeys();
    const bobPeerId = 'bob123456789012345';

    const challenge = PeerAuth.createChallenge();
    const response = await PeerAuth.respondToChallenge(
      challenge.nonce,
      bobPeerId,
      aliceKeys.privateKey,
    );

    // Verify with Eve's public key instead of Alice's
    const valid = await PeerAuth.verifyResponse(
      challenge.nonce,
      bobPeerId,
      response.signature,
      eveKeys.publicKey,
    );
    expect(valid).toBe(false);
  });

  test('challenge expiry check: fresh challenge is valid', () => {
    const challenge = PeerAuth.createChallenge();
    expect(PeerAuth.isChallengeExpired(challenge, 30_000)).toBe(false);
  });

  test('challenge expiry check: old challenge is expired', () => {
    const challenge = PeerAuth.createChallenge();
    // Backdate the timestamp by 31 seconds
    challenge.timestamp = Date.now() - 31_000;
    expect(PeerAuth.isChallengeExpired(challenge, 30_000)).toBe(true);
  });

  test('respondToChallenge produces different signatures for different nonces', async () => {
    const keys = await generateSigningKeys();
    const bobPeerId = 'bob123456789012345';

    const c1 = PeerAuth.createChallenge();
    const c2 = PeerAuth.createChallenge();

    const r1 = await PeerAuth.respondToChallenge(c1.nonce, bobPeerId, keys.privateKey);
    const r2 = await PeerAuth.respondToChallenge(c2.nonce, bobPeerId, keys.privateKey);

    expect(r1.signature).not.toBe(r2.signature);
  });
});
