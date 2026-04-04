import { describe, test, expect } from 'bun:test';
import { ConnectionRetryProgress } from '../../src/app/ConnectionRetryProgress';

describe('ConnectionRetryProgress', () => {
  function createProgress(totalAttempts = 5) {
    const hints: string[] = [];
    const progress = new ConnectionRetryProgress(totalAttempts, {
      setLoadingHint: (msg) => hints.push(msg),
    });
    return { progress, hints };
  }

  test('first attempt emits no hint (clean happy path)', () => {
    const { progress, hints } = createProgress();
    progress.beforeAttempt(0);
    expect(hints).toEqual([]);
  });

  test('subsequent attempts show retry progress with correct numbering', () => {
    const { progress, hints } = createProgress(5);
    progress.beforeAttempt(0); // no hint
    progress.beforeAttempt(1);
    progress.beforeAttempt(2);
    progress.beforeAttempt(3);
    progress.beforeAttempt(4);
    expect(hints).toEqual([
      'Connecting to network\u2026 attempt 2/5',
      'Connecting to network\u2026 attempt 3/5',
      'Connecting to network\u2026 attempt 4/5',
      'Connecting to network\u2026 attempt 5/5',
    ]);
  });

  test('onSuccess clears wentOffline flag', () => {
    const { progress } = createProgress();
    expect(progress.wentOffline).toBe(false);
    progress.onSuccess();
    expect(progress.wentOffline).toBe(false);
  });

  test('onExhausted sets offline hint and wentOffline flag', () => {
    const { progress, hints } = createProgress(3);
    progress.beforeAttempt(0);
    progress.beforeAttempt(1);
    progress.beforeAttempt(2);
    progress.onExhausted();
    expect(progress.wentOffline).toBe(true);
    expect(hints[hints.length - 1]).toBe(
      'Offline mode \u2014 messages will sync when connected',
    );
  });

  test('happy path: immediate success produces no hints and no offline', () => {
    const { progress, hints } = createProgress();
    progress.beforeAttempt(0);
    progress.onSuccess();
    const result = progress.getResult();
    expect(result.wentOffline).toBe(false);
    expect(result.hints).toEqual([]);
    expect(hints).toEqual([]);
  });

  test('retry then success: shows progress hints but not offline', () => {
    const { progress } = createProgress(3);
    progress.beforeAttempt(0); // fail
    progress.beforeAttempt(1); // fail
    progress.beforeAttempt(2); // success
    progress.onSuccess();
    const result = progress.getResult();
    expect(result.wentOffline).toBe(false);
    expect(result.hints).toEqual([
      'Connecting to network\u2026 attempt 2/3',
      'Connecting to network\u2026 attempt 3/3',
    ]);
  });

  test('full exhaustion: shows all retry hints then offline message', () => {
    const { progress } = createProgress(3);
    progress.beforeAttempt(0);
    progress.beforeAttempt(1);
    progress.beforeAttempt(2);
    progress.onExhausted();
    const result = progress.getResult();
    expect(result.wentOffline).toBe(true);
    expect(result.hints).toEqual([
      'Connecting to network\u2026 attempt 2/3',
      'Connecting to network\u2026 attempt 3/3',
      'Offline mode \u2014 messages will sync when connected',
    ]);
  });

  test('totalAttempts must be at least 1', () => {
    expect(() => createProgress(0)).toThrow('totalAttempts must be >= 1');
  });

  test('getResult returns a snapshot (not a live reference)', () => {
    const { progress } = createProgress(3);
    const snap1 = progress.getResult();
    progress.beforeAttempt(1);
    const snap2 = progress.getResult();
    expect(snap1.hints.length).toBe(0);
    expect(snap2.hints.length).toBe(1);
  });
});
