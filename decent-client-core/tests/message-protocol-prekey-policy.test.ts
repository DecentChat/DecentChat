import { describe, expect, test } from 'bun:test';
import { CryptoManager } from '@decentchat/protocol';
import type { PersistedLocalPreKeyState, PreKeyBundle, SerializedRatchetState } from '@decentchat/protocol';
import { MessageProtocol } from '../src/messages/MessageProtocol';

function createBasePersistence() {
  return {
    save: async (_peerId: string, _state: SerializedRatchetState) => {},
    load: async (_peerId: string) => null,
    delete: async (_peerId: string) => {},
  };
}


describe('MessageProtocol handshake send-chain bootstrap behavior', () => {
  test('falls back to legacy shared-secret encryption when Bob send chain is not ready yet', async () => {
    const aliceCrypto = new CryptoManager();
    const aliceSigning = await aliceCrypto.generateSigningKeyPair();

    const bobCrypto = new CryptoManager();
    const bobSigning = await bobCrypto.generateSigningKeyPair();

    const alice = new MessageProtocol(aliceCrypto, 'alice-peer');
    const bob = new MessageProtocol(bobCrypto, 'bob-peer');

    await alice.init(aliceSigning);
    await bob.init(bobSigning);

    const aliceHandshake = await alice.createHandshake();
    const bobHandshake = await bob.createHandshake();

    await alice.processHandshake('bob-peer', bobHandshake);
    await bob.processHandshake('alice-peer', aliceHandshake);

    const envelope = await bob.encryptMessage('alice-peer', 'first message from bob');
    expect((envelope as any).protocolVersion).toBe(1);
    expect('encrypted' in envelope).toBe(true);

    const decrypted = await alice.decryptMessage('bob-peer', envelope as any, bobSigning.publicKey);
    expect(decrypted).toBe('first message from bob');
  });
});

describe('MessageProtocol pre-key lifecycle policy', () => {
  test('rotates near-expiry signed pre-key, prunes stale local one-time keys, and replenishes pool', async () => {
    const cryptoManager = new CryptoManager();
    const signing = await cryptoManager.generateSigningKeyPair();

    let seededState: PersistedLocalPreKeyState | null = null;
    const seedProtocol = new MessageProtocol(cryptoManager, 'alice-peer');
    seedProtocol.setPersistence({
      ...createBasePersistence(),
      saveLocalPreKeyState: async (_ownerPeerId: string, state: PersistedLocalPreKeyState) => {
        seededState = structuredClone(state);
      },
      loadLocalPreKeyState: async () => null,
    });

    await seedProtocol.init(signing);
    await seedProtocol.createPreKeyBundle();

    expect(seededState).not.toBeNull();

    const now = Date.now();
    const persisted = structuredClone(seededState!);
    persisted.signedPreKey.expiresAt = now + 60_000;
    persisted.oneTimePreKeys = persisted.oneTimePreKeys
      .slice(0, 2)
      .map((entry, index) => ({
        ...entry,
        createdAt: index === 0 ? now - (25 * 24 * 60 * 60 * 1000) : now - 1_000,
      }));

    let postPolicyState: PersistedLocalPreKeyState | null = null;
    const protocol = new MessageProtocol(cryptoManager, 'alice-peer');
    protocol.setPersistence({
      ...createBasePersistence(),
      loadLocalPreKeyState: async () => persisted,
      saveLocalPreKeyState: async (_ownerPeerId: string, state: PersistedLocalPreKeyState) => {
        postPolicyState = structuredClone(state);
      },
    });

    await protocol.init(signing);
    const bundle = await protocol.createPreKeyBundle();

    expect(bundle.signedPreKey.keyId).not.toBe(persisted.signedPreKey.keyId);
    expect(bundle.oneTimePreKeys.length).toBeGreaterThanOrEqual(3);
    expect(bundle.oneTimePreKeys.length).toBeLessThanOrEqual(20);
    expect(bundle.oneTimePreKeys.every((entry) => entry.createdAt > now - (24 * 60 * 60 * 1000))).toBe(true);

    for (let i = 0; i < 50 && (postPolicyState?.oneTimePreKeys.length ?? 0) < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(postPolicyState).not.toBeNull();
    expect(postPolicyState!.oneTimePreKeys.length).toBeGreaterThanOrEqual(20);

    const replenishedBundle = await protocol.createPreKeyBundle();
    expect(replenishedBundle.oneTimePreKeys.length).toBeGreaterThanOrEqual(20);
  });

  test('prunes stale and duplicate peer one-time pre-keys on store', async () => {
    const aliceCrypto = new CryptoManager();
    const aliceSigning = await aliceCrypto.generateSigningKeyPair();

    const bobCrypto = new CryptoManager();
    const bobSigning = await bobCrypto.generateSigningKeyPair();

    const alice = new MessageProtocol(aliceCrypto, 'alice-peer');
    const bob = new MessageProtocol(bobCrypto, 'bob-peer');

    alice.setPersistence(createBasePersistence());
    bob.setPersistence(createBasePersistence());

    await alice.init(aliceSigning);
    await bob.init(bobSigning);

    const bobBundle = await bob.createPreKeyBundle();
    const fresh = bobBundle.oneTimePreKeys[0]!;
    const stale = {
      ...bobBundle.oneTimePreKeys[1]!,
      keyId: 999,
      createdAt: Date.now() - (30 * 24 * 60 * 60 * 1000),
    };

    const mixedBundle: PreKeyBundle = {
      ...bobBundle,
      oneTimePreKeys: [
        stale,
        fresh,
        { ...fresh },
      ],
    };

    const stored = await alice.storePeerPreKeyBundle('bob-peer', mixedBundle);
    expect(stored).toBe(true);

    const cached = await alice.getPeerPreKeyBundle('bob-peer');
    expect(cached?.oneTimePreKeys.map((entry) => entry.keyId)).toEqual([fresh.keyId]);
  });

  test('drops stale persisted peer bundles during load and clears persistence cache entry', async () => {
    const aliceCrypto = new CryptoManager();
    const aliceSigning = await aliceCrypto.generateSigningKeyPair();

    const bobCrypto = new CryptoManager();
    const bobSigning = await bobCrypto.generateSigningKeyPair();

    const bob = new MessageProtocol(bobCrypto, 'bob-peer');
    bob.setPersistence(createBasePersistence());
    await bob.init(bobSigning);

    const staleBundle = {
      ...(await bob.createPreKeyBundle()),
      generatedAt: Date.now() - (60 * 24 * 60 * 60 * 1000),
    };

    let deletedPeerId: string | null = null;
    const alice = new MessageProtocol(aliceCrypto, 'alice-peer');
    alice.setPersistence({
      ...createBasePersistence(),
      loadPreKeyBundle: async (_peerId: string) => staleBundle,
      deletePreKeyBundle: async (peerId: string) => {
        deletedPeerId = peerId;
      },
      savePreKeyBundle: async () => {},
    });

    await alice.init(aliceSigning);
    const loaded = await alice.getPeerPreKeyBundle('bob-peer');

    expect(loaded).toBeNull();
    expect(deletedPeerId).toBe('bob-peer');
  });
});
