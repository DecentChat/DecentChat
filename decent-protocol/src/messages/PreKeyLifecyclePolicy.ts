import { PRE_KEY_BUNDLE_VERSION, type PreKeyBundle } from './PreKeyTypes';

export interface PreKeyLifecyclePolicyConfig {
  signedPreKeyTtlMs: number;
  signedPreKeyRefreshWindowMs: number;
  maxOneTimePreKeyAgeMs: number;
  maxPeerBundleAgeMs: number;
  targetOneTimePreKeys: number;
  lowWatermarkOneTimePreKeys: number;
}

export const DEFAULT_PRE_KEY_LIFECYCLE_POLICY: Readonly<PreKeyLifecyclePolicyConfig> = Object.freeze({
  signedPreKeyTtlMs: 30 * 24 * 60 * 60 * 1000,
  signedPreKeyRefreshWindowMs: 7 * 24 * 60 * 60 * 1000,
  maxOneTimePreKeyAgeMs: 21 * 24 * 60 * 60 * 1000,
  maxPeerBundleAgeMs: 45 * 24 * 60 * 60 * 1000,
  targetOneTimePreKeys: 20,
  lowWatermarkOneTimePreKeys: 8,
});

export interface SignedPreKeyLifecycleDecision {
  regenerateAll: boolean;
  rotateSignedPreKey: boolean;
}

export function decideSignedPreKeyLifecycle(
  signedPreKey: { expiresAt: number } | null | undefined,
  options: {
    now?: number;
    refreshWindowMs?: number;
  } = {},
): SignedPreKeyLifecycleDecision {
  const now = options.now ?? Date.now();
  const refreshWindowMs = options.refreshWindowMs ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.signedPreKeyRefreshWindowMs;

  if (!signedPreKey || signedPreKey.expiresAt <= now) {
    return {
      regenerateAll: true,
      rotateSignedPreKey: false,
    };
  }

  return {
    regenerateAll: false,
    rotateSignedPreKey: (signedPreKey.expiresAt - now) <= refreshWindowMs,
  };
}

export interface OneTimePreKeyLifecycleEntry {
  keyId: number;
  createdAt: number;
}

export interface LocalOneTimePreKeyLifecyclePlan {
  staleKeyIds: number[];
  retainedCount: number;
  replenishCount: number;
}

export function planLocalOneTimePreKeyLifecycle(
  entries: Iterable<OneTimePreKeyLifecycleEntry>,
  options: {
    now?: number;
    maxAgeMs?: number;
    targetCount?: number;
    lowWatermark?: number;
  } = {},
): LocalOneTimePreKeyLifecyclePlan {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.maxOneTimePreKeyAgeMs;
  const targetCount = options.targetCount ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.targetOneTimePreKeys;
  const lowWatermark = options.lowWatermark ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.lowWatermarkOneTimePreKeys;

  const minCreatedAt = now - maxAgeMs;
  const staleKeyIds: number[] = [];
  let totalCount = 0;

  for (const entry of entries) {
    totalCount += 1;
    if (entry.createdAt < minCreatedAt) {
      staleKeyIds.push(entry.keyId);
    }
  }

  const retainedCount = totalCount - staleKeyIds.length;
  const replenishCount = retainedCount < lowWatermark
    ? Math.max(0, targetCount - retainedCount)
    : 0;

  return {
    staleKeyIds,
    retainedCount,
    replenishCount,
  };
}

export interface NormalizePeerPreKeyBundleOptions {
  now?: number;
  expectedVersion?: number;
  maxBundleAgeMs?: number;
  maxOneTimePreKeyAgeMs?: number;
}

export function normalizePeerPreKeyBundle(
  bundle: PreKeyBundle | null | undefined,
  options: NormalizePeerPreKeyBundleOptions = {},
): PreKeyBundle | null {
  if (!bundle) return null;

  const now = options.now ?? Date.now();
  const expectedVersion = options.expectedVersion ?? PRE_KEY_BUNDLE_VERSION;
  const maxBundleAgeMs = options.maxBundleAgeMs ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.maxPeerBundleAgeMs;
  const maxOneTimePreKeyAgeMs = options.maxOneTimePreKeyAgeMs ?? DEFAULT_PRE_KEY_LIFECYCLE_POLICY.maxOneTimePreKeyAgeMs;

  if (bundle.version !== expectedVersion) return null;
  if (!bundle.signingPublicKey || !bundle.signedPreKey?.publicKey || !bundle.signedPreKey?.signature) return null;
  if (bundle.signedPreKey.expiresAt <= now) return null;
  if (!bundle.generatedAt || bundle.generatedAt < (now - maxBundleAgeMs)) return null;

  const minOneTimeCreatedAt = now - maxOneTimePreKeyAgeMs;
  const seen = new Set<number>();
  const oneTimePreKeys = bundle.oneTimePreKeys
    .slice()
    .sort((a, b) => a.keyId - b.keyId)
    .filter((entry) => {
      if (!entry?.publicKey) return false;
      if (!Number.isFinite(entry.keyId) || entry.keyId <= 0) return false;
      if (!Number.isFinite(entry.createdAt) || entry.createdAt < minOneTimeCreatedAt) return false;
      if (seen.has(entry.keyId)) return false;
      seen.add(entry.keyId);
      return true;
    });

  return {
    ...bundle,
    oneTimePreKeys,
  };
}

export function hasPeerPreKeyBundleChanged(before: PreKeyBundle, after: PreKeyBundle): boolean {
  if (before.version !== after.version) return true;
  if (before.peerId !== after.peerId) return true;
  if (before.generatedAt !== after.generatedAt) return true;
  if (before.signingPublicKey !== after.signingPublicKey) return true;

  if (
    before.signedPreKey.keyId !== after.signedPreKey.keyId
    || before.signedPreKey.publicKey !== after.signedPreKey.publicKey
    || before.signedPreKey.signature !== after.signedPreKey.signature
    || before.signedPreKey.createdAt !== after.signedPreKey.createdAt
    || before.signedPreKey.expiresAt !== after.signedPreKey.expiresAt
  ) {
    return true;
  }

  if (before.oneTimePreKeys.length !== after.oneTimePreKeys.length) return true;
  for (let i = 0; i < before.oneTimePreKeys.length; i++) {
    const beforeEntry = before.oneTimePreKeys[i]!;
    const afterEntry = after.oneTimePreKeys[i]!;

    if (
      beforeEntry.keyId !== afterEntry.keyId
      || beforeEntry.publicKey !== afterEntry.publicKey
      || beforeEntry.createdAt !== afterEntry.createdAt
    ) {
      return true;
    }
  }

  return false;
}
