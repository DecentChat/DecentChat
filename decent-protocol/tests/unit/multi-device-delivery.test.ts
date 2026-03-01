/**
 * Task 12: Multi-Device Message Delivery Tests
 *
 * Tests device-aware recipient resolution, message dedup, and device tracking
 * in workspace state.
 */
import { describe, test, expect } from 'bun:test';
import { DeviceManager } from '../../src/identity/DeviceManager';

describe('Multi-Device Delivery', () => {
  describe('DeviceRegistry recipient resolution', () => {
    test('getAllPeerIds returns all device peerIds for an identity', () => {
      const registry = new DeviceManager.DeviceRegistry();
      const identityId = 'abc123def4567890';

      registry.addDevice(identityId, {
        deviceId: 'device-peer-0',
        peerId: 'device-peer-0',
        deviceLabel: 'MacBook',
        lastSeen: Date.now(),
      });
      registry.addDevice(identityId, {
        deviceId: 'device-peer-1',
        peerId: 'device-peer-1',
        deviceLabel: 'iPhone',
        lastSeen: Date.now(),
      });

      const peerIds = registry.getAllPeerIds(identityId);
      expect(peerIds).toEqual(['device-peer-0', 'device-peer-1']);
    });

    test('getIdentityForPeerId resolves peerId to identityId', () => {
      const registry = new DeviceManager.DeviceRegistry();
      const identityId = 'abc123def4567890';

      registry.addDevice(identityId, {
        deviceId: 'device-peer-0',
        peerId: 'device-peer-0',
        deviceLabel: 'MacBook',
        lastSeen: Date.now(),
      });

      expect(registry.getIdentityForPeerId('device-peer-0')).toBe(identityId);
      expect(registry.getIdentityForPeerId('unknown-peer')).toBeUndefined();
    });

    test('handles multiple identities correctly', () => {
      const registry = new DeviceManager.DeviceRegistry();

      registry.addDevice('alice-identity', {
        deviceId: 'alice-device-0',
        peerId: 'alice-device-0',
        deviceLabel: 'Alice MacBook',
        lastSeen: Date.now(),
      });
      registry.addDevice('alice-identity', {
        deviceId: 'alice-device-1',
        peerId: 'alice-device-1',
        deviceLabel: 'Alice iPhone',
        lastSeen: Date.now(),
      });
      registry.addDevice('bob-identity', {
        deviceId: 'bob-device-0',
        peerId: 'bob-device-0',
        deviceLabel: 'Bob laptop',
        lastSeen: Date.now(),
      });

      expect(registry.getAllPeerIds('alice-identity')).toHaveLength(2);
      expect(registry.getAllPeerIds('bob-identity')).toHaveLength(1);
      expect(registry.getIdentityForPeerId('alice-device-1')).toBe('alice-identity');
      expect(registry.getIdentityForPeerId('bob-device-0')).toBe('bob-identity');
    });
  });

  describe('Message dedup by ID', () => {
    test('MessageDedup tracks seen message IDs', () => {
      const dedup = new DeviceManager.MessageDedup();
      expect(dedup.isDuplicate('msg-1')).toBe(false);
      dedup.markSeen('msg-1');
      expect(dedup.isDuplicate('msg-1')).toBe(true);
      expect(dedup.isDuplicate('msg-2')).toBe(false);
    });

    test('MessageDedup evicts old entries when max size exceeded', () => {
      const dedup = new DeviceManager.MessageDedup(3); // max 3
      dedup.markSeen('msg-1');
      dedup.markSeen('msg-2');
      dedup.markSeen('msg-3');
      expect(dedup.isDuplicate('msg-1')).toBe(true);
      // Adding 4th should evict oldest (msg-1)
      dedup.markSeen('msg-4');
      expect(dedup.isDuplicate('msg-1')).toBe(false);
      expect(dedup.isDuplicate('msg-2')).toBe(true);
      expect(dedup.isDuplicate('msg-4')).toBe(true);
    });
  });
});
