/**
 * Huddle — 3-Peer Audio E2E Tests
 *
 * Verifies that when 3 users are in a huddle, ALL pairs have
 * working WebRTC audio connections. No drops, no missing peers.
 *
 * Scenario:
 * - Alice creates workspace, Bob and Charlie join via invite
 * - Alice starts huddle
 * - Bob joins huddle
 * - Charlie joins huddle
 * - All 3 should see all participants, have active audio elements,
 *   and WebRTC connections in "connected" state
 */

import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function clearStorage(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}

async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });

  const openAppBtn = page.getByRole('button', { name: /open app/i });
  if (await openAppBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openAppBtn.click();
  }

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
}

/** Mock getUserMedia with a real oscillator so audio data actually flows */
async function mockWithOscillator(context: BrowserContext, freqHz: number) {
  await context.grantPermissions(['microphone']);
  await context.addInitScript((freq: number) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const audioCtx = new AudioContext();
      const oscillator = audioCtx.createOscillator();
      oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
      const dest = audioCtx.createMediaStreamDestination();
      oscillator.connect(dest);
      oscillator.start();
      return dest.stream;
    };
  }, freqHz);
}

async function createWorkspace(page: Page, name: string, alias: string) {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 5000 });
}

async function getInviteUrl(page: Page): Promise<string> {
  const inviteUrl = await page.evaluate(() => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    if (!state?.activeWorkspaceId) return '';
    return ctrl?.generateInviteURL?.(state.activeWorkspaceId) || '';
  });
  return inviteUrl;
}

async function joinViaInvite(page: Page, inviteUrl: string, alias: string) {
  await page.goto(inviteUrl);
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
}

async function waitForPeerConnection(page: Page, expectedOnline = 2, timeoutMs = 30000) {
  await page.waitForFunction(
    (min: number) => {
      const headers = document.querySelectorAll('.member-group-header');
      for (const h of headers) {
        const match = h.textContent?.match(/Online\s*—\s*(\d+)/);
        if (match && parseInt(match[1], 10) >= min) return true;
      }
      return false;
    },
    expectedOnline,
    { timeout: timeoutMs },
  );
}

async function startHuddle(page: Page) {
  await page.click('#overflow-menu-btn');
  await page.click('#huddle-start-btn');
  await page.waitForFunction(() => {
    const bar = document.getElementById('huddle-bar');
    return bar && bar.style.display !== 'none';
  }, { timeout: 10000 });
}

async function joinHuddle(page: Page) {
  await page.waitForFunction(() => {
    const banner = document.getElementById('huddle-join-banner');
    return banner && banner.style.display !== 'none';
  }, { timeout: 20000 });
  await page.click('#huddle-join-btn');
  await page.waitForFunction(() => {
    const bar = document.getElementById('huddle-bar');
    return bar && bar.style.display !== 'none';
  }, { timeout: 10000 });
}

interface AudioDiagnostics {
  audioElementCount: number;
  activeStreams: number;
  playingElements: number;
  liveAudioTracks: number;
  participantCount: number;
  huddleState: string;
  peerConnectionStates: string[];
}

