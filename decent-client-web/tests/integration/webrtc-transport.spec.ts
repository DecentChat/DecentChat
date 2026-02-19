import { test, expect } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(() => relay?.close());

test.setTimeout(30000);

test('check transport state and attempt P2P connect', async ({ browser }) => {
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

  // Check transport state
  const p1State = await page1.evaluate(() => {
    const t = (window as any).__transport;
    return {
      peerId: t?.getMyPeerId?.(),
      serverCount: t?.getConnectedServerCount?.() ?? 0,
      signalingStatus: t?.getSignalingStatus?.(),
    };
  });

  const p2State = await page2.evaluate(() => {
    const t = (window as any).__transport;
    return {
      peerId: t?.getMyPeerId?.(),
      serverCount: t?.getConnectedServerCount?.() ?? 0,
      signalingStatus: t?.getSignalingStatus?.(),
    };
  });

  expect(p1State.peerId).toBeTruthy();
  expect(p2State.peerId).toBeTruthy();
  expect(p1State.serverCount).toBeGreaterThan(0);
  expect(p2State.serverCount).toBeGreaterThan(0);
  expect(p1State.signalingStatus[0].connected).toBe(true);
  expect(p2State.signalingStatus[0].connected).toBe(true);

  // P2 connects to P1
  const connectResult = await page2.evaluate(async (targetId: string) => {
    try {
      await (window as any).__transport.connect(targetId);
      return 'SUCCESS';
    } catch (e: any) {
      return `FAILED: ${e.message}`;
    }
  }, p1State.peerId);

  expect(connectResult).toBe('SUCCESS');

  // Verify bidirectional connection
  const p1Peers = await page1.evaluate(() => (window as any).__transport.getConnectedPeers());
  const p2Peers = await page2.evaluate(() => (window as any).__transport.getConnectedPeers());
  expect(p1Peers.length).toBeGreaterThan(0);
  expect(p2Peers.length).toBeGreaterThan(0);

  await ctx1.close();
  await ctx2.close();
});
