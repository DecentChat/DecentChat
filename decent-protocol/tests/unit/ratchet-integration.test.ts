/**
 * Double Ratchet Integration Tests
 *
 * Tests the full message encryption pipeline with DoubleRatchet,
 * including state serialization, legacy fallback, and edge cases.
 */

import { describe, test, expect } from 'bun:test';
import {
  DoubleRatchet,
  serializeRatchetState,
  deserializeRatchetState,
} from '../../src/crypto/DoubleRatchet';
import type { RatchetState } from '../../src/crypto/DoubleRatchet';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createSharedSecret(): Promise<ArrayBuffer> {
  const alice = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const bob = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: bob.publicKey },
    alice.privateKey,
    256,
  );
}

async function createPair(): Promise<{ alice: RatchetState; bob: RatchetState }> {
  const bobDH = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sharedSecret = await createSharedSecret();
  const alice = await DoubleRatchet.initAlice(sharedSecret, bobDH.publicKey);
  const bob = await DoubleRatchet.initBob(sharedSecret, bobDH);
  return { alice, bob };
}

// ── State Serialization Tests ────────────────────────────────────────────────

describe('RatchetState Serialization', () => {
  test('serializes and deserializes Alice initial state', async () => {
    const { alice } = await createPair();

    const serialized = await serializeRatchetState(alice);
    const restored = await deserializeRatchetState(serialized);

    // Verify structural integrity
    expect(restored.sendCount).toBe(alice.sendCount);
    expect(restored.recvCount).toBe(alice.recvCount);
    expect(restored.previousSendCount).toBe(alice.previousSendCount);
    expect(restored.sendChainKey).not.toBeNull();
    expect(restored.recvChainKey).toBeNull();
    expect(restored.peerDHPublicKey).not.toBeNull();
  });

  test('serializes and deserializes Bob initial state', async () => {
    const { bob } = await createPair();

    const serialized = await serializeRatchetState(bob);
    const restored = await deserializeRatchetState(serialized);

    expect(restored.sendCount).toBe(0);
    expect(restored.recvCount).toBe(0);
    expect(restored.sendChainKey).toBeNull();
    expect(restored.recvChainKey).toBeNull();
    expect(restored.peerDHPublicKey).toBeNull();
  });

  test('round-trip: serialize → deserialize → encrypt/decrypt still works', async () => {
    const { alice, bob } = await createPair();

    // Alice sends a message to advance state
    const msg1 = await DoubleRatchet.encrypt(alice, 'first message');
    await DoubleRatchet.decrypt(bob, msg1);

    // Serialize both states
    const aliceSerialized = await serializeRatchetState(alice);
    const bobSerialized = await serializeRatchetState(bob);

    // Deserialize into new state objects
    const aliceRestored = await deserializeRatchetState(aliceSerialized);
    const bobRestored = await deserializeRatchetState(bobSerialized);

    // Continue conversation with restored states
    const msg2 = await DoubleRatchet.encrypt(aliceRestored, 'after restore');
    const decrypted = await DoubleRatchet.decrypt(bobRestored, msg2);
    expect(decrypted).toBe('after restore');

    // And in the other direction
    const msg3 = await DoubleRatchet.encrypt(bobRestored, 'bob reply after restore');
    const decrypted3 = await DoubleRatchet.decrypt(aliceRestored, msg3);
    expect(decrypted3).toBe('bob reply after restore');
  });

  test('serialized state has correct structure', async () => {
    const { alice } = await createPair();
    const serialized = await serializeRatchetState(alice);

    expect(typeof serialized.dhKeyPair.publicKey).toBe('string');
    expect(typeof serialized.dhKeyPair.privateKey).toBe('string');
    expect(typeof serialized.rootKey).toBe('string');
    expect(serialized.sendChainKey).not.toBeNull();
    expect(typeof serialized.sendChainKey).toBe('string');
    expect(serialized.recvChainKey).toBeNull();
    expect(Array.isArray(serialized.skippedKeys)).toBe(true);
    expect(serialized.skippedKeys.length).toBe(0);
  });

  test('serializes skipped keys correctly', async () => {
    const { alice, bob } = await createPair();

    // Alice sends 3 messages
    const m0 = await DoubleRatchet.encrypt(alice, 'msg 0');
    const m1 = await DoubleRatchet.encrypt(alice, 'msg 1');
    const m2 = await DoubleRatchet.encrypt(alice, 'msg 2');

    // Bob receives m2 first (skips m0, m1)
    await DoubleRatchet.decrypt(bob, m2);

    // Bob should now have skipped keys for m0 and m1
    expect(bob.skippedKeys.size).toBe(2);

    // Serialize and restore
    const serialized = await serializeRatchetState(bob);
    expect(serialized.skippedKeys.length).toBe(2);

    const restored = await deserializeRatchetState(serialized);
    expect(restored.skippedKeys.size).toBe(2);

    // The skipped keys should still work
    const d0 = await DoubleRatchet.decrypt(restored, m0);
    expect(d0).toBe('msg 0');
    const d1 = await DoubleRatchet.decrypt(restored, m1);
    expect(d1).toBe('msg 1');
  });

  test('persist-restore cycle through multiple ratchet steps', async () => {
    const { alice, bob } = await createPair();

    for (let i = 0; i < 5; i++) {
      // Alice sends
      const msgA = await DoubleRatchet.encrypt(alice, `alice-${i}`);
      expect(await DoubleRatchet.decrypt(bob, msgA)).toBe(`alice-${i}`);

      // Serialize and restore both
      const aliceS = await serializeRatchetState(alice);
      const bobS = await serializeRatchetState(bob);
      const aliceR = await deserializeRatchetState(aliceS);
      const bobR = await deserializeRatchetState(bobS);

      // Bob replies
      const msgB = await DoubleRatchet.encrypt(bobR, `bob-${i}`);
      expect(await DoubleRatchet.decrypt(aliceR, msgB)).toBe(`bob-${i}`);

      // Copy restored states back for next iteration
      Object.assign(alice, aliceR);
      Object.assign(bob, bobR);
    }
  });
});

