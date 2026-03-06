import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

async function clearStorage(page: Page): Promise<void> {
  await page.goto('/app');
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}

async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 20000 });

  const openAppBtn = page.getByRole('button', { name: /open app/i });
  if (await openAppBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openAppBtn.click();
  }

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 20000 });
}

async function createUser(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await clearStorage(page);
  await waitForApp(page);
  return { context, page };
}

async function createWorkspace(page: Page, name: string, alias: string): Promise<void> {
  const createBtn = page.locator('#create-ws-btn:visible, #ws-rail-add:visible').first();
  await createBtn.click();
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('.modal input[name="name"]').fill(name);
  await page.locator('.modal input[name="alias"]').fill(alias);
  await page.locator('.modal #modal-submit, .modal .btn-primary').first().click();
  await expect(page.locator('.sidebar-header h1')).toContainText(name, { timeout: 10000 });
}

test.describe('Mobile workspace switching', () => {
  test.setTimeout(90000);

  test('mobile sidebar shows workspace switch controls', async ({ browser }) => {
    const alice = await createUser(browser);

    try {
      await createWorkspace(alice.page, 'Mobile Alpha', 'Alice');
      await createWorkspace(alice.page, 'Mobile Beta', 'Alice');

      // Switch to mobile viewport after workspace setup.
      await alice.page.setViewportSize({ width: 390, height: 844 });

      // Open sidebar from channel header.
      await alice.page.click('#hamburger-btn');
      await expect(alice.page.locator('#sidebar.open')).toBeVisible();

      // Expected new mobile workspace tray (currently missing => failing test).
      await expect(alice.page.locator('[data-testid="mobile-workspace-tray"]')).toBeVisible();

      // Expected ability to switch workspaces from mobile.
      await alice.page.locator('[data-testid="mobile-workspace-item"]').filter({ hasText: 'MO' }).first().click();
      await expect(alice.page.locator('.sidebar-header h1')).toContainText('Mobile Alpha');
    } finally {
      await alice.context.close();
    }
  });
});
