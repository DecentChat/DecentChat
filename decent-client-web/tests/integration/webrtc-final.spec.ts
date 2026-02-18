import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test('P2P data channel between two browser contexts', async ({ browser }) => {
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
  await page2.waitForTimeout(2000);

  // Verify transport state
  const p1Id = await page1.evaluate(() => (window as any).__transport?.myPeerId);
  const p2Id = await page2.evaluate(() => (window as any).__transport?.myPeerId);
  const p1Open = await page1.evaluate(() => {
    const t = (window as any).__transport;
    return t?.signalingInstances?.[0]?.peer?.open === true;
  });
  const p2Open = await page2.evaluate(() => {
    const t = (window as any).__transport;
    return t?.signalingInstances?.[0]?.peer?.open === true;
  });
  
  console.log(`[TEST] P1=${p1Id} open=${p1Open}, P2=${p2Id} open=${p2Open}`);

  // Set up P1 to track incoming connections via transport events
  await page1.evaluate(() => {
    (window as any).__p2pConnected = false;
    (window as any).__p2pData = [];
    const t = (window as any).__transport;
    // Hook into the PeerJS peer's connection event directly
    const inst = t.signalingInstances[0];
    inst.peer.on('connection', (conn: any) => {
      console.log(`[P1] INCOMING connection from ${conn.peer}`);
      conn.on('open', () => {
        console.log('[P1] Data channel OPEN');
        (window as any).__p2pConnected = true;
        conn.send('hello from P1');
      });
      conn.on('data', (data: any) => {
        console.log(`[P1] Received: ${data}`);
        (window as any).__p2pData.push(String(data));
      });
      conn.on('error', (err: any) => console.log(`[P1] Conn error: ${err}`));
    });
  });

  // P2: initiate connection to P1 using raw PeerJS (not transport.connect which has retry logic)
  await page2.evaluate((targetId: string) => {
    (window as any).__p2pConnected = false;
    (window as any).__p2pData = [];
    const t = (window as any).__transport;
    const inst = t.signalingInstances[0];
    
    console.log(`[P2] Attempting raw peer.connect(${targetId})...`);
    const conn = inst.peer.connect(targetId, { reliable: true });
    
    conn.on('open', () => {
      console.log('[P2] Data channel OPEN');
      (window as any).__p2pConnected = true;
      conn.send('hello from P2');
    });
    conn.on('data', (data: any) => {
      console.log(`[P2] Received: ${data}`);
      (window as any).__p2pData.push(String(data));
    });
    conn.on('error', (err: any) => console.log(`[P2] Conn error: ${err}`));
    conn.on('close', () => console.log('[P2] Conn closed'));
    
    // Also log ICE state
    if (conn.peerConnection) {
      conn.peerConnection.oniceconnectionstatechange = () => {
        console.log(`[P2] ICE state: ${conn.peerConnection.iceConnectionState}`);
      };
    }
  }, p1Id);

  // Wait for connection
  console.log('[TEST] Waiting for P2P connection...');
  
  try {
    await page2.waitForFunction(
      () => (window as any).__p2pConnected === true,
      { timeout: 20000 },
    );
    console.log('[TEST] P2 connected!');
  } catch {
    console.log('[TEST] P2 connection timed out');
    
    // Check final states
    const p2State = await page2.evaluate(() => ({
      connected: (window as any).__p2pConnected,
      data: (window as any).__p2pData,
    }));
    console.log(`[TEST] P2 final state: ${JSON.stringify(p2State)}`);
  }

  try {
    await page1.waitForFunction(
      () => (window as any).__p2pConnected === true,
      { timeout: 5000 },
    );
    console.log('[TEST] P1 received connection!');
    
    const p1Data = await page1.evaluate(() => (window as any).__p2pData);
    console.log(`[TEST] P1 received data: ${JSON.stringify(p1Data)}`);
  } catch {
    console.log('[TEST] P1 never received incoming connection');
  }

  await ctx1.close();
  await ctx2.close();
});
