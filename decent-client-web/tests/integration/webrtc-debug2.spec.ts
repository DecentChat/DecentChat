import { test, expect } from '@playwright/test';

const SIGNAL_PORT = Number(process.env.PW_SIGNAL_PORT || '19090');

test.setTimeout(30000);

test('check transport signaling connection state', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();

  page1.on('console', msg => console.log(`[P1] ${msg.text()}`));
  page1.on('pageerror', err => console.log(`[P1 ERR] ${err.message}`));

  await page1.goto('/');
  await page1.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });
  await page1.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });

  // Wait a bit for transport to initialize
  await page1.waitForTimeout(3000);

  // Check signaling server state
  const signalingState = await page1.evaluate((signalPort) => {
    // Try to access the signaling server list endpoint
    return fetch(`http://localhost:${signalPort}/peerjs`).then(r => r.status).catch(e => -1);
  }, SIGNAL_PORT);
  console.log(`[TEST] Signaling server HTTP status: ${signalingState}`);

  // Try to check the Peer object state from browser console
  // The app doesn't expose the transport globally, so let's check what logs were printed
  console.log('[TEST] Check logs above for "Connected to" or "Signaling server unavailable"');

  try {
    await ctx1.close();
  } catch {}
});
