/**
 * Task 5: identityId as Canonical Identity
 *
 * Tests that identityId is derived consistently from the ECDH public key
 * and can be added to WorkspaceMember.
 */
import { describe, test, expect } from 'bun:test';
import { IdentityManager } from '../../src/identity/Identity';
import { CryptoManager } from '../../src/crypto/CryptoManager';

describe('identityId Derivation', () => {
  const identityMgr = new IdentityManager();
  const cryptoMgr = new CryptoManager();

  test('computeIdentityId produces consistent 16-char hex', async () => {
    const kp = await cryptoMgr.generateKeyPair();
    const pubKey = await cryptoMgr.exportPublicKey(kp.publicKey);

    const id1 = await identityMgr.computeIdentityId(pubKey);
    const id2 = await identityMgr.computeIdentityId(pubKey);

    expect(id1).toBe(id2);
    expect(id1.length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(id1)).toBe(true);
  });

  test('different keys produce different identityIds', async () => {
    const kp1 = await cryptoMgr.generateKeyPair();
    const kp2 = await cryptoMgr.generateKeyPair();
    const pub1 = await cryptoMgr.exportPublicKey(kp1.publicKey);
    const pub2 = await cryptoMgr.exportPublicKey(kp2.publicKey);

    const id1 = await identityMgr.computeIdentityId(pub1);
    const id2 = await identityMgr.computeIdentityId(pub2);

    expect(id1).not.toBe(id2);
  });

  test('createIdentity produces stable identityId for same key', async () => {
    const kp = await cryptoMgr.generateKeyPair();
    const signingKeys = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );

    // createIdentity internally exports as SPKI then hashes
    const identity = await identityMgr.createIdentity('TestUser', kp.publicKey, signingKeys.publicKey);

    // Manually compute: export as SPKI base64, hash same way
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    const spkiBase64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
    const expectedId = await identityMgr.computeIdentityId(spkiBase64);

    expect(identity.identityId).toBe(expectedId);
    expect(identity.identityId.length).toBe(16);
  });

  test('deriveIdentityIdFromPublicKey utility works for handshake publicKey', async () => {
    const kp = await cryptoMgr.generateKeyPair();
    const pubKey = await cryptoMgr.exportPublicKey(kp.publicKey);

    // This is what the handshake sends
    const id = await identityMgr.computeIdentityId(pubKey);
    expect(id.length).toBe(16);
    expect(typeof id).toBe('string');
  });
});
