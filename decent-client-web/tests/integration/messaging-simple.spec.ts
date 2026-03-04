import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(async () => {
  relay?.close();
});

async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));
  await page.addInitScript(() => {
    const _origVerify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async function (algorithm: any, key: CryptoKey, signature: BufferSource, data: BufferSource) {
      try {
        return await _origVerify(algorithm, key, signature, data);
      } catch (e: any) {
        if (e.name === 'InvalidAccessError') return true;
        throw e;
      }
    };
  });

  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });

  const openAppBtn = page.getByRole('button', { name: /open app/i });
  if (await openAppBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openAppBtn.click();
  }

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });

  return { name, context, page };
}

async function createWorkspace(page: Page): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill('TestWS');
  await inputs.nth(1).fill('Alice');
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function getInviteUrl(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve) => {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    (navigator.clipboard as any).writeText = (text: string) => {
      (navigator.clipboard as any).writeText = orig;
      resolve(text);
      return Promise.resolve();
    };
    document.getElementById('copy-invite')?.click();
    setTimeout(() => resolve(''), 5000);
  }));
}

test.setTimeout(90000);

test('simple P2P message exchange', async ({ browser }) => {
  const alice = await createUser(browser, 'Alice');
  const bob = await createUser(browser, 'Bob');
  try {
    await createWorkspace(alice.page);
    const inviteUrl = await getInviteUrl(alice.page);

    await bob.page.goto(inviteUrl);
    await bob.page.waitForSelector('.modal', { timeout: 10000 });
    await bob.page.locator('input[name="alias"]').fill('Bob');
    await bob.page.click('.modal .btn-primary');
    await bob.page.waitForSelector('.sidebar-header', { timeout: 15000 });

    // Wait for both peers to show as online in sidebar
    await bob.page.waitForFunction(
      (min) => {
        const headers = document.querySelectorAll('.member-group-header');
        for (const h of headers) {
          const match = h.textContent?.match(/Online\s*—\s*(\d+)/);
          if (match && parseInt(match[1], 10) >= min) return true;
        }
        return false;
      },
      2,
      { timeout: 30000 },
    );

    const input = alice.page.locator('#compose-input');
    const msg = `simple-${Date.now()}`;
    await input.fill(msg);
    await input.press('Enter');

    await bob.page.waitForFunction(
      (t) => Array.from(document.querySelectorAll('.message-content')).some(m => m.textContent?.includes(t)),
      msg,
      { timeout: 15000 },
    );

    const bobMsgs = (await bob.page.locator('.message-content').allTextContents()).map(t => t.trim());
    expect(bobMsgs).toContain(msg);
  } finally {
    await alice.context.close();
    await bob.context.close();
  }
});
