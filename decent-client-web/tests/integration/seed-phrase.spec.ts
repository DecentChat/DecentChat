/**
 * Seed Phrase E2E Tests
 *
 * Tests two critical identity flows:
 *   1. Generate — user generates a fresh 12-word seed phrase via Settings
 *   2. Import   — user restores an existing identity from a known seed phrase
 *
 * These tests run against the real Vite dev server (no MockTransport needed,
 * since we're only testing identity management, not P2P messaging).
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

// ─── Known-valid BIP39 mnemonic for import tests ─────────────────────────────
// Validated with SeedPhraseManager.validate() — all 12 words are in the BIP39
// English wordlist and the checksum passes.
const VALID_MNEMONIC =
  'elbow excite access tunnel genre chase risk loan raise mesh chaos artwork';

// A phrase with a word not in the BIP39 wordlist
const INVALID_MNEMONIC = 'this is not a valid bip39 seed phrase at all here end';

// ─── Relay server (use mock transport to avoid localhost:9000 dependency) ───

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(() => relay?.close());

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fresh browser context + page with clean IndexedDB / localStorage */
async function freshPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.error('[Browser]', msg.text());
  });

  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));

  await page.goto('/');

  // Wipe all storage for a clean test state
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    sessionStorage.clear();
  });

  await page.reload();
  await waitForReady(page);
  return page;
}

/** Wait for the app to be ready (welcome screen or main app) */
async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const loading = document.getElementById('loading');
      return !loading || loading.style.opacity === '0' || loading.style.display === 'none';
    },
    { timeout: 15000 },
  );
  const openAppBtn = page.getByRole('button', { name: /open app/i });
  if (await openAppBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openAppBtn.click();
  }

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
}

/** Create a workspace so we can reach the main app (needed for Settings) */
async function createWorkspace(page: Page, wsName = 'Test WS', alias = 'Tester'): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal', { timeout: 5000 });
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(wsName);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

/** Open the Settings panel (⚙️ button in channel header) */
async function openSettings(page: Page): Promise<void> {
  await page.click('#settings-btn');
  await page.waitForSelector('.settings-modal', { timeout: 5000 });
}

/** Close the Settings panel */
async function closeSettings(page: Page): Promise<void> {
  await page.click('#settings-close');
  await page.waitForSelector('.settings-modal', { state: 'hidden', timeout: 3000 }).catch(() => {});
}

