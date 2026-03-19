import { describe, expect, test } from 'bun:test';
import {
  PRE_KEY_BUNDLE_VERSION,
  decideSignedPreKeyLifecycle,
  planLocalOneTimePreKeyLifecycle,
  normalizePeerPreKeyBundle,
  hasPeerPreKeyBundleChanged,
} from '../../src/index';
import type { PreKeyBundle } from '../../src/index';

describe('pre-key lifecycle policy helpers', () => {
  test('decides signed pre-key regeneration and rotation windows', () => {
    const now = Date.now();

    expect(decideSignedPreKeyLifecycle(null, { now })).toEqual({
      regenerateAll: true,
      rotateSignedPreKey: false,
    });

    expect(decideSignedPreKeyLifecycle({ expiresAt: now - 1 }, { now })).toEqual({
      regenerateAll: true,
      rotateSignedPreKey: false,
    });

    expect(decideSignedPreKeyLifecycle({ expiresAt: now + 1_000 }, { now, refreshWindowMs: 2_000 })).toEqual({
      regenerateAll: false,
      rotateSignedPreKey: true,
    });

    expect(decideSignedPreKeyLifecycle({ expiresAt: now + 10_000 }, { now, refreshWindowMs: 2_000 })).toEqual({
      regenerateAll: false,
      rotateSignedPreKey: false,
    });
  });

  test('plans stale prune + replenishment for one-time pre-keys', () => {
    const now = Date.now();
    const plan = planLocalOneTimePreKeyLifecycle(
      [
        { keyId: 1, createdAt: now - 10_000 },
        { keyId: 2, createdAt: now - 100 },
        { keyId: 3, createdAt: now - 50 },
      ],
      {
        now,
        maxAgeMs: 5_000,
        targetCount: 6,
        lowWatermark: 4,
      },
    );

    expect(plan.staleKeyIds).toEqual([1]);
    expect(plan.retainedCount).toBe(2);
    expect(plan.replenishCount).toBe(4);
  });

  test('normalizes peer bundle by pruning stale/duplicate one-time keys', () => {
    const now = Date.now();
    const baseBundle: PreKeyBundle = {
      version: PRE_KEY_BUNDLE_VERSION,
      peerId: 'peer-bob',
      generatedAt: now,
      signingPublicKey: 'signing-pub',
      signedPreKey: {
        keyId: 100,
        publicKey: 'signed-pub',
        signature: 'sig',
        createdAt: now - 1_000,
        expiresAt: now + 10_000,
      },
      oneTimePreKeys: [
        { keyId: 9, publicKey: 'stale', createdAt: now - 10_000 },
        { keyId: 4, publicKey: 'fresh-a', createdAt: now - 100 },
        { keyId: 4, publicKey: 'fresh-a-dup', createdAt: now - 50 },
        { keyId: 2, publicKey: 'fresh-b', createdAt: now - 75 },
      ],
    };

    const normalized = normalizePeerPreKeyBundle(baseBundle, {
      now,
      maxBundleAgeMs: 60_000,
      maxOneTimePreKeyAgeMs: 1_000,
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.oneTimePreKeys).toEqual([
      { keyId: 2, publicKey: 'fresh-b', createdAt: now - 75 },
      { keyId: 4, publicKey: 'fresh-a', createdAt: now - 100 },
    ]);
  });

  test('detects whether normalized bundle changed', () => {
    const now = Date.now();
    const before: PreKeyBundle = {
      version: PRE_KEY_BUNDLE_VERSION,
      peerId: 'peer-a',
      generatedAt: now,
      signingPublicKey: 'signing-pub',
      signedPreKey: {
        keyId: 7,
        publicKey: 'signed',
        signature: 'sig',
        createdAt: now - 1,
        expiresAt: now + 999,
      },
      oneTimePreKeys: [
        { keyId: 1, publicKey: 'ot-1', createdAt: now - 10 },
      ],
    };

    const same = structuredClone(before);
    const changed = {
      ...before,
      oneTimePreKeys: [
        { keyId: 2, publicKey: 'ot-2', createdAt: now - 10 },
      ],
    };

    expect(hasPeerPreKeyBundleChanged(before, same)).toBe(false);
    expect(hasPeerPreKeyBundleChanged(before, changed)).toBe(true);
  });
});
