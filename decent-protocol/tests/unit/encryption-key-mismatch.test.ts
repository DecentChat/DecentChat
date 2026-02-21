/**
 * GAP 12: Encryption Key Mismatch — Wrong seed on re-import
 *
 * Scenario: Write encrypted IndexedDB with seed X, re-import seed Y.
 *
 * Verify: graceful failure on decrypt (no crash, clear error), system can
 * still write new data with new key.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { AtRestEncryption } from '../../src/storage/AtRestEncryption';

function makeSeed(): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

async function makeReady(seed?: ArrayBuffer): Promise<AtRestEncryption> {
  const enc = new AtRestEncryption();
  await enc.init(seed ?? makeSeed());
  return enc;
}

describe('Encryption Key Mismatch — Wrong seed re-import', () => {
  const seedX = new Uint8Array(32).fill(0x11).buffer;
  const seedY = new Uint8Array(32).fill(0x22).buffer;

  test('data encrypted with seed X cannot be decrypted with seed Y', async () => {
    const encX = await makeReady(seedX);
    const encrypted = await encX.encrypt('Secret message');

    const encY = await makeReady(seedY);
    const result = await encY.decrypt(encrypted);

    expect(result).toBe('[decryption failed]');
  });

  test('no crash on key mismatch — returns error string', async () => {
    const encX = await makeReady(seedX);
    const encY = await makeReady(seedY);

    // Encrypt multiple messages with seed X
    const ciphertexts = [];
    for (let i = 0; i < 10; i++) {
      ciphertexts.push(await encX.encrypt(`Message ${i}`));
    }

    // Try decrypting all with seed Y — none should crash
    for (const ct of ciphertexts) {
      let threw = false;
      let result: string;
      try {
        result = await encY.decrypt(ct);
      } catch {
        threw = true;
        result = '';
      }
      expect(threw).toBe(false);
      expect(result).toBe('[decryption failed]');
    }
  });

  test('system can write new data with new key after mismatch', async () => {
    const encX = await makeReady(seedX);
    const oldEncrypted = await encX.encrypt('Old data');

    // Switch to new key (seed Y)
    const encY = await makeReady(seedY);

    // Old data unreadable
    expect(await encY.decrypt(oldEncrypted)).toBe('[decryption failed]');

    // But new data can be written and read with new key
    const newEncrypted = await encY.encrypt('New data with new key');
    expect(AtRestEncryption.isEncrypted(newEncrypted)).toBe(true);

    const decrypted = await encY.decrypt(newEncrypted);
    expect(decrypted).toBe('New data with new key');
  });

  test('clear() then re-init with wrong seed gives clear error', async () => {
    const enc = await makeReady(seedX);
    const encrypted = await enc.encrypt('Important data');

    // Clear and re-init with wrong seed
    enc.clear();
    expect(enc.ready).toBe(false);

    await enc.init(seedY);
    expect(enc.ready).toBe(true);

    const result = await enc.decrypt(encrypted);
    expect(result).toBe('[decryption failed]');
  });

  test('encrypted content without key shows unlock-required message', async () => {
    const enc = await makeReady(seedX);
    const encrypted = await enc.encrypt('Locked data');

    // Simulate app restart without providing seed
    const noKey = new AtRestEncryption();
    expect(noKey.ready).toBe(false);

    const result = await noKey.decrypt(encrypted);
    expect(result).toBe('[encrypted — unlock required]');
  });

  test('same seed produces same key: cross-instance decrypt works', async () => {
    const enc1 = await makeReady(seedX);
    const encrypted = await enc1.encrypt('Cross-instance test');

    const enc2 = await makeReady(seedX); // Same seed
    const decrypted = await enc2.decrypt(encrypted);

    expect(decrypted).toBe('Cross-instance test');
  });

  test('legacy unencrypted data readable regardless of key', async () => {
    const enc = await makeReady(seedY);

    // Legacy data has no enc:v1: prefix
    const legacy = 'This is unencrypted old data';
    const result = await enc.decrypt(legacy);

    expect(result).toBe(legacy);
  });

  test('malformed ciphertext returns decryption-failed', async () => {
    const enc = await makeReady(seedX);

    const malformed = 'enc:v1:bad-base64!!!:also-bad!!!';
    const result = await enc.decrypt(malformed);

    expect(result).toBe('[decryption failed]');
  });

  test('mixed old and new data: old fails, new succeeds', async () => {
    const encX = await makeReady(seedX);

    // Encrypt with old key
    const old1 = await encX.encrypt('Old message 1');
    const old2 = await encX.encrypt('Old message 2');

    // Switch to new key
    const encY = await makeReady(seedY);
    const new1 = await encY.encrypt('New message 1');
    const new2 = await encY.encrypt('New message 2');

    // Old data unreadable with new key
    expect(await encY.decrypt(old1)).toBe('[decryption failed]');
    expect(await encY.decrypt(old2)).toBe('[decryption failed]');

    // New data readable with new key
    expect(await encY.decrypt(new1)).toBe('New message 1');
    expect(await encY.decrypt(new2)).toBe('New message 2');
  });

  test('re-import correct seed restores access', async () => {
    const enc = await makeReady(seedX);
    const encrypted = await enc.encrypt('Recoverable data');

    // Wrong key
    enc.clear();
    await enc.init(seedY);
    expect(await enc.decrypt(encrypted)).toBe('[decryption failed]');

    // Correct key restored
    enc.clear();
    await enc.init(seedX);
    expect(await enc.decrypt(encrypted)).toBe('Recoverable data');
  });

  test('empty string encrypted and decrypted with wrong key', async () => {
    const encX = await makeReady(seedX);
    const encrypted = await encX.encrypt('');

    const encY = await makeReady(seedY);
    const result = await encY.decrypt(encrypted);

    // Even empty string encryption fails with wrong key
    expect(result).toBe('[decryption failed]');
  });

  test('unicode data: mismatch returns clean error, not garbled text', async () => {
    const encX = await makeReady(seedX);
    const encrypted = await encX.encrypt('🔐 Hello мир 你好世界');

    const encY = await makeReady(seedY);
    const result = await encY.decrypt(encrypted);

    // Should be clean error, not garbled bytes
    expect(result).toBe('[decryption failed]');
  });
});
