/**
 * Task 9: Device Key Derivation Tests
 *
 * Verifies: same seed → same identityId regardless of device index,
 * different device indices → different peerIds.
 */
import { describe, test, expect } from 'bun:test';
import { SeedPhraseManager } from '../../src/identity/SeedPhrase';

describe('Device Key Derivation', () => {
  const spm = new SeedPhraseManager();

  // Generate a mnemonic once for all tests
  const getMnemonic = (() => {
    let cached: string | null = null;
    return () => {
      if (!cached) {
        cached = spm.generate().mnemonic;
      }
      return cached;
    };
  })();

  describe('deriveIdentityId', () => {
    test('returns a 16-char hex string', async () => {
      const mnemonic = getMnemonic();
      const identityId = await spm.deriveIdentityId(mnemonic);
      expect(identityId).toMatch(/^[0-9a-f]{16}$/);
    });

    test('same seed always produces the same identityId', async () => {
      const mnemonic = getMnemonic();
      const id1 = await spm.deriveIdentityId(mnemonic);
      const id2 = await spm.deriveIdentityId(mnemonic);
      expect(id1).toBe(id2);
    });

    test('different seeds produce different identityIds', async () => {
      const m1 = getMnemonic();
      const m2 = spm.generate().mnemonic;
      const id1 = await spm.deriveIdentityId(m1);
      const id2 = await spm.deriveIdentityId(m2);
      expect(id1).not.toBe(id2);
    });

    test('identityId is the same regardless of device index', async () => {
      const mnemonic = getMnemonic();
      const identityId = await spm.deriveIdentityId(mnemonic);
      // deriveDevicePeerId at different indices should NOT affect identityId
      const peerId0 = await spm.deriveDevicePeerId(mnemonic, 0);
      const peerId1 = await spm.deriveDevicePeerId(mnemonic, 1);
      // peerId changes, identityId stays the same
      expect(peerId0).not.toBe(peerId1);
      // identityId doesn't change
      const identityIdAgain = await spm.deriveIdentityId(mnemonic);
      expect(identityIdAgain).toBe(identityId);
    });
  });

  describe('deriveDevicePeerId', () => {
    test('returns an 18-char hex string', async () => {
      const mnemonic = getMnemonic();
      const peerId = await spm.deriveDevicePeerId(mnemonic, 0);
      expect(peerId).toMatch(/^[0-9a-f]{18}$/);
    });

    test('same seed + same device index → same peerId', async () => {
      const mnemonic = getMnemonic();
      const p1 = await spm.deriveDevicePeerId(mnemonic, 0);
      const p2 = await spm.deriveDevicePeerId(mnemonic, 0);
      expect(p1).toBe(p2);
    });

    test('same seed + different device indices → different peerIds', async () => {
      const mnemonic = getMnemonic();
      const p0 = await spm.deriveDevicePeerId(mnemonic, 0);
      const p1 = await spm.deriveDevicePeerId(mnemonic, 1);
      const p2 = await spm.deriveDevicePeerId(mnemonic, 2);
      expect(p0).not.toBe(p1);
      expect(p0).not.toBe(p2);
      expect(p1).not.toBe(p2);
    });

    test('different seeds + same index → different peerIds', async () => {
      const m1 = getMnemonic();
      const m2 = spm.generate().mnemonic;
      const p1 = await spm.deriveDevicePeerId(m1, 0);
      const p2 = await spm.deriveDevicePeerId(m2, 0);
      expect(p1).not.toBe(p2);
    });

    test('rejects negative device index', async () => {
      const mnemonic = getMnemonic();
      await expect(spm.deriveDevicePeerId(mnemonic, -1)).rejects.toThrow();
    });

    test('rejects non-integer device index', async () => {
      const mnemonic = getMnemonic();
      await expect(spm.deriveDevicePeerId(mnemonic, 1.5)).rejects.toThrow();
    });
  });

  describe('deriveDeviceKeys', () => {
    test('returns full key material for a device', async () => {
      const mnemonic = getMnemonic();
      const result = await spm.deriveDeviceKeys(mnemonic, 0);
      expect(result.peerId).toMatch(/^[0-9a-f]{18}$/);
      expect(result.identityId).toMatch(/^[0-9a-f]{16}$/);
      expect(result.deviceKeys.ecdhKeyPair.publicKey).toBeDefined();
      expect(result.deviceKeys.ecdhKeyPair.privateKey).toBeDefined();
      expect(result.deviceKeys.ecdsaKeyPair.publicKey).toBeDefined();
      expect(result.deviceKeys.ecdsaKeyPair.privateKey).toBeDefined();
      expect(result.identityKeys.ecdhKeyPair.publicKey).toBeDefined();
      expect(result.identityKeys.ecdsaKeyPair.publicKey).toBeDefined();
    });

    test('device 0 and device 1 share the same identityId but different peerIds', async () => {
      const mnemonic = getMnemonic();
      const dev0 = await spm.deriveDeviceKeys(mnemonic, 0);
      const dev1 = await spm.deriveDeviceKeys(mnemonic, 1);
      expect(dev0.identityId).toBe(dev1.identityId);
      expect(dev0.peerId).not.toBe(dev1.peerId);
    });

    test('device keys have different ECDH public keys from identity keys', async () => {
      const mnemonic = getMnemonic();
      const result = await spm.deriveDeviceKeys(mnemonic, 0);
      const devicePubKey = await crypto.subtle.exportKey('spki', result.deviceKeys.ecdhKeyPair.publicKey);
      const identityPubKey = await crypto.subtle.exportKey('spki', result.identityKeys.ecdhKeyPair.publicKey);
      const devHex = Array.from(new Uint8Array(devicePubKey)).map(b => b.toString(16).padStart(2, '0')).join('');
      const idHex = Array.from(new Uint8Array(identityPubKey)).map(b => b.toString(16).padStart(2, '0')).join('');
      expect(devHex).not.toBe(idHex);
    });
  });
});
