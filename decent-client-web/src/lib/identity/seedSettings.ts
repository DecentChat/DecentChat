export function normalizeSeedPhrase(seed?: string | null): string | null {
  if (typeof seed !== 'string') return null;
  const normalized = seed.trim();
  return normalized ? normalized : null;
}

export function resolveSeedPhraseForSettings(
  settingsSeed?: string | null,
  canonicalSeed?: string | null,
): string | undefined {
  return normalizeSeedPhrase(canonicalSeed)
    ?? normalizeSeedPhrase(settingsSeed)
    ?? undefined;
}

export function canGenerateSeed(canonicalSeed?: string | null): boolean {
  return normalizeSeedPhrase(canonicalSeed) === null;
}
