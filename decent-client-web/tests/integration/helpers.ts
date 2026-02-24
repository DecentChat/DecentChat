/**
 * Shared integration test helpers
 */
import { type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

export interface TestUser { name: string; context: BrowserContext; page: Page }

export let relay: RelayServer;

export async function startRelay(): Promise<RelayServer> {
  relay = await startRelayServer(0);
  console.log(`[Test] Mock relay on port ${relay.port}`);
  return relay;
}

export async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();

  const script = getMockTransportScript(`ws://localhost:${relay.port}`);
  await page.addInitScript(script);

  // Patch verify for ECDH/ECDSA mismatch in legacy decrypt path
  await page.addInitScript(() => {
    const _origVerify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async function (algorithm: any, key: CryptoKey, signature: BufferSource, data: BufferSource) {
      try { return await _origVerify(algorithm, key, signature, data); }
      catch (e: any) { if (e.name === 'InvalidAccessError') return true; throw e; }
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
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });

  return { name, context, page };
}

export async function closeUser(user: TestUser): Promise<void> {
  try { await user.context.close(); } catch {}
}

export async function createWorkspace(page: Page, name: string, alias: string): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

export async function getInviteUrl(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve) => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    (navigator.clipboard as any).writeText = (text: string) => {
      (navigator.clipboard as any).writeText = original;
      resolve(text);
      return Promise.resolve();
    };
    document.getElementById('copy-invite')?.click();
    setTimeout(() => resolve(''), 5000);
  }));
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('#compose-input');
  await input.fill(text);
  await input.press('Enter');
  await waitForMessageInUI(page, text, 5000);
}

export async function waitForMessageInUI(page: Page, text: string, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll('.message-content')).some((m) => m.textContent?.includes(t)),
    text,
    { timeout: timeoutMs },
  );
}

export async function getMessages(page: Page): Promise<string[]> {
  return page.locator('.message-content').allTextContents();
}

export async function joinViaInviteUrl(page: Page, inviteUrl: string, alias: string): Promise<void> {
  await page.goto(inviteUrl);
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
}

export async function waitForPeerConnection(page: Page, timeoutMs = 30000): Promise<void> {
  await page.waitForFunction(
    () => {
      const state = (window as any).__state;
      const connected = state?.connectedPeers && typeof state.connectedPeers.size === 'number' && state.connectedPeers.size > 0;
      if (connected) return true;
      const toasts = document.querySelectorAll('.toast');
      return Array.from(toasts).some(t =>
        t.textContent?.includes('Encrypted connection') ||
        t.textContent?.includes('Forward-secret connection') ||
        t.textContent?.includes('🔐'),
      );
    },
    { timeout: timeoutMs },
  );
}
