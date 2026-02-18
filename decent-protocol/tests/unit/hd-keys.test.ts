/**
 * HD Key Derivation tests — Per-workspace unique keys from one seed
 * Like Bitcoin HD wallets: one seed → infinite derived key pairs
 */

import { describe, test, expect } from 'bun:test';
import { SeedPhraseManager } from '../../src/identity/SeedPhrase';
import { CryptoManager } from '../../src/crypto/CryptoManager';

describe('HD Key Derivation - Per Workspace Keys', () => {
  const spm = new SeedPhraseManager();
  const crypto = new CryptoManager();
  let mnemonic: string;

  // Generate once, reuse across tests
  test('setup: generate seed phrase', () => {
    mnemonic = spm.generate().mnemonic;
    expect(mnemonic.split(' ')).toHaveLength(12);
  });

  test('workspace 0 produces same keys as deriveKeys() (backwards compatible)', async () => {
    const rootKeys = await spm.deriveKeys(mnemonic);
    const ws0Keys = await spm.deriveWorkspaceKeys(mnemonic, 0);

    const rootPub = await crypto.exportPublicKey(rootKeys.ecdhKeyPair.publicKey);
    const ws0Pub = await crypto.exportPublicKey(ws0Keys.ecdhKeyPair.publicKey);

    expect(ws0Pub).toBe(rootPub);
  });

  test('different workspace indices produce different keys', async () => {
    const ws0 = await spm.deriveWorkspaceKeys(mnemonic, 0);
    const ws1 = await spm.deriveWorkspaceKeys(mnemonic, 1);
    const ws2 = await spm.deriveWorkspaceKeys(mnemonic, 2);

    const pub0 = await crypto.exportPublicKey(ws0.ecdhKeyPair.publicKey);
    const pub1 = await crypto.exportPublicKey(ws1.ecdhKeyPair.publicKey);
    const pub2 = await crypto.exportPublicKey(ws2.ecdhKeyPair.publicKey);

    // All different
    expect(pub0).not.toBe(pub1);
    expect(pub0).not.toBe(pub2);
    expect(pub1).not.toBe(pub2);
  });

  test('ECDSA keys also differ per workspace', async () => {
    const ws1 = await spm.deriveWorkspaceKeys(mnemonic, 1);
    const ws2 = await spm.deriveWorkspaceKeys(mnemonic, 2);

    const sig1 = await crypto.exportPublicKey(ws1.ecdsaKeyPair.publicKey);
    const sig2 = await crypto.exportPublicKey(ws2.ecdsaKeyPair.publicKey);

    expect(sig1).not.toBe(sig2);
  });

  test('same seed + same index = deterministic (same keys every time)', async () => {
    const keys1 = await spm.deriveWorkspaceKeys(mnemonic, 5);
    const keys2 = await spm.deriveWorkspaceKeys(mnemonic, 5);

    const pub1 = await crypto.exportPublicKey(keys1.ecdhKeyPair.publicKey);
    const pub2 = await crypto.exportPublicKey(keys2.ecdhKeyPair.publicKey);

    expect(pub1).toBe(pub2);
  });

  test('different seed + same index = different keys', async () => {
    const seed2 = spm.generate().mnemonic;

    const keys1 = await spm.deriveWorkspaceKeys(mnemonic, 1);
    const keys2 = await spm.deriveWorkspaceKeys(seed2, 1);

    const pub1 = await crypto.exportPublicKey(keys1.ecdhKeyPair.publicKey);
    const pub2 = await crypto.exportPublicKey(keys2.ecdhKeyPair.publicKey);

    expect(pub1).not.toBe(pub2);
  });
});

describe('HD Key Derivation - Crypto Operations', () => {
  const spm = new SeedPhraseManager();
  const crypto = new CryptoManager();

  test('workspace keys can derive shared secrets with peers', async () => {
    const mnemonic = spm.generate().mnemonic;
    const wsKeys = await spm.deriveWorkspaceKeys(mnemonic, 3);

    // Peer generates their own keys
    const peerKeys = await crypto.generateKeyPair();

    // Both can derive shared secret
    const aliceSecret = await crypto.deriveSharedSecret(peerKeys.publicKey, wsKeys.ecdhKeyPair.privateKey);
    const bobSecret = await crypto.deriveSharedSecret(wsKeys.ecdhKeyPair.publicKey, peerKeys.privateKey);

    // Both should derive the same secret (test by encrypting/decrypting)
    const { MessageCipher } = await import('../../src/crypto/MessageCipher');
    const cipher = new MessageCipher();

    const encrypted = await cipher.encrypt('HD wallet test', aliceSecret);
    const decrypted = await cipher.decrypt(encrypted, bobSecret);

    expect(decrypted).toBe('HD wallet test');
  });

  test('workspace ECDSA keys can sign and verify', async () => {
    const mnemonic = spm.generate().mnemonic;
    const wsKeys = await spm.deriveWorkspaceKeys(mnemonic, 7);

    const { MessageCipher } = await import('../../src/crypto/MessageCipher');
    const cipher = new MessageCipher();

    const signature = await cipher.sign('workspace 7 message', wsKeys.ecdsaKeyPair.privateKey);
    const valid = await cipher.verify('workspace 7 message', signature, wsKeys.ecdsaKeyPair.publicKey);

    expect(valid).toBe(true);
  });

  test('cross-workspace signature fails (different keys)', async () => {
    const mnemonic = spm.generate().mnemonic;
    const ws1Keys = await spm.deriveWorkspaceKeys(mnemonic, 1);
    const ws2Keys = await spm.deriveWorkspaceKeys(mnemonic, 2);

    const { MessageCipher } = await import('../../src/crypto/MessageCipher');
    const cipher = new MessageCipher();

    // Sign with workspace 1 key
    const signature = await cipher.sign('test message', ws1Keys.ecdsaKeyPair.privateKey);

    // Verify with workspace 2 key — should fail
    const valid = await cipher.verify('test message', signature, ws2Keys.ecdsaKeyPair.publicKey);
    expect(valid).toBe(false);
  });
});

