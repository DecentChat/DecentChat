import { test, expect } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

let relay: RelayServer;
test.beforeAll(async () => { relay = await startRelayServer(0); });
test.afterAll(async () => { relay?.close(); });

test('many messages: scrollbar and messages visible with thread open', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(getMockTransportScript('ws://localhost:' + relay.port));
  await page.addInitScript(() => {
    const _origVerify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async function(a: any, k: CryptoKey, s: BufferSource, d: BufferSource) {
      try { return await _origVerify(a, k, s, d); } catch(e: any) { if (e.name === 'InvalidAccessError') return true; throw e; }
    };
  });

  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) { for (const db of await indexedDB.databases()) { if (db.name) indexedDB.deleteDatabase(db.name); } }
    localStorage.clear();
  });
  await page.reload();
  await page.waitForFunction(() => { const l = document.getElementById('loading'); return !l || l.style.opacity === '0'; }, { timeout: 15000 });
  const openBtn = page.getByRole('button', { name: /open app/i });
  if (await openBtn.isVisible({ timeout: 2000 }).catch(() => false)) await openBtn.click();
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });

  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  await page.locator('.modal input[name="name"]').fill('ScrollTest');
  await page.locator('.modal input[name="alias"]').fill('Tester');
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });

  // Send 40 messages
  for (let i = 0; i < 40; i++) {
    const input = page.locator('#compose-input');
    await input.fill('Msg ' + (i+1) + ' - Testing scroll with many messages.');
    await input.press('Enter');
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1000);

  // Verify BEFORE thread
  const before = await page.evaluate(() => {
    const ml = document.getElementById('messages-list');
    return {
      h: ml?.offsetHeight, sh: ml?.scrollHeight, ch: ml?.clientHeight, st: ml?.scrollTop,
      msgs: ml?.querySelectorAll('.message').length,
      hasScrollbar: (ml?.scrollHeight || 0) > (ml?.clientHeight || 0),
      lastMsgVisible: (() => {
        const msgs = ml?.querySelectorAll('.message');
        if (!msgs?.length) return false;
        const last = msgs[msgs.length - 1];
        const rect = last.getBoundingClientRect();
        const mlRect = ml!.getBoundingClientRect();
        return rect.bottom <= mlRect.bottom + 10 && rect.top >= mlRect.top - 10;
      })(),
    };
  });
  console.log('BEFORE thread:', JSON.stringify(before));
  expect(before.hasScrollbar).toBe(true);
  expect(before.lastMsgVisible).toBe(true);

  // Open thread
  const firstMsg = page.locator('.message').first();
  await firstMsg.hover();
  await page.waitForTimeout(300);
  await page.locator('.message-thread-btn').first().click({ timeout: 3000 });
  await page.waitForTimeout(1500);

  // Verify AFTER thread
  const after = await page.evaluate(() => {
    const ml = document.getElementById('messages-list');
    const wrapper = ml?.parentElement;
    return {
      ml_h: ml?.offsetHeight, ml_sh: ml?.scrollHeight, ml_ch: ml?.clientHeight,
      wrapper_h: wrapper?.offsetHeight,
      msgs: ml?.querySelectorAll('.message').length,
      hasScrollbar: (ml?.scrollHeight || 0) > (ml?.clientHeight || 0),
      anyMsgVisible: (() => {
        const msgs = ml?.querySelectorAll('.message');
        if (!msgs?.length) return false;
        const mlRect = ml!.getBoundingClientRect();
        return Array.from(msgs).some(m => {
          const r = m.getBoundingClientRect();
          return r.bottom > mlRect.top && r.top < mlRect.bottom;
        });
      })(),
    };
  });
  console.log('AFTER thread:', JSON.stringify(after));
  expect(after.hasScrollbar, 'messages-list should have scrollbar').toBe(true);
  expect(after.anyMsgVisible, 'at least one message should be visible').toBe(true);

  await context.close();
});
