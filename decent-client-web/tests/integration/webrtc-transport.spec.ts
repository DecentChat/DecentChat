import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test('check transport state and attempt P2P connect', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  page1.on('console', msg => console.log(`[P1] ${msg.text()}`));
  page2.on('console', msg => console.log(`[P2] ${msg.text()}`));
  page1.on('pageerror', err => console.log(`[P1 ERR] ${err.message}`));
  page2.on('pageerror', err => console.log(`[P2 ERR] ${err.message}`));

  for (const page of [page1, page2]) {
    await page.goto('/');
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return !loading || loading.style.opacity === '0';
    }, { timeout: 15000 });
    await page.waitForSelector('#create-ws-btn', { timeout: 15000 });
  }

  // Wait for transports to fully initialize
  await page1.waitForTimeout(3000);
  await page2.waitForTimeout(3000);

  // Check transport state
  const p1State = await page1.evaluate(() => {
    const t = (window as any).__transport;
    if (!t) return 'NO TRANSPORT';
    return JSON.stringify({
      peerId: t.myPeerId,
      signalingCount: t.signalingInstances?.length ?? -1,
      connectedServers: t.signalingInstances?.filter((i: any) => i.connected).length ?? -1,
      hasOnConnection: typeof t.onConnection,
    });
  });
  console.log(`[TEST] P1 transport: ${p1State}`);

  const p2State = await page2.evaluate(() => {
    const t = (window as any).__transport;
    if (!t) return 'NO TRANSPORT';
    return JSON.stringify({
      peerId: t.myPeerId,
      signalingCount: t.signalingInstances?.length ?? -1,
      connectedServers: t.signalingInstances?.filter((i: any) => i.connected).length ?? -1,
    });
  });
  console.log(`[TEST] P2 transport: ${p2State}`);

  // Set up P1 to log incoming connections
  await page1.evaluate(() => {
    const t = (window as any).__transport;
    if (t && t.signalingInstances) {
      for (const inst of t.signalingInstances) {
        if (inst.peer) {
          console.log(`[P1] PeerJS peer state: ${inst.peer.open ? 'OPEN' : 'NOT OPEN'}, id: ${inst.peer.id}, destroyed: ${inst.peer.destroyed}, disconnected: ${inst.peer.disconnected}`);
        }
      }
    }
  });

  await page2.evaluate(() => {
    const t = (window as any).__transport;
    if (t && t.signalingInstances) {
      for (const inst of t.signalingInstances) {
        if (inst.peer) {
          console.log(`[P2] PeerJS peer state: ${inst.peer.open ? 'OPEN' : 'NOT OPEN'}, id: ${inst.peer.id}, destroyed: ${inst.peer.destroyed}, disconnected: ${inst.peer.disconnected}`);
        }
      }
    }
  });

  // Try P2 connecting to P1
  const p1Id = await page1.evaluate(() => (window as any).__transport?.myPeerId || '');
  console.log(`[TEST] Attempting P2 -> P1 (${p1Id})`);

  const connectResult = await page2.evaluate(async (targetId: string) => {
    const t = (window as any).__transport;
    if (!t) return 'NO TRANSPORT';
    
    try {
      console.log(`[P2] Calling transport.connect(${targetId})...`);
      await t.connect(targetId);
      return 'SUCCESS';
    } catch (e: any) {
      return `FAILED: ${e.message}`;
    }
  }, p1Id);

  console.log(`[TEST] Connect result: ${connectResult}`);

  await ctx1.close();
  await ctx2.close();
});
