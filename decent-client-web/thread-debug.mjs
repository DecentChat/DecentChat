import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', msg => console.log('PAGE LOG', msg.type(), msg.text()));
page.on('pageerror', err => console.log('PAGE ERROR', err?.stack || String(err)));
await page.goto('http://127.0.0.1:5173/');
await page.waitForTimeout(1000);
const openAppBtn = page.getByRole('button', { name: /open app/i });
if (await openAppBtn.isVisible().catch(()=>false)) await openAppBtn.click();
await page.waitForTimeout(500);
if (await page.locator('#create-ws-btn').isVisible().catch(()=>false)) {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.locator('.modal input[name="name"]').fill('Debug WS');
  await page.locator('.modal input[name="alias"]').fill('Alice');
  await page.click('.modal .btn-primary');
  await page.waitForSelector('#compose-input', { timeout: 10000 });
}
const rootText = `thread-root-${Date.now()}`;
await page.locator('#compose-input').fill(rootText);
await page.locator('#compose-input').press('Enter');
await page.waitForFunction((text) => Array.from(document.querySelectorAll('.message-content')).some(m => m.textContent?.includes(text)), rootText, { timeout: 10000 });
const before = await page.evaluate((text) => {
  const ctrl = window.__ctrl;
  const rows = Array.from(document.querySelectorAll('.message'));
  const row = rows.find(r => r.textContent?.includes(text));
  const btn = row?.querySelector('.message-thread-btn');
  const panel = document.getElementById('thread-panel');
  const input = document.getElementById('thread-input');
  return {
    threadOpen: ctrl?.state?.threadOpen,
    activeThreadId: ctrl?.state?.activeThreadId,
    btnExists: !!btn,
    btnText: btn?.textContent,
    panelClass: panel?.className,
    panelHidden: panel?.classList.contains('hidden'),
    panelOpen: panel?.classList.contains('open'),
    inputVisible: !!input?.offsetParent,
  };
}, rootText);
console.log('BEFORE', JSON.stringify(before, null, 2));
const clickResult = await page.evaluate((text) => {
  const ctrl = window.__ctrl;
  const rows = Array.from(document.querySelectorAll('.message'));
  const row = rows.find(r => r.textContent?.includes(text));
  const btn = row?.querySelector('.message-thread-btn');
  if (!btn) return { error: 'no button' };
  try { btn.click(); } catch (err) { return { error: String(err) }; }
  const panel = document.getElementById('thread-panel');
  return {
    threadOpen: ctrl?.state?.threadOpen,
    activeThreadId: ctrl?.state?.activeThreadId,
    panelClass: panel?.className,
    panelHidden: panel?.classList.contains('hidden'),
    panelOpen: panel?.classList.contains('open'),
  };
}, rootText);
console.log('AFTER CLICK', JSON.stringify(clickResult, null, 2));
await page.waitForTimeout(500);
const after = await page.evaluate(() => {
  const ctrl = window.__ctrl;
  const panel = document.getElementById('thread-panel');
  const input = document.getElementById('thread-input');
  return {
    threadOpen: ctrl?.state?.threadOpen,
    activeThreadId: ctrl?.state?.activeThreadId,
    panelClass: panel?.className,
    panelHidden: panel?.classList.contains('hidden'),
    panelOpen: panel?.classList.contains('open'),
    inputVisible: !!input?.offsetParent,
    inputParentDisplay: input ? getComputedStyle(input.parentElement).display : null,
    panelDisplay: panel ? getComputedStyle(panel).display : null,
  };
});
console.log('AFTER 500MS', JSON.stringify(after, null, 2));
await browser.close();
