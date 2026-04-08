import { describe, expect, test } from 'bun:test';
import { classifySingleTabMessage, isSingleTabLockRoute } from '../../src/app/singleTabLock';

describe('single-tab lock route detection', () => {
  test('enables lock on /app and nested app routes', () => {
    expect(isSingleTabLockRoute('/app')).toBe(true);
    expect(isSingleTabLockRoute('/app/invite/abc')).toBe(true);
  });

  test('skips lock outside app routes', () => {
    expect(isSingleTabLockRoute('/')).toBe(false);
    expect(isSingleTabLockRoute('/docs/security')).toBe(false);
  });
});

describe('single-tab lock message classifier', () => {
  const SELF = 'tab-self';

  test('ignores malformed payloads', () => {
    expect(classifySingleTabMessage(null, SELF)).toBe('ignore');
    expect(classifySingleTabMessage({ type: 'ping' }, SELF)).toBe('ignore');
    expect(classifySingleTabMessage({ type: 123, tabId: 'tab-a' }, SELF)).toBe('ignore');
    expect(classifySingleTabMessage({ type: 'unknown', tabId: 'tab-a' }, SELF)).toBe('ignore');
  });

  test('ignores messages from current tab', () => {
    expect(classifySingleTabMessage({ type: 'ping', tabId: SELF }, SELF)).toBe('ignore');
    expect(classifySingleTabMessage({ type: 'pong', tabId: SELF }, SELF)).toBe('ignore');
    expect(classifySingleTabMessage({ type: 'focus-tab', tabId: SELF }, SELF)).toBe('ignore');
  });

  test('classifies ping/pong/focus from another tab', () => {
    expect(classifySingleTabMessage({ type: 'ping', tabId: 'tab-a' }, SELF)).toBe('respond-pong');
    expect(classifySingleTabMessage({ type: 'pong', tabId: 'tab-a' }, SELF)).toBe('duplicate-tab-detected');
    expect(classifySingleTabMessage({ type: 'focus-tab', tabId: 'tab-a' }, SELF)).toBe('focus-existing-tab');
  });
});
