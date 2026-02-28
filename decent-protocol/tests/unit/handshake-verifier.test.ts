/**
 * HandshakeVerifier extended tests — peerId↔publicKey binding verification
 * Task 4: Extend verifyHandshakeKey to also check peerId↔key binding
 */
import { describe, test, expect } from 'bun:test';
import { verifyHandshake } from '../../src/security/HandshakeVerifier';

describe('HandshakeVerifier - PeerId Binding', () => {
  // Helper to generate an identity with correct peerId
  async function createIdentity() {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    const hash = await crypto.subtle.digest('SHA-256', spki);
    const peerId = Array.from(new Uint8Array(hash).slice(0, 9))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
    return { kp, spki, peerId, publicKeyBase64 };
  }

  test('valid: correct peerId + matching pre-stored key', async () => {
    const identity = await createIdentity();
    const result = await verifyHandshake({
      preStoredKey: identity.publicKeyBase64,
      handshakeKey: identity.publicKeyBase64,
      peerId: identity.peerId,
    });
    expect(result.ok).toBe(true);
  });

  test('valid: no pre-stored key (TOFU) + correct peerId binding', async () => {
    const identity = await createIdentity();
    const result = await verifyHandshake({
      handshakeKey: identity.publicKeyBase64,
      peerId: identity.peerId,
    });
    expect(result.ok).toBe(true);
  });

  test('rejected: peerId does not match handshake key', async () => {
    const identity = await createIdentity();
    const result = await verifyHandshake({
      handshakeKey: identity.publicKeyBase64,
      peerId: '000000000000000000', // Wrong peerId
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('PeerId');
    }
  });

  test('rejected: pre-stored key mismatch (existing behavior preserved)', async () => {
    const alice = await createIdentity();
    const mallory = await createIdentity();
    const result = await verifyHandshake({
      preStoredKey: alice.publicKeyBase64,
      handshakeKey: mallory.publicKeyBase64,
      peerId: mallory.peerId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('mismatch');
    }
  });

  test('skips peerId check when no peerId provided', async () => {
    const identity = await createIdentity();
    const result = await verifyHandshake({
      handshakeKey: identity.publicKeyBase64,
      // No peerId → skip binding check
    });
    expect(result.ok).toBe(true);
  });

  test('skips peerId check when no handshakeKey provided (TOFU)', async () => {
    const result = await verifyHandshake({
      peerId: '000000000000000000',
      // No keys at all → TOFU
    });
    expect(result.ok).toBe(true);
  });

  test('backward compat: pre-stored key match still works', async () => {
    const identity = await createIdentity();
    const result = await verifyHandshake({
      preStoredKey: identity.publicKeyBase64,
      handshakeKey: identity.publicKeyBase64,
      // No peerId → only key match check
    });
    expect(result.ok).toBe(true);
  });
});
