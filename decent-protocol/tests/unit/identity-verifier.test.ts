import { describe, test, expect } from 'bun:test';
import { verifyPeerIdBinding } from '../../src/security/IdentityVerifier';

describe('IdentityVerifier', () => {
  test('valid binding: peerId matches publicKey hash', async () => {
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

  test('rejects peerId that is wrong length (too short)', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);

    const result = await verifyPeerIdBinding('abc', spki);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('length');
  });

  test('rejects peerId that is wrong length (too long)', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);

    const result = await verifyPeerIdBinding('0000000000000000001234', spki);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('length');
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

    // Encode SPKI as base64
    const base64Spki = btoa(String.fromCharCode(...new Uint8Array(spki)));

    const result = await verifyPeerIdBinding(expectedPeerId, base64Spki);
    expect(result.valid).toBe(true);
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

    // Verify kp1's peerId against kp2's key → should fail
    const result = await verifyPeerIdBinding(peerId1, spki2);
    expect(result.valid).toBe(false);
  });
});
