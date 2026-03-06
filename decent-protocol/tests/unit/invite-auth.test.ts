/**
 * InviteAuth tests — Cryptographic invite signing & verification
 */

import { describe, test, expect } from 'bun:test';
import { InviteURI } from '../../src/invite/InviteURI';
import type { InviteData } from '../../src/invite/InviteURI';
import { signInvite, verifyInviteSignature } from '../../src/invite/InviteAuth';

// Helper: generate an ECDSA signing key pair
async function generateSigningKeyPair() {
  return await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
}

// Helper: export public key as Base64 JWK string (same format used in protocol)
async function exportPublicKeyBase64(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return btoa(JSON.stringify(jwk));
}

function makeInviteData(overrides: Partial<InviteData> = {}): InviteData {
  return {
    host: '192.168.1.50',
    port: 9000,
    inviteCode: 'TEST1234',
    secure: false,
    path: '/peerjs',
    fallbackServers: [],
    turnServers: [],
    workspaceId: 'ws-abc-123',
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    maxUses: 0,
    inviterId: 'alice-peer-id',
    ...overrides,
  };
}

describe('InviteAuth - Sign and Verify', () => {
  test('sign and verify roundtrip succeeds', async () => {
    const keyPair = await generateSigningKeyPair();
    const data = makeInviteData();

    const signature = await signInvite(keyPair.privateKey, data);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe('string');
    // base64url: no +, /, or trailing =
    expect(signature).not.toContain('+');
    expect(signature).not.toContain('/');
    expect(signature).not.toMatch(/=$/);

    const signedData = { ...data, signature };
    const valid = await verifyInviteSignature(keyPair.publicKey, signedData);
    expect(valid).toBe(true);
  });

  test('verify with Base64 JWK string public key', async () => {
    const keyPair = await generateSigningKeyPair();
    const data = makeInviteData();

    const signature = await signInvite(keyPair.privateKey, data);
    const signedData = { ...data, signature };

    const pkString = await exportPublicKeyBase64(keyPair.publicKey);
    const valid = await verifyInviteSignature(pkString, signedData);
    expect(valid).toBe(true);
  });

  test('tampered invite code fails verification', async () => {
    const keyPair = await generateSigningKeyPair();
    const data = makeInviteData();

    const signature = await signInvite(keyPair.privateKey, data);
    const tampered = { ...data, signature, inviteCode: 'TAMPERED' };

    const valid = await verifyInviteSignature(keyPair.publicKey, tampered);
    expect(valid).toBe(false);
  });

  test('tampered workspaceId fails verification', async () => {
    const keyPair = await generateSigningKeyPair();
    const data = makeInviteData();

    const signature = await signInvite(keyPair.privateKey, data);
    const tampered = { ...data, signature, workspaceId: 'ws-evil' };

    const valid = await verifyInviteSignature(keyPair.publicKey, tampered);
    expect(valid).toBe(false);
  });

  test('tampered expiresAt fails verification', async () => {
    const keyPair = await generateSigningKeyPair();
    const data = makeInviteData();

    const signature = await signInvite(keyPair.privateKey, data);
    const tampered = { ...data, signature, expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 };

    const valid = await verifyInviteSignature(keyPair.publicKey, tampered);
    expect(valid).toBe(false);
  });

  test('wrong public key fails verification', async () => {
    const keyPair = await generateSigningKeyPair();
    const otherKeyPair = await generateSigningKeyPair();
    const data = makeInviteData();

    const signature = await signInvite(keyPair.privateKey, data);
    const signedData = { ...data, signature };

    const valid = await verifyInviteSignature(otherKeyPair.publicKey, signedData);
    expect(valid).toBe(false);
  });

  test('missing signature returns false (does not throw)', async () => {
    const keyPair = await generateSigningKeyPair();
    const data = makeInviteData(); // no signature field

    const valid = await verifyInviteSignature(keyPair.publicKey, data);
    expect(valid).toBe(false);
  });

  test('unsigned invites still work for backward compatibility', async () => {
    // Old invites have no signature — they should decode fine and isExpired should return false
    const data: InviteData = {
      host: '10.0.0.1',
      port: 9000,
      inviteCode: 'OLD001',
      secure: false,
      path: '/peerjs',
      fallbackServers: [],
      turnServers: [],
    };

    expect(data.signature).toBeUndefined();
    expect(InviteURI.isExpired(data)).toBe(false);
    // Can encode and decode without issues
    const encoded = InviteURI.encode(data);
    const decoded = InviteURI.decode(encoded);
    expect(decoded.inviteCode).toBe('OLD001');
    expect(decoded.signature).toBeUndefined();
    expect(decoded.expiresAt).toBeUndefined();
  });

  test('signature survives encode → decode roundtrip', async () => {
    const keyPair = await generateSigningKeyPair();
    const data = makeInviteData();
    const signature = await signInvite(keyPair.privateKey, data);
    const signedData = { ...data, signature };

    // Encode to URL, decode back
    const url = InviteURI.encode(signedData);
    const decoded = InviteURI.decode(url);

    expect(decoded.signature).toBe(signature);
    expect(decoded.expiresAt).toBe(data.expiresAt);
    // maxUses=0 (unlimited) is not encoded, so decoded is undefined — both map to 0 in getSignPayload
    expect(decoded.maxUses ?? 0).toBe(data.maxUses ?? 0);
    expect(decoded.inviterId).toBe(data.inviterId);

    // Verify the decoded data with the signature still works
    const valid = await verifyInviteSignature(keyPair.publicKey, decoded);
    expect(valid).toBe(true);
  });

  test('signature survives encodeNative → decode roundtrip', async () => {
    const keyPair = await generateSigningKeyPair();
    const data = makeInviteData();
    const signature = await signInvite(keyPair.privateKey, data);
    const signedData = { ...data, signature };

    const uri = InviteURI.encodeNative(signedData);
    const decoded = InviteURI.decode(uri);

    expect(decoded.signature).toBe(signature);
    const valid = await verifyInviteSignature(keyPair.publicKey, decoded);
    expect(valid).toBe(true);
  });
});

