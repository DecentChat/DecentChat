import { test, expect } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(() => relay?.close());

test.setTimeout(30000);

test('P2P data channel between two browser contexts', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  page1.on('console', msg => console.log(`[P1] ${msg.text()}`));
  page2.on('console', msg => console.log(`[P2] ${msg.text()}`));

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
  const p2Id = await page2.evaluate(() => (window as any).__transport?.getMyPeerId?.());
  expect(p1Id).toBeTruthy();
  expect(p2Id).toBeTruthy();

  // Set up P1 to track incoming data
  await page1.evaluate(() => {
    (window as any).__p2pConnected = false;
    (window as any).__p2pData = [];
    const t = (window as any).__transport;
    const origOnMessage = t.onMessage;
    t.onMessage = (from: string, data: any) => {
      if (data?.type === 'test-data') {
        (window as any).__p2pData.push(data.payload);
      }
      if (origOnMessage) origOnMessage(from, data);
    };
  });

  // P2 connects to P1 via MockTransport relay
  await page2.evaluate(async (targetId: string) => {
    const t = (window as any).__transport;
    await t.connect(targetId);
    (window as any).__p2pConnected = true;
    t.send(targetId, { type: 'test-data', payload: 'hello from P2' });
  }, p1Id);

  // Wait for P1 to receive data
  await page1.waitForFunction(
    () => (window as any).__p2pData.length > 0,
    { timeout: 10000 },
  );

  const p1Data = await page1.evaluate(() => (window as any).__p2pData);
  expect(p1Data).toContain('hello from P2');

  // Send data back
  await page1.evaluate((targetId: string) => {
    const t = (window as any).__transport;
    t.send(targetId, { type: 'test-data', payload: 'hello from P1' });
  }, p2Id);

  await page2.evaluate(() => {
    (window as any).__p2pData = [];
    const t = (window as any).__transport;
    const origOnMessage = t.onMessage;
    t.onMessage = (from: string, data: any) => {
      if (data?.type === 'test-data') {
        (window as any).__p2pData.push(data.payload);
      }
      if (origOnMessage) origOnMessage(from, data);
    };
  });

  await page1.evaluate((targetId: string) => {
    (window as any).__transport.send(targetId, { type: 'test-data', payload: 'hello again from P1' });
  }, p2Id);

  await page2.waitForFunction(
    () => (window as any).__p2pData.length > 0,
    { timeout: 10000 },
  );

  const p2Data = await page2.evaluate(() => (window as any).__p2pData);
  expect(p2Data).toContain('hello again from P1');

  await ctx1.close();
  await ctx2.close();
});
