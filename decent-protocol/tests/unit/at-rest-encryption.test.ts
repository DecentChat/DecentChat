/**
 * T3.5: At-Rest Encryption tests
 *
 * Tests the AtRestEncryption class — AES-GCM-256 encryption/decryption
 * of IndexedDB message content, derived from a master seed.
 *
 * Note: requires SubtleCrypto — Bun provides it globally.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { AtRestEncryption } from '../../src/storage/AtRestEncryption';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a fresh 32-byte master seed (like SeedPhrase.deriveMasterSeed()) */
function makeMasterSeed(): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

async function makeReadyEnc(seed?: ArrayBuffer): Promise<AtRestEncryption> {
  const enc = new AtRestEncryption();
  await enc.init(seed ?? makeMasterSeed());
  return enc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AtRestEncryption — init and ready state', () => {
  test('not ready before init()', () => {
    const enc = new AtRestEncryption();
    expect(enc.ready).toBe(false);
  });

  test('ready after init()', async () => {
    const enc = await makeReadyEnc();
    expect(enc.ready).toBe(true);
  });

  test('clear() resets ready to false', async () => {
    const enc = await makeReadyEnc();
    enc.clear();
    expect(enc.ready).toBe(false);
  });

  test('accepts any 32-byte master seed', async () => {
    const seed = new Uint8Array(32).fill(0xAB).buffer;
    const enc = new AtRestEncryption();
    let threw = false;
    try { await enc.init(seed); } catch { threw = true; }
    expect(threw).toBe(false);
    expect(enc.ready).toBe(true);
  });
});

describe('AtRestEncryption — encrypt()', () => {
  let enc: AtRestEncryption;

  beforeEach(async () => { enc = await makeReadyEnc(); });

  test('encrypted value starts with enc:v1: prefix', async () => {
    const result = await enc.encrypt('hello world');
    expect(result.startsWith('enc:v1:')).toBe(true);
  });

  test('encrypted value differs from plaintext', async () => {
    const plaintext = 'hello world';
    const encrypted = await enc.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
  });

  test('encrypting same plaintext twice produces different ciphertext (random IV)', async () => {
    const a = await enc.encrypt('same text');
    const b = await enc.encrypt('same text');
    expect(a).not.toBe(b);
  });

  test('returns plaintext unchanged when not ready', async () => {
    const notReady = new AtRestEncryption(); // not init'd
    const result = await notReady.encrypt('test message');
    expect(result).toBe('test message');
  });

  test('returns plaintext unchanged after clear()', async () => {
    enc.clear();
    const result = await enc.encrypt('test');
    expect(result).toBe('test');
  });

  test('encrypts empty string', async () => {
    const result = await enc.encrypt('');
    expect(result.startsWith('enc:v1:')).toBe(true);
  });

  test('encrypts long content', async () => {
    const long = 'a'.repeat(10_000);
    const result = await enc.encrypt(long);
    expect(result.startsWith('enc:v1:')).toBe(true);
  });

  test('encrypts unicode content', async () => {
    const unicode = '🔐 šifrovanie správ ❤️ 中文测试';
    const result = await enc.encrypt(unicode);
    expect(result.startsWith('enc:v1:')).toBe(true);
  });
});

describe('AtRestEncryption — decrypt()', () => {
  let enc: AtRestEncryption;

  beforeEach(async () => { enc = await makeReadyEnc(); });

  test('round-trip: encrypt then decrypt returns original', async () => {
    const plaintext = 'hello world';
    const encrypted = await enc.encrypt(plaintext);
    const decrypted = await enc.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test('round-trip with empty string', async () => {
    const encrypted = await enc.encrypt('');
    expect(await enc.decrypt(encrypted)).toBe('');
  });

  test('round-trip with unicode', async () => {
    const text = '🔐 שלום עולם こんにちは';
    expect(await enc.decrypt(await enc.encrypt(text))).toBe(text);
  });

  test('round-trip with long content', async () => {
    const text = 'x'.repeat(5_000);
    expect(await enc.decrypt(await enc.encrypt(text))).toBe(text);
  });

  test('legacy plaintext (no prefix) returned as-is', async () => {
    const legacy = 'this is an old unencrypted message';
    expect(await enc.decrypt(legacy)).toBe(legacy);
  });

  test('legacy empty string returned as-is', async () => {
    expect(await enc.decrypt('')).toBe('');
  });

  test('legacy message with colons returned as-is (no false positive)', async () => {
    const msg = 'check https://example.com:8080 for details';
    expect(await enc.decrypt(msg)).toBe(msg);
  });

  test('returns placeholder when key not ready but content is encrypted', async () => {
    const encrypted = await enc.encrypt('secret');
    const noKey = new AtRestEncryption(); // not init'd
    const result = await noKey.decrypt(encrypted);
    expect(result).toBe('[encrypted — unlock required]');
  });

  test('returns error string on malformed ciphertext', async () => {
    const malformed = 'enc:v1:notvalidbase64!!!:alsoinvalid!!!';
    const result = await enc.decrypt(malformed);
    expect(result).toBe('[decryption failed]');
  });

  test('cannot decrypt with different key (wrong seed)', async () => {
    const enc2 = await makeReadyEnc(); // different seed
    const encrypted = await enc.encrypt('secret message');
    const result = await enc2.decrypt(encrypted);
    // Should either return error string or throw-caught '[decryption failed]'
    expect(result).toBe('[decryption failed]');
  });
});

describe('AtRestEncryption — isEncrypted()', () => {
  test('returns true for enc:v1: prefixed strings', () => {
    expect(AtRestEncryption.isEncrypted('enc:v1:abc:def')).toBe(true);
  });

  test('returns false for legacy plaintext', () => {
    expect(AtRestEncryption.isEncrypted('hello world')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(AtRestEncryption.isEncrypted('')).toBe(false);
  });

  test('returns false for partial prefix', () => {
    expect(AtRestEncryption.isEncrypted('enc:')).toBe(false);
    expect(AtRestEncryption.isEncrypted('enc:v1')).toBe(false);
  });

  test('returns false for URL-like strings', () => {
    expect(AtRestEncryption.isEncrypted('https://example.com')).toBe(false);
  });
});

describe('AtRestEncryption — same seed produces same key', () => {
  test('two instances with same seed can decrypt each other\'s ciphertext', async () => {
    const seed = makeMasterSeed();

    const enc1 = new AtRestEncryption();
    await enc1.init(seed);

    const enc2 = new AtRestEncryption();
    await enc2.init(seed);

    const encrypted = await enc1.encrypt('cross-instance test');
    const decrypted = await enc2.decrypt(encrypted);

    expect(decrypted).toBe('cross-instance test');
  });

  test('reinitializing with same seed restores decryption capability', async () => {
    const seed = makeMasterSeed();
    const enc = new AtRestEncryption();
    await enc.init(seed);

    const encrypted = await enc.encrypt('restore test');
    enc.clear();

    // Re-init with same seed
    await enc.init(seed);
    expect(await enc.decrypt(encrypted)).toBe('restore test');
  });
});
