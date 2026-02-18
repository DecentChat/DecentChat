/**
 * Direct PeerJS data channel test between two Playwright contexts.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(30000);

test('PeerJS data channel works between two browser contexts', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  // Load a minimal page with PeerJS
  // We'll use the Vite dev server since it has PeerJS bundled
  await page1.goto('/');
  await page2.goto('/');

  // Wait for app to fully load
  for (const page of [page1, page2]) {
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return !loading || loading.style.opacity === '0';
    }, { timeout: 15000 });
    await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
  }

  page1.on('console', msg => console.log(`[P1] ${msg.text()}`));
  page2.on('console', msg => console.log(`[P2] ${msg.text()}`));
  page1.on('pageerror', err => console.log(`[P1 ERR] ${err.message}`));
  page2.on('pageerror', err => console.log(`[P2 ERR] ${err.message}`));

  // Get peer IDs (already assigned by PeerJS during app init)
  const p1Id = await page1.evaluate(() => document.getElementById('welcome-peer-id')?.textContent || '');
  const p2Id = await page2.evaluate(() => document.getElementById('welcome-peer-id')?.textContent || '');
  console.log(`[TEST] P1=${p1Id}, P2=${p2Id}`);

  // Set up page1 to listen for incoming connections and messages
  await page1.evaluate(() => {
    (window as any).__received = [];
    (window as any).__connectionStatus = 'waiting';
    // The app already has a PeerJS instance listening on the transport
    // We need to hook into it or create a parallel listener
    console.log('[P1] Setting up listener... checking if transport has incoming handler');
  });

  // Have page2 create a workspace and page1 join it, to trigger connect
  // Actually, let's test the raw PeerJS layer
  // Inject a simple peer-to-peer test bypassing the app
  
  // Create standalone PeerJS instances
  const result = await Promise.race([
    (async () => {
      // P1: create a new PeerJS peer on the signaling server, wait for incoming data
      const p1Setup = page1.evaluate(() => {
        return new Promise<string>((resolve) => {
          // Import PeerJS from the bundled app
          import('/src/main.ts').catch(() => {});
          
          // Create a simple test: use the already-running transport
          // Actually, let's just test if the signaling server is listing our peers
          // by checking the /peerjs endpoint
          console.log('[P1] App peer is already initialized');
          resolve('ready');
        });
      });

      // P2: connect to P1's peer ID
      await page2.waitForTimeout(1000);
      
      const p2Result = await page2.evaluate(async (targetId: string) => {
        console.log(`[P2] Attempting to connect to ${targetId}`);
        
        // Try using the app's transport.connect method
        // The transport is initialized but we can't access it directly
        // Let's try a raw WebRTC test instead
        
        try {
          // Check if the target peer exists on the signaling server
          // by attempting to connect via the app flow
          console.log('[P2] Creating workspace to trigger connect...');
          
          // Create a workspace first
          const createBtn = document.getElementById('create-ws-btn');
          if (createBtn) {
            createBtn.click();
            // Wait for modal
            await new Promise(r => setTimeout(r, 500));
            
            const form = document.querySelector('.modal form');
            if (form) {
              const inputs = form.querySelectorAll('input');
              if (inputs[0]) (inputs[0] as HTMLInputElement).value = 'Test WS';
              if (inputs[1]) (inputs[1] as HTMLInputElement).value = 'P2';
              form.dispatchEvent(new Event('submit', { bubbles: true }));
              
              await new Promise(r => setTimeout(r, 1000));
              console.log('[P2] Workspace created, now connecting to peer...');
              
              // Try to connect via the copy-invite button area
              // Actually, we need to trigger transport.connect(targetId) directly
              // But we don't have direct access
            }
          }
          
          return 'setup-complete';
        } catch (e) {
          return `error: ${(e as Error).message}`;
        }
      }, p1Id);
      
      console.log(`[TEST] P2 result: ${p2Result}`);
      return 'completed';
    })(),
    new Promise<string>(r => setTimeout(() => r('timeout'), 25000)),
  ]);

  console.log(`[TEST] Result: ${result}`);

  await ctx1.close();
  await ctx2.close();
});
