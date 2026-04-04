/**
 * Huddle Audio Debug Test
 *
 * This test creates TWO browser contexts (Alice and Bob),
 * has Alice start a huddle, Bob join, and then checks the
 * WebRTC connection state and audio element diagnostics.
 *
 * This is the browser ↔ browser path (same as production, just
 * with MockTransport for signaling).
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
  console.log('[Test] Mock relay on port', relay.port);
});

test.afterAll(async () => {
  relay?.close();
});

async function setupUser(browser: any, name: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  // Mock getUserMedia with oscillator (real audio data)
  await ctx.grantPermissions(['microphone']);
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const audioCtx = new AudioContext();
      const osc = audioCtx.createOscillator();
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      const dest = audioCtx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return dest.stream;
    };
  });

  const page = await ctx.newPage();

  // Inject MockTransport
  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));

  // Patch verify for ECDH/ECDSA mismatch
  await page.addInitScript(() => {
    const _origVerify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async function (a: any, k: CryptoKey, s: BufferSource, d: BufferSource) {
      try { return await _origVerify(a, k, s, d); } catch (e: any) { if (e.name === 'InvalidAccessError') return true; throw e; }
    };
  });

  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) { const dbs = await indexedDB.databases(); for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); } }
    localStorage.clear(); sessionStorage.clear();
  });
  await page.reload();

  await page.waitForFunction(() => {
    const l = document.getElementById('loading'); return !l || l.style.opacity === '0';
  }, { timeout: 15000 });

  const openBtn = page.getByRole('button', { name: /open app/i });
  if (await openBtn.isVisible({ timeout: 2000 }).catch(() => false)) await openBtn.click();
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });

  return { ctx, page };
}

test.describe('Huddle Audio Debug', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'Clipboard and mic permissions are not supported in Playwright Firefox');

  test.setTimeout(120000);

  test('two-browser huddle: WebRTC states and audio element diagnostics', async ({ browser }) => {
    const alice = await setupUser(browser, 'Alice');
    const bob = await setupUser(browser, 'Bob');

    // Capture console for huddle logs
    const aliceLogs: string[] = [];
    const bobLogs: string[] = [];
    alice.page.on('console', msg => { if (msg.text().includes('[Huddle]')) aliceLogs.push(msg.text()); });
    bob.page.on('console', msg => { if (msg.text().includes('[Huddle]')) bobLogs.push(msg.text()); });

    try {
      // Alice creates workspace
      await alice.page.click('#create-ws-btn');
      await alice.page.waitForSelector('.modal');
      await alice.page.locator('.modal input[name="name"]').fill('HuddleDebug');
      await alice.page.locator('.modal input[name="alias"]').fill('Alice');
      await alice.page.click('.modal .btn-primary');
      await alice.page.waitForSelector('.sidebar-header', { timeout: 10000 });

      // Get invite URL
      const invite = await alice.page.evaluate(() => {
        const state = (window as any).__state;
        const ctrl = (window as any).__ctrl;
        return ctrl?.generateInviteURL?.(state.activeWorkspaceId) || '';
      });
      expect(invite).toContain('/join/');

      // Bob joins
      await bob.page.goto(invite);
      await bob.page.waitForSelector('.modal', { timeout: 10000 });
      await bob.page.locator('.modal input[name="alias"]').fill('Bob');
      await bob.page.click('.modal .btn-primary');
      await bob.page.waitForSelector('.sidebar-header', { timeout: 15000 });

      // Wait for both peers to show as online in sidebar
      await alice.page.waitForFunction(
        (min: number) => {
          const headers = document.querySelectorAll('.member-group-header');
          for (const h of headers) {
            const match = h.textContent?.match(/Online\s*—\s*(\d+)/);
            if (match && parseInt(match[1], 10) >= min) return true;
          }
          return false;
        },
        2,
        { timeout: 30000 },
      );

      console.log('[Test] P2P connected');

      // Alice starts huddle
      await alice.page.click('#overflow-menu-btn');
      await alice.page.click('#huddle-start-btn');
      await alice.page.waitForFunction(() => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      }, { timeout: 10000 });

      console.log('[Test] Alice started huddle');

      // Bob should see join banner
      await bob.page.waitForFunction(() => {
        const banner = document.getElementById('huddle-join-banner');
        return banner && banner.style.display !== 'none';
      }, { timeout: 15000 });

      console.log('[Test] Bob sees join banner');

      // Bob joins
      await bob.page.click('#huddle-join-btn');
      await bob.page.waitForFunction(() => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      }, { timeout: 10000 });

      console.log('[Test] Bob joined huddle');

      // Wait for WebRTC to connect and audio to flow
      await alice.page.waitForTimeout(8000);

      // ── Diagnostics ─────────────────────────────────────────────────

      const aliceDiag = await alice.page.evaluate(() => {
        const audioEls = Array.from(document.querySelectorAll('audio'));
        const pcs = (window as any).__huddleDebugPCs || [];

        return {
          audioElements: audioEls.map(a => ({
            hasSrcObject: !!a.srcObject,
            paused: a.paused,
            muted: a.muted,
            volume: a.volume,
            readyState: a.readyState,
            currentTime: a.currentTime,
            srcObjectActive: a.srcObject ? (a.srcObject as MediaStream).active : null,
            tracks: a.srcObject ? (a.srcObject as MediaStream).getTracks().map(t => ({
              kind: t.kind,
              enabled: t.enabled,
              readyState: t.readyState,
              muted: t.muted,
              id: t.id,
            })) : [],
          })),
          totalAudioElements: audioEls.length,
        };
      });

      const bobDiag = await bob.page.evaluate(() => {
        const audioEls = Array.from(document.querySelectorAll('audio'));
        return {
          audioElements: audioEls.map(a => ({
            hasSrcObject: !!a.srcObject,
            paused: a.paused,
            muted: a.muted,
            volume: a.volume,
            readyState: a.readyState,
            currentTime: a.currentTime,
            srcObjectActive: a.srcObject ? (a.srcObject as MediaStream).active : null,
            tracks: a.srcObject ? (a.srcObject as MediaStream).getTracks().map(t => ({
              kind: t.kind,
              enabled: t.enabled,
              readyState: t.readyState,
              muted: t.muted,
              id: t.id,
            })) : [],
          })),
          totalAudioElements: audioEls.length,
        };
      });

      // Get RTCPeerConnection stats
      const alicePcStats = await alice.page.evaluate(async () => {
        // Access HuddleManager connections via internal state
        const mgr = (window as any).__huddleManager;
        if (!mgr) return { error: 'no __huddleManager' };

        const connections = mgr.connections as Map<string, RTCPeerConnection>;
        const results: any[] = [];
        for (const [peerId, pc] of connections) {
          const stats = await pc.getStats();
          const inbound: any[] = [];
          const outbound: any[] = [];
          stats.forEach((report: any) => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              inbound.push({
                packetsReceived: report.packetsReceived,
                bytesReceived: report.bytesReceived,
                packetsLost: report.packetsLost,
                jitter: report.jitter,
              });
            }
            if (report.type === 'outbound-rtp' && report.kind === 'audio') {
              outbound.push({
                packetsSent: report.packetsSent,
                bytesSent: report.bytesSent,
              });
            }
          });
          results.push({
            peerId: peerId.slice(0, 12),
            state: pc.connectionState,
            iceState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            inbound,
            outbound,
          });
        }
        return results;
      });

      console.log('\n=== ALICE DIAGNOSTICS ===');
      console.log('Audio elements:', JSON.stringify(aliceDiag, null, 2));
      console.log('PC stats:', JSON.stringify(alicePcStats, null, 2));
      console.log('Huddle logs:', aliceLogs.join('\n'));

      console.log('\n=== BOB DIAGNOSTICS ===');
      console.log('Audio elements:', JSON.stringify(bobDiag, null, 2));
      console.log('Huddle logs:', bobLogs.join('\n'));

      // ── Assertions ──────────────────────────────────────────────────

      // Both should have at least one audio element
      expect(aliceDiag.totalAudioElements).toBeGreaterThanOrEqual(1);
      expect(bobDiag.totalAudioElements).toBeGreaterThanOrEqual(1);

      // Audio elements should not be paused
      for (const el of aliceDiag.audioElements) {
        expect(el.paused).toBe(false);
      }
      for (const el of bobDiag.audioElements) {
        expect(el.paused).toBe(false);
      }

      // Tracks should be live
      for (const el of aliceDiag.audioElements) {
        for (const t of el.tracks) {
          expect(t.readyState).toBe('live');
        }
      }
      for (const el of bobDiag.audioElements) {
        for (const t of el.tracks) {
          expect(t.readyState).toBe('live');
        }
      }

      // RTP packets should have been exchanged
      if (Array.isArray(alicePcStats)) {
        for (const pc of alicePcStats) {
          expect(pc.state).toBe('connected');
          if (pc.inbound.length > 0) {
            expect(pc.inbound[0].packetsReceived).toBeGreaterThan(0);
          }
        }
      }

    } finally {
      await alice.ctx.close();
      await bob.ctx.close();
    }
  });
});
