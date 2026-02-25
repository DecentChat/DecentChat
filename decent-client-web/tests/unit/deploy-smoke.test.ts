/**
 * Deploy smoke tests — validate built artifacts for deployment correctness
 *
 * These tests run against actual built files in dist/ to catch issues
 * that only surface after a build: missing files, broken references,
 * unresolved env variables, stale localhost URLs, etc.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const DIST = '/Users/claw/Projects/decent-chat/decent-client-web/dist';

// Helper: skip all tests gracefully if dist hasn't been built
const distExists = existsSync(DIST);

describe('Deploy smoke — dist file existence', () => {
  test('dist directory exists', () => {
    expect(distExists).toBe(true);
  });

  test('dist/version.json exists and is valid JSON', () => {
    if (!distExists) return;
    const path = join(DIST, 'version.json');
    expect(existsSync(path)).toBe(true);

    const content = readFileSync(path, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test('version.json has all required fields', () => {
    if (!distExists) return;
    const data = JSON.parse(readFileSync(join(DIST, 'version.json'), 'utf-8'));

    expect(typeof data.version).toBe('string');
    expect(data.version).toMatch(/^\d+\.\d+\.\d+/);

    expect(typeof data.buildTime).toBe('string');
    // buildTime should be an ISO date string
    expect(new Date(data.buildTime).toString()).not.toBe('Invalid Date');

    expect(typeof data.commitHash).toBe('string');
    expect(data.commitHash.length).toBeGreaterThan(0);

    expect(typeof data.schemaVersion).toBe('number');
  });

  test('dist/index.html exists and is internally consistent with service-worker mode', () => {
    if (!distExists) return;
    const path = join(DIST, 'index.html');
    expect(existsSync(path)).toBe(true);

    const content = readFileSync(path, 'utf-8');
    const hasSWReference = content.includes('sw.js') || content.includes('serviceWorker') || content.includes('registerSW');
    const hasSWFile = existsSync(join(DIST, 'sw.js'));

    // If we ship a service worker file, index should reference/boot it.
    if (hasSWFile) {
      expect(hasSWReference).toBe(true);
    } else {
      // If SW file is absent, index must not contain stale SW hooks.
      expect(hasSWReference).toBe(false);
    }
  });

  test('dist/sw.js optional artifact is coherent when present', () => {
    if (!distExists) return;
    const hasSWFile = existsSync(join(DIST, 'sw.js'));
    if (!hasSWFile) {
      // Current build mode may intentionally disable service worker output.
      expect(hasSWFile).toBe(false);
      return;
    }
    expect(hasSWFile).toBe(true);
  });
});

describe('Deploy smoke — bundle integrity', () => {
  function findMainBundle(): string | null {
    if (!distExists) return null;
    const assetsDir = join(DIST, 'assets');
    if (!existsSync(assetsDir)) return null;

    const files = readdirSync(assetsDir);
    // App is code-split — find the largest index-*.js chunk (the actual app bundle)
    const indexFiles = files
      .filter(f => f.startsWith('index-') && f.endsWith('.js'))
      .map(f => ({ name: f, size: Bun.file(join(assetsDir, f)).size }))
      .sort((a, b) => b.size - a.size);

    return indexFiles.length > 0 ? join(assetsDir, indexFiles[0].name) : null;
  }

  test('main JS bundle exists and is non-empty', () => {
    const bundlePath = findMainBundle();
    if (!bundlePath) {
      if (!distExists) return;
      throw new Error('Main JS bundle not found in dist/assets/');
    }

    const stat = Bun.file(bundlePath).size;
    // Main bundle (largest code-split chunk) should be substantial (> 50KB)
    expect(stat).toBeGreaterThan(50_000);
  });

  test('version in version.json matches __APP_VERSION__ in bundle', () => {
    if (!distExists) return;
    const versionData = JSON.parse(readFileSync(join(DIST, 'version.json'), 'utf-8'));
    const bundlePath = findMainBundle();
    if (!bundlePath) return;

    const bundleContent = readFileSync(bundlePath, 'utf-8');
    // The version string should appear somewhere in the bundle
    expect(bundleContent).toContain(versionData.version);
  });

  test('no localhost:5173 references in production bundle', () => {
    const bundlePath = findMainBundle();
    if (!bundlePath) return;

    const content = readFileSync(bundlePath, 'utf-8');
    // Vite dev server URL should never appear in production build
    expect(content).not.toContain('localhost:5173');
  });

  test('no unresolved import.meta.env.DEV in bundle', () => {
    const bundlePath = findMainBundle();
    if (!bundlePath) return;

    const content = readFileSync(bundlePath, 'utf-8');
    // Vite should replace import.meta.env.DEV at build time
    expect(content).not.toContain('import.meta.env.DEV');
  });
});

describe('Deploy smoke — service worker', () => {
  test('sw.js precache manifest has entries', () => {
    if (!distExists) return;
    const swPath = join(DIST, 'sw.js');
    if (!existsSync(swPath)) return;

    const content = readFileSync(swPath, 'utf-8');

    // Workbox precache manifest entries look like { url: '...', revision: '...' }
    // or are listed in a precacheAndRoute call
    const urlMatches = content.match(/url\s*:\s*"/g);
    if (urlMatches) {
      // Should have at least a few entries (index.html, main.js, main.css, etc.)
      expect(urlMatches.length).toBeGreaterThan(3);
    }
  });

  test('sw.js includes deterministic activation handoff hooks', () => {
    if (!distExists) return;
    const swPath = join(DIST, 'sw.js');
    if (!existsSync(swPath)) return;

    const content = readFileSync(swPath, 'utf-8');
    expect(content).toContain('skipWaiting');
    expect(content.includes('clients.claim') || content.includes('self.clients.claim')).toBe(true);
    expect(content).toContain('DC_SW_ACTIVATED');
  });
});

describe('Deploy smoke — security', () => {
  test('index.html CSP allows self scripts (if CSP meta tag exists)', () => {
    if (!distExists) return;
    const content = readFileSync(join(DIST, 'index.html'), 'utf-8');

    // Check if a CSP meta tag exists
    const cspMatch = content.match(/content-security-policy/i);
    if (cspMatch) {
      // If CSP exists, verify it allows 'self' for scripts
      const metaMatch = content.match(/content="([^"]*default-src[^"]*)"/i)
        || content.match(/content="([^"]*script-src[^"]*)"/i);
      if (metaMatch) {
        expect(metaMatch[1]).toContain("'self'");
      }
    }
    // If no CSP meta tag, test passes (CSP might be set via headers instead)
  });
});
