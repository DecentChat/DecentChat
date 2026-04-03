import { test, expect } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

const VALID_MNEMONIC =
  'snack soul crime uncover invest leisure dad crazy latin media hip broom';

const installMockTransport = async (page: any) => {
  await page.addInitScript(() => {
    class MockTransport {
      static initCalls = 0;
      onConnect: ((peerId: string) => void) | null = null;
      onDisconnect: ((peerId: string) => void) | null = null;
      onMessage: ((peerId: string, data: unknown) => void) | null = null;

      async init(peerId?: string) {
        (MockTransport as any).initCalls += 1;
        return peerId || 'mock-peer-id-1234';
      }

      destroy() {}
      send() {}
      async connect() { return; }
      getConnectedPeers() { return []; }
      setHeartbeatEnabled() {}
    }

    (window as any).__MockTransport = MockTransport;
  });
};

/** Fill the seed phrase textarea and dispatch input event for validation */
async function fillSeedPhrase(page: import('@playwright/test').Page, phrase: string) {
  const textarea = page.locator('#restore-seed-input');
  await textarea.fill(phrase);
  await page.evaluate(() => {
    const el = document.getElementById('restore-seed-input') as HTMLTextAreaElement;
    if (el) {
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(100);
}

test.describe('routing bootstrap split', () => {
  test('landing route does not initialize transport', async ({ page }) => {
    await installMockTransport(page);
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);

    await expect(page.locator('#create-ws-btn')).toBeVisible();

    const initCalls = await page.evaluate(() => ((window as any).__MockTransport as any).initCalls || 0);
    expect(initCalls).toBe(0);
  });

  test('/app initializes transport', async ({ page }) => {
    await installMockTransport(page);
    await clearStorage(page);
    await page.goto('/app');
    await waitForApp(page);

    const initCalls = await page.evaluate(() => ((window as any).__MockTransport as any).initCalls || 0);
    expect(initCalls).toBeGreaterThan(0);
  });

  test('landing still shows Open App CTA when workspace exists locally', async ({ page }) => {
    await installMockTransport(page);
    await clearStorage(page);

    await page.goto('/app');
    await waitForApp(page);

    await createWorkspace(page, 'Route Test WS', 'Alex');
    await expect(page.locator('.sidebar-header')).toContainText('Route Test WS');

    await page.goto('/');
    await page.waitForSelector('#open-app-btn, #create-ws-btn, .sidebar-header', { timeout: 15000 });

    // The "Open App" CTA appears in the nav bar (#open-app-btn-nav) and/or
    // in the hero section (#open-app-btn) depending on async workspace restore.
    await expect(page.locator('#open-app-btn, #open-app-btn-nav').first()).toBeVisible();
  });
});

// ─── Suite: Seed restore from landing page navigates to /app ──────────────────

test.describe('seed restore navigates to /app', () => {
  test('restoring seed from landing page (/) redirects to /app', async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);

    // Open restore modal
    await page.locator('#restore-identity-btn').click();
    await page.waitForSelector('.restore-modal', { timeout: 3000 });

    // Enter valid seed phrase
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await expect(page.locator('#restore-confirm-btn')).toBeEnabled();

    // Click Restore then confirm
    await page.locator('#restore-confirm-btn').click();
    await page.waitForSelector('#seed-restore-btn', { timeout: 3000 });

    // Click "Yes, Restore" and wait for navigation
    const navigationPromise = page.waitForURL('**/app**', { timeout: 10000 });
    await page.locator('#seed-restore-btn').click();
    await navigationPromise;

    // Verify we ended up on /app, NOT back on /
    const url = new URL(page.url());
    expect(url.pathname).toBe('/app');

    // The full app should bootstrap (workspace UI or create-workspace button visible)
    await waitForApp(page);
    await expect(page.locator('#create-ws-btn, .sidebar-header')).toBeVisible({ timeout: 10000 });

    // No startup error screen should appear (IndexedDB must not be "blocked")
    await expect(page.locator('#clear-storage-btn')).not.toBeVisible();
  });

  test('restoring seed from /app stays on /app', async ({ page }) => {
    await clearStorage(page);
    await page.goto('/app');
    await waitForApp(page);

    // Open restore modal from the app route
    await page.locator('#restore-identity-btn').click();
    await page.waitForSelector('.restore-modal', { timeout: 3000 });

    // Enter valid seed phrase
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await expect(page.locator('#restore-confirm-btn')).toBeEnabled();

    // Click Restore then confirm
    await page.locator('#restore-confirm-btn').click();
    await page.waitForSelector('#seed-restore-btn', { timeout: 3000 });

    // Click "Yes, Restore" and wait for navigation
    const navigationPromise = page.waitForURL('**/app**', { timeout: 10000 });
    await page.locator('#seed-restore-btn').click();
    await navigationPromise;

    // Verify we're on /app
    const url = new URL(page.url());
    expect(url.pathname).toBe('/app');

    // Full app should bootstrap
    await waitForApp(page);
    await expect(page.locator('#create-ws-btn, .sidebar-header')).toBeVisible({ timeout: 10000 });

    // No startup error screen should appear
    await expect(page.locator('#clear-storage-btn')).not.toBeVisible();
  });

  test('seed is persisted after restore-from-landing navigation', async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);

    // Restore seed from landing page
    await page.locator('#restore-identity-btn').click();
    await page.waitForSelector('.restore-modal', { timeout: 3000 });
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await expect(page.locator('#restore-confirm-btn')).toBeEnabled();
    await page.locator('#restore-confirm-btn').click();
    await page.waitForSelector('#seed-restore-btn', { timeout: 3000 });

    const navigationPromise = page.waitForURL('**/app**', { timeout: 10000 });
    await page.locator('#seed-restore-btn').click();
    await navigationPromise;
    await waitForApp(page);

    // Verify seed was persisted by checking it's readable from the store
    const storedSeed = await page.evaluate(async () => {
      const ctrl = (window as any).__ctrl;
      if (!ctrl) return null;
      return await ctrl.persistentStore.getSetting('seedPhrase');
    });
    expect(storedSeed).toBe(VALID_MNEMONIC);
  });

  test('no startup error after rapid seed-restore navigation (IndexedDB handles closed)', async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);

    // Restore seed phrase (opens IndexedDB connections on landing page)
    await page.locator('#restore-identity-btn').click();
    await page.waitForSelector('.restore-modal', { timeout: 3000 });
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await expect(page.locator('#restore-confirm-btn')).toBeEnabled();
    await page.locator('#restore-confirm-btn').click();
    await page.waitForSelector('#seed-restore-btn', { timeout: 3000 });

    // Collect console errors during navigation to detect IndexedDB "blocked" issues
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const navigationPromise = page.waitForURL('**/app**', { timeout: 10000 });
    await page.locator('#seed-restore-btn').click();
    await navigationPromise;
    await waitForApp(page);

    // App should bootstrap successfully — no error screen
    await expect(page.locator('#create-ws-btn, .sidebar-header')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#clear-storage-btn')).not.toBeVisible();

    // No IndexedDB "blocked" errors in console
    const blockedErrors = consoleErrors.filter(e =>
      e.toLowerCase().includes('blocked') || e.toLowerCase().includes('failed to initialize'),
    );
    expect(blockedErrors).toHaveLength(0);
  });
});
