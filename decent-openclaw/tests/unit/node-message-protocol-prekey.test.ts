import { describe, expect, test } from 'bun:test';
import { CryptoManager } from 'decent-protocol';
import type { PersistedLocalPreKeyState, PreKeyBundle, SerializedRatchetState } from 'decent-protocol';
import { NodeMessageProtocol } from '../../src/peer/NodeMessageProtocol';

function createBasePersistence() {
  return {
    save: async (_peerId: string, _state: SerializedRatchetState) => {},
    load: async (_peerId: string) => null,
    delete: async (_peerId: string) => {},
  };
}

describe('NodeMessageProtocol pre-key bootstrap', () => {


  test('falls back to legacy shared-secret encryption when Bob send chain is not ready yet', async () => {
    const aliceCrypto = new CryptoManager();
    const aliceSigning = await aliceCrypto.generateSigningKeyPair();

    const bobCrypto = new CryptoManager();
    const bobSigning = await bobCrypto.generateSigningKeyPair();

    const alice = new NodeMessageProtocol(aliceCrypto, 'alice-peer');
    const bob = new NodeMessageProtocol(bobCrypto, 'bob-peer');

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
  test('bootstraps a ratchet session from a stored peer pre-key bundle', async () => {
    const aliceCrypto = new CryptoManager();
    const aliceSigning = await aliceCrypto.generateSigningKeyPair();

    const bobCrypto = new CryptoManager();
    const bobSigning = await bobCrypto.generateSigningKeyPair();

    const alice = new NodeMessageProtocol(aliceCrypto, 'alice-peer');
    const bob = new NodeMessageProtocol(bobCrypto, 'bob-peer');

    await alice.init(aliceSigning);
    await bob.init(bobSigning);

    const bobBundle = await bob.createPreKeyBundle();
    const originalOneTimeCount = bobBundle.oneTimePreKeys.length;
    expect(originalOneTimeCount).toBeGreaterThan(0);

    const accepted = await alice.storePeerPreKeyBundle('bob-peer', bobBundle);
    expect(accepted).toBe(true);

    const envelope = await alice.encryptMessage('bob-peer', 'hello from alice');
    expect((envelope as any).protocolVersion).toBe(3);
    expect((envelope as any).sessionInit.selectedPreKeyType).toBe('one-time');

    const decrypted = await bob.decryptMessage('alice-peer', envelope as any, aliceSigning.publicKey);
    expect(decrypted).toBe('hello from alice');

    const cachedAfterUse = await alice.getPeerPreKeyBundle('bob-peer');
    expect(cachedAfterUse).not.toBeNull();
    expect(cachedAfterUse!.oneTimePreKeys).toHaveLength(originalOneTimeCount - 1);

    await expect(
      bob.decryptMessage('alice-peer', envelope as any, aliceSigning.publicKey),
    ).rejects.toThrow('Ratchet already established');
  });

  test('persists local one-time pre-key consumption after decrypting session init', async () => {
    const aliceCrypto = new CryptoManager();
    const aliceSigning = await aliceCrypto.generateSigningKeyPair();

    const bobCrypto = new CryptoManager();
    const bobSigning = await bobCrypto.generateSigningKeyPair();

    const alice = new NodeMessageProtocol(aliceCrypto, 'alice-peer');
    const bob = new NodeMessageProtocol(bobCrypto, 'bob-peer');

    const persistedStates: PersistedLocalPreKeyState[] = [];
    bob.setPersistence({
      ...createBasePersistence(),
      saveLocalPreKeyState: async (_ownerPeerId: string, state: PersistedLocalPreKeyState) => {
        persistedStates.push(structuredClone(state));
      },
      loadLocalPreKeyState: async () => null,
    });

    await alice.init(aliceSigning);
    await bob.init(bobSigning);

    const bobBundle = await bob.createPreKeyBundle();
    await alice.storePeerPreKeyBundle('bob-peer', bobBundle);

    const envelope = await alice.encryptMessage('bob-peer', 'consumption persistence check') as any;
    expect(envelope.sessionInit.selectedPreKeyType).toBe('one-time');

    const decrypted = await bob.decryptMessage('alice-peer', envelope, aliceSigning.publicKey);
    expect(decrypted).toBe('consumption persistence check');

    const consumedKeyId = envelope.sessionInit.selectedPreKeyId as number;
    const latestState = persistedStates[persistedStates.length - 1];
    expect(latestState).toBeDefined();
    expect(latestState.oneTimePreKeys).toHaveLength(19);
    expect(latestState.oneTimePreKeys.some((entry) => entry.keyId === consumedKeyId)).toBe(false);
  });

  test('falls back to signed pre-key when no one-time pre-keys are published', async () => {
    const aliceCrypto = new CryptoManager();
    const aliceSigning = await aliceCrypto.generateSigningKeyPair();

    const bobCrypto = new CryptoManager();
    const bobSigning = await bobCrypto.generateSigningKeyPair();

    const alice = new NodeMessageProtocol(aliceCrypto, 'alice-peer');
    const bob = new NodeMessageProtocol(bobCrypto, 'bob-peer');

    await alice.init(aliceSigning);
    await bob.init(bobSigning);

    const bobBundle = await bob.createPreKeyBundle();
    const signedOnlyBundle = { ...bobBundle, oneTimePreKeys: [] as typeof bobBundle.oneTimePreKeys };

    const accepted = await alice.storePeerPreKeyBundle('bob-peer', signedOnlyBundle);
    expect(accepted).toBe(true);

    const envelope = await alice.encryptMessage('bob-peer', 'signed pre-key path');
    expect((envelope as any).protocolVersion).toBe(3);
    expect((envelope as any).sessionInit.selectedPreKeyType).toBe('signed');

    const decrypted = await bob.decryptMessage('alice-peer', envelope as any, aliceSigning.publicKey);
    expect(decrypted).toBe('signed pre-key path');
  });
});

describe('NodeMessageProtocol pre-key lifecycle policy', () => {
  test('rotates near-expiry signed pre-key, prunes stale local one-time keys, and replenishes pool', async () => {
    const cryptoManager = new CryptoManager();
    const signing = await cryptoManager.generateSigningKeyPair();

    let seededState: PersistedLocalPreKeyState | null = null;
    const seedProtocol = new NodeMessageProtocol(cryptoManager, 'alice-peer');
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
    const protocol = new NodeMessageProtocol(cryptoManager, 'alice-peer');
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
    expect(bundle.oneTimePreKeys).toHaveLength(20);
    expect(bundle.oneTimePreKeys.every((entry) => entry.createdAt > now - (24 * 60 * 60 * 1000))).toBe(true);
    expect(postPolicyState).not.toBeNull();
    expect(postPolicyState!.oneTimePreKeys).toHaveLength(20);
  });

  test('prunes stale and duplicate peer one-time pre-keys on store', async () => {
    const aliceCrypto = new CryptoManager();
    const aliceSigning = await aliceCrypto.generateSigningKeyPair();

    const bobCrypto = new CryptoManager();
    const bobSigning = await bobCrypto.generateSigningKeyPair();

    const alice = new NodeMessageProtocol(aliceCrypto, 'alice-peer');
    const bob = new NodeMessageProtocol(bobCrypto, 'bob-peer');

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

    const bob = new NodeMessageProtocol(bobCrypto, 'bob-peer');
    bob.setPersistence(createBasePersistence());
    await bob.init(bobSigning);

    const staleBundle = {
      ...(await bob.createPreKeyBundle()),
      generatedAt: Date.now() - (60 * 24 * 60 * 60 * 1000),
    };

    let deletedPeerId: string | null = null;
    const alice = new NodeMessageProtocol(aliceCrypto, 'alice-peer');
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