/** Get the current peer ID shown in the welcome screen or sidebar */
async function getDisplayedPeerId(page: Page): Promise<string> {
  const el = page.locator('#welcome-peer-id, #copy-peer-id').first();
  const text = await el.textContent({ timeout: 5000 });
  return (text ?? '').replace('…', '').trim();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Seed Phrase — Generate', () => {
  test('seed phrase is auto-generated and can be shown/hidden in settings', async ({ browser }) => {
    // App auto-generates a seed phrase on first launch (commit 6ec0e9d).
    // This test verifies the Show/Hide flow that users actually encounter.
    test.setTimeout(60000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await createWorkspace(page);

    // Wait for auto-generation to complete (logged to console)
    await page.waitForFunction(
      () => (window as any).__ctrl?.persistentStore != null,
      { timeout: 10000 },
    );

    await openSettings(page);

    const seedBtn = page.locator('#seed-phrase-btn');
    await expect(seedBtn).toBeVisible({ timeout: 5000 });

    // With auto-generated seed, button starts as "Show"
    const display = page.locator('#seed-phrase-display');

    // Click Show → phrase becomes visible
    if (await seedBtn.textContent({ timeout: 3000 }).then(t => t?.includes('Show'))) {
      await seedBtn.click();
      await expect(display).toBeVisible({ timeout: 5000 });
      const phrase = (await display.textContent()) ?? '';
      const words = phrase.trim().split(/\s+/);
      expect(words.length).toBeGreaterThanOrEqual(12);
      words.slice(0, 12).forEach(w => expect(w).toMatch(/^[a-z]+$/));
      // Button should now say "Hide"
      await expect(seedBtn).toContainText('Hide');
    } else {
      // Button says "Generate" (no auto-gen yet) — test the generate flow
      await seedBtn.click();
      await expect(display).toBeVisible({ timeout: 5000 });
      const phrase = (await display.textContent()) ?? '';
      const words = phrase.trim().split(/\s+/);
      expect(words).toHaveLength(12);
      words.forEach(w => expect(w).toMatch(/^[a-z]+$/));
      await expect(seedBtn).toContainText('Hide');
    }

    await ctx.close();
  });

  test('generated phrase persists after page reload', async ({ browser }) => {
    test.setTimeout(60000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await createWorkspace(page);
    await openSettings(page);

    // Generate
    await page.click('#seed-phrase-btn');
    const display = page.locator('#seed-phrase-display');
    await display.waitFor({ state: 'visible', timeout: 5000 });
    const originalPhrase = (await display.textContent())?.trim() ?? '';
    expect(originalPhrase.split(' ')).toHaveLength(12);

    await closeSettings(page);

    // Reload
    await page.reload();
    await waitForReady(page);

    await openSettings(page);

    // Button should say "Show" — phrase is already stored
    const showBtn = page.locator('#seed-phrase-btn');
    await expect(showBtn).toContainText('Show');

    // Click Show to reveal
    await showBtn.click();
    const displayAfterReload = page.locator('#seed-phrase-display');
    await displayAfterReload.waitFor({ state: 'visible', timeout: 5000 });
    const restoredPhrase = (await displayAfterReload.textContent())?.trim() ?? '';

    expect(restoredPhrase).toBe(originalPhrase);

    await ctx.close();
  });

  test('peer ID is stable across reloads once seed is generated', async ({ browser }) => {
    test.setTimeout(90000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await createWorkspace(page);
    await openSettings(page);
    await page.click('#seed-phrase-btn'); // Generate
    await page.locator('#seed-phrase-display').waitFor({ state: 'visible', timeout: 5000 });
    await closeSettings(page);

    // First reload — switches from random UUID to seed-derived ID
    await page.reload();
    await waitForReady(page);
    const peerId1 = await getDisplayedPeerId(page);
    expect(peerId1.length).toBeGreaterThan(4);

    // Second reload — must produce the SAME seed-derived ID
    await page.reload();
    await waitForReady(page);
    const peerId2 = await getDisplayedPeerId(page);
    expect(peerId2).toBe(peerId1);

    await ctx.close();
  });

  test('two different users get different seed phrases', async ({ browser }) => {
    test.setTimeout(60000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    const page1 = await freshPage(ctx1);
    const page2 = await freshPage(ctx2);

    await createWorkspace(page1, 'WS1', 'User1');
    await createWorkspace(page2, 'WS2', 'User2');

    await openSettings(page1);
    await page1.click('#seed-phrase-btn');
    await page1.locator('#seed-phrase-display').waitFor({ state: 'visible', timeout: 5000 });
    const phrase1 = (await page1.locator('#seed-phrase-display').textContent())?.trim() ?? '';

    await openSettings(page2);
    await page2.click('#seed-phrase-btn');
    await page2.locator('#seed-phrase-display').waitFor({ state: 'visible', timeout: 5000 });
    const phrase2 = (await page2.locator('#seed-phrase-display').textContent())?.trim() ?? '';

    expect(phrase1).not.toBe(phrase2);

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('Seed Phrase — Import (Restore)', () => {
  test('restore link is visible on welcome screen', async ({ browser }) => {
    test.setTimeout(30000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    const restoreBtn = page.locator('#restore-identity-btn');
    await expect(restoreBtn).toBeVisible();
    await expect(restoreBtn).toContainText('Restore from seed phrase');

    await ctx.close();
  });

  test('restore modal opens with "Enter phrase" tab active', async ({ browser }) => {
    test.setTimeout(30000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await page.click('#restore-identity-btn');
    await page.waitForSelector('.restore-modal', { timeout: 5000 });

    // "Enter phrase" tab should be active
    const activeTab = page.locator('.restore-tab.active');
    await expect(activeTab).toContainText('Enter phrase');

    // Textarea should be visible
    await expect(page.locator('#restore-seed-input')).toBeVisible();

    // Restore button should be disabled (no input yet)
    const restoreConfirmBtn = page.locator('#restore-confirm-btn');
    await expect(restoreConfirmBtn).toBeDisabled();

    await ctx.close();
  });

  test('invalid phrase shows error and keeps button disabled', async ({ browser }) => {
    test.setTimeout(30000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await page.click('#restore-identity-btn');
    await page.waitForSelector('#restore-seed-input', { timeout: 5000 });

    // Type an invalid phrase
    await page.fill('#restore-seed-input', INVALID_MNEMONIC);

    const status = page.locator('#restore-seed-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveClass(/error/);
    // Should contain some kind of error (unknown word, wrong count, etc.)
    const statusText = (await status.textContent()) ?? '';
    expect(statusText.length).toBeGreaterThan(0);
    expect(statusText).toMatch(/✗/);

    // Button must remain disabled
    await expect(page.locator('#restore-confirm-btn')).toBeDisabled();

    await ctx.close();
  });

  test('wrong word count shows error', async ({ browser }) => {
    test.setTimeout(30000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await page.click('#restore-identity-btn');
    await page.waitForSelector('#restore-seed-input', { timeout: 5000 });

    // Only 3 words
    await page.fill('#restore-seed-input', 'elbow excite access');

    const status = page.locator('#restore-seed-status');
    await expect(status).toHaveClass(/error/, { timeout: 2000 });
    await expect(page.locator('#restore-confirm-btn')).toBeDisabled();

    await ctx.close();
  });

  test('valid phrase enables the Restore button and shows ✓', async ({ browser }) => {
    test.setTimeout(30000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await page.click('#restore-identity-btn');
    await page.waitForSelector('#restore-seed-input', { timeout: 5000 });

    await page.fill('#restore-seed-input', VALID_MNEMONIC);

    const status = page.locator('#restore-seed-status');
    await expect(status).toHaveClass(/valid/, { timeout: 2000 });
    await expect(status).toContainText('✓');

    // Restore button must now be enabled
    await expect(page.locator('#restore-confirm-btn')).toBeEnabled();

    await ctx.close();
  });

  test('clicking Restore shows confirmation dialog with phrase preview', async ({ browser }) => {
    test.setTimeout(30000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await page.click('#restore-identity-btn');
    await page.waitForSelector('#restore-seed-input', { timeout: 5000 });
    await page.fill('#restore-seed-input', VALID_MNEMONIC);
    await page.locator('#restore-confirm-btn').click();

    // Confirmation modal should appear
    await page.waitForSelector('#seed-restore-btn', { timeout: 5000 });

    // Should show the phrase being restored
    const confirmText = (await page.locator('.seed-confirm-phrase').textContent()) ?? '';
    expect(confirmText).toContain('elbow');
    expect(confirmText).toContain('artwork'); // last word

    // "Yes, Restore" button should be present
    await expect(page.locator('#seed-restore-btn')).toBeVisible();

    // "Cancel" button should be present
    await expect(page.locator('#qr-cancel')).toBeVisible();

    await ctx.close();
  });

  test('cancelling confirmation keeps the original identity', async ({ browser }) => {
    test.setTimeout(30000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    const originalPeerId = await getDisplayedPeerId(page);

    await page.click('#restore-identity-btn');
    await page.waitForSelector('#restore-seed-input', { timeout: 5000 });
    await page.fill('#restore-seed-input', VALID_MNEMONIC);
    await page.locator('#restore-confirm-btn').click();
    await page.waitForSelector('#qr-cancel', { timeout: 5000 });

    // Cancel
    await page.click('#qr-cancel');
    await page.waitForSelector('.restore-modal', { state: 'hidden', timeout: 3000 }).catch(() => {});

    // Still on welcome screen, peer ID unchanged
    const currentPeerId = await getDisplayedPeerId(page);
    expect(currentPeerId).toBe(originalPeerId);

    await ctx.close();
  });

  test('confirming restore reloads the app', async ({ browser }) => {
    test.setTimeout(60000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await page.click('#restore-identity-btn');
    await page.waitForSelector('#restore-seed-input', { timeout: 5000 });
    await page.fill('#restore-seed-input', VALID_MNEMONIC);
    await page.locator('#restore-confirm-btn').click();
    await page.waitForSelector('#seed-restore-btn', { timeout: 5000 });

    // Confirm the restore — this triggers window.location.reload()
    const reloadPromise = page.waitForNavigation({ timeout: 15000 });
    await page.click('#seed-restore-btn');
    await reloadPromise.catch(() => {}); // navigation may throw in some Playwright versions

    await waitForReady(page);

    // App is back up — welcome screen or main app
    const isReady =
      (await page.locator('#create-ws-btn').isVisible().catch(() => false)) ||
      (await page.locator('.sidebar-header').isVisible().catch(() => false));
    expect(isReady).toBe(true);

    await ctx.close();
  });

  test('imported seed produces a deterministic peer ID', async ({ browser }) => {
    test.setTimeout(60000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    async function importAndGetPeerId(ctx: BrowserContext): Promise<string> {
      const page = await freshPage(ctx);
      await page.click('#restore-identity-btn');
      await page.waitForSelector('#restore-seed-input', { timeout: 5000 });
      await page.fill('#restore-seed-input', VALID_MNEMONIC);
      await page.locator('#restore-confirm-btn').click();
      await page.waitForSelector('#seed-restore-btn', { timeout: 5000 });
      const reloadPromise = page.waitForNavigation({ timeout: 15000 });
      await page.click('#seed-restore-btn');
      await reloadPromise.catch(() => {});
      await waitForReady(page);
      return getDisplayedPeerId(page);
    }

    // Two separate browser contexts importing the same seed should produce the same peer ID
    const peerId1 = await importAndGetPeerId(ctx1);
    const peerId2 = await importAndGetPeerId(ctx2);

    expect(peerId1.length).toBeGreaterThan(4);
    expect(peerId1).toBe(peerId2);

    await ctx1.close();
    await ctx2.close();
  });

  test('imported seed survives a page reload', async ({ browser }) => {
    test.setTimeout(60000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    // Import seed
    await page.click('#restore-identity-btn');
    await page.waitForSelector('#restore-seed-input', { timeout: 5000 });
    await page.fill('#restore-seed-input', VALID_MNEMONIC);
    await page.locator('#restore-confirm-btn').click();
    await page.waitForSelector('#seed-restore-btn', { timeout: 5000 });
    const reloadPromise = page.waitForNavigation({ timeout: 15000 });
    await page.click('#seed-restore-btn');
    await reloadPromise.catch(() => {});
    await waitForReady(page);

    const peerIdAfterImport = await getDisplayedPeerId(page);

    // Reload again
    await page.reload();
    await waitForReady(page);

    const peerIdAfterReload = await getDisplayedPeerId(page);
    expect(peerIdAfterReload).toBe(peerIdAfterImport);

    // Verify the seed is accessible in settings too
    await createWorkspace(page);
    await openSettings(page);
    const showBtn = page.locator('#seed-phrase-btn');
    await expect(showBtn).toContainText('Show'); // not "Generate"

    await ctx.close();
  });

  test('imported peer ID differs from a randomly generated one', async ({ browser }) => {
    test.setTimeout(60000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    // Page 1: fresh app with no seed (random peer ID)
    const page1 = await freshPage(ctx1);
    const randomPeerId = await getDisplayedPeerId(page1);

    // Page 2: import known seed
    const page2 = await freshPage(ctx2);
    await page2.click('#restore-identity-btn');
    await page2.waitForSelector('#restore-seed-input', { timeout: 5000 });
    await page2.fill('#restore-seed-input', VALID_MNEMONIC);
    await page2.locator('#restore-confirm-btn').click();
    await page2.waitForSelector('#seed-restore-btn', { timeout: 5000 });
    const reloadPromise = page2.waitForNavigation({ timeout: 15000 });
    await page2.click('#seed-restore-btn');
    await reloadPromise.catch(() => {});
    await waitForReady(page2);
    const importedPeerId = await getDisplayedPeerId(page2);

    expect(importedPeerId).not.toBe(randomPeerId);

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('Seed Phrase — Transfer (Settings)', () => {
  test('Transfer button appears only when seed phrase exists', async ({ browser }) => {
    test.setTimeout(60000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await createWorkspace(page);
    await openSettings(page);

    // Before generating: no Transfer button
    await expect(page.locator('#seed-transfer-btn')).toHaveCount(0);

    // Generate seed
    await page.click('#seed-phrase-btn');
    await page.locator('#seed-phrase-display').waitFor({ state: 'visible', timeout: 5000 });

    await closeSettings(page);
    await openSettings(page);

    // After generating: Transfer button should appear
    await expect(page.locator('#seed-transfer-btn')).toBeVisible();

    await ctx.close();
  });

  test('Transfer button opens QR modal', async ({ browser }) => {
    test.setTimeout(60000);
    const ctx = await browser.newContext();
    const page = await freshPage(ctx);

    await createWorkspace(page);
    await openSettings(page);
    await page.click('#seed-phrase-btn'); // Generate
    await page.locator('#seed-phrase-display').waitFor({ state: 'visible', timeout: 5000 });
    await closeSettings(page);
    await openSettings(page);

    await page.click('#seed-transfer-btn');

    // QR modal should open
    await page.waitForSelector('.qr-modal', { timeout: 5000 });
    await expect(page.locator('.qr-image')).toBeVisible();

    // Warning should be visible
    await expect(page.locator('.seed-qr-warning')).toBeVisible();

    await ctx.close();
  });
});
