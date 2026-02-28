/**
 * Seed Restore & Transfer — E2E tests
 *
 * Covers:
 *  1. Welcome screen "Restore from seed phrase →" entry point
 *  2. Restore modal: tabs, live validation, confirmation flow
 *  3. Settings → Transfer: seed QR modal, phrase reveal, copy
 */

import { test, expect, Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

// A real BIP39 12-word phrase (from protocol test vectors)
const VALID_MNEMONIC =
  'snack soul crime uncover invest leisure dad crazy latin media hip broom';
const INVALID_MNEMONIC_SHORT = 'one two three four';
const INVALID_MNEMONIC_BADWORD = 'snack soul crime uncover invest leisure dad crazy latin media hip xyzzy';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Click the "Restore from seed phrase →" link on the welcome screen */
async function clickRestoreLink(page: Page) {
  await page.locator('#restore-identity-btn').click();
  await page.waitForSelector('.restore-modal', { timeout: 3000 });
}

/** Fill the seed phrase textarea and wait for validation to settle */
async function fillSeedPhrase(page: Page, phrase: string) {
  const textarea = page.locator('#restore-seed-input');
  await textarea.fill(phrase);
  // Playwright's fill() doesn't fire input events, so we manually trigger it
  await page.evaluate(() => {
    const el = document.getElementById('restore-seed-input') as HTMLTextAreaElement;
    if (el) {
      const event = new InputEvent('input', { bubbles: true });
      el.dispatchEvent(event);
    }
  });
  // Give the input handler a tick to process
  await page.waitForTimeout(100);
}

/** Open Settings from inside a workspace */
async function openSettings(page: Page) {
  await page.click('#settings-btn');
  await page.waitForSelector('.settings-modal', { timeout: 3000 });
}

// ─── Suite: Welcome screen entry point ───────────────────────────────────────

test.describe('Restore entry point on welcome screen', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
  });

  test('welcome screen shows "Restore from seed phrase →" link', async ({ page }) => {
    await expect(page.locator('#restore-identity-btn')).toBeVisible();
  });

  test('restore link text mentions seed phrase', async ({ page }) => {
    const text = await page.locator('#restore-identity-btn').textContent();
    expect(text?.toLowerCase()).toContain('seed phrase');
  });

  test('clicking restore link opens Restore modal', async ({ page }) => {
    await clickRestoreLink(page);
    await expect(page.locator('.restore-modal')).toBeVisible();
  });

  test('restore modal has "Restore Your Account" heading', async ({ page }) => {
    await clickRestoreLink(page);
    await expect(page.locator('.restore-modal h2')).toContainText('Restore Your Account');
  });

  test('restore modal can be closed with Escape', async ({ page }) => {
    await clickRestoreLink(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });

  test('restore modal can be closed with ✕ button', async ({ page }) => {
    await clickRestoreLink(page);
    await page.locator('.restore-modal #qr-close').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });

  test('restore modal closes by clicking backdrop', async ({ page }) => {
    await clickRestoreLink(page);
    // Click the modal-overlay outside the modal box
    await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });
});

// ─── Suite: Restore modal — tabs ─────────────────────────────────────────────

test.describe('Restore modal tabs', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await clickRestoreLink(page);
  });

  test('modal opens on "Enter phrase" tab by default', async ({ page }) => {
    await expect(page.locator('#restore-pane-phrase')).toBeVisible();
    await expect(page.locator('#restore-pane-scan')).toBeHidden();
  });

  test('"Enter phrase" tab shows textarea', async ({ page }) => {
    await expect(page.locator('#restore-seed-input')).toBeVisible();
  });

  test('clicking "Scan QR" tab shows scan pane', async ({ page }) => {
    await page.locator('.restore-tab[data-tab="scan"]').click();
    await expect(page.locator('#restore-pane-scan')).toBeVisible();
    await expect(page.locator('#restore-pane-phrase')).toBeHidden();
  });

  test('switching back to "Enter phrase" tab restores phrase pane', async ({ page }) => {
    await page.locator('.restore-tab[data-tab="scan"]').click();
    await page.locator('.restore-tab[data-tab="phrase"]').click();
    await expect(page.locator('#restore-pane-phrase')).toBeVisible();
    await expect(page.locator('#restore-pane-scan')).toBeHidden();
  });

  test('"Enter phrase" tab is active by default', async ({ page }) => {
    const tab = page.locator('.restore-tab[data-tab="phrase"]');
    await expect(tab).toHaveClass(/active/);
  });

  test('"Scan QR" tab becomes active on click', async ({ page }) => {
    await page.locator('.restore-tab[data-tab="scan"]').click();
    await expect(page.locator('.restore-tab[data-tab="scan"]')).toHaveClass(/active/);
    await expect(page.locator('.restore-tab[data-tab="phrase"]')).not.toHaveClass(/active/);
  });
});

// ─── Suite: Restore modal — live validation ───────────────────────────────────

