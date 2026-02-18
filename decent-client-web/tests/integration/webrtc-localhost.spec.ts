import { test, expect } from '@playwright/test';

test.setTimeout(30000);

test('P2P works with localhost-only ICE (no STUN)', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  page1.on('console', msg => console.log(`[P1] ${msg.text()}`));
  page2.on('console', msg => console.log(`[P2] ${msg.text()}`));

  for (const page of [page1, page2]) {
    await page.goto('/');
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return !loading || loading.style.opacity === '0';
    }, { timeout: 15000 });
    await page.waitForSelector('#create-ws-btn', { timeout: 15000 });
  }

  await page1.waitForTimeout(2000);

  // Override PeerJS ICE config to use NO STUN/TURN (localhost only)
  // This forces WebRTC to use only host candidates (127.0.0.1)
  const p1Id = await page1.evaluate(() => (window as any).__transport?.myPeerId);
  console.log(`[TEST] P1=${p1Id}`);

  // P1: listen for connections
  await page1.evaluate(() => {
    (window as any).__connected = false;
    (window as any).__data = [];
    const t = (window as any).__transport;
    const peer = t.signalingInstances[0].peer;
    peer.on('connection', (conn: any) => {
      console.log(`[P1] Incoming from ${conn.peer}`);
      conn.on('open', () => {
        console.log('[P1] Channel OPEN');
        (window as any).__connected = true;
        conn.send('pong');
      });
      conn.on('data', (d: any) => {
        console.log(`[P1] Data: ${d}`);
        (window as any).__data.push(String(d));
      });
    });
  });

  // P2: connect with empty ICE servers (localhost only)
  await page2.evaluate((targetId: string) => {
    (window as any).__connected = false;
    (window as any).__data = [];
    const t = (window as any).__transport;
    const peer = t.signalingInstances[0].peer;
    
    console.log(`[P2] Connecting to ${targetId} with empty ICE...`);
    const conn = peer.connect(targetId, { 
      reliable: true,
      // Override ICE config for localhost testing
      config: { iceServers: [] },
    } as any);
    
    conn.on('open', () => {
      console.log('[P2] Channel OPEN');
      (window as any).__connected = true;
      conn.send('ping');
    });
    conn.on('data', (d: any) => {
      console.log(`[P2] Data: ${d}`);
      (window as any).__data.push(String(d));
    });
    conn.on('error', (e: any) => console.log(`[P2] Error: ${e}`));

    // Monitor ICE state
    setTimeout(() => {
      if (conn.peerConnection) {
        console.log(`[P2] ICE: ${conn.peerConnection.iceConnectionState}`);
        console.log(`[P2] Signaling: ${conn.peerConnection.signalingState}`);
        // Log candidates
        const stats = conn.peerConnection.getStats();
        stats.then((s: any) => {
          s.forEach((v: any) => {
            if (v.type === 'local-candidate' || v.type === 'remote-candidate') {
              console.log(`[P2] ${v.type}: ${v.candidateType} ${v.address}:${v.port}`);
            }
          });
        });
      }
    }, 3000);
  }, p1Id);

  console.log('[TEST] Waiting...');

  try {
    await page2.waitForFunction(() => (window as any).__connected, { timeout: 15000 });
    console.log('[TEST] ✅ P2P CONNECTED!');
    
    // Wait for data exchange
    await page1.waitForFunction(() => (window as any).__data.length > 0, { timeout: 5000 });
    await page2.waitForFunction(() => (window as any).__data.length > 0, { timeout: 5000 });
    
    const p1Data = await page1.evaluate(() => (window as any).__data);
    const p2Data = await page2.evaluate(() => (window as any).__data);
    console.log(`[TEST] P1 received: ${JSON.stringify(p1Data)}`);
    console.log(`[TEST] P2 received: ${JSON.stringify(p2Data)}`);
    
    expect(p1Data).toContain('ping');
    expect(p2Data).toContain('pong');
  } catch {
    console.log('[TEST] ❌ Connection failed');
    
    // Dump ICE diagnostics
    const diag = await page2.evaluate(() => {
      return JSON.stringify({
        connected: (window as any).__connected,
        data: (window as any).__data,
      });
    }).catch(() => 'page closed');
    console.log(`[TEST] P2 state: ${diag}`);
  }

  await ctx1.close();
  await ctx2.close();
});
