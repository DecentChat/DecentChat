const RUN_LIVE_P2P = process.env.PW_RUN_LIVE_P2P === '1';

/**
 * Live P2P test: Chromium (Alice) ↔ Firefox (Bob) on production
 */
import { test, expect, chromium, firefox } from '@playwright/test';

test('Alice (Chromium) and Bob (Firefox) can chat via P2P on production', async () => {
  test.skip(!RUN_LIVE_P2P, 'Live production P2P test — opt-in via PW_RUN_LIVE_P2P=1');
  test.setTimeout(180000);

  const chromiumBrowser = await chromium.launch({ headless: false });
  const firefoxBrowser  = await firefox.launch({ headless: false });

  const alice = await chromiumBrowser.newPage();
  const bob   = await firefoxBrowser.newPage();

  // Strip STUN/TURN so Playwright browsers use host-only ICE (same-machine loopback)
  const patchICE = () => {
    const Orig = (window as any).RTCPeerConnection;
    (window as any).RTCPeerConnection = function (cfg: any, ...a: any[]) {
      return new Orig({ ...(cfg || {}), iceServers: [] }, ...a);
    };
    Object.assign((window as any).RTCPeerConnection, Orig);
  };
  await alice.addInitScript(patchICE);
  await bob.addInitScript(patchICE);

  alice.on('console', msg => { if (!msg.text().includes('[vite]')) console.log(`  [Alice] ${msg.text()}`); });
  bob.on('console',   msg => { if (!msg.text().includes('[vite]')) console.log(`  [Bob]   ${msg.text()}`); });
  alice.on('pageerror', err => console.log(`  [Alice ERR] ${err.message}`));
  bob.on('pageerror',   err => console.log(`  [Bob ERR]   ${err.message}`));

  try {
    // ── Step 1: Alice loads app ──────────────────────────────────────────
    console.log('[1] Alice: loading decentchat.app...');
    await alice.goto('https://decentchat.app', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await alice.waitForSelector('#create-ws-btn, button:has-text("Create Workspace")', { timeout: 20000 });
    console.log('[1] Alice: app loaded ✅');

    // ── Step 2: Alice creates workspace ──────────────────────────────────
    console.log('[2] Alice: creating workspace...');
    await alice.locator('#create-ws-btn, button:has-text("Create Workspace")').first().click();
    await alice.waitForSelector('.modal', { timeout: 5000 });
    await alice.locator('.modal input:not([type="hidden"])').nth(0).fill('P2PLive');
    await alice.locator('.modal input:not([type="hidden"])').nth(1).fill('Alice');
    await alice.locator('.modal .btn-primary, .modal button:has-text("Confirm")').click();
    await alice.waitForSelector('#compose-input', { timeout: 20000 });
    console.log('[2] Alice: workspace created ✅');

    // ── Step 3: Alice gets invite URL ────────────────────────────────────
    console.log('[3] Alice: generating invite URL...');
    const inviteUrl: string = await alice.evaluate(() =>
      (window as any).__ctrl?.generateInviteURL((window as any).__state?.activeWorkspaceId) || ''
    );
    console.log('[3] Invite URL:', inviteUrl);
    expect(inviteUrl).toContain('/join/');
    const signal = new URL(inviteUrl).searchParams.get('signal');
    console.log('[3] Signal server:', signal);
    expect(signal).toContain('peerjs.com');

    // ── Step 4: Bob loads invite URL ─────────────────────────────────────
    console.log('[4] Bob: navigating to invite URL...');
    await bob.goto(inviteUrl, { waitUntil: 'networkidle', timeout: 30000 });
    // Wait for the visible name input (skip hidden peerId field)
    const bobInput = bob.locator('.modal input[type="text"], .modal input:not([type="hidden"])').first();
    await bobInput.waitFor({ state: 'visible', timeout: 20000 });
    await bob.waitForTimeout(500); // let animation settle
    console.log('[4] Bob: join modal appeared ✅');

    // ── Step 5: Bob fills name & confirms ────────────────────────────────
    console.log('[5] Bob: entering name...');
    await bobInput.click();
    await bobInput.fill('Bob');
    const confirmBtn = bob.locator('.modal button:has-text("Confirm"), .modal .btn-primary').first();
    await confirmBtn.click({ force: true });
    await bob.waitForSelector('#compose-input', { timeout: 20000 });
    console.log('[5] Bob: joined workspace ✅');

    // ── Step 6: Poll for P2P connection (up to 30s) ──────────────────────
    console.log('[6] Waiting for P2P handshake...');
    let connected = false;
    for (let i = 0; i < 6; i++) {
      await alice.waitForTimeout(5000);
      const [aReady, bReady, aTransport, bTransport] = await Promise.all([
        alice.evaluate(() => (window as any).__state?.readyPeers?.size || 0),
        bob.evaluate(()   => (window as any).__state?.readyPeers?.size || 0),
        alice.evaluate(() => { const t = (window as any).__ctrl?.transport; const p = t?.signalingInstances?.[0]?.peer || t?.peer; return p?.open ? 'open' : (p?.disconnected ? 'disconnected' : 'closed'); }),
        bob.evaluate(()   => { const t = (window as any).__ctrl?.transport; const p = t?.signalingInstances?.[0]?.peer || t?.peer; return p?.open ? 'open' : (p?.disconnected ? 'disconnected' : 'closed'); }),
      ]);
      console.log(`[6] ${5*(i+1)}s — Alice peers:${aReady} transport:${aTransport} | Bob peers:${bReady} transport:${bTransport}`);
      if (aReady > 0 && bReady > 0) { connected = true; break; }
    }

    expect(connected, 'P2P connection should be established within 30s').toBe(true);
    console.log('[6] P2P connection established ✅');

    // ── Step 7: Alice → Bob ──────────────────────────────────────────────
    console.log('[7] Alice sending message...');
    await alice.locator('#compose-input').fill('Hello from Chrome!');
    await alice.locator('#compose-input').press('Enter');
    await bob.waitForFunction(
      (t: string) => Array.from(document.querySelectorAll('.message-content'))
        .some(m => m.textContent?.includes(t)),
      'Hello from Chrome!',
      { timeout: 15000 }
    );
    console.log('[7] Bob received Alice\'s message ✅');

    // ── Step 8: Bob → Alice ──────────────────────────────────────────────
    console.log('[8] Bob sending reply...');
    await bob.locator('#compose-input').fill('Hey Alice, Firefox here!');
    await bob.locator('#compose-input').press('Enter');
    await alice.waitForFunction(
      (t: string) => Array.from(document.querySelectorAll('.message-content'))
        .some(m => m.textContent?.includes(t)),
      'Hey Alice, Firefox here!',
      { timeout: 15000 }
    );
    console.log('[8] Alice received Bob\'s reply ✅');

    console.log('\n🎉 P2P CHAT FULLY WORKING: Chrome ↔ Firefox on production!\n');

  } finally {
    await chromiumBrowser.close();
    await firefoxBrowser.close();
    // Clean up screenshot files
    const { unlinkSync } = await import('fs');
    ['~/.openclaw/workspace/test-failed-1.png', '~/.openclaw/workspace/test-failed-2.png']
      .forEach(f => { try { unlinkSync(f); } catch {} });
  }
});