describe('InviteAuth - isExpired', () => {
  test('returns true for expired invite', () => {
    const data = makeInviteData({ expiresAt: Date.now() - 1000 });
    expect(InviteURI.isExpired(data)).toBe(true);
  });

  test('returns false for valid (future) invite', () => {
    const data = makeInviteData({ expiresAt: Date.now() + 60_000 });
    expect(InviteURI.isExpired(data)).toBe(false);
  });

  test('returns false for invite without expiration', () => {
    const data = makeInviteData({ expiresAt: undefined });
    expect(InviteURI.isExpired(data)).toBe(false);
  });
});

describe('InviteAuth - getSignPayload', () => {
  test('is deterministic', () => {
    const data = makeInviteData();
    const a = InviteURI.getSignPayload(data);
    const b = InviteURI.getSignPayload(data);
    expect(a).toBe(b);
  });

  test('includes inviteCode, workspaceId, expiresAt, maxUses', () => {
    const data = makeInviteData({
      inviteCode: 'ABC',
      workspaceId: 'ws-1',
      expiresAt: 12345,
      maxUses: 10,
    });
    expect(InviteURI.getSignPayload(data)).toBe('ABC:ws-1:12345:10');
  });

  test('handles missing optional fields with defaults', () => {
    const data = makeInviteData({
      workspaceId: undefined,
      expiresAt: undefined,
      maxUses: undefined,
    });
    expect(InviteURI.getSignPayload(data)).toBe(`${data.inviteCode}::0:0`);
  });

  test('different inviteCodes produce different payloads', () => {
    const a = InviteURI.getSignPayload(makeInviteData({ inviteCode: 'AAA' }));
    const b = InviteURI.getSignPayload(makeInviteData({ inviteCode: 'BBB' }));
    expect(a).not.toBe(b);
  });
});
