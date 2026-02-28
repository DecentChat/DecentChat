/**
 * Handshake Authentication Integration Test
 *
 * Tests the full authentication flow combining IdentityVerifier + PeerAuth:
 *   1. PeerId↔PublicKey binding verification
 *   2. Challenge-response authentication
 *   3. Rejection of impersonation attempts
 */
import { describe, test, expect } from 'bun:test';
import { verifyPeerIdBinding } from '../../src/security/IdentityVerifier';
import { PeerAuth } from '../../src/security/PeerAuth';

describe('Handshake Auth Integration', () => {
  // Helper: generate a complete peer identity (ECDH + ECDSA + derived peerId)
  async function createPeerIdentity() {
    const ecdhKeys = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const signingKeys = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const spki = await crypto.subtle.exportKey('spki', ecdhKeys.publicKey);
    const hash = await crypto.subtle.digest('SHA-256', spki);
    const peerId = Array.from(new Uint8Array(hash).slice(0, 9))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return { ecdhKeys, signingKeys, spki, peerId };
  }

  test('full handshake auth: Alice and Bob mutually authenticate', async () => {
    const alice = await createPeerIdentity();
    const bob = await createPeerIdentity();

    // Step 1: Both sides verify peerId↔publicKey binding
    const aliceBinding = await verifyPeerIdBinding(alice.peerId, alice.spki);
    const bobBinding = await verifyPeerIdBinding(bob.peerId, bob.spki);
    expect(aliceBinding.valid).toBe(true);
    expect(bobBinding.valid).toBe(true);

    // Step 2: Bob sends challenge to Alice
    const bobChallenge = PeerAuth.createChallenge();

    // Step 3: Alice responds (signs nonce + bobPeerId)
    const aliceResponse = await PeerAuth.respondToChallenge(
      bobChallenge.nonce,
      bob.peerId,
      alice.signingKeys.privateKey,
    );

    // Step 4: Bob verifies Alice's response
    const aliceAuthenticated = await PeerAuth.verifyResponse(
      bobChallenge.nonce,
      bob.peerId,
      aliceResponse.signature,
      alice.signingKeys.publicKey,
    );
    expect(aliceAuthenticated).toBe(true);

    // Step 5: Alice sends challenge to Bob (mutual auth)
    const aliceChallenge = PeerAuth.createChallenge();
    const bobResponse = await PeerAuth.respondToChallenge(
      aliceChallenge.nonce,
      alice.peerId,
      bob.signingKeys.privateKey,
    );
    const bobAuthenticated = await PeerAuth.verifyResponse(
      aliceChallenge.nonce,
      alice.peerId,
      bobResponse.signature,
      bob.signingKeys.publicKey,
    );
    expect(bobAuthenticated).toBe(true);
  });

  test('impersonation attempt: Eve steals Alice peerId but has wrong key', async () => {
    const alice = await createPeerIdentity();

    // Eve generates her own keys but claims Alice's peerId
    const eveKeys = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const eveSpki = await crypto.subtle.exportKey('spki', eveKeys.publicKey);

    // PeerId binding check catches the impersonation
    const binding = await verifyPeerIdBinding(alice.peerId, eveSpki);
    expect(binding.valid).toBe(false);
    expect(binding.reason).toContain('mismatch');
  });

  test('replay attack: Eve replays Alice challenge response to Bob', async () => {
    const alice = await createPeerIdentity();
    const bob = await createPeerIdentity();
    const eve = await createPeerIdentity();

    // Alice authenticates to Bob normally
    const bobChallenge = PeerAuth.createChallenge();
    const aliceResponse = await PeerAuth.respondToChallenge(
      bobChallenge.nonce,
      bob.peerId,
      alice.signingKeys.privateKey,
    );

    // Eve tries to replay Alice's response to Bob
    // This fails because Alice signed (nonce + BOB's peerId), not Eve's
    // If Eve tries to use the same nonce with Bob, she'd need Alice's private key
    const verified = await PeerAuth.verifyResponse(
      bobChallenge.nonce,
      bob.peerId,
      aliceResponse.signature,
      alice.signingKeys.publicKey, // Eve would need to present Alice's signing key too
    );
    // This would succeed IF Eve could present Alice's public key,
    // but the peerId binding check would catch that Eve's peerId != Alice's
    expect(verified).toBe(true); // sig valid with Alice's key

    // But Eve can't use this response if she's connecting as herself:
    // Her peerId won't match Alice's public key
    const eveBinding = await verifyPeerIdBinding(eve.peerId, alice.spki);
    expect(eveBinding.valid).toBe(false);

    // And if Eve connects from a different challenger, the nonce won't match
    const eveChallenge = PeerAuth.createChallenge();
    const replayFails = await PeerAuth.verifyResponse(
      eveChallenge.nonce, // Different nonce than what Alice signed
      eve.peerId,
      aliceResponse.signature,
      alice.signingKeys.publicKey,
    );
    expect(replayFails).toBe(false);
  });

  test('expired challenge is detected', async () => {
    const challenge = PeerAuth.createChallenge();
    challenge.timestamp = Date.now() - 31_000; // 31 seconds ago

    expect(PeerAuth.isChallengeExpired(challenge, 30_000)).toBe(true);
  });

  test('base64 SPKI key works end-to-end with peerId binding', async () => {
    const peer = await createPeerIdentity();
    const base64Spki = btoa(String.fromCharCode(...new Uint8Array(peer.spki)));

    const binding = await verifyPeerIdBinding(peer.peerId, base64Spki);
    expect(binding.valid).toBe(true);
  });
});
