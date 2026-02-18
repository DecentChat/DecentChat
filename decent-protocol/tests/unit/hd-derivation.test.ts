/**
 * HD Key Derivation tests — Structured hierarchical key tree from one seed
 *
 * Tests the HDKeyDerivation module and its integration with SeedPhraseManager.
 * Verifies determinism, path isolation, and crypto compatibility.
 */

import { describe, test, expect } from 'bun:test';
import { HDKeyDerivation, HDPurpose } from '../../src/identity/HDKeyDerivation';
import { SeedPhraseManager } from '../../src/identity/SeedPhrase';
import { CryptoManager } from '../../src/crypto/CryptoManager';
import { MessageCipher } from '../../src/crypto/MessageCipher';

const hd = new HDKeyDerivation();
const spm = new SeedPhraseManager();
const cm = new CryptoManager();
const cipher = new MessageCipher();

/** Helper: export a CryptoKey to hex for comparison */
async function exportKeyHex(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('spki', key);
  return Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('HDKeyDerivation — Master Key', () => {
  test('deriveMasterKey produces 64-byte output', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(16));
    const masterKey = await hd.deriveMasterKey(seed);
    expect(masterKey.byteLength).toBe(64);
  });

  test('same seed → same master key (deterministic)', async () => {
    const seed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const mk1 = await hd.deriveMasterKey(seed);
    const mk2 = await hd.deriveMasterKey(seed);
    const hex1 = Array.from(new Uint8Array(mk1)).map(b => b.toString(16).padStart(2, '0')).join('');
    const hex2 = Array.from(new Uint8Array(mk2)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(hex1).toBe(hex2);
  });

  test('different seeds → different master keys', async () => {
    const seed1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const seed2 = new Uint8Array([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const mk1 = await hd.deriveMasterKey(seed1);
    const mk2 = await hd.deriveMasterKey(seed2);
    const hex1 = Array.from(new Uint8Array(mk1)).map(b => b.toString(16).padStart(2, '0')).join('');
    const hex2 = Array.from(new Uint8Array(mk2)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(hex1).not.toBe(hex2);
  });
});

describe('HDKeyDerivation — Determinism', () => {
  let masterKey: ArrayBuffer;

  test('setup: derive master key', async () => {
    const seed = new Uint8Array([42, 17, 88, 3, 200, 55, 101, 7, 33, 64, 128, 99, 12, 5, 77, 222]);
    masterKey = await hd.deriveMasterKey(seed);
  });

  test('same master key + same path → same keys every time', async () => {
    const k1 = await hd.deriveIdentityKey(masterKey, 0);
    const k2 = await hd.deriveIdentityKey(masterKey, 0);

    expect(await exportKeyHex(k1.ecdhKeyPair.publicKey)).toBe(await exportKeyHex(k2.ecdhKeyPair.publicKey));
    expect(await exportKeyHex(k1.ecdsaKeyPair.publicKey)).toBe(await exportKeyHex(k2.ecdsaKeyPair.publicKey));
  });

  test('workspace keys are deterministic', async () => {
    const k1 = await hd.deriveWorkspaceKey(masterKey, 5);
    const k2 = await hd.deriveWorkspaceKey(masterKey, 5);
    expect(await exportKeyHex(k1.ecdhKeyPair.publicKey)).toBe(await exportKeyHex(k2.ecdhKeyPair.publicKey));
  });

  test('contact keys are deterministic', async () => {
    const k1 = await hd.deriveContactKey(masterKey, 3);
    const k2 = await hd.deriveContactKey(masterKey, 3);
    expect(await exportKeyHex(k1.ecdhKeyPair.publicKey)).toBe(await exportKeyHex(k2.ecdhKeyPair.publicKey));
  });

  test('device keys are deterministic', async () => {
    const k1 = await hd.deriveDeviceKey(masterKey, 1);
    const k2 = await hd.deriveDeviceKey(masterKey, 1);
    expect(await exportKeyHex(k1.ecdhKeyPair.publicKey)).toBe(await exportKeyHex(k2.ecdhKeyPair.publicKey));
  });
});

describe('HDKeyDerivation — Path Isolation', () => {
  let masterKey: ArrayBuffer;

  test('setup: derive master key', async () => {
    const seed = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]);
    masterKey = await hd.deriveMasterKey(seed);
  });

  test('different purposes produce different keys (same index)', async () => {
    const identity = await hd.deriveIdentityKey(masterKey, 0);
    const workspace = await hd.deriveWorkspaceKey(masterKey, 0);
    const contact = await hd.deriveContactKey(masterKey, 0);
    const device = await hd.deriveDeviceKey(masterKey, 0);

    const pubs = await Promise.all([
      exportKeyHex(identity.ecdhKeyPair.publicKey),
      exportKeyHex(workspace.ecdhKeyPair.publicKey),
      exportKeyHex(contact.ecdhKeyPair.publicKey),
      exportKeyHex(device.ecdhKeyPair.publicKey),
    ]);

    const unique = new Set(pubs);
    expect(unique.size).toBe(4);
  });

  test('different indices within same purpose produce different keys', async () => {
    const pubs: string[] = [];
    for (let i = 0; i < 5; i++) {
      const keys = await hd.deriveWorkspaceKey(masterKey, i);
      pubs.push(await exportKeyHex(keys.ecdhKeyPair.publicKey));
    }
    const unique = new Set(pubs);
    expect(unique.size).toBe(5);
  });

  test('ECDSA keys also differ across purposes', async () => {
    const identity = await hd.deriveIdentityKey(masterKey, 0);
    const workspace = await hd.deriveWorkspaceKey(masterKey, 0);

    const sigId = await exportKeyHex(identity.ecdsaKeyPair.publicKey);
    const sigWs = await exportKeyHex(workspace.ecdsaKeyPair.publicKey);
    expect(sigId).not.toBe(sigWs);
  });

  test('derivation paths are correctly set', async () => {
    const id = await hd.deriveIdentityKey(masterKey, 0);
    const ws = await hd.deriveWorkspaceKey(masterKey, 3);
    const ct = await hd.deriveContactKey(masterKey, 7);
    const dv = await hd.deriveDeviceKey(masterKey, 2);

    expect(id.path).toBe("m/0'/identity/0");
    expect(ws.path).toBe("m/1'/workspace/3");
    expect(ct.path).toBe("m/2'/contact/7");
    expect(dv.path).toBe("m/3'/device/2");
  });
});

describe('HDKeyDerivation — ECDH Key Exchange', () => {
  let masterKey: ArrayBuffer;

  test('setup: derive master key', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(16));
    masterKey = await hd.deriveMasterKey(seed);
  });

  test('identity keys work with ECDH key exchange', async () => {
    const alice = await hd.deriveIdentityKey(masterKey, 0);
    const bobKeys = await cm.generateKeyPair();

    const aliceSecret = await cm.deriveSharedSecret(bobKeys.publicKey, alice.ecdhKeyPair.privateKey);
    const bobSecret = await cm.deriveSharedSecret(alice.ecdhKeyPair.publicKey, bobKeys.privateKey);

    const encrypted = await cipher.encrypt('HD identity test', aliceSecret);
    const decrypted = await cipher.decrypt(encrypted, bobSecret);
    expect(decrypted).toBe('HD identity test');
  });

  test('workspace keys work with ECDH key exchange', async () => {
    const wsKeys = await hd.deriveWorkspaceKey(masterKey, 1);
    const peerKeys = await cm.generateKeyPair();

    const mySecret = await cm.deriveSharedSecret(peerKeys.publicKey, wsKeys.ecdhKeyPair.privateKey);
    const peerSecret = await cm.deriveSharedSecret(wsKeys.ecdhKeyPair.publicKey, peerKeys.privateKey);

    const encrypted = await cipher.encrypt('workspace msg', mySecret);
    const decrypted = await cipher.decrypt(encrypted, peerSecret);
    expect(decrypted).toBe('workspace msg');
  });

  test('contact keys work with ECDH key exchange', async () => {
    const ctKeys = await hd.deriveContactKey(masterKey, 42);
    const peerKeys = await cm.generateKeyPair();

    const mySecret = await cm.deriveSharedSecret(peerKeys.publicKey, ctKeys.ecdhKeyPair.privateKey);
    const peerSecret = await cm.deriveSharedSecret(ctKeys.ecdhKeyPair.publicKey, peerKeys.privateKey);

    const encrypted = await cipher.encrypt('secret DM', mySecret);
    const decrypted = await cipher.decrypt(encrypted, peerSecret);
    expect(decrypted).toBe('secret DM');
  });
});

