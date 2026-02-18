/**
 * Crypto layer unit tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { CryptoManager, MessageCipher, KeyStore } from '../../src/crypto';

describe('CryptoManager', () => {
  let crypto: CryptoManager;

  beforeEach(() => {
    crypto = new CryptoManager();
  });

  test('generates valid ECDH key pair', async () => {
    const keyPair = await crypto.generateKeyPair();
    
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.publicKey.type).toBe('public');
    expect(keyPair.privateKey.type).toBe('private');
  });

  test('exports and imports public key', async () => {
    const keyPair = await crypto.generateKeyPair();
    const exported = await crypto.exportPublicKey(keyPair.publicKey);
    
    expect(typeof exported).toBe('string');
    expect(exported.length).toBeGreaterThan(0);
    
    const imported = await crypto.importPublicKey(exported);
    expect(imported.type).toBe('public');
  });

  test('derives shared secret from two key pairs', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();
    
    const aliceKeys = await alice.generateKeyPair();
    const bobKeys = await bob.generateKeyPair();
    
    // Alice derives shared secret using Bob's public key
    const aliceShared = await alice.deriveSharedSecret(bobKeys.publicKey, aliceKeys.privateKey);
    
    // Bob derives shared secret using Alice's public key
    const bobShared = await bob.deriveSharedSecret(aliceKeys.publicKey, bobKeys.privateKey);
    
    // Both should produce the same AES-GCM key
    expect(aliceShared).toBeDefined();
    expect(bobShared).toBeDefined();
    expect(aliceShared.type).toBe('secret');
    expect(bobShared.type).toBe('secret');
  });

  test('generates valid ECDSA signing key pair', async () => {
    const signingKeys = await crypto.generateSigningKeyPair();
    
    expect(signingKeys.publicKey).toBeDefined();
    expect(signingKeys.privateKey).toBeDefined();
    expect(signingKeys.publicKey.type).toBe('public');
    expect(signingKeys.privateKey.type).toBe('private');
  });

  test('serializes and deserializes ECDH key pair', async () => {
    const keyPair = await crypto.generateKeyPair();
    const serialized = await crypto.serializeKeyPair(keyPair);
    
    expect(serialized.publicKey).toBeDefined();
    expect(serialized.privateKey).toBeDefined();
    expect(typeof serialized.publicKey).toBe('string');
    expect(typeof serialized.privateKey).toBe('string');
    
    const deserialized = await crypto.deserializeKeyPair(
      serialized,
      'ECDH',
      ['deriveKey', 'deriveBits'] as any
    );
    
    expect(deserialized.publicKey.type).toBe('public');
    expect(deserialized.privateKey.type).toBe('private');
  });

  test('serializes and deserializes ECDSA key pair', async () => {
    const keyPair = await crypto.generateSigningKeyPair();
    const serialized = await crypto.serializeKeyPair(keyPair);
    
    const deserialized = await crypto.deserializeKeyPair(
      serialized,
      'ECDSA',
      ['sign', 'verify'] as any
    );
    
    expect(deserialized.publicKey.type).toBe('public');
    expect(deserialized.privateKey.type).toBe('private');
  });
});

describe('MessageCipher', () => {
  let cipher: MessageCipher;
  let crypto: CryptoManager;

  beforeEach(() => {
    cipher = new MessageCipher();
    crypto = new CryptoManager();
  });

  test('encrypts and decrypts message', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();
    
    const aliceKeys = await alice.generateKeyPair();
    const bobKeys = await bob.generateKeyPair();
    
    const sharedSecret = await alice.deriveSharedSecret(bobKeys.publicKey, aliceKeys.privateKey);
    
    const plaintext = 'Hello, Bob! This is a secret message.';
    const encrypted = await cipher.encrypt(plaintext, sharedSecret);
    
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();
    expect(typeof encrypted.ciphertext).toBe('string');
    
    const bobSharedSecret = await bob.deriveSharedSecret(aliceKeys.publicKey, bobKeys.privateKey);
    const decrypted = await cipher.decrypt(encrypted, bobSharedSecret);
    
    expect(decrypted).toBe(plaintext);
  });

  test('different IVs produce different ciphertexts', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();
    
    const aliceKeys = await alice.generateKeyPair();
    const bobKeys = await bob.generateKeyPair();
    const sharedSecret = await alice.deriveSharedSecret(bobKeys.publicKey, aliceKeys.privateKey);
    
    const plaintext = 'Same message';
    const encrypted1 = await cipher.encrypt(plaintext, sharedSecret);
    const encrypted2 = await cipher.encrypt(plaintext, sharedSecret);
    
    // Different IVs should produce different ciphertexts
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
  });

  test('fails to decrypt with wrong key', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();
    const eve = new CryptoManager();
    
    const aliceKeys = await alice.generateKeyPair();
    const bobKeys = await bob.generateKeyPair();
    const eveKeys = await eve.generateKeyPair();
    
    const aliceBobSecret = await alice.deriveSharedSecret(bobKeys.publicKey, aliceKeys.privateKey);
    const plaintext = 'Secret message';
    const encrypted = await cipher.encrypt(plaintext, aliceBobSecret);
    
    // Eve tries to decrypt with wrong key
    const eveSharedSecret = await eve.deriveSharedSecret(aliceKeys.publicKey, eveKeys.privateKey);
    
    await expect(cipher.decrypt(encrypted, eveSharedSecret)).rejects.toThrow();
  });

  test('signs and verifies message', async () => {
    const signingKeys = await crypto.generateSigningKeyPair();
    const data = 'Important message that needs verification';
    
    const signature = await cipher.sign(data, signingKeys.privateKey);
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);
    
    const isValid = await cipher.verify(data, signature, signingKeys.publicKey);
    expect(isValid).toBe(true);
  });

  test('detects tampered signature', async () => {
    const signingKeys = await crypto.generateSigningKeyPair();
    const data = 'Original message';
    
    const signature = await cipher.sign(data, signingKeys.privateKey);
    
    // Tamper with data
    const tamperedData = 'Tampered message';
    const isValid = await cipher.verify(tamperedData, signature, signingKeys.publicKey);
    
    expect(isValid).toBe(false);
  });

  test('creates and verifies signed message', async () => {
    const signingKeys = await crypto.generateSigningKeyPair();
    const data = 'Signed message content';
    
    const signedMessage = await cipher.createSignedMessage(data, signingKeys.privateKey);
    
    expect(signedMessage.data).toBeDefined();
    expect(signedMessage.signature).toBeDefined();
    
    const verified = await cipher.verifySignedMessage(signedMessage, signingKeys.publicKey);
    expect(verified).toBe(data);
  });

  test('returns null for invalid signed message', async () => {
    const signingKeys = await crypto.generateSigningKeyPair();
    const data = 'Original data';
    
    const signedMessage = await cipher.createSignedMessage(data, signingKeys.privateKey);
    
    // Tamper with signature
    signedMessage.signature = signedMessage.signature.slice(0, -5) + 'xxxxx';
    
    const verified = await cipher.verifySignedMessage(signedMessage, signingKeys.publicKey);
    expect(verified).toBeNull();
  });
});

describe('KeyStore', () => {
  let keyStore: KeyStore;
  let crypto: CryptoManager;

  beforeEach(async () => {
    crypto = new CryptoManager();
    keyStore = new KeyStore(crypto);
    await keyStore.init();
    await keyStore.clearAll(); // Clean slate for each test
  });

  test('stores and retrieves ECDH key pair', async () => {
    const keyPair = await crypto.generateKeyPair();
    await keyStore.storeECDHKeyPair(keyPair);
    
    const retrieved = await keyStore.getECDHKeyPair();
    expect(retrieved).not.toBeNull();
    expect(retrieved!.publicKey.type).toBe('public');
    expect(retrieved!.privateKey.type).toBe('private');
  });

  test('stores and retrieves ECDSA key pair', async () => {
    const signingKeys = await crypto.generateSigningKeyPair();
    await keyStore.storeECDSAKeyPair(signingKeys);
    
    const retrieved = await keyStore.getECDSAKeyPair();
    expect(retrieved).not.toBeNull();
    expect(retrieved!.publicKey.type).toBe('public');
    expect(retrieved!.privateKey.type).toBe('private');
  });

  test('stores and retrieves peer public key', async () => {
    const keyPair = await crypto.generateKeyPair();
    const publicKey = await crypto.exportPublicKey(keyPair.publicKey);
    
    const peerId = 'peer-123';
    await keyStore.storePeerPublicKey(peerId, publicKey);
    
    const retrieved = await keyStore.getPeerPublicKey(peerId);
    expect(retrieved).toBe(publicKey);
  });

  test('returns null for non-existent key', async () => {
    const retrieved = await keyStore.getECDHKeyPair();
    expect(retrieved).toBeNull();
  });

  test('clears all keys', async () => {
    const keyPair = await crypto.generateKeyPair();
    await keyStore.storeECDHKeyPair(keyPair);
    
    await keyStore.clearAll();
    
    const retrieved = await keyStore.getECDHKeyPair();
    expect(retrieved).toBeNull();
  });
});

describe('End-to-End Encryption Flow', () => {
  test('Alice and Bob can exchange encrypted messages', async () => {
    // Setup
    const aliceCrypto = new CryptoManager();
    const bobCrypto = new CryptoManager();
    const cipher = new MessageCipher();
    
    // Generate key pairs
    const aliceKeys = await aliceCrypto.generateKeyPair();
    const bobKeys = await bobCrypto.generateKeyPair();
    
    // Exchange public keys (simulated)
    const alicePublicExported = await aliceCrypto.exportPublicKey(aliceKeys.publicKey);
    const bobPublicExported = await bobCrypto.exportPublicKey(bobKeys.publicKey);
    
    const bobPublicImported = await aliceCrypto.importPublicKey(bobPublicExported);
    const alicePublicImported = await bobCrypto.importPublicKey(alicePublicExported);
    
    // Derive shared secrets
    const aliceShared = await aliceCrypto.deriveSharedSecret(bobPublicImported, aliceKeys.privateKey);
    const bobShared = await bobCrypto.deriveSharedSecret(alicePublicImported, bobKeys.privateKey);
    
    // Alice sends message to Bob
    const message = 'Hey Bob, this is encrypted!';
    const encrypted = await cipher.encrypt(message, aliceShared);
    
    // Bob decrypts message from Alice
    const decrypted = await cipher.decrypt(encrypted, bobShared);
    
    expect(decrypted).toBe(message);
  });
});
