/**
 * Identity tests — creation, export/import, safety numbers, device linking, QR
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { IdentityManager } from '../../src/identity/Identity';
import type { DecentIdentity, IdentityBundle } from '../../src/identity/Identity';

// Helper to generate key pairs using Web Crypto
async function generateECDHKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

async function generateECDSAKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
}

describe('IdentityManager - Creation', () => {
  let im: IdentityManager;

  beforeEach(() => {
    im = new IdentityManager();
  });

  test('creates identity with correct fields', async () => {
    const ecdh = await generateECDHKeyPair();
    const ecdsa = await generateECDSAKeyPair();

    const identity = await im.createIdentity('Alice', ecdh.publicKey, ecdsa.publicKey, 'MacBook');

    expect(identity.displayName).toBe('Alice');
    expect(identity.identityId).toHaveLength(16); // 8 bytes hex
    expect(identity.publicKey).toBeTruthy();
    expect(identity.signingKey).toBeTruthy();
    expect(identity.deviceGroup).toHaveLength(1);
    expect(identity.deviceId).toBeTruthy();
    expect(identity.deviceLabel).toBe('MacBook');
    expect(identity.createdAt).toBeGreaterThan(0);
  });

  test('same key produces same identity ID', async () => {
    const ecdh = await generateECDHKeyPair();
    const ecdsa = await generateECDSAKeyPair();

    const id1 = await im.createIdentity('Alice', ecdh.publicKey, ecdsa.publicKey);
    const id2 = await im.createIdentity('Bob', ecdh.publicKey, ecdsa.publicKey); // Same key, different name

    expect(id1.identityId).toBe(id2.identityId); // Identity is key-based, not name-based
  });

  test('different keys produce different identity IDs', async () => {
    const ecdh1 = await generateECDHKeyPair();
    const ecdh2 = await generateECDHKeyPair();
    const ecdsa = await generateECDSAKeyPair();

    const id1 = await im.createIdentity('Alice', ecdh1.publicKey, ecdsa.publicKey);
    const id2 = await im.createIdentity('Alice', ecdh2.publicKey, ecdsa.publicKey);

    expect(id1.identityId).not.toBe(id2.identityId);
  });
});

describe('IdentityManager - Export/Import', () => {
  let im: IdentityManager;
  let ecdh: CryptoKeyPair;
  let ecdsa: CryptoKeyPair;
  let identity: DecentIdentity;

  beforeEach(async () => {
    im = new IdentityManager();
    ecdh = await generateECDHKeyPair();
    ecdsa = await generateECDSAKeyPair();
    identity = await im.createIdentity('Alice', ecdh.publicKey, ecdsa.publicKey, 'Laptop');
  });

  test('exports identity as encrypted bundle', async () => {
    const bundle = await im.exportIdentity(identity, ecdh.privateKey, ecdsa.privateKey, 'mypassword');

    expect(bundle.version).toBe(1);
    expect(bundle.identity.displayName).toBe('Alice');
    expect(bundle.encryptedKeys.ciphertext).toBeTruthy();
    expect(bundle.encryptedKeys.iv).toBeTruthy();
    expect(bundle.encryptedKeys.salt).toBeTruthy();
    expect(bundle.encryptedKeys.iterations).toBe(100000);
  });

  test('imports identity with correct passphrase', async () => {
    const bundle = await im.exportIdentity(identity, ecdh.privateKey, ecdsa.privateKey, 'correctpassword');
    const imported = await im.importIdentity(bundle, 'correctpassword');

    expect(imported.identity.displayName).toBe('Alice');
    expect(imported.identity.identityId).toBe(identity.identityId);
    expect(imported.ecdhKeyPair.publicKey).toBeTruthy();
    expect(imported.ecdhKeyPair.privateKey).toBeTruthy();
    expect(imported.ecdsaKeyPair.publicKey).toBeTruthy();
    expect(imported.ecdsaKeyPair.privateKey).toBeTruthy();
  });

  test('rejects wrong passphrase', async () => {
    const bundle = await im.exportIdentity(identity, ecdh.privateKey, ecdsa.privateKey, 'correctpassword');

    await expect(im.importIdentity(bundle, 'wrongpassword')).rejects.toThrow('Invalid passphrase');
  });

  test('imported keys can encrypt/decrypt', async () => {
    const bundle = await im.exportIdentity(identity, ecdh.privateKey, ecdsa.privateKey, 'testpass');
    const imported = await im.importIdentity(bundle, 'testpass');

    // Generate a second peer's keys
    const peerEcdh = await generateECDHKeyPair();

    // Derive shared secret from imported private + peer public
    const sharedSecret = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerEcdh.publicKey },
      imported.ecdhKeyPair.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    // Encrypt a message
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sharedSecret,
      new TextEncoder().encode('Hello from imported identity!')
    );

    // Derive same shared secret from other side
    const peerSharedSecret = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: imported.ecdhKeyPair.publicKey },
      peerEcdh.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      peerSharedSecret,
      encrypted
    );

    expect(new TextDecoder().decode(decrypted)).toBe('Hello from imported identity!');
  });

  test('imported signing keys can sign/verify', async () => {
    const bundle = await im.exportIdentity(identity, ecdh.privateKey, ecdsa.privateKey, 'testpass');
    const imported = await im.importIdentity(bundle, 'testpass');

    const data = new TextEncoder().encode('Sign this message');

    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      imported.ecdsaKeyPair.privateKey,
      data
    );

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      imported.ecdsaKeyPair.publicKey,
      signature,
      data
    );

    expect(valid).toBe(true);
  });

  test('bundle is JSON-serializable (for QR/file)', async () => {
    const bundle = await im.exportIdentity(identity, ecdh.privateKey, ecdsa.privateKey, 'pass');
    
    const json = JSON.stringify(bundle);
    const parsed = JSON.parse(json) as IdentityBundle;

    // Import from parsed JSON
    const imported = await im.importIdentity(parsed, 'pass');
    expect(imported.identity.identityId).toBe(identity.identityId);
  });
});

describe('IdentityManager - Safety Numbers', () => {
  let im: IdentityManager;

  beforeEach(() => {
    im = new IdentityManager();
  });

  test('generates 60-digit safety number', async () => {
    const safety = await im.generateSafetyNumber('key-alice', 'key-bob');

    expect(safety.numeric).toHaveLength(60);
    expect(safety.numeric).toMatch(/^\d{60}$/);
  });

  test('same keys produce same safety number on both sides', async () => {
    const safetyAlice = await im.generateSafetyNumber('key-alice', 'key-bob');
    const safetyBob = await im.generateSafetyNumber('key-bob', 'key-alice'); // Reversed!

    expect(safetyAlice.numeric).toBe(safetyBob.numeric);
  });

  test('different keys produce different safety numbers', async () => {
    const safety1 = await im.generateSafetyNumber('key-alice', 'key-bob');
    const safety2 = await im.generateSafetyNumber('key-alice', 'key-charlie');

    expect(safety1.numeric).not.toBe(safety2.numeric);
  });

  test('formatted as 12 groups of 5 digits', async () => {
    const safety = await im.generateSafetyNumber('key-a', 'key-b');

    const lines = safety.formatted.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].split(' ')).toHaveLength(6); // 6 groups per line
    expect(lines[1].split(' ')).toHaveLength(6);
  });

  test('QR data format', async () => {
    const safety = await im.generateSafetyNumber('key-a', 'key-b');
    expect(safety.qrData).toStartWith('mesh-safety:');
    expect(safety.qrData).toContain(safety.numeric);
  });
});

describe('IdentityManager - Device Linking', () => {
  let im: IdentityManager;
  let identity: DecentIdentity;

  beforeEach(async () => {
    im = new IdentityManager();
    const ecdh = await generateECDHKeyPair();
    const ecdsa = await generateECDSAKeyPair();
    identity = await im.createIdentity('Alice', ecdh.publicKey, ecdsa.publicKey, 'Primary');
  });

  test('creates device link challenge', async () => {
    const tempKey = await generateECDHKeyPair();
    const challenge = await im.createDeviceLinkChallenge(identity.identityId, tempKey.publicKey);

    expect(challenge.identityId).toBe(identity.identityId);
    expect(challenge.nonce).toBeTruthy();
    expect(challenge.timestamp).toBeGreaterThan(0);
    expect(challenge.tempPublicKey).toBeTruthy();
  });

  test('validates fresh challenge', async () => {
    const tempKey = await generateECDHKeyPair();
    const challenge = await im.createDeviceLinkChallenge(identity.identityId, tempKey.publicKey);

    const result = im.validateDeviceLinkChallenge(challenge);
    expect(result.valid).toBe(true);
  });

  test('rejects expired challenge', () => {
    const challenge = {
      identityId: identity.identityId,
      nonce: 'test-nonce',
      timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
      tempPublicKey: 'test-key',
    };

    const result = im.validateDeviceLinkChallenge(challenge);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  test('rejects invalid challenge format', () => {
    const result = im.validateDeviceLinkChallenge({
      identityId: '',
      nonce: '',
      timestamp: Date.now(),
      tempPublicKey: '',
    });

    expect(result.valid).toBe(false);
  });

  test('adds device to group', () => {
    expect(identity.deviceGroup).toHaveLength(1);

    const updated = im.addDevice(identity, 'device-2', 'iPhone');
    expect(updated.deviceGroup).toHaveLength(2);
    expect(updated.deviceGroup).toContain('device-2');
  });

  test('removes device from group', () => {
    let updated = im.addDevice(identity, 'device-2', 'iPhone');
    updated = im.addDevice(updated, 'device-3', 'iPad');
    expect(updated.deviceGroup).toHaveLength(3);

    updated = im.removeDevice(updated, 'device-2');
    expect(updated.deviceGroup).toHaveLength(2);
    expect(updated.deviceGroup).not.toContain('device-2');
  });

  test('device operations are immutable', () => {
    const original = { ...identity, deviceGroup: [...identity.deviceGroup] };
    im.addDevice(identity, 'new-device', 'New');

    expect(identity.deviceGroup).toHaveLength(original.deviceGroup.length);
  });
});

describe('IdentityManager - QR Code Data', () => {
  let im: IdentityManager;
  let identity: DecentIdentity;

  beforeEach(async () => {
    im = new IdentityManager();
    const ecdh = await generateECDHKeyPair();
    const ecdsa = await generateECDSAKeyPair();
    identity = await im.createIdentity('Alice', ecdh.publicKey, ecdsa.publicKey);
  });

  test('generates parseable QR data for identity sharing', () => {
    const qrData = im.generateQRData(identity);
    const parsed = JSON.parse(qrData);

    expect(parsed.type).toBe('mesh-identity');
    expect(parsed.id).toBe(identity.identityId);
    expect(parsed.name).toBe('Alice');
    expect(parsed.publicKey).toBe(identity.publicKey);
    expect(parsed.signingKey).toBe(identity.signingKey);
  });

  test('generates parseable QR data for device linking', async () => {
    const ecdh = await generateECDHKeyPair();
    const ecdsa = await generateECDSAKeyPair();
    const bundle = await im.exportIdentity(identity, ecdh.privateKey, ecdsa.privateKey, 'pass');

    const qrData = await im.generateDeviceLinkQR(bundle);
    const parsed = JSON.parse(qrData);

    expect(parsed.type).toBe('mesh-device-link');
    expect(parsed.bundle.version).toBe(1);
    expect(parsed.bundle.identity.displayName).toBe('Alice');
  });
});

describe('IdentityManager - Full Multi-Device Flow', () => {
  test('complete flow: create → export → import on new device → both work', async () => {
    const im = new IdentityManager();

    // Device 1: Create identity
    const ecdh = await generateECDHKeyPair();
    const ecdsa = await generateECDSAKeyPair();
    const identity = await im.createIdentity('Alice', ecdh.publicKey, ecdsa.publicKey, 'Laptop');

    // Device 1: Export for device linking
    const bundle = await im.exportIdentity(identity, ecdh.privateKey, ecdsa.privateKey, 'secure-passphrase-123');

    // Simulate QR code transfer (serialize → deserialize)
    const qrPayload = JSON.stringify(bundle);
    const scannedBundle = JSON.parse(qrPayload) as IdentityBundle;

    // Device 2: Import identity
    const imported = await im.importIdentity(scannedBundle, 'secure-passphrase-123');

    // Verify same identity
    expect(imported.identity.identityId).toBe(identity.identityId);
    expect(imported.identity.displayName).toBe('Alice');

    // Both devices can derive same shared secret with a third peer
    const peerEcdh = await generateECDHKeyPair();

    const device1Secret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerEcdh.publicKey },
      ecdh.privateKey,
      256
    );

    const device2Secret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerEcdh.publicKey },
      imported.ecdhKeyPair.privateKey,
      256
    );

    // Same shared secret from both devices!
    const d1Hex = Array.from(new Uint8Array(device1Secret)).map(b => b.toString(16).padStart(2, '0')).join('');
    const d2Hex = Array.from(new Uint8Array(device2Secret)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(d1Hex).toBe(d2Hex);
  });
});
