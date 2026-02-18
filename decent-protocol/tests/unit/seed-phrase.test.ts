/**
 * SeedPhrase tests — BIP39-style mnemonic for deterministic identity recovery
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SeedPhraseManager } from '../../src/identity/SeedPhrase';
import { IdentityManager } from '../../src/identity/Identity';
import { WORDLIST } from '../../src/identity/wordlist';

describe('SeedPhraseManager - Generation', () => {
  let spm: SeedPhraseManager;

  beforeEach(() => {
    spm = new SeedPhraseManager();
  });

  test('generates 12-word mnemonic', () => {
    const result = spm.generate();
    const words = result.mnemonic.split(' ');
    expect(words).toHaveLength(12);
  });

  test('all words are from BIP39 wordlist', () => {
    const result = spm.generate();
    const words = result.mnemonic.split(' ');
    for (const word of words) {
      expect(WORDLIST).toContain(word);
    }
  });

  test('entropy is 32 hex chars (128 bits)', () => {
    const result = spm.generate();
    expect(result.entropy).toHaveLength(32);
    expect(result.entropy).toMatch(/^[0-9a-f]{32}$/);
  });

  test('generates different phrases each time', () => {
    const r1 = spm.generate();
    const r2 = spm.generate();
    expect(r1.mnemonic).not.toBe(r2.mnemonic);
  });

  test('generated phrase passes validation', () => {
    const result = spm.generate();
    const validation = spm.validate(result.mnemonic);
    expect(validation.valid).toBe(true);
  });
});

describe('SeedPhraseManager - Validation', () => {
  let spm: SeedPhraseManager;

  beforeEach(() => {
    spm = new SeedPhraseManager();
  });

  test('validates correct 12-word phrase', () => {
    const { mnemonic } = spm.generate();
    expect(spm.validate(mnemonic).valid).toBe(true);
  });

  test('rejects phrase with wrong word count', () => {
    const result = spm.validate('one two three');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('12 words');
  });

  test('rejects phrase with unknown words', () => {
    const result = spm.validate('abandon ability able about above absent absorb abstract absurd abuse access xyzzy');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unknown word');
  });

  test('handles extra whitespace', () => {
    const { mnemonic } = spm.generate();
    const spacey = '  ' + mnemonic.replace(/ /g, '   ') + '  ';
    expect(spm.validate(spacey).valid).toBe(true);
  });

  test('case insensitive', () => {
    const { mnemonic } = spm.generate();
    expect(spm.validate(mnemonic.toUpperCase()).valid).toBe(true);
  });
});

describe('SeedPhraseManager - Deterministic Key Derivation', () => {
  let spm: SeedPhraseManager;

  beforeEach(() => {
    spm = new SeedPhraseManager();
  });

  test('derives ECDH and ECDSA key pairs', async () => {
    const { mnemonic } = spm.generate();
    const keys = await spm.deriveKeys(mnemonic);

    expect(keys.ecdhKeyPair.publicKey).toBeTruthy();
    expect(keys.ecdhKeyPair.privateKey).toBeTruthy();
    expect(keys.ecdsaKeyPair.publicKey).toBeTruthy();
    expect(keys.ecdsaKeyPair.privateKey).toBeTruthy();
    expect(keys.masterSeed).toBeTruthy();
  });

  test('DETERMINISTIC: same phrase → same keys every time', async () => {
    const { mnemonic } = spm.generate();

    const keys1 = await spm.deriveKeys(mnemonic);
    const keys2 = await spm.deriveKeys(mnemonic);

    // Export and compare public keys
    const pub1 = await crypto.subtle.exportKey('spki', keys1.ecdhKeyPair.publicKey);
    const pub2 = await crypto.subtle.exportKey('spki', keys2.ecdhKeyPair.publicKey);

    const hex1 = Array.from(new Uint8Array(pub1)).map(b => b.toString(16).padStart(2, '0')).join('');
    const hex2 = Array.from(new Uint8Array(pub2)).map(b => b.toString(16).padStart(2, '0')).join('');

    expect(hex1).toBe(hex2);

    // Also check ECDSA
    const sig1 = await crypto.subtle.exportKey('spki', keys1.ecdsaKeyPair.publicKey);
    const sig2 = await crypto.subtle.exportKey('spki', keys2.ecdsaKeyPair.publicKey);

    const sigHex1 = Array.from(new Uint8Array(sig1)).map(b => b.toString(16).padStart(2, '0')).join('');
    const sigHex2 = Array.from(new Uint8Array(sig2)).map(b => b.toString(16).padStart(2, '0')).join('');

    expect(sigHex1).toBe(sigHex2);
  });

  test('different phrases → different keys', async () => {
    const phrase1 = spm.generate().mnemonic;
    const phrase2 = spm.generate().mnemonic;

    const keys1 = await spm.deriveKeys(phrase1);
    const keys2 = await spm.deriveKeys(phrase2);

    const pub1 = await crypto.subtle.exportKey('spki', keys1.ecdhKeyPair.publicKey);
    const pub2 = await crypto.subtle.exportKey('spki', keys2.ecdhKeyPair.publicKey);

    const hex1 = Array.from(new Uint8Array(pub1)).map(b => b.toString(16).padStart(2, '0')).join('');
    const hex2 = Array.from(new Uint8Array(pub2)).map(b => b.toString(16).padStart(2, '0')).join('');

    expect(hex1).not.toBe(hex2);
  });

  test('derived ECDH keys can derive shared secrets', async () => {
    const { mnemonic } = spm.generate();
    const aliceKeys = await spm.deriveKeys(mnemonic);

    // Bob has separate keys
    const bobKeys = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );

    // Derive shared secret from both sides
    const aliceSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: bobKeys.publicKey },
      aliceKeys.ecdhKeyPair.privateKey,
      256
    );

    const bobSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: aliceKeys.ecdhKeyPair.publicKey },
      bobKeys.privateKey,
      256
    );

    const aHex = Array.from(new Uint8Array(aliceSecret)).map(b => b.toString(16).padStart(2, '0')).join('');
    const bHex = Array.from(new Uint8Array(bobSecret)).map(b => b.toString(16).padStart(2, '0')).join('');

    expect(aHex).toBe(bHex);
  });

  test('derived ECDSA keys can sign and verify', async () => {
    const { mnemonic } = spm.generate();
    const keys = await spm.deriveKeys(mnemonic);

    const data = new TextEncoder().encode('Test message for signing');

    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.ecdsaKeyPair.privateKey,
      data
    );

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.ecdsaKeyPair.publicKey,
      signature,
      data
    );

    expect(valid).toBe(true);
  });

  test('rejects invalid phrase for key derivation', async () => {
    await expect(spm.deriveKeys('invalid phrase here')).rejects.toThrow();
  });
});

describe('SeedPhraseManager - Identity Integration', () => {
  test('full flow: generate seed → derive keys → create identity → recover from seed', async () => {
    const spm = new SeedPhraseManager();
    const im = new IdentityManager();

    // Step 1: Generate seed phrase
    const { mnemonic } = spm.generate();

    // Step 2: Derive keys from seed
    const keys = await spm.deriveKeys(mnemonic);

    // Step 3: Create identity
    const identity = await im.createIdentity(
      'Alice',
      keys.ecdhKeyPair.publicKey,
      keys.ecdsaKeyPair.publicKey,
      'Phone'
    );

    // Step 4: Simulate device loss — derive keys from seed again
    const recoveredKeys = await spm.deriveKeys(mnemonic);

    // Step 5: Create identity from recovered keys
    const recoveredIdentity = await im.createIdentity(
      'Alice', // User remembers their name
      recoveredKeys.ecdhKeyPair.publicKey,
      recoveredKeys.ecdsaKeyPair.publicKey,
      'New Phone'
    );

    // Same identity!
    expect(recoveredIdentity.identityId).toBe(identity.identityId);
    expect(recoveredIdentity.publicKey).toBe(identity.publicKey);
    expect(recoveredIdentity.signingKey).toBe(identity.signingKey);
  });

  test('verify phrase against identity ID', async () => {
    const spm = new SeedPhraseManager();
    const im = new IdentityManager();

    const { mnemonic } = spm.generate();
    const keys = await spm.deriveKeys(mnemonic);
    const identity = await im.createIdentity('Alice', keys.ecdhKeyPair.publicKey, keys.ecdsaKeyPair.publicKey);

    // Correct phrase
    expect(await spm.verifyPhrase(mnemonic, identity.identityId)).toBe(true);

    // Wrong phrase
    const other = spm.generate().mnemonic;
    expect(await spm.verifyPhrase(other, identity.identityId)).toBe(false);
  });

  test('multi-device from seed: both devices derive same shared secret with peer', async () => {
    const spm = new SeedPhraseManager();
    const { mnemonic } = spm.generate();

    // Device 1: derive keys from seed
    const device1Keys = await spm.deriveKeys(mnemonic);

    // Device 2: derive keys from same seed (new device)
    const device2Keys = await spm.deriveKeys(mnemonic);

    // External peer
    const peerKeys = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );

    // Both devices derive same shared secret with the peer
    const secret1 = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerKeys.publicKey },
      device1Keys.ecdhKeyPair.privateKey,
      256
    );

    const secret2 = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerKeys.publicKey },
      device2Keys.ecdhKeyPair.privateKey,
      256
    );

    const hex1 = Array.from(new Uint8Array(secret1)).map(b => b.toString(16).padStart(2, '0')).join('');
    const hex2 = Array.from(new Uint8Array(secret2)).map(b => b.toString(16).padStart(2, '0')).join('');

    expect(hex1).toBe(hex2); // Same identity, same secrets!
  });
});
