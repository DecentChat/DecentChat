/**
 * AutoUpdater unit tests — version detection, polling, and update lifecycle
 *
 * Covers the three real deployment bugs:
 * 1. Update banner doesn't always appear (version comparison)
 * 2. Network failures don't crash the updater
 * 3. Polling starts/stops correctly
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { AutoUpdater } from '../../src/updater/AutoUpdater';
import type { UpdateInfo } from '../../src/updater/AutoUpdater';

// ─── Fetch mock setup ────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetchWith(response: Response | Error) {
  if (response instanceof Error) {
    globalThis.fetch = mock(async () => { throw response; }) as any;
  } else {
    globalThis.fetch = mock(async () => response) as any;
  }
}

function mockFetchJSON(data: any, status = 200) {
  mockFetchWith(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AutoUpdater — version detection', () => {
  test('same version → no callback, returns null', async () => {
    mockFetchJSON({ version: '0.1.0', buildTime: '2026-01-01T00:00:00Z', commitHash: 'abc' });
    const cb = mock(() => {});

    const updater = new AutoUpdater('0.1.0', { onUpdateAvailable: cb });
    const result = await updater.check();

    expect(result).toBeNull();
    expect(cb).not.toHaveBeenCalled();
    expect(updater.isUpdateAvailable()).toBe(false);
  });

  test('new version → fires onUpdateAvailable with version info', async () => {
    const info = { version: '0.2.0', buildTime: '2026-02-01T00:00:00Z', commitHash: 'def456' };
    mockFetchJSON(info);
    const cb = mock(() => {});

    const updater = new AutoUpdater('0.1.0', { onUpdateAvailable: cb });
    const result = await updater.check();

    expect(result).not.toBeNull();
    expect(result!.version).toBe('0.2.0');
    expect(result!.buildTime).toBe('2026-02-01T00:00:00Z');
    expect(result!.commitHash).toBe('def456');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(updater.isUpdateAvailable()).toBe(true);
  });

  test('network error → returns null, no crash', async () => {
    mockFetchWith(new Error('Network error'));

    const updater = new AutoUpdater('0.1.0');
    const result = await updater.check();

    expect(result).toBeNull();
    expect(updater.isUpdateAvailable()).toBe(false);
  });

  test('404 response → returns null', async () => {
    globalThis.fetch = mock(async () => new Response('Not Found', { status: 404 })) as any;

    const updater = new AutoUpdater('0.1.0');
    const result = await updater.check();

    expect(result).toBeNull();
  });
});

describe('AutoUpdater — polling lifecycle', () => {
  test('start() calls check immediately', async () => {
    mockFetchJSON({ version: '0.1.0' });

    const updater = new AutoUpdater('0.1.0', { checkIntervalMs: 60_000 });
    updater.start();

    // Give the immediate async check time to complete
    await new Promise(r => setTimeout(r, 50));

    expect(globalThis.fetch).toHaveBeenCalled();
    updater.stop();
  });

  test('stop() prevents further checks', async () => {
    mockFetchJSON({ version: '0.1.0' });

    const updater = new AutoUpdater('0.1.0', { checkIntervalMs: 50 });
    updater.start();

    // Let the immediate check fire
    await new Promise(r => setTimeout(r, 30));
    updater.stop();

    const callsAfterStop = (globalThis.fetch as any).mock.calls.length;

    // Wait long enough for another interval to have fired
    await new Promise(r => setTimeout(r, 120));

    expect((globalThis.fetch as any).mock.calls.length).toBe(callsAfterStop);
  });

  test('autoApply: true calls apply() after detecting update', async () => {
    mockFetchJSON({ version: '0.2.0', buildTime: 'now', commitHash: 'xyz' });

    const updater = new AutoUpdater('0.1.0', { autoApply: true });

    // Mock apply() so it doesn't actually reload
    const applyMock = mock(() => {});
    updater.apply = applyMock;

    await updater.check();

    expect(applyMock).toHaveBeenCalledTimes(1);
  });
});

describe('AutoUpdater — accessors', () => {
  test('getVersion() returns the version passed to constructor', () => {
    const updater = new AutoUpdater('1.2.3');
    expect(updater.getVersion()).toBe('1.2.3');
  });

  test('isUpdateAvailable() starts false, becomes true after new version detected', async () => {
    mockFetchJSON({ version: '0.2.0', buildTime: 'now' });

    const updater = new AutoUpdater('0.1.0');
    expect(updater.isUpdateAvailable()).toBe(false);

    await updater.check();
    expect(updater.isUpdateAvailable()).toBe(true);
  });
});

describe('AutoUpdater — version.json sanity check', () => {
  test('version.json at dist/ has required fields and valid semver', async () => {
    const file = Bun.file('/Users/claw/Projects/decent-chat/decent-client-web/dist/version.json');
    const exists = await file.exists();

    if (!exists) {
      // Skip gracefully if dist hasn't been built yet
      console.warn('dist/version.json not found — skipping (run build first)');
      return;
    }

    const data = await file.json();

    expect(typeof data.version).toBe('string');
    expect(data.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof data.buildTime).toBe('string');
    expect(typeof data.commitHash).toBe('string');
    expect(data.commitHash.length).toBeGreaterThan(0);
  });
});
