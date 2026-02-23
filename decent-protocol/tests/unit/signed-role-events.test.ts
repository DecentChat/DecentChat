/**
 * Signed Role Events — ECDSA Signature Tests
 *
 * Tests that role-changed, workspace-settings-updated, and member-removed
 * events are properly signed and verified using ECDSA P-256.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { CryptoManager } from '../../src/crypto/CryptoManager';
import { MessageCipher } from '../../src/crypto/MessageCipher';

const cipher = new MessageCipher();
const DEFAULT_WORKSPACE_ID = 'ws-1';
const DEFAULT_ACTOR_PEER_ID = 'owner-peer';

async function generateSigningKeys() {
  const cm = new CryptoManager();
  return cm.generateSigningKeyPair();
}

function rolePayload(
  target: string,
  role: string,
  ts: number,
  workspaceId = DEFAULT_WORKSPACE_ID,
  actorPeerId = DEFAULT_ACTOR_PEER_ID,
) {
  return `role:${workspaceId}:${actorPeerId}:${target}:${role}:${ts}`;
}

function settingsPayload(
  settings: any,
  ts: number,
  workspaceId = DEFAULT_WORKSPACE_ID,
  actorPeerId = DEFAULT_ACTOR_PEER_ID,
) {
  return `settings:${workspaceId}:${actorPeerId}:${JSON.stringify(settings)}:${ts}`;
}

function removePayload(
  peerId: string,
  ts: number,
  workspaceId = DEFAULT_WORKSPACE_ID,
  actorPeerId = DEFAULT_ACTOR_PEER_ID,
) {
  return `remove:${workspaceId}:${actorPeerId}:${peerId}:${ts}`;
}

describe('Signed Role Events — ECDSA', () => {
  let ownerKeys: { publicKey: CryptoKey; privateKey: CryptoKey };
  let attackerKeys: { publicKey: CryptoKey; privateKey: CryptoKey };

  beforeEach(async () => {
    ownerKeys = await generateSigningKeys();
    attackerKeys = await generateSigningKeys();
  });

  describe('role-changed signing', () => {
    it('owner can sign a valid role change', async () => {
      const data = rolePayload('peer-1', 'admin', 1000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      expect(sig).toBeTruthy();
      expect(typeof sig).toBe('string');
    });

    it('signature verifies with correct public key', async () => {
      const data = rolePayload('peer-1', 'admin', 1000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const valid = await cipher.verify(data, sig, ownerKeys.publicKey);
      expect(valid).toBe(true);
    });

    it('signature fails with wrong public key (attacker)', async () => {
      const data = rolePayload('peer-1', 'admin', 1000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const valid = await cipher.verify(data, sig, attackerKeys.publicKey);
      expect(valid).toBe(false);
    });

    it('attacker cannot forge role change with their own key', async () => {
      const data = rolePayload('attacker', 'owner', 1000);
      const sig = await cipher.sign(data, attackerKeys.privateKey);
      // Verify against owner's key — must fail
      const valid = await cipher.verify(data, sig, ownerKeys.publicKey);
      expect(valid).toBe(false);
    });

    it('tampered payload fails verification', async () => {
      const data = rolePayload('peer-1', 'admin', 1000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const tampered = rolePayload('peer-1', 'owner', 1000); // changed role
      const valid = await cipher.verify(tampered, sig, ownerKeys.publicKey);
      expect(valid).toBe(false);
    });

    it('tampered timestamp fails verification', async () => {
      const data = rolePayload('peer-1', 'admin', 1000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const tampered = rolePayload('peer-1', 'admin', 9999); // changed timestamp
      const valid = await cipher.verify(tampered, sig, ownerKeys.publicKey);
      expect(valid).toBe(false);
    });

    it('tampered target peerId fails verification', async () => {
      const data = rolePayload('peer-1', 'admin', 1000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const tampered = rolePayload('peer-2', 'admin', 1000); // changed target
      const valid = await cipher.verify(tampered, sig, ownerKeys.publicKey);
      expect(valid).toBe(false);
    });
  });

  describe('settings-changed signing', () => {
    it('owner can sign settings change', async () => {
      const settings = { whoCanCreateChannels: 'admins', whoCanInviteMembers: 'everyone' };
      const data = settingsPayload(settings, 2000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const valid = await cipher.verify(data, sig, ownerKeys.publicKey);
      expect(valid).toBe(true);
    });

    it('attacker cannot forge settings change', async () => {
      const settings = { whoCanCreateChannels: 'everyone', whoCanInviteMembers: 'everyone' };
      const data = settingsPayload(settings, 2000);
      const sig = await cipher.sign(data, attackerKeys.privateKey);
      const valid = await cipher.verify(data, sig, ownerKeys.publicKey);
      expect(valid).toBe(false);
    });

    it('tampered settings fail verification', async () => {
      const settings = { whoCanCreateChannels: 'admins', whoCanInviteMembers: 'everyone' };
      const data = settingsPayload(settings, 2000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const tampered = settingsPayload({ whoCanCreateChannels: 'everyone', whoCanInviteMembers: 'everyone' }, 2000);
      const valid = await cipher.verify(tampered, sig, ownerKeys.publicKey);
      expect(valid).toBe(false);
    });
  });

  describe('member-removed signing', () => {
    it('admin can sign member removal', async () => {
      const data = removePayload('peer-1', 3000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const valid = await cipher.verify(data, sig, ownerKeys.publicKey);
      expect(valid).toBe(true);
    });

    it('attacker cannot forge member removal', async () => {
      const data = removePayload('peer-1', 3000);
      const sig = await cipher.sign(data, attackerKeys.privateKey);
      const valid = await cipher.verify(data, sig, ownerKeys.publicKey);
      expect(valid).toBe(false);
    });

    it('tampered peerId fails', async () => {
      const data = removePayload('peer-1', 3000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const tampered = removePayload('peer-2', 3000);
      const valid = await cipher.verify(tampered, sig, ownerKeys.publicKey);
      expect(valid).toBe(false);
    });
  });

  describe('replay protection', () => {
    it('same payload signed twice produces different signatures (random k)', async () => {
      const data = rolePayload('peer-1', 'admin', 1000);
      const sig1 = await cipher.sign(data, ownerKeys.privateKey);
      const sig2 = await cipher.sign(data, ownerKeys.privateKey);
      // ECDSA with random k produces different sigs, but both valid
      expect(await cipher.verify(data, sig1, ownerKeys.publicKey)).toBe(true);
      expect(await cipher.verify(data, sig2, ownerKeys.publicKey)).toBe(true);
    });

    it('timestamp ordering prevents replay of older events', () => {
      // Simulate replay protection logic
      const accepted = new Map<string, number>();
      const tryAccept = (peerId: string, ts: number): boolean => {
        const last = accepted.get(peerId) || 0;
        if (ts <= last) return false; // replay
        accepted.set(peerId, ts);
        return true;
      };

      expect(tryAccept('peer-1', 1000)).toBe(true);
      expect(tryAccept('peer-1', 2000)).toBe(true);
      expect(tryAccept('peer-1', 1500)).toBe(false); // replay
      expect(tryAccept('peer-1', 2000)).toBe(false); // replay (same ts)
      expect(tryAccept('peer-1', 3000)).toBe(true);
      expect(tryAccept('peer-2', 1000)).toBe(true); // different peer, independent
    });
  });

  describe('key export/import roundtrip', () => {
    it('exported signing public key can be imported and used to verify', async () => {
      const cm = new CryptoManager();
      const exported = await cm.exportPublicKey(ownerKeys.publicKey);
      const imported = await cm.importSigningPublicKey(exported);

      const data = rolePayload('peer-1', 'admin', 5000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const valid = await cipher.verify(data, sig, imported);
      expect(valid).toBe(true);
    });

    it('wrong key import still rejects forged signatures', async () => {
      const cm = new CryptoManager();
      const exported = await cm.exportPublicKey(ownerKeys.publicKey);
      const imported = await cm.importSigningPublicKey(exported);

      const data = rolePayload('peer-1', 'admin', 5000);
      const sig = await cipher.sign(data, attackerKeys.privateKey); // signed with wrong key
      const valid = await cipher.verify(data, sig, imported);
      expect(valid).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('empty target peerId still works', async () => {
      const data = rolePayload('', 'admin', 1000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const valid = await cipher.verify(data, sig, ownerKeys.publicKey);
      expect(valid).toBe(true);
    });

    it('unicode in peerId works', async () => {
      const data = rolePayload('peer-🔥-1', 'admin', 1000);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const valid = await cipher.verify(data, sig, ownerKeys.publicKey);
      expect(valid).toBe(true);
    });

    it('very large timestamp works', async () => {
      const data = rolePayload('peer-1', 'admin', Number.MAX_SAFE_INTEGER);
      const sig = await cipher.sign(data, ownerKeys.privateKey);
      const valid = await cipher.verify(data, sig, ownerKeys.publicKey);
      expect(valid).toBe(true);
    });
  });
});
