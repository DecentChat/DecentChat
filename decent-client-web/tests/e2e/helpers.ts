import { Page, Locator, expect } from '@playwright/test';

/**
 * Clear IndexedDB to start fresh — must be called after page.goto()
 */
export async function clearStorage(page: Page) {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();

    // Best effort cleanup only — do not block tests on IDB/service worker teardown.
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) indexedDB.deleteDatabase(db.name);
        }
      }
    } catch {}

    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) void r.unregister();
      }
    } catch {}

    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) void caches.delete(k);
      }
    } catch {}
  });
}

/**
 * Wait for app to finish loading (loading screen gone)
 */
export async function waitForApp(page: Page) {
  const readySelector = '#create-ws-btn, #join-ws-btn, .sidebar-header, #compose-input';

  const waitReady = async (timeout: number) => {
    await page.waitForFunction(() => {
      const appReady = !!document.querySelector('#create-ws-btn, #join-ws-btn, .sidebar-header, #compose-input');
      if (appReady) return true;
      const loading = document.getElementById('loading') as HTMLElement | null;
      if (!loading) return true;
      const style = window.getComputedStyle(loading);
      return loading.style.opacity === '0' || loading.style.display === 'none' || style.display === 'none' || style.visibility === 'hidden';
    }, { timeout });

    await page.waitForSelector(readySelector, { timeout });
  };

  try {
    await waitReady(18000);
  } catch {
    if (page.isClosed()) throw new Error('page closed while waiting for app');
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitReady(18000);
  }
}

/**
 * Create a workspace and return to the main app view
 */
export async function createWorkspace(page: Page, name = 'Test Workspace', alias = 'Tester') {
  // Normalize to app route to avoid landing-page CTA redirect races.
  if (!page.url().includes('/app')) {
    await page.goto('/app');
  }
  await waitForApp(page);

  // Ensure no stale create modal is open.
  const staleModalClose = page.locator('.modal .btn-secondary').first();
  if (await staleModalClose.count()) {
    await staleModalClose.click().catch(() => {});
  }

  const createBtn = page.locator('#create-ws-btn-nav, #create-ws-btn').first();
  await createBtn.click();
  const createHeading = page.getByRole('heading', { name: /Create private group/i });
  const headingVisible = await createHeading.isVisible({ timeout: 3000 }).catch(() => false);
  if (!headingVisible) {
    await createBtn.click({ force: true });
  }
  await createHeading.waitFor({ state: 'visible', timeout: 10000 });

  const modal = page.locator('.modal').last();
  const nameInput = modal.locator('input[name="name"], input[placeholder="e.g. Design team"]').first();
  const aliasInput = modal.locator('input[name="alias"], input[placeholder="Your name"]').first();
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await expect(aliasInput).toBeVisible({ timeout: 5000 });

  const fillAndVerify = async (input: Locator, value: string): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await input.click();
      await input.fill(value);
      if ((await input.inputValue()) === value) return;

      await input.fill('');
      await input.pressSequentially(value, { delay: 10 });
      if ((await input.inputValue()) === value) return;
    }

    await expect(input).toHaveValue(value, { timeout: 3000 });
  };

  await fillAndVerify(nameInput, name);
  await fillAndVerify(aliasInput, alias);

  const submitButton = modal.locator('.btn-primary.create-workspace-submit, .btn-primary').first();
  await expect(submitButton).toBeVisible({ timeout: 5000 });
  await submitButton.click();

  // Wait for workspace to load (sidebar should show workspace name)
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

/**
 * Send a message in the current channel
 */
export async function sendMessage(page: Page, text: string) {
  const input = page.locator('#compose-input');
  const beforeCount = await page.locator('.message-content').count();
  await input.fill(text);
  await input.press('Enter');

  // Avoid strict text includes (special-char normalization differs by renderer).
  await page.waitForFunction(
    (countBefore) => document.querySelectorAll('.message-content').length > countBefore,
    beforeCount,
    { timeout: 8000 }
  );
}

/**
 * Get all visible message texts
 */
export async function getMessages(page: Page): Promise<string[]> {
  const texts = await page.locator('.message-content').allTextContents();
  return texts.map((t) => t.trim()).filter(Boolean);
}

/**
 * Open settings panel
 */
export async function openSettings(page: Page) {
  await page.click('#settings-btn');
  await page.waitForSelector('.settings-modal', { timeout: 3000 });
}

/**
 * Close any open modal
 */
export async function closeModal(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 3000 }).catch(() => {});
}
