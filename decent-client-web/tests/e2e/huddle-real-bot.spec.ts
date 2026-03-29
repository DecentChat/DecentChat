/**
 * Real Bot Huddle Test
 *
 * This test opens a REAL headed browser, joins Alex's workspace,
 * starts a huddle, and captures all diagnostics for debugging
 * bot → browser audio.
 *
 * Run with: npx playwright test tests/e2e/huddle-real-bot.spec.ts --headed --reporter=line
 */

import { test, expect, chromium } from '@playwright/test';

test.setTimeout(60000);

test.skip('Real browser joins huddle and captures bot audio diagnostics', async () => {
  // This test requires --headed mode and a live decentchat.app server.
  // Run manually: npx playwright test tests/e2e/huddle-real-bot.spec.ts --headed --reporter=line
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--use-fake-ui-for-media-stream', // Auto-grant mic permission
      '--use-fake-device-for-media-stream', // Use fake mic
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect all console logs
  const logs: { type: string; text: string; ts: number }[] = [];
  page.on('console', msg => {
    logs.push({ type: msg.type(), text: msg.text(), ts: Date.now() });
    if (msg.text().includes('[Huddle]') || msg.text().includes('ontrack') || msg.text().includes('audio')) {
      console.log(`[${msg.type()}] ${msg.text()}`);
    }
  });

  try {
    // Join Alex's workspace
    await page.goto('https://decentchat.app/join/9e70fc09-eb30-477c-aec7-622564707ccd');

    // Fill in name and join
    await page.waitForSelector('.modal input[name="alias"]', { timeout: 10000 });
    await page.locator('.modal input[name="alias"]').fill('XenaDebug');
    await page.click('.modal .btn-primary');

    // Wait for workspace to load
    await page.waitForSelector('#huddle-start-btn', { timeout: 15000 });
    console.log('[Test] Workspace loaded, huddle button visible');

    // Inject diagnostic script before starting huddle
    await page.evaluate(() => {
      (window as any).__huddleDiagnostics = {
        peerConnections: new Map(),
        tracks: new Map(),
        audioElements: new Map(),
      };

      // Patch RTCPeerConnection to capture all connections
      const OriginalRTCPeerConnection = (window as any).RTCPeerConnection;
      (window as any).RTCPeerConnection = function(...args: any[]) {
        const pc = new OriginalRTCPeerConnection(...args);
        const id = Math.random().toString(36).slice(2, 10);
        console.log(`[HuddleDiag] RTCPeerConnection created: ${id}`);

        (window as any).__huddleDiagnostics.peerConnections.set(id, {
          pc,
          createdAt: Date.now(),
          events: [],
        });

        // Capture all events
        const originalAddEventListener = pc.addEventListener.bind(pc);
        pc.addEventListener = function(event: string, handler: any, options?: any) {
          const wrappedHandler = (...args: any[]) => {
            console.log(`[HuddleDiag] PC ${id} event: ${event}`, args.map((a: any) => a?.type || a?.constructor?.name || String(a)).join(', '));
            handler(...args);
          };
          return originalAddEventListener(event, wrappedHandler, options);
        };

        // Track event
        pc.addEventListener('track', (event: RTCTrackEvent) => {
          const track = event.track;
          console.log(`[HuddleDiag] ontrack fired! kind=${track.kind}, readyState=${track.readyState}, muted=${track.muted}, id=${track.id}`);
          console.log(`[HuddleDiag] streams: ${event.streams.length}, stream active: ${event.streams[0]?.active}`);

          (window as any).__huddleDiagnostics.tracks.set(track.id, {
            track,
            streams: event.streams,
            firedAt: Date.now(),
          });

          // Monitor track state changes
          track.addEventListener('mute', () => console.log(`[HuddleDiag] Track ${track.id} muted`));
          track.addEventListener('unmute', () => console.log(`[HuddleDiag] Track ${track.id} unmuted`));
          track.addEventListener('ended', () => console.log(`[HuddleDiag] Track ${track.id} ended`));
        });

        return pc;
      };
    });

    // Start huddle
    await page.click('#huddle-start-btn');
    console.log('[Test] Clicked Start Huddle');

    // Wait for huddle bar to appear
    await page.waitForFunction(() => {
      const bar = document.getElementById('huddle-bar');
      return bar && bar.style.display !== 'none';
    }, { timeout: 10000 });
    console.log('[Test] Huddle bar visible');

    // Wait for peer connection and bot to join
    await page.waitForTimeout(5000);

    // Get diagnostics
    const diag = await page.evaluate(() => {
      const results: any = {
        peerConnections: [],
        tracks: [],
        audioElements: [],
        huddleManager: null,
      };

      // Get all audio elements
      document.querySelectorAll('audio').forEach((a, i) => {
        results.audioElements.push({
          index: i,
          paused: a.paused,
          muted: a.muted,
          volume: a.volume,
          readyState: a.readyState,
          currentTime: a.currentTime,
          hasSrcObject: !!a.srcObject,
          srcObjectActive: a.srcObject ? (a.srcObject as MediaStream).active : null,
          tracks: a.srcObject ? (a.srcObject as MediaStream).getTracks().map(t => ({
            kind: t.kind,
            enabled: t.enabled,
            muted: t.muted,
            readyState: t.readyState,
            id: t.id,
          })) : [],
        });
      });

      // Get RTCPeerConnection stats
      const mgr = (window as any).__huddleManager;
      if (mgr && mgr.connections) {
        results.huddleManager = {
          hasConnections: true,
          connectionCount: mgr.connections.size,
          peerIds: Array.from(mgr.connections.keys()).map((id: string) => id.slice(0, 12)),
        };

        // Get stats for each connection
        mgr.connections.forEach((pc: RTCPeerConnection, peerId: string) => {
          results.peerConnections.push({
            peerId: peerId.slice(0, 12),
            connectionState: pc.connectionState,
            iceState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            receivers: pc.getReceivers().map((r: RTCRtpReceiver) => ({
              trackKind: r.track?.kind,
              trackMuted: r.track?.muted,
              trackReadyState: r.track?.readyState,
            })),
            senders: pc.getSenders().map((s: RTCRtpSender) => ({
              trackKind: s.track?.kind,
            })),
          });
        });
      }

      // Get diagnostics from our monkey-patch
      const diag = (window as any).__huddleDiagnostics;
      if (diag) {
        results.tracks = Array.from(diag.tracks.entries()).map(([id, data]: [string, any]) => ({
          id,
          kind: data.track.kind,
          muted: data.track.muted,
          readyState: data.track.readyState,
          streamCount: data.streams.length,
        }));
      }

      return results;
    });

    console.log('\n=== DIAGNOSTICS ===');
    console.log('Audio elements:', JSON.stringify(diag.audioElements, null, 2));
    console.log('Peer connections:', JSON.stringify(diag.peerConnections, null, 2));
    console.log('Tracks:', JSON.stringify(diag.tracks, null, 2));
    console.log('HuddleManager:', JSON.stringify(diag.huddleManager, null, 2));

    // Wait a bit more and check again
    await page.waitForTimeout(5000);

    const diag2 = await page.evaluate(() => {
      const results: any = { audioElements: [], stats: [] };

      document.querySelectorAll('audio').forEach((a, i) => {
        results.audioElements.push({
          index: i,
          currentTime: a.currentTime,
          paused: a.paused,
        });
      });

      const mgr = (window as any).__huddleManager;
      if (mgr) {
        mgr.connections.forEach(async (pc: RTCPeerConnection, peerId: string) => {
          const stats = await pc.getStats();
          const inbound: any[] = [];
          stats.forEach((report: any) => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              inbound.push({
                ssrc: report.ssrc,
                packetsReceived: report.packetsReceived,
                bytesReceived: report.bytesReceived,
                packetsLost: report.packetsLost,
              });
            }
          });
          results.stats.push({ peerId: peerId.slice(0, 12), inbound });
        });
      }

      return results;
    });

    console.log('\n=== AFTER 5s ===');
    console.log('Audio elements:', JSON.stringify(diag2.audioElements, null, 2));

    // Keep browser open for a bit so you can inspect
    console.log('[Test] Keeping browser open for 10 seconds...');
    await page.waitForTimeout(10000);

  } finally {
    await browser.close();
  }
});
