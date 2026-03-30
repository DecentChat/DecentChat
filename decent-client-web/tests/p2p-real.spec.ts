/**
 * Real WebRTC integration test — no MockTransport.
 *
 * Two pages in the SAME browser instance, running against the local dev server.
 * On localhost the app sets iceServers:[] automatically, so ICE uses host
 * candidates only (loopback). Two tabs in the same process can always reach
 * each other that way — no STUN/TURN needed.
 *
 * Requires: `bun run dev` (starts Vite + signaling server on localhost:9000)
 * Run with: npx playwright test tests/p2p-real.spec.ts
 */
import { test, expect, Browser } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const SIGNAL_URL = 'ws://localhost:9000';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadApp(page: Page, label: string): Promise<void> {
  // Navigate to /app directly — fresh browser context guarantees clean storage
  await page.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#create-ws-btn-nav, #create-ws-btn, button:has-text("Create Workspace"), .sidebar-header', { timeout: 30000 });
  console.log(`[${label}] app loaded ✅`);
}

async function createWorkspace(page: Page, wsName: string, displayName: string): Promise<void> {
  await page.locator('#create-ws-btn-nav, #create-ws-btn, button:has-text("Create Workspace")').first().click();
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.locator('.modal input:not([type="hidden"])').nth(0).fill(wsName);
  await page.locator('.modal input:not([type="hidden"])').nth(1).fill(displayName);
  await page.locator('.modal .btn-primary, .modal button:has-text("Confirm")').click();
  await page.waitForSelector('#compose-input', { timeout: 15000 });
  console.log(`[${displayName}] workspace "${wsName}" created ✅`);
}

async function getInviteUrl(page: Page): Promise<string> {
  const url: string = await page.evaluate(() =>
    (window as any).__ctrl?.generateInviteURL((window as any).__state?.activeWorkspaceId) || ''
  );
  expect(url).toContain('/join/');
  // Rewrite to localhost for local testing
  const localUrl = url.replace('https://decentchat.app', BASE_URL);
  console.log(`[Invite] ${localUrl}`);
  return localUrl;
}

async function joinWorkspace(page: Page, inviteUrl: string, displayName: string): Promise<void> {
  await page.goto(inviteUrl, { waitUntil: 'networkidle', timeout: 20000 });
  const input = page.locator('.modal input:not([type="hidden"])').first();
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(displayName);
  await page.locator('.modal .btn-primary, .modal button:has-text("Confirm")').click();
  await page.waitForSelector('#compose-input', { timeout: 15000 });
  console.log(`[${displayName}] joined workspace ✅`);
}

async function waitForP2P(alice: Page, bob: Page, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await alice.waitForTimeout(2000);
    const [aReady, bReady] = await Promise.all([
      alice.evaluate(() => (window as any).__state?.readyPeers?.size || 0),
      bob.evaluate(()   => (window as any).__state?.readyPeers?.size || 0),
    ]);
    console.log(`[P2P] Alice ready peers: ${aReady}, Bob ready peers: ${bReady}`);
    if (aReady > 0 && bReady > 0) return;
  }
  throw new Error('P2P connection not established within timeout');
}

async function sendAndVerify(
  sender: Page, receiver: Page,
  senderName: string, receiverName: string,
  text: string
): Promise<void> {
  await sender.locator('#compose-input').fill(text);
  await sender.locator('#compose-input').press('Enter');
  await receiver.waitForFunction(
    (t: string) => Array.from(document.querySelectorAll('.message-content, [data-message-content]'))
      .some(el => el.textContent?.includes(t)),
    text,
    { timeout: 10000 }
  );
  console.log(`[${receiverName}] received "${text}" from ${senderName} ✅`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Real WebRTC P2P (localhost, same browser, no MockTransport)', () => {

  test('two users can exchange messages via real WebRTC', async ({ browser }) => {
    test.setTimeout(120000);

    const aliceCtx = await browser.newContext();
    const bobCtx   = await browser.newContext();
    const alice = await aliceCtx.newPage();
    const bob   = await bobCtx.newPage();

    alice.on('console', msg => { if (msg.type() === 'error' || msg.text().includes('PeerJS') || msg.text().includes('ICE')) console.log(`  [Alice] ${msg.text()}`); });
    bob.on('console',   msg => { if (msg.type() === 'error' || msg.text().includes('PeerJS') || msg.text().includes('ICE')) console.log(`  [Bob]   ${msg.text()}`); });

    // ── Setup ──────────────────────────────────────────────────────────────
    await loadApp(alice, 'Alice');
    await createWorkspace(alice, 'RealP2P', 'Alice');

    const inviteUrl = await getInviteUrl(alice);
    await loadApp(bob, 'Bob');
    await joinWorkspace(bob, inviteUrl, 'Bob');

    // ── Wait for P2P handshake ─────────────────────────────────────────────
    console.log('[P2P] Waiting for WebRTC connection...');
    await waitForP2P(alice, bob);
    console.log('[P2P] Connection established! ✅');

    // ── Messaging ─────────────────────────────────────────────────────────
    await sendAndVerify(alice, bob,   'Alice', 'Bob',   'Hello from Alice via real WebRTC!');
    await sendAndVerify(bob,   alice, 'Bob',   'Alice', 'Hi Alice, Bob here — P2P works!');
    await sendAndVerify(alice, bob,   'Alice', 'Bob',   'One more from Alice 🎉');

    console.log('\n🎉 REAL WebRTC P2P messaging works!\n');

    await alice.close();
    await bob.close();
    await aliceCtx.close();
    await bobCtx.close();
  });

  test('typing indicator works over real WebRTC', async ({ browser }) => {
    test.setTimeout(90000);

    const aliceCtx = await browser.newContext();
    const bobCtx   = await browser.newContext();
    const alice = await aliceCtx.newPage();
    const bob   = await bobCtx.newPage();

    await loadApp(alice, 'Alice');
    await createWorkspace(alice, 'TypingTest', 'Alice');
    await joinWorkspace(bob, (await getInviteUrl(alice)).replace('https://decentchat.app', BASE_URL), 'Bob');

    await waitForP2P(alice, bob);

    // Alice types — Bob should see indicator
    await alice.locator('#compose-input').pressSequentially('Typing...', { delay: 80 });
    await bob.waitForFunction(
      () => {
        const el = document.getElementById('typing-indicator');
        return el && el.textContent && el.textContent.trim().length > 0;
      },
      { timeout: 8000 }
    );
    await expect(bob.locator('#typing-indicator')).toContainText('typing');
    console.log('[Typing] Bob sees Alice typing ✅');

    await alice.close();
    await bob.close();
    await aliceCtx.close();
    await bobCtx.close();
  });

});