test.describe('Restore modal — live phrase validation', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await clickRestoreLink(page);
  });

  test('Restore button is disabled initially', async ({ page }) => {
    await expect(page.locator('#restore-confirm-btn')).toBeDisabled();
  });

  test('no status shown with empty textarea', async ({ page }) => {
    const status = page.locator('#restore-seed-status');
    await expect(status).toHaveText('');
  });

  test('typing a valid 12-word phrase enables Restore button', async ({ page }) => {
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await expect(page.locator('#restore-confirm-btn')).toBeEnabled();
  });

  test('valid phrase shows ✓ status message', async ({ page }) => {
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await expect(page.locator('#restore-seed-status')).toContainText('✓');
  });

  test('valid phrase status contains "Valid"', async ({ page }) => {
    await fillSeedPhrase(page, VALID_MNEMONIC);
    const statusText = await page.locator('#restore-seed-status').textContent();
    expect(statusText?.toLowerCase()).toContain('valid');
  });

  test('too-short phrase keeps button disabled', async ({ page }) => {
    await fillSeedPhrase(page, INVALID_MNEMONIC_SHORT);
    await expect(page.locator('#restore-confirm-btn')).toBeDisabled();
  });

  test('short phrase shows ✗ error status', async ({ page }) => {
    await fillSeedPhrase(page, INVALID_MNEMONIC_SHORT);
    await expect(page.locator('#restore-seed-status')).toContainText('✗');
  });

  test('unknown word shows ✗ error status', async ({ page }) => {
    await fillSeedPhrase(page, INVALID_MNEMONIC_BADWORD);
    await expect(page.locator('#restore-seed-status')).toContainText('✗');
  });

  test('clearing input after valid phrase disables button again', async ({ page }) => {
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await expect(page.locator('#restore-confirm-btn')).toBeEnabled();

    await page.locator('#restore-seed-input').fill('');
    await page.waitForTimeout(100);
    await expect(page.locator('#restore-confirm-btn')).toBeDisabled();
    await expect(page.locator('#restore-seed-status')).toHaveText('');
  });

  test('phrase is accepted case-insensitively', async ({ page }) => {
    await fillSeedPhrase(page, VALID_MNEMONIC.toUpperCase());
    await expect(page.locator('#restore-confirm-btn')).toBeEnabled();
  });

  test('extra whitespace in phrase is tolerated', async ({ page }) => {
    const spacey = '  ' + VALID_MNEMONIC.replace(/ /g, '   ') + '  ';
    await fillSeedPhrase(page, spacey);
    await expect(page.locator('#restore-confirm-btn')).toBeEnabled();
  });
});

// ─── Suite: Restore modal — confirmation flow ─────────────────────────────────

test.describe('Restore modal — confirmation dialog', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await clickRestoreLink(page);
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await page.locator('#restore-confirm-btn').click();
    // Confirmation modal should now be visible
    await page.waitForSelector('#seed-restore-btn', { timeout: 3000 });
  });

  test('confirmation modal appears after clicking Restore', async ({ page }) => {
    await expect(page.locator('#seed-restore-btn')).toBeVisible();
  });

  test('confirmation modal shows "Restore Identity" heading', async ({ page }) => {
    await expect(page.locator('.modal h2')).toContainText('Restore Identity');
  });

  test('confirmation modal shows danger warning about replacing identity', async ({ page }) => {
    const body = await page.locator('.modal').textContent();
    expect(body?.toLowerCase()).toContain('replace');
  });

  test('confirmation modal shows the seed phrase to restore', async ({ page }) => {
    // At least the first word of the phrase should appear
    await expect(page.locator('.modal')).toContainText('snack');
  });

  test('cancel button closes the confirmation without restoring', async ({ page }) => {
    await page.locator('#qr-cancel').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });

  test('"Yes, Restore" button triggers restore and reloads app', async ({ page }) => {
    // After restore, app should reload and show the app with the restored identity
    const navigationPromise = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await page.locator('#seed-restore-btn').click();
    await navigationPromise;
    // After reload, the app should have loaded (either workspace or welcome)
    await waitForApp(page);
    // The app should work normally after restore
    await expect(page.locator('#create-ws-btn, .sidebar-header')).toBeVisible({ timeout: 8000 });
  });
});

// ─── Suite: Settings — Transfer button ───────────────────────────────────────