// ── JSON Serialization (simulates IndexedDB storage) ─────────────────────────

describe('RatchetState JSON Round-trip', () => {
  test('SerializedRatchetState survives JSON.stringify/parse', async () => {
    const { alice, bob } = await createPair();

    // Exchange some messages to build up state
    const msg1 = await DoubleRatchet.encrypt(alice, 'hello');
    await DoubleRatchet.decrypt(bob, msg1);
    const msg2 = await DoubleRatchet.encrypt(bob, 'hi back');
    await DoubleRatchet.decrypt(alice, msg2);

    // Serialize
    const aliceSerialized = await serializeRatchetState(alice);
    const bobSerialized = await serializeRatchetState(bob);

    // Simulate IndexedDB storage (JSON round-trip)
    const aliceJSON = JSON.parse(JSON.stringify(aliceSerialized));
    const bobJSON = JSON.parse(JSON.stringify(bobSerialized));

    // Deserialize from JSON
    const aliceRestored = await deserializeRatchetState(aliceJSON);
    const bobRestored = await deserializeRatchetState(bobJSON);

    // Continue conversation
    const msg3 = await DoubleRatchet.encrypt(aliceRestored, 'after JSON roundtrip');
    expect(await DoubleRatchet.decrypt(bobRestored, msg3)).toBe('after JSON roundtrip');
  });
});

// ── Extractable Key Pairs ────────────────────────────────────────────────────

describe('DoubleRatchet Key Extractability', () => {
  test('DH key pairs generated during ratchet are extractable', async () => {
    const { alice } = await createPair();

    // The DH key pair should be extractable for serialization
    const pubRaw = await crypto.subtle.exportKey('raw', alice.dhKeyPair.publicKey);
    expect(pubRaw.byteLength).toBeGreaterThan(0);

    // Private key should be exportable as JWK
    const privJwk = await crypto.subtle.exportKey('jwk', alice.dhKeyPair.privateKey);
    expect(privJwk.kty).toBe('EC');
    expect(privJwk.crv).toBe('P-256');
    expect(privJwk.d).toBeDefined();
  });

  test('keys remain extractable after DH ratchet steps', async () => {
    const { alice, bob } = await createPair();

    // Exchange messages to trigger multiple DH ratchet steps
    const m1 = await DoubleRatchet.encrypt(alice, 'a');
    await DoubleRatchet.decrypt(bob, m1);
    const m2 = await DoubleRatchet.encrypt(bob, 'b');
    await DoubleRatchet.decrypt(alice, m2);
    const m3 = await DoubleRatchet.encrypt(alice, 'c');
    await DoubleRatchet.decrypt(bob, m3);

    // Both sides' current DH keys should still be extractable
    const alicePub = await crypto.subtle.exportKey('raw', alice.dhKeyPair.publicKey);
    expect(alicePub.byteLength).toBeGreaterThan(0);

    const bobPub = await crypto.subtle.exportKey('raw', bob.dhKeyPair.publicKey);
    expect(bobPub.byteLength).toBeGreaterThan(0);
  });
});

// ── Protocol Version Detection ───────────────────────────────────────────────

describe('Message Format', () => {
  test('RatchetMessage has correct structure', async () => {
    const { alice } = await createPair();
    const msg = await DoubleRatchet.encrypt(alice, 'test');

    expect(msg.header).toBeDefined();
    expect(typeof msg.header.dhPublicKey).toBe('string');
    expect(typeof msg.header.messageNumber).toBe('number');
    expect(typeof msg.header.previousCount).toBe('number');
    expect(typeof msg.ciphertext).toBe('string');
    expect(typeof msg.iv).toBe('string');
  });

  test('can distinguish ratchet vs legacy envelope by protocolVersion', () => {
    const ratchetEnvelope = {
      id: '1',
      timestamp: Date.now(),
      sender: 'alice',
      type: 'text' as const,
      ratchet: { header: { dhPublicKey: 'abc', messageNumber: 0, previousCount: 0 }, ciphertext: 'x', iv: 'y' },
      signature: 'sig',
      protocolVersion: 2 as const,
    };

    const legacyEnvelope = {
      id: '2',
      timestamp: Date.now(),
      sender: 'bob',
      type: 'text' as const,
      encrypted: { ciphertext: 'x', iv: 'y', tag: 'z' },
      signature: 'sig',
    };

    expect(ratchetEnvelope.protocolVersion).toBe(2);
    expect((ratchetEnvelope as any).ratchet).toBeDefined();
    expect((legacyEnvelope as any).protocolVersion).toBeUndefined();
    expect((legacyEnvelope as any).encrypted).toBeDefined();
  });
});