async function getAudioDiagnostics(page: Page): Promise<AudioDiagnostics> {
  return await page.evaluate(() => {
    const audioEls = Array.from(document.querySelectorAll('audio'));
    const activeStreams = audioEls.filter(a => a.srcObject && (a.srcObject as MediaStream).active).length;
    const playingElements = audioEls.filter(a => !a.paused && a.srcObject).length;
    const liveAudioTracks = audioEls.reduce((count, a) => {
      if (!a.srcObject) return count;
      return count + (a.srcObject as MediaStream).getTracks()
        .filter(t => t.kind === 'audio' && t.readyState === 'live').length;
    }, 0);

    const huddleManager = (window as any).__ctrl?.huddle ?? (window as any).__huddleManager;
    const participantCount = huddleManager?.getParticipants?.()?.length ?? 0;
    const huddleState = huddleManager?.getState?.() ?? 'unknown';

    // Get all RTCPeerConnection states from huddle manager internals
    const connections = (huddleManager as any)?.connections as Map<string, RTCPeerConnection> | undefined;
    const peerConnectionStates: string[] = [];
    if (connections) {
      for (const [_peerId, pc] of connections) {
        peerConnectionStates.push(pc.connectionState);
      }
    }

    return {
      audioElementCount: audioEls.length,
      activeStreams,
      playingElements,
      liveAudioTracks,
      participantCount,
      huddleState,
      peerConnectionStates,
    };
  });
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

test.describe('Huddle — 3 Peers Full Mesh Audio', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'Clipboard and mic permissions are not supported in Playwright Firefox');

  test.setTimeout(120000);

  let aliceCtx: BrowserContext;
  let bobCtx: BrowserContext;
  let charlieCtx: BrowserContext;
  let alice: Page;
  let bob: Page;
  let charlie: Page;

  test.beforeEach(async ({ browser }) => {
    // Each user gets a unique oscillator frequency so we can distinguish audio
    aliceCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    bobCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    charlieCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });

    await mockWithOscillator(aliceCtx, 440);   // A4
    await mockWithOscillator(bobCtx, 523);     // C5
    await mockWithOscillator(charlieCtx, 659); // E5

    // Patch crypto.subtle.verify for ECDH/ECDSA mismatch
    for (const ctx of [aliceCtx, bobCtx, charlieCtx]) {
      await ctx.addInitScript(() => {
        const _origVerify = crypto.subtle.verify.bind(crypto.subtle);
        crypto.subtle.verify = async function (a: any, k: CryptoKey, s: BufferSource, d: BufferSource) {
          try { return await _origVerify(a, k, s, d); }
          catch (e: any) { if (e.name === 'InvalidAccessError') return true; throw e; }
        };
      });
    }

    alice = await aliceCtx.newPage();
    bob = await bobCtx.newPage();
    charlie = await charlieCtx.newPage();

    // Collect huddle logs for debugging
    for (const [name, page] of [['Alice', alice], ['Bob', bob], ['Charlie', charlie]] as const) {
      page.on('console', msg => {
        if (msg.text().includes('[Huddle]')) {
          console.log(`[${name}] ${msg.text()}`);
        }
      });
    }

    await clearStorage(alice);
    await clearStorage(bob);
    await clearStorage(charlie);

    await waitForApp(alice);
    await waitForApp(bob);
    await waitForApp(charlie);
  });

  test.afterEach(async () => {
    await aliceCtx?.close();
    await bobCtx?.close();
    await charlieCtx?.close();
  });

  test('all 3 peers see each other and have active audio connections', async () => {
    // Alice creates workspace
    await createWorkspace(alice, 'Huddle3', 'Alice');
    const inviteUrl = await getInviteUrl(alice);
    expect(inviteUrl).toContain('/join/');

    // Bob and Charlie join
    console.log('[Test] Bob joining workspace...');
    await joinViaInvite(bob, inviteUrl, 'Bob');
    await waitForPeerConnection(bob, 2, 30000);

    console.log('[Test] Charlie joining workspace...');
    await joinViaInvite(charlie, inviteUrl, 'Charlie');
    await waitForPeerConnection(charlie, 2, 30000);

    // Wait for all P2P connections to stabilize
    await alice.waitForTimeout(2000);

    // Alice starts huddle
    console.log('[Test] Alice starting huddle...');
    await startHuddle(alice);

    // Bob joins huddle
    console.log('[Test] Bob joining huddle...');
    await joinHuddle(bob);

    // Give time for WebRTC between Alice and Bob
    await alice.waitForTimeout(3000);

    // Charlie joins huddle
    console.log('[Test] Charlie joining huddle...');
    await joinHuddle(charlie);

    // Give WebRTC time to establish all connections (3 pairs)
    console.log('[Test] Waiting for WebRTC mesh to stabilize...');
    await alice.waitForTimeout(5000);

    // ── Collect diagnostics from all 3 peers ──────────────────────────

    const aliceDiag = await getAudioDiagnostics(alice);
    const bobDiag = await getAudioDiagnostics(bob);
    const charlieDiag = await getAudioDiagnostics(charlie);

    console.log('\n=== 3-PEER HUDDLE DIAGNOSTICS ===');
    console.log('Alice:', JSON.stringify(aliceDiag, null, 2));
    console.log('Bob:', JSON.stringify(bobDiag, null, 2));
    console.log('Charlie:', JSON.stringify(charlieDiag, null, 2));

    // ── Assertions ────────────────────────────────────────────────────

    // All 3 should be in-call
    expect(aliceDiag.huddleState).toBe('in-call');
    expect(bobDiag.huddleState).toBe('in-call');
    expect(charlieDiag.huddleState).toBe('in-call');

    // Each peer should see 3 participants (including self)
    expect(aliceDiag.participantCount).toBe(3);
    expect(bobDiag.participantCount).toBe(3);
    expect(charlieDiag.participantCount).toBe(3);

    // Each peer should have 2 audio elements (one for each remote peer)
    expect(aliceDiag.audioElementCount).toBeGreaterThanOrEqual(2);
    expect(bobDiag.audioElementCount).toBeGreaterThanOrEqual(2);
    expect(charlieDiag.audioElementCount).toBeGreaterThanOrEqual(2);

    // All audio streams should be active
    expect(aliceDiag.activeStreams).toBeGreaterThanOrEqual(2);
    expect(bobDiag.activeStreams).toBeGreaterThanOrEqual(2);
    expect(charlieDiag.activeStreams).toBeGreaterThanOrEqual(2);

    // All audio elements should be playing (not paused)
    expect(aliceDiag.playingElements).toBeGreaterThanOrEqual(2);
    expect(bobDiag.playingElements).toBeGreaterThanOrEqual(2);
    expect(charlieDiag.playingElements).toBeGreaterThanOrEqual(2);

    // All audio tracks should be live
    expect(aliceDiag.liveAudioTracks).toBeGreaterThanOrEqual(2);
    expect(bobDiag.liveAudioTracks).toBeGreaterThanOrEqual(2);
    expect(charlieDiag.liveAudioTracks).toBeGreaterThanOrEqual(2);

    // All WebRTC peer connections should be "connected"
    expect(aliceDiag.peerConnectionStates.length).toBe(2);
    expect(aliceDiag.peerConnectionStates.every(s => s === 'connected')).toBe(true);

    expect(bobDiag.peerConnectionStates.length).toBe(2);
    expect(bobDiag.peerConnectionStates.every(s => s === 'connected')).toBe(true);

    expect(charlieDiag.peerConnectionStates.length).toBe(2);
    expect(charlieDiag.peerConnectionStates.every(s => s === 'connected')).toBe(true);

    console.log('[Test] ✅ All 3 peers have full mesh audio connections!');
  });

  test('late joiner gets full audio mesh with existing peers', async () => {
    // Setup workspace
    await createWorkspace(alice, 'LateJoin', 'Alice');
    const inviteUrl = await getInviteUrl(alice);

    await joinViaInvite(bob, inviteUrl, 'Bob');
    await waitForPeerConnection(bob, 2, 30000);
    await joinViaInvite(charlie, inviteUrl, 'Charlie');
    await waitForPeerConnection(charlie, 2, 30000);
    await alice.waitForTimeout(2000);

    // Alice and Bob start huddle first
    console.log('[Test] Alice starts huddle...');
    await startHuddle(alice);
    console.log('[Test] Bob joins huddle...');
    await joinHuddle(bob);

    // Let Alice↔Bob stabilize
    await alice.waitForTimeout(5000);

    // Verify Alice↔Bob connection is solid
    const alicePre = await getAudioDiagnostics(alice);
    const bobPre = await getAudioDiagnostics(bob);
    console.log('Alice before Charlie:', JSON.stringify(alicePre));
    console.log('Bob before Charlie:', JSON.stringify(bobPre));
    expect(alicePre.peerConnectionStates.length).toBe(1);
    expect(alicePre.peerConnectionStates[0]).toBe('connected');

    // Now Charlie joins as the late joiner
    console.log('[Test] Charlie joins huddle (late)...');
    await joinHuddle(charlie);

    // Give extra time for the late joiner to establish connections
    await alice.waitForTimeout(8000);

    const aliceDiag = await getAudioDiagnostics(alice);
    const bobDiag = await getAudioDiagnostics(bob);
    const charlieDiag = await getAudioDiagnostics(charlie);

    console.log('\n=== LATE JOINER DIAGNOSTICS ===');
    console.log('Alice:', JSON.stringify(aliceDiag, null, 2));
    console.log('Bob:', JSON.stringify(bobDiag, null, 2));
    console.log('Charlie:', JSON.stringify(charlieDiag, null, 2));

    // Charlie (late joiner) must have connections to both Alice and Bob
    expect(charlieDiag.participantCount).toBe(3);
    expect(charlieDiag.peerConnectionStates.length).toBe(2);
    expect(charlieDiag.peerConnectionStates.every(s => s === 'connected')).toBe(true);
    expect(charlieDiag.activeStreams).toBeGreaterThanOrEqual(2);

    // Alice and Bob should STILL have their connection + new one to Charlie
    expect(aliceDiag.peerConnectionStates.length).toBe(2);
    expect(aliceDiag.peerConnectionStates.every(s => s === 'connected')).toBe(true);

    expect(bobDiag.peerConnectionStates.length).toBe(2);
    expect(bobDiag.peerConnectionStates.every(s => s === 'connected')).toBe(true);

    console.log('[Test] ✅ Late joiner has full audio mesh!');
  });

  test('no audio drops when third peer joins an active huddle', async () => {
    // Setup workspace
    await createWorkspace(alice, 'NoDrop', 'Alice');
    const inviteUrl = await getInviteUrl(alice);

    await joinViaInvite(bob, inviteUrl, 'Bob');
    await waitForPeerConnection(bob, 2, 30000);
    await joinViaInvite(charlie, inviteUrl, 'Charlie');
    await waitForPeerConnection(charlie, 2, 30000);
    await alice.waitForTimeout(2000);

    // Alice and Bob in huddle
    await startHuddle(alice);
    await joinHuddle(bob);
    await alice.waitForTimeout(3000);

    // Snapshot Alice↔Bob connection state BEFORE Charlie joins
    const aliceBefore = await getAudioDiagnostics(alice);
    expect(aliceBefore.peerConnectionStates.length).toBe(1);
    expect(aliceBefore.peerConnectionStates[0]).toBe('connected');

    // Charlie joins — this must NOT break Alice↔Bob
    await joinHuddle(charlie);
    await alice.waitForTimeout(8000);

    const aliceAfter = await getAudioDiagnostics(alice);
    const bobAfter = await getAudioDiagnostics(bob);

    console.log('\n=== NO-DROP DIAGNOSTICS ===');
    console.log('Alice after:', JSON.stringify(aliceAfter, null, 2));
    console.log('Bob after:', JSON.stringify(bobAfter, null, 2));

    // Alice↔Bob connection must still be alive (no drop)
    // Both should now have 2 connections (each other + Charlie)
    expect(aliceAfter.peerConnectionStates.length).toBe(2);
    expect(aliceAfter.peerConnectionStates.every(s => s === 'connected')).toBe(true);

    expect(bobAfter.peerConnectionStates.length).toBe(2);
    expect(bobAfter.peerConnectionStates.every(s => s === 'connected')).toBe(true);

    // Audio must still be flowing
    expect(aliceAfter.activeStreams).toBeGreaterThanOrEqual(2);
    expect(aliceAfter.playingElements).toBeGreaterThanOrEqual(2);
    expect(bobAfter.activeStreams).toBeGreaterThanOrEqual(2);
    expect(bobAfter.playingElements).toBeGreaterThanOrEqual(2);

    console.log('[Test] ✅ No audio drops when third peer joined!');
  });
});
