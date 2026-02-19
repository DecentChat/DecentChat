import { test, expect } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(() => relay?.close());

test.setTimeout(30000);

test('raw transport connection between two browser contexts', async ({ browser }) => {
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

  // Verify transport is initialized
  const p1Id = await page1.evaluate(() => (window as any).__transport?.getMyPeerId?.());
  const p2Id = await page2.evaluate(() => (window as any).__transport?.getMyPeerId?.());
  expect(p1Id).toBeTruthy();
  expect(p2Id).toBeTruthy();

  // Check connected server count
  const c1 = await page1.evaluate(() => (window as any).__transport?.getConnectedServerCount?.() ?? 0);
  const c2 = await page2.evaluate(() => (window as any).__transport?.getConnectedServerCount?.() ?? 0);
  expect(c1).toBeGreaterThan(0);
  expect(c2).toBeGreaterThan(0);

  // P2 connects to P1
  await page2.evaluate(async (targetId: string) => {
    await (window as any).__transport.connect(targetId);
  }, p1Id);

  // Verify connection established on both sides
  await page1.waitForFunction(
    () => (window as any).__transport?.getConnectedPeers?.()?.length > 0,
    { timeout: 10000 },
  );

  const p1Peers = await page1.evaluate(() => (window as any).__transport.getConnectedPeers());
  const p2Peers = await page2.evaluate(() => (window as any).__transport.getConnectedPeers());
  expect(p1Peers).toContain(p2Id);
  expect(p2Peers).toContain(p1Id);

  await ctx1.close();
  await ctx2.close();
});
