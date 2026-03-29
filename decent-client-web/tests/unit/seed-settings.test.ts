import { describe, expect, test } from 'bun:test';

import { canGenerateSeed, resolveSeedPhraseForSettings } from '../../src/lib/identity/seedSettings';

describe('seed settings helpers', () => {
  test('prefers the canonical standalone seed over the app-settings copy', () => {
    expect(resolveSeedPhraseForSettings('stale settings seed', 'canonical standalone seed')).toBe('canonical standalone seed');
  });

  test('falls back to the app-settings copy when standalone seed is missing', () => {
    expect(resolveSeedPhraseForSettings('settings seed', null)).toBe('settings seed');
  });

  test('does not allow generating a new seed when one already exists', () => {
    expect(canGenerateSeed('already have one')).toBe(false);
  });

  test('allows generation only when no usable seed exists', () => {
    expect(canGenerateSeed('   ')).toBe(true);
    expect(canGenerateSeed(null)).toBe(true);
  });
});
