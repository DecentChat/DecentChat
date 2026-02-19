import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test('raw transport connection between two browser contexts', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  for (const page of [page1, page2]) {
    await page.goto('/');
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return !loading || loading.style.opacity === '0';
    }, { timeout: 15000 });
    await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
  }

  const p1Id = await page1.evaluate(() => (window as any).__transport?.myPeerId || '');
  const p2Id = await page2.evaluate(() => (window as any).__transport?.myPeerId || '');
  expect(p1Id).toBeTruthy();
  expect(p2Id).toBeTruthy();

  // Trigger app-level connect via transport (no direct `import('peerjs')` in browser test context)
  await page2.evaluate(async (targetId: string) => {
    const t = (window as any).__transport;
    await t.connect(targetId);
  }, p1Id);

  await page2.waitForFunction(() => {
    const t = (window as any).__transport;
    return (t?.connections?.size || 0) > 0;
  }, { timeout: 20000 });

  await page1.waitForFunction(() => {
    const t = (window as any).__transport;
    return (t?.connections?.size || 0) > 0;
  }, { timeout: 20000 });

  const c1 = await page1.evaluate(() => (window as any).__transport?.connections?.size || 0);
  const c2 = await page2.evaluate(() => (window as any).__transport?.connections?.size || 0);
  expect(c1).toBeGreaterThan(0);
  expect(c2).toBeGreaterThan(0);

  await ctx1.close();
  await ctx2.close();
});
