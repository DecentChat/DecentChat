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

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 45000 });
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

async function createWorkspace(page: Page, name: string, alias: string): Promise<string> {
  const createBtn = page.locator('#create-ws-btn:visible, #ws-rail-add:visible').first();
  await createBtn.click();
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('.modal input[name="name"]').fill(name);
  await page.locator('.modal input[name="alias"]').fill(alias);
  await page.locator('.modal #modal-submit, .modal .btn-primary').first().click();
  await expect(page.locator('.sidebar-header h1')).toContainText(name, { timeout: 10000 });

  const wsId = await page.evaluate((workspaceName) => {
    const ctrl = (window as any).__ctrl;
    const ws = ctrl?.workspaceManager?.getAllWorkspaces?.().find((w: any) => w.name === workspaceName);
    return ws?.id || '';
  }, name);
  expect(wsId).toBeTruthy();
  return wsId;
}

test.describe('Mobile workspace switching', () => {
  test.setTimeout(180000);

  test('mobile sidebar shows workspace switch controls and allows switching workspaces', async ({ browser }) => {
    const alice = await createUser(browser);

    try {
      const alphaId = await createWorkspace(alice.page, 'Alpha Mobile', 'Alice');
      await createWorkspace(alice.page, 'Beta Mobile', 'Alice');

      // Switch to mobile viewport after workspace setup.
      await alice.page.setViewportSize({ width: 390, height: 844 });

      // Open sidebar from channel header.
      await alice.page.click('#hamburger-btn');
      await expect(alice.page.locator('#sidebar.open')).toBeVisible();

      // Mobile workspace tray is visible.
      await expect(alice.page.locator('[data-testid="mobile-workspace-tray"]')).toBeVisible();

      // Switch to Alpha from mobile tray.
      await alice.page.locator(`[data-testid="mobile-workspace-item"][data-ws-id="${alphaId}"]`).click();
      await expect(alice.page.locator('.sidebar-header h1')).toContainText('Alpha Mobile');

      // Mobile switch should close the sidebar drawer.
      await expect(alice.page.locator('#sidebar')).not.toHaveClass(/open/);
    } finally {
      await alice.context.close().catch(() => {});
    }
  });

  test('mobile tray add button opens create workspace flow', async ({ browser }) => {
    const alice = await createUser(browser);

    try {
      await createWorkspace(alice.page, 'Existing Mobile', 'Alice');

      await alice.page.setViewportSize({ width: 390, height: 844 });
      await alice.page.click('#hamburger-btn');

      await expect(alice.page.locator('[data-testid="mobile-workspace-tray"]')).toBeVisible();
      await alice.page.locator('[data-testid="mobile-workspace-add"]').click();

      await expect(alice.page.locator('.modal')).toBeVisible();
      await alice.page.locator('.modal input[name="name"]').fill('Gamma Mobile');
      await alice.page.locator('.modal input[name="alias"]').fill('Alice');
      await alice.page.locator('.modal #modal-submit, .modal .btn-primary').first().click();

      await expect(alice.page.locator('.sidebar-header h1')).toContainText('Gamma Mobile');

      // Verify workspace exists in app state (stable assertion without extra drawer toggles).
      const hasGamma = await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const all = ctrl?.workspaceManager?.getAllWorkspaces?.() || [];
        return all.some((ws: any) => ws.name === 'Gamma Mobile');
      });
      expect(hasGamma).toBe(true);
    } finally {
      await alice.context.close().catch(() => {});
    }
  });
});
