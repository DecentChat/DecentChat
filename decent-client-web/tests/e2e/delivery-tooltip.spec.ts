/**
 * Delivery tooltip stability test (deterministic)
 *
 * Verifies that when message status is updated, the message-row tooltip updates too,
 * including while currently hovered (MutationObserver path in TooltipManager).
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(async () => {
  relay?.close();
});

interface TestUser {
  context: BrowserContext;
  page: Page;
}

async function createUser(browser: Browser): Promise<TestUser> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));
  await page.addInitScript(() => {
    const orig = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async (alg: any, key: CryptoKey, sig: BufferSource, data: BufferSource) => {
      try { return await orig(alg, key, sig, data); }
      catch (e: any) { if (e.name === 'InvalidAccessError') return true; throw e; }
    };
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      for (const db of await indexedDB.databases()) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 20000 });

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 20000 });
  return { context, page };
}

async function closeUser(user: TestUser): Promise<void> {
  await user.context.close().catch(() => {});
}

async function createWorkspace(page: Page, name: string, alias: string): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  await page.locator('.modal input[name="name"]').fill(name);
  await page.locator('.modal input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const before = await page.locator('.message-content').count();
  await page.locator('#compose-input').fill(text);
  await page.locator('#compose-input').press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.message-content').length > n, before, { timeout: 8000 });
}

test.describe('delivery tooltip regression', () => {
  test('status tooltip updates while hovered after status changes', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'tooltip hover behavior validated in chromium');

    const user = await createUser(browser);

    try {
      await createWorkspace(user.page, 'Tooltip Test', 'Alice');

      const text = `status-tip-${Date.now()}`;
      await sendMessage(user.page, text);

      const row = user.page
        .locator('.message')
        .filter({ has: user.page.locator('.message-content', { hasText: text }) })
        .first();
      await expect(row).toBeVisible();

      const messageId = await row.getAttribute('data-message-id');
      expect(messageId).toBeTruthy();

      const status = user.page.locator(`.msg-delivery-status[data-message-id="${messageId}"]`);
      await expect(status).toBeVisible();

      const apiInfo = await user.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        return {
          hasCtrl: !!ctrl,
          hasUi: !!ctrl?.ui,
          updateType: typeof ctrl?.ui?.updateMessageStatus,
        };
      });
      expect(apiInfo.hasCtrl).toBe(true);
      expect(apiInfo.hasUi).toBe(true);
      expect(apiInfo.updateType).toBe('function');

      // Mimic ChatController: mutate the in-memory messageStore entry first
      // (updateMessageStatus patches shellData, but the deferred syncShellMessages
      // re-reads from messageStore via rAF and would revert the patch otherwise).
      await user.page.evaluate(({ id }) => {
        const ctrl = (window as any).__ctrl;
        const channelId = ctrl.state?.activeChannelId;
        if (channelId) {
          const msgs = ctrl.messageStore.getMessages(channelId);
          const msg = msgs.find((m: any) => m.id === id);
          if (msg) {
            (msg as any).status = 'delivered';
            (msg as any).recipientPeerIds = ['peer-0'];
            (msg as any).ackedBy = ['peer-0'];
            (msg as any).readBy = [];
          }
        }
        ctrl.ui.updateMessageStatus(id, 'delivered', { acked: 1, total: 1, read: 0 });
      }, { id: messageId });

      await expect.poll(async () => (await status.getAttribute('data-tooltip')) || '', { timeout: 3000 })
        .toContain('Delivered');

      // Hover and ensure tooltip is visible
      await status.hover();
      await expect(user.page.locator('.ft-tooltip')).toBeVisible();
      await expect(user.page.locator('.ft-tooltip')).toContainText('Delivered');

      // Update to read while hovered; tooltip text should live-update.
      await user.page.evaluate(({ id }) => {
        const ctrl = (window as any).__ctrl;
        const channelId = ctrl.state?.activeChannelId;
        if (channelId) {
          const msgs = ctrl.messageStore.getMessages(channelId);
          const msg = msgs.find((m: any) => m.id === id);
          if (msg) {
            (msg as any).status = 'read';
            (msg as any).readBy = ['peer-0'];
          }
        }
        ctrl?.ui?.updateMessageStatus?.(id, 'read', { acked: 1, total: 1, read: 1 });
      }, { id: messageId });

      await expect.poll(async () => (await status.getAttribute('data-tooltip')) || '', { timeout: 3000 })
        .toContain('Read');
      await expect(user.page.locator('.ft-tooltip')).toContainText('Read');
    } finally {
      await closeUser(user);
    }
  });
});
