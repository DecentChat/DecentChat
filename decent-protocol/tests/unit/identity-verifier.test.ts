import { describe, test, expect } from 'bun:test';
import { verifyPeerIdBinding } from '../../src/security/IdentityVerifier';

describe('IdentityVerifier', () => {
  test('valid binding: peerId matches publicKey hash (SPKI ArrayBuffer)', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    const hash = await crypto.subtle.digest('SHA-256', spki);
    const expectedPeerId = Array.from(new Uint8Array(hash).slice(0, 9))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const result = await verifyPeerIdBinding(expectedPeerId, spki);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('invalid binding: peerId does not match publicKey', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);

    const result = await verifyPeerIdBinding('000000000000000000', spki);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  test('skips check for non-DEP-003 peerId (too short)', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);

    // Non-DEP-003 format → skip binding check (backward compat)
    const result = await verifyPeerIdBinding('abc', spki);
    expect(result.valid).toBe(true);
  });

  test('skips check for UUID peerId (legacy PeerJS format)', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);

    // UUID format — not DEP-003, should skip
    const result = await verifyPeerIdBinding('d38d93d2-f17a-47f1-aedd-1d1cee2b5812', spki);
    expect(result.valid).toBe(true);
  });

  test('rejects empty peerId', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);

    const result = await verifyPeerIdBinding('', spki);
    expect(result.valid).toBe(false);
  });

  test('accepts base64-encoded SPKI', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);

    const hash = await crypto.subtle.digest('SHA-256', spki);
    const expectedPeerId = Array.from(new Uint8Array(hash).slice(0, 9))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const base64Spki = btoa(String.fromCharCode(...new Uint8Array(spki)));

    const result = await verifyPeerIdBinding(expectedPeerId, base64Spki);
    expect(result.valid).toBe(true);
  });

  test('accepts base64-encoded JWK (handshake format)', async () => {
    // This is what the handshake actually sends: base64(JSON(JWK))
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    const hash = await crypto.subtle.digest('SHA-256', spki);
    const expectedPeerId = Array.from(new Uint8Array(hash).slice(0, 9))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Export as JWK and encode as base64 (matching CryptoManager.exportPublicKey)
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const jwkBase64 = btoa(JSON.stringify(jwk));

    const result = await verifyPeerIdBinding(expectedPeerId, jwkBase64);
    expect(result.valid).toBe(true);
  });

  test('JWK format: wrong peerId still rejected', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const jwkBase64 = btoa(JSON.stringify(jwk));

    const result = await verifyPeerIdBinding('000000000000000000', jwkBase64);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  test('JWK and SPKI formats produce the same peerId', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    const hash = await crypto.subtle.digest('SHA-256', spki);
    const expectedPeerId = Array.from(new Uint8Array(hash).slice(0, 9))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Both formats should verify the same peerId
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const jwkBase64 = btoa(JSON.stringify(jwk));
    const spkiBase64 = btoa(String.fromCharCode(...new Uint8Array(spki)));

    const resultJwk = await verifyPeerIdBinding(expectedPeerId, jwkBase64);
    const resultSpki = await verifyPeerIdBinding(expectedPeerId, spkiBase64);
    const resultRaw = await verifyPeerIdBinding(expectedPeerId, spki);

    expect(resultJwk.valid).toBe(true);
    expect(resultSpki.valid).toBe(true);
    expect(resultRaw.valid).toBe(true);
  });

  test('different keys produce different peerIds', async () => {
    const kp1 = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const kp2 = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );

    const spki1 = await crypto.subtle.exportKey('spki', kp1.publicKey);
    const spki2 = await crypto.subtle.exportKey('spki', kp2.publicKey);

    const hash1 = await crypto.subtle.digest('SHA-256', spki1);
    const peerId1 = Array.from(new Uint8Array(hash1).slice(0, 9))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const result = await verifyPeerIdBinding(peerId1, spki2);
    expect(result.valid).toBe(false);
  });
});
