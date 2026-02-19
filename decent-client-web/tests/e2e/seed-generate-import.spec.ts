/**
 * Seed Generate & Import — E2E round-trip test
 *
 * Flow:
 *  1. Create workspace (generates seed phrase + identity)
 *  2. Extract seed phrase and peer ID from settings
 *  3. Clear all storage (fresh browser)
 *  4. Import the extracted seed phrase via restore flow
 *  5. Verify the restored identity matches the original
 */

import { test, expect, Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Open Settings modal */
async function openSettings(page: Page) {
  await page.click('#settings-btn');
  await page.waitForSelector('.settings-modal', { timeout: 3000 });
}

/**
 * Generate (if needed) and extract seed phrase from Settings panel.
 * Click the seed button — if no seed exists it generates one; if it does, it shows it.
 * Either way, the seed phrase display becomes visible.
 */
async function extractSeedPhrase(page: Page): Promise<string> {
  const seedBtn = page.locator('#seed-phrase-btn');
  await seedBtn.click();

  // Wait for the seed phrase display to appear
  const seedDisplay = page.locator('#seed-phrase-display');
  await expect(seedDisplay).toBeVisible({ timeout: 5000 });

  const phrase = await seedDisplay.textContent();
  expect(phrase).toBeTruthy();

  return phrase!.trim();
}

/** Extract peer ID from Settings — the <code> element in the Peer ID row */
async function extractPeerId(page: Page): Promise<string> {
  const peerIdEl = page.locator('.settings-modal .setting-row:has(label:text("Peer ID")) code');
  await peerIdEl.waitFor({ state: 'visible', timeout: 3000 });
  const peerId = await peerIdEl.textContent();
  expect(peerId).toBeTruthy();
  expect(peerId).not.toBe('N/A');
  return peerId!.trim();
}

/** Restore identity from seed phrase via welcome screen */
async function restoreFromSeed(page: Page, phrase: string) {
  await page.locator('#restore-identity-btn').click();
  await page.waitForSelector('.restore-modal', { timeout: 3000 });

  // Fill seed phrase
  const textarea = page.locator('#restore-seed-input');
  await textarea.fill(phrase);
  // Trigger input event (Playwright fill doesn't always fire it)
  await page.evaluate(() => {
    const el = document.getElementById('restore-seed-input') as HTMLTextAreaElement;
    if (el) el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await page.waitForTimeout(100);

  // Confirm restore
  await expect(page.locator('#restore-confirm-btn')).toBeEnabled({ timeout: 3000 });
  await page.locator('#restore-confirm-btn').click();
  await page.waitForSelector('#seed-restore-btn', { timeout: 3000 });

  // Click "Yes, Restore" and wait for reload
  const navPromise = page.waitForNavigation({ timeout: 10000 }).catch(() => null);
  await page.locator('#seed-restore-btn').click();
  await navPromise;

  await waitForApp(page);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Seed generate & import round-trip', () => {

  test('generate seed → export → clear → import → same identity', async ({ page }) => {
    // 1. Fresh start — create workspace (seed auto-generated, peer ID derived from it)
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'Seed Test', 'Alice');

    // 2. Open settings, extract seed phrase and peer ID
    await openSettings(page);
    const originalSeed = await extractSeedPhrase(page);
    expect(originalSeed.split(/\s+/).length).toBeGreaterThanOrEqual(12);
    const originalPeerId = await extractPeerId(page);

    // Close settings
    await page.click('#settings-close');
    await page.waitForTimeout(300);

    // 3. Nuke everything — simulate fresh device
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);

    // Verify we're back on welcome screen
    await expect(page.locator('#create-ws-btn')).toBeVisible();

    // 4. Import seed phrase via restore flow
    await restoreFromSeed(page, originalSeed);

    // 5. Create workspace to access settings
    await expect(page.locator('#create-ws-btn, .sidebar-header')).toBeVisible({ timeout: 8000 });
    await createWorkspace(page, 'Restored WS', 'Alice');

    // 6. Verify both seed phrase AND peer ID match
    await openSettings(page);
    const restoredSeed = await extractSeedPhrase(page);
    const restoredPeerId = await extractPeerId(page);

    expect(restoredSeed).toBe(originalSeed);
    expect(restoredPeerId).toBe(originalPeerId);
  });

  test('generated seed phrase is valid BIP39 (12 words)', async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'BIP39 Check', 'Bob');

    await openSettings(page);
    const seedPhrase = await extractSeedPhrase(page);

    const words = seedPhrase.split(/\s+/).filter(w => w.length > 0);
    expect(words.length).toBe(12);

    // Each word should be lowercase alpha only (BIP39 wordlist)
    for (const word of words) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });

  test('two different workspaces generate different seeds', async ({ page }) => {
    // First identity
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'WS One', 'User1');
    await openSettings(page);
    const seed1 = await extractSeedPhrase(page);

    // Second identity (fresh)
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'WS Two', 'User2');
    await openSettings(page);
    const seed2 = await extractSeedPhrase(page);

    expect(seed1).not.toBe(seed2);
  });

  test('imported seed produces consistent peer ID across multiple restores', async ({ page }) => {
    // Generate seed
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'Consistency', 'Eve');
    await openSettings(page);
    const seedPhrase = await extractSeedPhrase(page);
    const originalPeerId = await extractPeerId(page);

    // First restore
    await page.click('#settings-close');
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await restoreFromSeed(page, seedPhrase);
    await createWorkspace(page, 'Restore 1', 'Eve');
    await openSettings(page);
    const peerId1 = await extractPeerId(page);

    // Second restore
    await page.click('#settings-close');
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await restoreFromSeed(page, seedPhrase);
    await createWorkspace(page, 'Restore 2', 'Eve');
    await openSettings(page);
    const peerId2 = await extractPeerId(page);

    expect(peerId1).toBe(originalPeerId);
    expect(peerId2).toBe(originalPeerId);
  });
});
