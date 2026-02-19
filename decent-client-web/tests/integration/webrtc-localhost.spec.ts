import { test, expect } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(() => relay?.close());

test.setTimeout(30000);

test('P2P works with localhost-only ICE (no STUN)', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  for (const page of [page1, page2]) {
    await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));
    await page.goto('/');
    await page.evaluate(async () => {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
    });
    await page.reload();
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return !loading || loading.style.opacity === '0';
    }, { timeout: 15000 });
    await page.waitForSelector('#create-ws-btn', { timeout: 15000 });
  }

  const p1Id = await page1.evaluate(() => (window as any).__transport?.getMyPeerId?.());

  // P1 listens for data
  await page1.evaluate(() => {
    (window as any).__data = [];
    const t = (window as any).__transport;
    const orig = t.onMessage;
    t.onMessage = (from: string, data: any) => {
      if (data?.type === 'ping') (window as any).__data.push(data.payload);
      if (orig) orig(from, data);
    };
  });

  // P2 connects and sends ping
  await page2.evaluate(async (targetId: string) => {
    (window as any).__data = [];
    const t = (window as any).__transport;
    const orig = t.onMessage;
    t.onMessage = (from: string, data: any) => {
      if (data?.type === 'pong') (window as any).__data.push(data.payload);
      if (orig) orig(from, data);
    };
    await t.connect(targetId);
    t.send(targetId, { type: 'ping', payload: 'ping' });
  }, p1Id);

  // Wait for ping
  await page1.waitForFunction(() => (window as any).__data.length > 0, { timeout: 10000 });
  const p1Data = await page1.evaluate(() => (window as any).__data);
  expect(p1Data).toContain('ping');

  // P1 sends pong
  const p2Id = await page2.evaluate(() => (window as any).__transport?.getMyPeerId?.());
  await page1.evaluate((targetId: string) => {
    (window as any).__transport.send(targetId, { type: 'pong', payload: 'pong' });
  }, p2Id);

  await page2.waitForFunction(() => (window as any).__data.length > 0, { timeout: 10000 });
  const p2Data = await page2.evaluate(() => (window as any).__data);
  expect(p2Data).toContain('pong');

  await ctx1.close();
  await ctx2.close();
});
