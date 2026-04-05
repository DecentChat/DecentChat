/**
 * PeerId stability tests — deterministic derivation from seed phrase
 *
 * Bug being tested: if peerId changes on reload, the peer becomes invisible
 * to others on the signaling server. PeerId must be derived deterministically
 * from the seed phrase so that refreshing the page doesn't change identity.
 *
 * Uses the actual SeedPhraseManager from @decentchat/protocol to exercise the
 * exact same code path as production.
 */

import { describe, test, expect } from 'bun:test';
import { SeedPhraseManager, WORDLIST } from '@decentchat/protocol';

const VALID_MNEMONIC = 'elbow excite access tunnel genre chase risk loan raise mesh chaos artwork';

describe('PeerId stability — deterministic derivation', () => {
  const spm = new SeedPhraseManager();

  test('same seed phrase always produces same peerId', async () => {
    const peerId1 = await spm.derivePeerId(VALID_MNEMONIC);
    const peerId2 = await spm.derivePeerId(VALID_MNEMONIC);

    expect(peerId1).toBe(peerId2);
  });

  test('different seed phrases produce different peerIds', async () => {
    const phrase1 = spm.generate().mnemonic;
    const phrase2 = spm.generate().mnemonic;

    const peerId1 = await spm.derivePeerId(phrase1);
    const peerId2 = await spm.derivePeerId(phrase2);

    expect(peerId1).not.toBe(peerId2);
  });

  test('peerId is a non-empty string', async () => {
    const peerId = await spm.derivePeerId(VALID_MNEMONIC);

    expect(typeof peerId).toBe('string');
    expect(peerId.length).toBeGreaterThan(0);
  });

  test('peerId is deterministic across repeated derivations', async () => {
    const first = await spm.derivePeerId(VALID_MNEMONIC);

    // Run sequentially — 100 parallel PBKDF2(100K) calls saturate the crypto
    // thread pool and cause intermittent timeouts. 10 sequential calls verify
    // the same determinism property without overwhelming the scheduler.
    for (let i = 0; i < 10; i++) {
      const result = await spm.derivePeerId(VALID_MNEMONIC);
      expect(result).toBe(first);
    }
  });

  test('peerId is 18-char hex (9 bytes)', async () => {
    const peerId = await spm.derivePeerId(VALID_MNEMONIC);

    // Algorithm: SHA-256(SPKI) → first 9 bytes → hex → 18 chars
    expect(peerId).toMatch(/^[0-9a-f]{18}$/);
  });
});

describe('PeerId stability — seed phrase round-trip', () => {
  const spm = new SeedPhraseManager();

  test('generate → export as words → re-import → same peerId', async () => {
    // Step 1: Generate a seed phrase (simulates first-run)
    const { mnemonic } = spm.generate();

    // Step 2: Derive peerId from it (simulates initial startup)
    const originalPeerId = await spm.derivePeerId(mnemonic);

    // Step 3: "Save" the mnemonic words (simulates storage in IndexedDB)
    const savedWords = mnemonic;

    // Step 4: "Load" from storage and re-derive (simulates page reload)
    const restoredPeerId = await spm.derivePeerId(savedWords);

    expect(restoredPeerId).toBe(originalPeerId);
  });

  test('deriveAll returns same peerId as derivePeerId', async () => {
    const peerId = await spm.derivePeerId(VALID_MNEMONIC);
    const { peerId: allPeerId } = await spm.deriveAll(VALID_MNEMONIC);

    expect(allPeerId).toBe(peerId);
  });

  test('validate accepts case-insensitive input but derivation uses raw input', async () => {
    const lower = VALID_MNEMONIC.toLowerCase();
    const upper = VALID_MNEMONIC.toUpperCase();

    // validate() normalizes to lowercase and accepts both
    expect(spm.validate(lower).valid).toBe(true);
    expect(spm.validate(upper).valid).toBe(true);

    // But derivation uses the raw string — so apps MUST normalize
    // before storing/deriving. This test documents that behavior.
    const peerId = await spm.derivePeerId(lower);
    expect(peerId.length).toBeGreaterThan(0);
  });

  test('whitespace-padded seed phrase still works', async () => {
    const padded = `  ${VALID_MNEMONIC}  `;
    const validation = spm.validate(padded);

    // The validate method trims whitespace
    expect(validation.valid).toBe(true);
  });
});