describe('HD Key Derivation - Privacy', () => {
  const spm = new SeedPhraseManager();
  const crypto = new CryptoManager();

  test('cannot link workspace identities without seed phrase', async () => {
    const mnemonic = spm.generate().mnemonic;

    // Derive keys for 10 workspaces
    const publicKeys: string[] = [];
    for (let i = 0; i < 10; i++) {
      const keys = await spm.deriveWorkspaceKeys(mnemonic, i);
      publicKeys.push(await crypto.exportPublicKey(keys.ecdhKeyPair.publicKey));
    }

    // All public keys are unique — no way to link them
    const unique = new Set(publicKeys);
    expect(unique.size).toBe(10);

    // An observer seeing any two public keys can't tell they're from the same seed
    // (HKDF output is indistinguishable from random without the master seed)
  });
});

describe('HD Key Derivation - Batch', () => {
  const spm = new SeedPhraseManager();
  const crypto = new CryptoManager();

  test('deriveMultipleWorkspaceKeys returns correct count', async () => {
    const mnemonic = spm.generate().mnemonic;
    const keys = await spm.deriveMultipleWorkspaceKeys(mnemonic, [0, 1, 2, 5, 10]);

    expect(keys.size).toBe(5);
    expect(keys.has(0)).toBe(true);
    expect(keys.has(5)).toBe(true);
    expect(keys.has(10)).toBe(true);
  });

  test('batch results match individual derivation', async () => {
    const mnemonic = spm.generate().mnemonic;
    const batch = await spm.deriveMultipleWorkspaceKeys(mnemonic, [3, 7]);

    const single3 = await spm.deriveWorkspaceKeys(mnemonic, 3);
    const single7 = await spm.deriveWorkspaceKeys(mnemonic, 7);

    const batchPub3 = await crypto.exportPublicKey(batch.get(3)!.ecdhKeyPair.publicKey);
    const singlePub3 = await crypto.exportPublicKey(single3.ecdhKeyPair.publicKey);
    const batchPub7 = await crypto.exportPublicKey(batch.get(7)!.ecdhKeyPair.publicKey);
    const singlePub7 = await crypto.exportPublicKey(single7.ecdhKeyPair.publicKey);

    expect(batchPub3).toBe(singlePub3);
    expect(batchPub7).toBe(singlePub7);
  });
});

describe('HD Key Derivation - Validation', () => {
  const spm = new SeedPhraseManager();

  test('rejects negative workspace index', async () => {
    const mnemonic = spm.generate().mnemonic;
    await expect(spm.deriveWorkspaceKeys(mnemonic, -1)).rejects.toThrow('non-negative integer');
  });

  test('rejects non-integer workspace index', async () => {
    const mnemonic = spm.generate().mnemonic;
    await expect(spm.deriveWorkspaceKeys(mnemonic, 1.5)).rejects.toThrow('non-negative integer');
  });

  test('supports high workspace indices', async () => {
    const mnemonic = spm.generate().mnemonic;
    const keys = await spm.deriveWorkspaceKeys(mnemonic, 999999);
    expect(keys.ecdhKeyPair).toBeDefined();
    expect(keys.ecdsaKeyPair).toBeDefined();
  });
});

describe('HD Key Derivation - Recovery Flow', () => {
  const spm = new SeedPhraseManager();
  const crypto = new CryptoManager();

  test('full recovery: seed → multiple workspaces → lose device → recover all', async () => {
    const mnemonic = spm.generate().mnemonic;

    // Original device: derive keys for 3 workspaces
    const originalKeys = await spm.deriveMultipleWorkspaceKeys(mnemonic, [0, 1, 2]);
    const originalPubs = new Map<number, string>();
    for (const [idx, keys] of originalKeys) {
      originalPubs.set(idx, await crypto.exportPublicKey(keys.ecdhKeyPair.publicKey));
    }

    // Device lost! Only have the 12 words written on paper

    // New device: recover all workspace keys
    const recoveredKeys = await spm.deriveMultipleWorkspaceKeys(mnemonic, [0, 1, 2]);
    const recoveredPubs = new Map<number, string>();
    for (const [idx, keys] of recoveredKeys) {
      recoveredPubs.set(idx, await crypto.exportPublicKey(keys.ecdhKeyPair.publicKey));
    }

    // All keys match
    expect(recoveredPubs.get(0)).toBe(originalPubs.get(0));
    expect(recoveredPubs.get(1)).toBe(originalPubs.get(1));
    expect(recoveredPubs.get(2)).toBe(originalPubs.get(2));
  });
});