describe('HDKeyDerivation — ECDSA Signing', () => {
  let masterKey: ArrayBuffer;

  test('setup: derive master key', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(16));
    masterKey = await hd.deriveMasterKey(seed);
  });

  test('identity ECDSA keys can sign and verify', async () => {
    const keys = await hd.deriveIdentityKey(masterKey, 0);
    const sig = await cipher.sign('identity message', keys.ecdsaKeyPair.privateKey);
    const valid = await cipher.verify('identity message', sig, keys.ecdsaKeyPair.publicKey);
    expect(valid).toBe(true);
  });

  test('workspace ECDSA keys can sign and verify', async () => {
    const keys = await hd.deriveWorkspaceKey(masterKey, 3);
    const sig = await cipher.sign('workspace signed', keys.ecdsaKeyPair.privateKey);
    const valid = await cipher.verify('workspace signed', sig, keys.ecdsaKeyPair.publicKey);
    expect(valid).toBe(true);
  });

  test('cross-purpose signature verification fails', async () => {
    const idKeys = await hd.deriveIdentityKey(masterKey, 0);
    const wsKeys = await hd.deriveWorkspaceKey(masterKey, 0);

    const sig = await cipher.sign('test', idKeys.ecdsaKeyPair.privateKey);
    const valid = await cipher.verify('test', sig, wsKeys.ecdsaKeyPair.publicKey);
    expect(valid).toBe(false);
  });

  test('cross-index signature verification fails', async () => {
    const ws1 = await hd.deriveWorkspaceKey(masterKey, 1);
    const ws2 = await hd.deriveWorkspaceKey(masterKey, 2);

    const sig = await cipher.sign('test', ws1.ecdsaKeyPair.privateKey);
    const valid = await cipher.verify('test', sig, ws2.ecdsaKeyPair.publicKey);
    expect(valid).toBe(false);
  });
});

