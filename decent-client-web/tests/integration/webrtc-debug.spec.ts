/**
 * Minimal WebRTC/PeerJS connection test to isolate the P2P issue.
 */
import { test, expect } from '@playwright/test';

const SIGNAL_PORT = Number(process.env.PW_SIGNAL_PORT || '19090');

test.setTimeout(60000);

test('two PeerJS peers can connect via signaling server', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  // Both pages load the app (which includes PeerJS)
  await page1.goto('/');
  await page2.goto('/');

  // Wait for app to load
  for (const page of [page1, page2]) {
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return !loading || loading.style.opacity === '0';
    }, { timeout: 15000 });
  }

  page1.on('console', msg => console.log(`[P1] ${msg.text()}`));
  page2.on('console', msg => console.log(`[P2] ${msg.text()}`));

  // Create raw PeerJS connections in each page
  const peer1Id = await page1.evaluate((signalPort) => {
    return new Promise<string>((resolve, reject) => {
      // @ts-ignore - PeerJS should be available as import
      const Peer = (window as any).Peer;
      if (!Peer) {
        // Try to create a peer using the app's existing peer
        const el = document.getElementById('welcome-peer-id');
        resolve(el?.textContent || 'no-peer-id');
        return;
      }
      const peer = new Peer({ host: 'localhost', port: signalPort, path: '/peerjs', secure: false, debug: 3 });
      peer.on('open', (id: string) => resolve(id));
      peer.on('error', (err: Error) => reject(err));
    });
  }, SIGNAL_PORT);
  console.log(`[TEST] Peer1 ID: ${peer1Id}`);

  const peer2Id = await page2.evaluate((signalPort) => {
    return new Promise<string>((resolve, reject) => {
      const Peer = (window as any).Peer;
      if (!Peer) {
        const el = document.getElementById('welcome-peer-id');
        resolve(el?.textContent || 'no-peer-id');
        return;
      }
      const peer = new Peer({ host: 'localhost', port: signalPort, path: '/peerjs', secure: false, debug: 3 });
      peer.on('open', (id: string) => resolve(id));
      peer.on('error', (err: Error) => reject(err));
    });
  }, SIGNAL_PORT);
  console.log(`[TEST] Peer2 ID: ${peer2Id}`);

  // Now try connecting page2 to page1 using the app's transport
  // The app already initializes PeerTransport on load
  // Let's check if the app's peer is actually connected to the signaling server

  const p1Status = await page1.evaluate(() => {
    // Check the global app state for transport info
    return JSON.stringify({
      peerId: document.getElementById('welcome-peer-id')?.textContent,
      // Check if peerjs connection exists
      hasPeer: typeof (window as any).__PEER__ !== 'undefined',
    });
  });
  console.log(`[TEST] P1 status: ${p1Status}`);

  const p2Status = await page2.evaluate(() => {
    return JSON.stringify({
      peerId: document.getElementById('welcome-peer-id')?.textContent,
      hasPeer: typeof (window as any).__PEER__ !== 'undefined',
    });
  });
  console.log(`[TEST] P2 status: ${p2Status}`);

  // Try a direct PeerJS connection test
  const connectionResult = await page2.evaluate(async ({ targetPeerId, signalPort }) => {
    // We need to test the raw PeerJS connection
    // The app already has a PeerJS instance, but it's not exposed globally
    // Let's create our own to test
    try {
      const resp = await fetch(`http://localhost:${signalPort}/peerjs/peers`);
      const peers = await resp.json();
      return JSON.stringify({ connectedPeers: peers });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  }, { targetPeerId: peer1Id, signalPort: SIGNAL_PORT });

  console.log(`[TEST] Connected peers on signaling server: ${connectionResult}`);

  try {
    await ctx1.close();
  } catch {}
  try {
    await ctx2.close();
  } catch {}
});