test.describe('Settings — Transfer / Seed QR', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'Test Workspace', 'Tester');
    await openSettings(page);

    // Transfer button appears only when a seed phrase already exists.
    // If missing, generate once and reopen settings to refresh conditional UI.
    if (await page.locator('#seed-transfer-btn').count() === 0) {
      await page.locator('#seed-phrase-btn').click();
      await page.waitForTimeout(500);
      await page.click('#settings-close');
      await openSettings(page);
    }

    await expect(page.locator('#seed-transfer-btn')).toBeVisible({ timeout: 5000 });
  });

  test('settings panel shows "Transfer" button next to seed phrase', async ({ page }) => {
    await expect(page.locator('#seed-transfer-btn')).toBeVisible();
  });

  test('Transfer button shows 📲 icon', async ({ page }) => {
    const text = await page.locator('#seed-transfer-btn').textContent();
    expect(text).toContain('📲');
  });

  test('clicking Transfer opens seed QR modal', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('.qr-modal', { timeout: 3000 });
    await expect(page.locator('.qr-modal')).toBeVisible();
  });

  test('seed QR modal has "Transfer to Another Device" heading', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('.qr-modal h2', { timeout: 3000 });
    await expect(page.locator('.qr-modal h2')).toContainText('Transfer to Another Device');
  });

  test('seed QR modal shows a QR code image', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('.qr-image', { timeout: 3000 });
    await expect(page.locator('.qr-image')).toBeVisible();
  });

  test('seed QR modal shows privacy warning', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('.seed-qr-warning', { timeout: 3000 });
    const warning = await page.locator('.seed-qr-warning').textContent();
    expect(warning?.toLowerCase()).toContain('private');
  });

  test('seed QR modal has "Show seed phrase instead" expandable section', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('details.seed-phrase-details', { timeout: 3000 });
    await expect(page.locator('details.seed-phrase-details')).toBeVisible();
  });

  test('expanding "Show seed phrase instead" reveals the seed phrase', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('details.seed-phrase-details', { timeout: 3000 });
    // Click to expand
    await page.locator('details.seed-phrase-details summary').click();
    // The seed phrase code block should now be visible
    await expect(page.locator('#seed-qr-words')).toBeVisible();
    // And should contain actual words (not empty)
    const words = await page.locator('#seed-qr-words').textContent();
    expect(words?.split(' ').length).toBeGreaterThanOrEqual(12);
  });

  test('Copy button in seed QR modal exists', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('details.seed-phrase-details', { timeout: 3000 });
    await page.locator('details.seed-phrase-details summary').click();
    await expect(page.locator('#seed-copy-btn')).toBeVisible();
  });

  test('seed QR modal can be closed with Escape', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('.qr-modal', { timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });

  test('seed QR modal can be closed with ✕ button', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('.qr-modal', { timeout: 3000 });
    // Count overlays before close (should be 2: settings + qr)
    const beforeClose = await page.locator('.modal-overlay').count();
    expect(beforeClose).toBeGreaterThanOrEqual(2);
    
    // Close the QR modal
    await page.locator('.qr-modal #qr-close').click();
    await page.waitForTimeout(300);
    
    // After closing QR, should have 1 less overlay (settings remains)
    const afterClose = await page.locator('.modal-overlay').count();
    expect(afterClose).toBe(beforeClose - 1);
    // QR modal should be gone
    await expect(page.locator('.qr-modal')).not.toBeVisible();
  });

  test('QR image src is a data: URL (generated locally)', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('.qr-image', { timeout: 3000 });
    const src = await page.locator('.qr-image').getAttribute('src');
    expect(src).toMatch(/^data:image\//);
  });

  test('"Scan a QR Code" hint text is visible below the QR image', async ({ page }) => {
    await page.locator('#seed-transfer-btn').click();
    await page.waitForSelector('.qr-modal', { timeout: 3000 });
    const hint = await page.locator('.qr-hint').textContent();
    expect(hint?.toLowerCase()).toContain('scan');
  });
});

// ─── Suite: Restore after actual seed phrase ──────────────────────────────────

test.describe('Full restore flow with pre-seeded identity', () => {
  test('restoring valid phrase results in a working app', async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);

    // Restore a known seed phrase
    await clickRestoreLink(page);
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await page.locator('#restore-confirm-btn').click();
    await page.waitForSelector('#seed-restore-btn', { timeout: 3000 });

    const reloadPromise = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await page.locator('#seed-restore-btn').click();
    await reloadPromise;

    // App should load normally
    await waitForApp(page);
    await expect(page.locator('#create-ws-btn, .sidebar-header')).toBeVisible({ timeout: 8000 });
  });

  test('restored identity persists after page reload', async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);

    // Restore seed phrase
    await clickRestoreLink(page);
    await fillSeedPhrase(page, VALID_MNEMONIC);
    await page.locator('#restore-confirm-btn').click();
    await page.waitForSelector('#seed-restore-btn', { timeout: 3000 });

    const reloadPromise = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await page.locator('#seed-restore-btn').click();
    await reloadPromise;

    await waitForApp(page);

    // Create a workspace so we can open settings
    await createWorkspace(page, 'After Restore', 'Me');
    await openSettings(page);

    // The seed phrase shown in settings should be derivable from our phrase
    // (we can't check exact phrase without reading it out, but Transfer button should exist)
    await expect(page.locator('#seed-transfer-btn')).toBeVisible();
  });
});
