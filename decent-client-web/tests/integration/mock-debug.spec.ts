/**
 * Debug test to trace MockTransport behavior
 */
import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
  console.log(`[Test] Mock relay on port ${relay.port}`);
});

test.afterAll(() => relay?.close());

async function createPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();

  // Log all console messages
  page.on('console', msg => console.log(`[Browser] ${msg.text()}`));

  const script = getMockTransportScript(`ws://localhost:${relay.port}`);
  await page.addInitScript(script);

  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
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
  await page.waitForFunction(() => {
    const t = (window as any).__transport;
    return t && t.getMyPeerId && t.getMyPeerId();
  }, { timeout: 10000 });
  return page;
}

test('debug: check mock transport injection', async ({ browser }) => {
  test.setTimeout(60000);

  const page1 = await createPage(browser);
  const page2 = await createPage(browser);

  // Check that MockTransport is being used
  const isMock1 = await page1.evaluate(() => {
    const t = (window as any).__transport;
    return {
      hasMockTransport: !!(window as any).__MockTransport,
      transportType: t?.constructor?.name,
      myPeerId: t?.getMyPeerId?.(),
      signalingStatus: t?.getSignalingStatus?.(),
    };
  });
  console.log('[Debug] Page 1 transport:', JSON.stringify(isMock1, null, 2));

  const isMock2 = await page2.evaluate(() => {
    const t = (window as any).__transport;
    return {
      hasMockTransport: !!(window as any).__MockTransport,
      transportType: t?.constructor?.name,
      myPeerId: t?.getMyPeerId?.(),
      signalingStatus: t?.getSignalingStatus?.(),
    };
  });
  console.log('[Debug] Page 2 transport:', JSON.stringify(isMock2, null, 2));

  // Now try a direct connect
  const p1Id = isMock1.myPeerId;
  const p2Id = isMock2.myPeerId;

  console.log(`[Debug] Connecting ${p2Id} -> ${p1Id}`);

  // Connect page2 to page1
  await page2.evaluate(async (targetId: string) => {
    const t = (window as any).__transport;
    console.log(`[Mock] Calling connect(${targetId})`);
    await t.connect(targetId);
    console.log(`[Mock] connect() resolved`);
    console.log(`[Mock] Connected peers:`, t.getConnectedPeers());
  }, p1Id);

  // Small wait for relay to forward
  await page1.waitForTimeout(1000);

  // Check both sides
  const p1Peers = await page1.evaluate(() => {
    const t = (window as any).__transport;
    return {
      connectedPeers: t.getConnectedPeers(),
      readyPeers: Array.from((window as any).__state?.readyPeers || []),
      connectedPeersFromState: Array.from((window as any).__state?.connectedPeers || []),
    };
  });
  console.log('[Debug] Page 1 peers:', JSON.stringify(p1Peers, null, 2));

  const p2Peers = await page2.evaluate(() => {
    const t = (window as any).__transport;
    return {
      connectedPeers: t.getConnectedPeers(),
      readyPeers: Array.from((window as any).__state?.readyPeers || []),
      connectedPeersFromState: Array.from((window as any).__state?.connectedPeers || []),
    };
  });
  console.log('[Debug] Page 2 peers:', JSON.stringify(p2Peers, null, 2));

  // Try to send a message directly through transport
  const sent = await page2.evaluate((targetId: string) => {
    const t = (window as any).__transport;
    return t.send(targetId, { type: 'test', content: 'hello from page2' });
  }, p1Id);
  console.log('[Debug] Send result:', sent);

  // Wait and check if page1 received it
  await page1.waitForTimeout(1000);

  expect(isMock1.transportType).toBe('MockTransport');
  expect(isMock2.transportType).toBe('MockTransport');
});