describe('HDKeyDerivation — Validation', () => {
  let masterKey: ArrayBuffer;

  test('setup: derive master key', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(16));
    masterKey = await hd.deriveMasterKey(seed);
  });

  test('rejects negative index', async () => {
    await expect(hd.deriveIdentityKey(masterKey, -1)).rejects.toThrow('non-negative integer');
    await expect(hd.deriveWorkspaceKey(masterKey, -1)).rejects.toThrow('non-negative integer');
    await expect(hd.deriveContactKey(masterKey, -1)).rejects.toThrow('non-negative integer');
    await expect(hd.deriveDeviceKey(masterKey, -1)).rejects.toThrow('non-negative integer');
  });

  test('rejects non-integer index', async () => {
    await expect(hd.deriveIdentityKey(masterKey, 1.5)).rejects.toThrow('non-negative integer');
    await expect(hd.deriveWorkspaceKey(masterKey, 0.1)).rejects.toThrow('non-negative integer');
  });

  test('supports high indices', async () => {
    const keys = await hd.deriveWorkspaceKey(masterKey, 999999);
    expect(keys.ecdhKeyPair.publicKey).toBeDefined();
    expect(keys.ecdsaKeyPair.publicKey).toBeDefined();
    expect(keys.path).toBe("m/1'/workspace/999999");
  });
});

