import { Page, expect } from '@playwright/test';

/**
 * Clear IndexedDB to start fresh — must be called after page.goto()
 */
export async function clearStorage(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    // Close any open connections first
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
    // Also clear localStorage/sessionStorage
    localStorage.clear();
    sessionStorage.clear();
  });
  // Reload to start fresh without cached state
  await page.reload();
}

/**
 * Wait for app to finish loading (loading screen gone)
 */
export async function waitForApp(page: Page) {
  // Wait for loading screen to disappear or not exist
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });
  // Wait for either welcome screen buttons or sidebar to appear
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
}

/**
 * Create a workspace and return to the main app view
 */
export async function createWorkspace(page: Page, name = 'Test Workspace', alias = 'Tester') {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');

  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');

  // Wait for workspace to load (sidebar should show workspace name)
  await page.waitForSelector('.sidebar-header', { timeout: 5000 });
}

/**
 * Send a message in the current channel
 */
export async function sendMessage(page: Page, text: string) {
  const input = page.locator('#compose-input');
  await input.fill(text);
  await input.press('Enter');
  // Wait for message to appear in the DOM
  await page.waitForFunction(
    (t) => document.querySelector('.messages-list')?.textContent?.includes(t),
    text,
    { timeout: 5000 }
  );
}

/**
 * Get all visible message texts
 */
export async function getMessages(page: Page): Promise<string[]> {
  return page.locator('.message-content').allTextContents();
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
