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
import { SeedPhraseManager } from '@decentchat/protocol';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Open Settings modal */
async function openSettings(page: Page) {
  await page.click('#settings-btn');
  await page.waitForSelector('.settings-modal', { timeout: 3000 });
}

/** Read canonical seed phrase from persistent storage */
async function extractSeedPhrase(page: Page): Promise<string> {
  const phrase = await page.evaluate(async () => {
    return await (window as any).__ctrl?.persistentStore?.getSetting?.('seedPhrase');
  });
  expect(phrase).toBeTruthy();
  return String(phrase).trim();
}

/** Read canonical in-memory peer ID */
async function extractCurrentPeerId(page: Page): Promise<string> {
  const peerId = await page.evaluate(() => (window as any).__state?.myPeerId || '');
  expect(peerId).toBeTruthy();
  return String(peerId).trim();
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

    // 2. Extract canonical seed + peer ID from app state
    const originalSeed = await extractSeedPhrase(page);
    expect(originalSeed.split(/\s+/).length).toBeGreaterThanOrEqual(12);
    const originalPeerId = await extractCurrentPeerId(page);

    const spm = new SeedPhraseManager();
    const { peerId: derivedOriginalPeerId } = await spm.deriveDeviceKeys(originalSeed, 0);
    expect(originalPeerId).toBe(derivedOriginalPeerId);

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

    // 6. Verify seed phrase and peer identity restored
    const restoredSeed = await extractSeedPhrase(page);
    const restoredPeerId = await extractCurrentPeerId(page);
    const { peerId: derivedRestoredPeerId } = await spm.deriveDeviceKeys(restoredSeed, 0);

    expect(restoredSeed).toBe(originalSeed);
    expect(restoredPeerId).toBe(derivedRestoredPeerId);
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
    const seedPhrase = await extractSeedPhrase(page);
    const originalPeerId = await extractCurrentPeerId(page);
    const spm = new SeedPhraseManager();
    const { peerId: expectedPeerId } = await spm.deriveDeviceKeys(seedPhrase, 0);
    expect(originalPeerId).toBe(expectedPeerId);

    // First restore
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await restoreFromSeed(page, seedPhrase);
    await createWorkspace(page, 'Restore 1', 'Eve');
    const peerId1 = await extractCurrentPeerId(page);

    // Second restore
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await restoreFromSeed(page, seedPhrase);
    await createWorkspace(page, 'Restore 2', 'Eve');
    const peerId2 = await extractCurrentPeerId(page);

    expect(peerId1).toBe(expectedPeerId);
    expect(peerId2).toBe(expectedPeerId);
    expect(peerId1).toBe(originalPeerId);
    expect(peerId2).toBe(originalPeerId);
  });
});