describe('HDKeyDerivation — SeedPhraseManager Integration', () => {
  let mnemonic: string;

  test('setup: generate mnemonic', () => {
    mnemonic = spm.generate().mnemonic;
    expect(mnemonic.split(' ')).toHaveLength(12);
  });

  test('deriveHDMasterKey works from mnemonic', async () => {
    const mk = await spm.deriveHDMasterKey(mnemonic);
    expect(mk.byteLength).toBe(64);
  });

  test('deriveHDMasterKey is deterministic', async () => {
    const mk1 = await spm.deriveHDMasterKey(mnemonic);
    const mk2 = await spm.deriveHDMasterKey(mnemonic);
    const hex1 = Array.from(new Uint8Array(mk1)).map(b => b.toString(16).padStart(2, '0')).join('');
    const hex2 = Array.from(new Uint8Array(mk2)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(hex1).toBe(hex2);
  });

  test('deriveHDIdentityKey returns valid key pairs', async () => {
    const keys = await spm.deriveHDIdentityKey(mnemonic, 0);
    expect(keys.ecdhKeyPair.publicKey).toBeDefined();
    expect(keys.ecdsaKeyPair.publicKey).toBeDefined();
    expect(keys.path).toBe("m/0'/identity/0");
  });

  test('deriveHDWorkspaceKey returns unique keys per workspace', async () => {
    const ws0 = await spm.deriveHDWorkspaceKey(mnemonic, 0);
    const ws1 = await spm.deriveHDWorkspaceKey(mnemonic, 1);

    const pub0 = await exportKeyHex(ws0.ecdhKeyPair.publicKey);
    const pub1 = await exportKeyHex(ws1.ecdhKeyPair.publicKey);
    expect(pub0).not.toBe(pub1);
  });

  test('deriveHDContactKey returns unique keys per contact', async () => {
    const ct0 = await spm.deriveHDContactKey(mnemonic, 0);
    const ct1 = await spm.deriveHDContactKey(mnemonic, 1);

    const pub0 = await exportKeyHex(ct0.ecdhKeyPair.publicKey);
    const pub1 = await exportKeyHex(ct1.ecdhKeyPair.publicKey);
    expect(pub0).not.toBe(pub1);
  });

  test('deriveHDDeviceKey returns unique keys per device', async () => {
    const dv0 = await spm.deriveHDDeviceKey(mnemonic, 0);
    const dv1 = await spm.deriveHDDeviceKey(mnemonic, 1);

    const pub0 = await exportKeyHex(dv0.ecdhKeyPair.publicKey);
    const pub1 = await exportKeyHex(dv1.ecdhKeyPair.publicKey);
    expect(pub0).not.toBe(pub1);
  });

  test('rejects invalid mnemonic', async () => {
    await expect(spm.deriveHDMasterKey('bad words here')).rejects.toThrow('Invalid seed phrase');
    await expect(spm.deriveHDIdentityKey('bad words here')).rejects.toThrow('Invalid seed phrase');
  });

  test('different mnemonics produce different HD keys', async () => {
    const mnemonic2 = spm.generate().mnemonic;

    const k1 = await spm.deriveHDIdentityKey(mnemonic, 0);
    const k2 = await spm.deriveHDIdentityKey(mnemonic2, 0);

    const pub1 = await exportKeyHex(k1.ecdhKeyPair.publicKey);
    const pub2 = await exportKeyHex(k2.ecdhKeyPair.publicKey);
    expect(pub1).not.toBe(pub2);
  });
});

describe('HDKeyDerivation — Recovery Flow', () => {
  test('full HD recovery: seed → identity + workspaces + contacts → lose device → recover all', async () => {
    const mnemonic = spm.generate().mnemonic;

    // Original device: derive all keys
    const origIdentity = await spm.deriveHDIdentityKey(mnemonic, 0);
    const origWs1 = await spm.deriveHDWorkspaceKey(mnemonic, 0);
    const origWs2 = await spm.deriveHDWorkspaceKey(mnemonic, 1);
    const origContact = await spm.deriveHDContactKey(mnemonic, 0);

    // Device lost! Only have the 12 words.

    // New device: recover
    const recIdentity = await spm.deriveHDIdentityKey(mnemonic, 0);
    const recWs1 = await spm.deriveHDWorkspaceKey(mnemonic, 0);
    const recWs2 = await spm.deriveHDWorkspaceKey(mnemonic, 1);
    const recContact = await spm.deriveHDContactKey(mnemonic, 0);

    // All keys match
    expect(await exportKeyHex(recIdentity.ecdhKeyPair.publicKey)).toBe(await exportKeyHex(origIdentity.ecdhKeyPair.publicKey));
    expect(await exportKeyHex(recWs1.ecdhKeyPair.publicKey)).toBe(await exportKeyHex(origWs1.ecdhKeyPair.publicKey));
    expect(await exportKeyHex(recWs2.ecdhKeyPair.publicKey)).toBe(await exportKeyHex(origWs2.ecdhKeyPair.publicKey));
    expect(await exportKeyHex(recContact.ecdhKeyPair.publicKey)).toBe(await exportKeyHex(origContact.ecdhKeyPair.publicKey));
  });
});

describe('HDKeyDerivation — Privacy', () => {
  test('cannot link keys across purposes or indices without master key', async () => {
    const mnemonic = spm.generate().mnemonic;

    // Derive 20 keys across all purposes
    const allPubs: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await spm.deriveHDIdentityKey(mnemonic, i);
      const ws = await spm.deriveHDWorkspaceKey(mnemonic, i);
      const ct = await spm.deriveHDContactKey(mnemonic, i);
      const dv = await spm.deriveHDDeviceKey(mnemonic, i);
      allPubs.push(
        await exportKeyHex(id.ecdhKeyPair.publicKey),
        await exportKeyHex(ws.ecdhKeyPair.publicKey),
        await exportKeyHex(ct.ecdhKeyPair.publicKey),
        await exportKeyHex(dv.ecdhKeyPair.publicKey),
      );
    }

    // All 20 public keys are unique
    const unique = new Set(allPubs);
    expect(unique.size).toBe(20);
  });
});
