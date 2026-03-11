/**
 * Task 10: Device Registration Protocol Tests
 *
 * DeviceManager: device-announce with cryptographic proof, verification, device tracking.
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { DeviceManager } from '../../src/identity/DeviceManager';
import { SeedPhraseManager } from '../../src/identity/SeedPhrase';

describe('DeviceManager', () => {
  const spm = new SeedPhraseManager();
  let mnemonic: string;
  let identityId: string;
  let signingKeyPair: CryptoKeyPair;
  let device0PeerId: string;
  let device1PeerId: string;

  beforeAll(async () => {
    mnemonic = spm.generate().mnemonic;
    const dev0 = await spm.deriveDeviceKeys(mnemonic, 0);
    const dev1 = await spm.deriveDeviceKeys(mnemonic, 1);
    identityId = dev0.identityId;
    device0PeerId = dev0.peerId;
    device1PeerId = dev1.peerId;
    // Use identity signing key (shared across devices)
    signingKeyPair = dev0.identityKeys.ecdsaKeyPair;
  });

  describe('createDeviceProof', () => {
    test('creates a valid proof object', async () => {
      const proof = await DeviceManager.createDeviceProof(
        identityId,
        device0PeerId,
        signingKeyPair.privateKey
      );
      expect(proof.identityId).toBe(identityId);
      expect(proof.deviceId).toBe(device0PeerId);
      expect(proof.timestamp).toBeGreaterThan(0);
      expect(proof.signature).toBeDefined();
      expect(typeof proof.signature).toBe('string');
    });
  });

  describe('verifyDeviceProof', () => {
    test('valid proof is accepted', async () => {
      const proof = await DeviceManager.createDeviceProof(
        identityId,
        device0PeerId,
        signingKeyPair.privateKey
      );
      const result = await DeviceManager.verifyDeviceProof(proof, signingKeyPair.publicKey);
      expect(result.valid).toBe(true);
    });

    test('proof from second device with same identity key is accepted', async () => {
      const proof = await DeviceManager.createDeviceProof(
        identityId,
        device1PeerId,
        signingKeyPair.privateKey
      );
      const result = await DeviceManager.verifyDeviceProof(proof, signingKeyPair.publicKey);
      expect(result.valid).toBe(true);
    });

    test('forged proof (wrong signing key) is rejected', async () => {
      // Generate a different signing key
      const fakeKeys = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      );
      const proof = await DeviceManager.createDeviceProof(
        identityId,
        device0PeerId,
        fakeKeys.privateKey  // signed with wrong key
      );
      const result = await DeviceManager.verifyDeviceProof(proof, signingKeyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('signature');
    });

    test('tampered identityId is rejected', async () => {
      const proof = await DeviceManager.createDeviceProof(
        identityId,
        device0PeerId,
        signingKeyPair.privateKey
      );
      // Tamper with the identityId after signing
      const tamperedProof = { ...proof, identityId: 'aaaaaaaaaaaaaaaa' };
      const result = await DeviceManager.verifyDeviceProof(tamperedProof, signingKeyPair.publicKey);
      expect(result.valid).toBe(false);
    });

    test('tampered deviceId is rejected', async () => {
      const proof = await DeviceManager.createDeviceProof(
        identityId,
        device0PeerId,
        signingKeyPair.privateKey
      );
      const tamperedProof = { ...proof, deviceId: 'bbbbbbbbbbbbbbbbbb' };
      const result = await DeviceManager.verifyDeviceProof(tamperedProof, signingKeyPair.publicKey);
      expect(result.valid).toBe(false);
    });

    test('tampered timestamp is rejected', async () => {
      const proof = await DeviceManager.createDeviceProof(
        identityId,
        device0PeerId,
        signingKeyPair.privateKey
      );
      const tamperedProof = { ...proof, timestamp: proof.timestamp + 1000 };
      const result = await DeviceManager.verifyDeviceProof(tamperedProof, signingKeyPair.publicKey);
      expect(result.valid).toBe(false);
    });

    test('expired proof is rejected (> 5 minutes)', async () => {
      const proof = await DeviceManager.createDeviceProof(
        identityId,
        device0PeerId,
        signingKeyPair.privateKey
      );
      // Set timestamp to 6 minutes ago
      const expiredProof = { ...proof, timestamp: Date.now() - 6 * 60 * 1000 };
      // Re-sign with correct timestamp so signature is valid but timestamp check fails
      const expiredSigned = await DeviceManager.createDeviceProof(
        identityId,
        device0PeerId,
        signingKeyPair.privateKey,
        expiredProof.timestamp
      );
      const result = await DeviceManager.verifyDeviceProof(expiredSigned, signingKeyPair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });
  });

  describe('createDeviceAnnouncement', () => {
    test('creates a complete announcement for sync', async () => {
      const announcement = await DeviceManager.createDeviceAnnouncement(
        identityId,
        device0PeerId,
        'MacBook Pro',
        signingKeyPair.privateKey
      );
      expect(announcement.type).toBe('device-announce');
      expect(announcement.identityId).toBe(identityId);
      expect(announcement.device.deviceId).toBe(device0PeerId);
      expect(announcement.device.peerId).toBe(device0PeerId);
      expect(announcement.device.deviceLabel).toBe('MacBook Pro');
      expect(announcement.device.lastSeen).toBeGreaterThan(0);
      expect(announcement.proof).toBeDefined();
    });

    test('announcement proof is verifiable', async () => {
      const announcement = await DeviceManager.createDeviceAnnouncement(
        identityId,
        device1PeerId,
        'iPhone',
        signingKeyPair.privateKey
      );
      const result = await DeviceManager.verifyDeviceProof(
        announcement.proof,
        signingKeyPair.publicKey
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('DeviceRegistry', () => {
    test('registers and retrieves devices for an identity', () => {
      const registry = new DeviceManager.DeviceRegistry();
      registry.addDevice(identityId, {
        deviceId: device0PeerId,
        peerId: device0PeerId,
        deviceLabel: 'MacBook',
        lastSeen: Date.now(),
      });
      const devices = registry.getDevices(identityId);
      expect(devices).toHaveLength(1);
      expect(devices[0].deviceId).toBe(device0PeerId);
    });

    test('tracks multiple devices per identity', () => {
      const registry = new DeviceManager.DeviceRegistry();
      registry.addDevice(identityId, {
        deviceId: device0PeerId,
        peerId: device0PeerId,
        deviceLabel: 'MacBook',
        lastSeen: Date.now(),
      });
      registry.addDevice(identityId, {
        deviceId: device1PeerId,
        peerId: device1PeerId,
        deviceLabel: 'iPhone',
        lastSeen: Date.now(),
      });
      const devices = registry.getDevices(identityId);
      expect(devices).toHaveLength(2);
    });

    test('updates existing device on re-announce', () => {
      const registry = new DeviceManager.DeviceRegistry();
      const now = Date.now();
      registry.addDevice(identityId, {
        deviceId: device0PeerId,
        peerId: device0PeerId,
        deviceLabel: 'MacBook',
        lastSeen: now,
      });
      registry.addDevice(identityId, {
        deviceId: device0PeerId,
        peerId: device0PeerId,
        deviceLabel: 'MacBook Pro',
        lastSeen: now + 1000,
      });
      const devices = registry.getDevices(identityId);
      expect(devices).toHaveLength(1);
      expect(devices[0].deviceLabel).toBe('MacBook Pro');
      expect(devices[0].lastSeen).toBe(now + 1000);
    });

    test('removes a device', () => {
      const registry = new DeviceManager.DeviceRegistry();
      registry.addDevice(identityId, {
        deviceId: device0PeerId,
        peerId: device0PeerId,
        deviceLabel: 'MacBook',
        lastSeen: Date.now(),
      });
      registry.removeDevice(identityId, device0PeerId);
      expect(registry.getDevices(identityId)).toHaveLength(0);
    });

    test('returns empty array for unknown identity', () => {
      const registry = new DeviceManager.DeviceRegistry();
      expect(registry.getDevices('unknown-identity')).toHaveLength(0);
    });

    test('getAllPeerIds returns all peerIds for an identity', () => {
      const registry = new DeviceManager.DeviceRegistry();
      registry.addDevice(identityId, {
        deviceId: device0PeerId,
        peerId: device0PeerId,
        deviceLabel: 'MacBook',
        lastSeen: Date.now(),
      });
      registry.addDevice(identityId, {
        deviceId: device1PeerId,
        peerId: device1PeerId,
        deviceLabel: 'iPhone',
        lastSeen: Date.now(),
      });
      const peerIds = registry.getAllPeerIds(identityId);
      expect(peerIds).toContain(device0PeerId);
      expect(peerIds).toContain(device1PeerId);
      expect(peerIds).toHaveLength(2);
    });
  });
});
