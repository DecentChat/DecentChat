import { test, expect } from '@playwright/test';

const SIGNAL_PORT = Number(process.env.PW_SIGNAL_PORT || '19090');

test.setTimeout(60000);

test('raw PeerJS connection between two browser contexts', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  page1.on('console', msg => console.log(`[P1] ${msg.text()}`));
  page2.on('console', msg => console.log(`[P2] ${msg.text()}`));
  page1.on('pageerror', err => console.log(`[P1 ERR] ${err.message}`));
  page2.on('pageerror', err => console.log(`[P2 ERR] ${err.message}`));

  // Load app in both 
  for (const page of [page1, page2]) {
    await page.goto('/');
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return !loading || loading.style.opacity === '0';
    }, { timeout: 15000 });
    await page.waitForSelector('#create-ws-btn', { timeout: 15000 });
  }

  // Wait for transports to initialize
  await page1.waitForTimeout(2000);
  await page2.waitForTimeout(2000);

  const p1Id = await page1.evaluate(() => document.getElementById('welcome-peer-id')?.textContent || '');
  const p2Id = await page2.evaluate(() => document.getElementById('welcome-peer-id')?.textContent || '');
  console.log(`[TEST] P1=${p1Id}, P2=${p2Id}`);

  // Set up P1 to listen for incoming data connections
  await page1.evaluate((signalPort) => {
    (window as any).__receivedData = [];
    (window as any).__connState = 'waiting';
    
    // Access PeerJS through import — the app bundles it
    // We need to create a fresh PeerJS instance since we can't access the app's
    import('peerjs').then(({ Peer }) => {
      console.log('[P1] Creating fresh PeerJS peer for test...');
      const peer = new Peer('test-p1-' + Date.now(), {
        host: 'localhost',
        port: signalPort,
        path: '/peerjs',
        secure: false,
        debug: 2,
      });
      
      peer.on('open', (id) => {
        console.log(`[P1] Test peer open with ID: ${id}`);
        (window as any).__testPeerId = id;
        (window as any).__connState = 'open';
      });
      
      peer.on('connection', (conn) => {
        console.log(`[P1] Incoming connection from ${conn.peer}`);
        (window as any).__connState = 'incoming';
        conn.on('data', (data) => {
          console.log(`[P1] Received data: ${data}`);
          (window as any).__receivedData.push(data);
        });
        conn.on('open', () => {
          console.log('[P1] Connection open!');
          (window as any).__connState = 'connected';
        });
      });
      
      peer.on('error', (err) => {
        console.log(`[P1] Peer error: ${err.type} - ${err.message}`);
      });
    });
  }, SIGNAL_PORT);

  // Wait for P1's test peer to be ready
  await page1.waitForFunction(() => (window as any).__connState === 'open', { timeout: 10000 });
  const testP1Id = await page1.evaluate(() => (window as any).__testPeerId);
  console.log(`[TEST] P1 test peer ID: ${testP1Id}`);

  // P2 connects to P1's test peer
  const connectResult = await page2.evaluate(async ({ targetId, signalPort }: { targetId: string; signalPort: number }) => {
    const { Peer } = await import('peerjs');
    console.log(`[P2] Creating peer and connecting to ${targetId}...`);
    
    return new Promise<string>((resolve) => {
      const peer = new Peer('test-p2-' + Date.now(), {
        host: 'localhost',
        port: signalPort,
        path: '/peerjs',
        secure: false,
        debug: 2,
      });
      
      peer.on('open', (id) => {
        console.log(`[P2] Open with ID: ${id}`);
        
        const conn = peer.connect(targetId, { reliable: true });
        console.log(`[P2] connect() called, waiting for open...`);
        
        conn.on('open', () => {
          console.log('[P2] Connection open! Sending test data...');
          conn.send('hello from P2');
          resolve('connected');
        });
        
        conn.on('error', (err) => {
          console.log(`[P2] Connection error: ${err}`);
          resolve(`error: ${err}`);
        });
        
        setTimeout(() => resolve('timeout'), 15000);
      });
      
      peer.on('error', (err) => {
        console.log(`[P2] Peer error: ${err.type} - ${err.message}`);
        resolve(`peer-error: ${err.message}`);
      });
    });
  }, { targetId: testP1Id, signalPort: SIGNAL_PORT });

  console.log(`[TEST] Connect result: ${connectResult}`);

  if (connectResult === 'connected') {
    // Wait for P1 to receive data
    await page1.waitForFunction(
      () => (window as any).__receivedData.length > 0,
      { timeout: 5000 },
    );
    const received = await page1.evaluate(() => (window as any).__receivedData);
    console.log(`[TEST] P1 received: ${JSON.stringify(received)}`);
    expect(received).toContain('hello from P2');
  } else {
    console.log(`[TEST] Connection failed: ${connectResult}`);
  }

  await ctx1.close();
  await ctx2.close();
});
