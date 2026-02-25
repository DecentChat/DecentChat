/**
 * Sync Reliability E2E Tests
 *
 * Tests multi-user message sync via MockTransport (WebSocket relay).
 * Covers: real-time delivery, burst traffic, ordering, offline queue flush,
 * and full large-history catchup (1 000 messages).
 *
 * Uses the same MockTransport + relay-server pattern as multi-user.spec.ts
 * so tests run deterministically without WebRTC / PeerJS.
 */

import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

// ─── Relay setup ──────────────────────────────────────────────────────────────

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
  console.log(`[SyncTest] Mock relay on port ${relay.port}`);
});

test.afterAll(async () => {
  relay?.close();
});

// ─── Test-user factory ────────────────────────────────────────────────────────

interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();

  // Inject MockTransport before any app JS runs
  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));

  // Loosen ECDH/ECDSA verify (same as multi-user.spec.ts)
  await page.addInitScript(() => {
    const _orig = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async (alg: any, key: CryptoKey, sig: BufferSource, data: BufferSource) => {
      try { return await _orig(alg, key, sig, data); }
      catch (e: any) { if (e.name === 'InvalidAccessError') return true; throw e; }
    };
  });

  // Fresh IndexedDB
  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      for (const db of await indexedDB.databases()) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  await page.waitForFunction(() => {
    const el = document.getElementById('loading');
    return !el || el.style.opacity === '0';
  }, { timeout: 15_000 });
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15_000 });

  return { name, context, page };
}

async function closeUser(user: TestUser) {
  await user.context.close().catch(() => {});
}

// ─── Workspace helpers ────────────────────────────────────────────────────────

async function createWorkspace(page: Page, name: string, alias: string) {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10_000 });
}

async function getInviteUrl(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>(resolve => {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    (navigator.clipboard as any).writeText = (text: string) => {
      (navigator.clipboard as any).writeText = orig;
      resolve(text);
      return Promise.resolve();
    };
    document.getElementById('copy-invite')?.click();
    setTimeout(() => resolve(''), 5_000);
  }));
}

async function joinViaUrl(page: Page, url: string, alias: string) {
  await page.goto(url);
  await page.waitForSelector('.modal', { timeout: 10_000 });
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15_000 });
}

// ─── Connection helper ────────────────────────────────────────────────────────

async function waitForPeerConnection(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => {
      const s = (window as any).__state;
      return s?.connectedPeers && s.connectedPeers.size > 0;
    },
    { timeout: timeoutMs },
  );
}

// ─── Messaging helpers ────────────────────────────────────────────────────────

async function sendMessageUI(page: Page, text: string) {
  await page.locator('#compose-input').fill(text);
  await page.locator('#compose-input').press('Enter');
  await waitForTextInMessages(page, text, 8_000);
}

async function waitForTextInMessages(page: Page, text: string, timeoutMs = 20_000) {
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll('.message-content')).some(el => el.textContent?.includes(t)),
    text,
    { timeout: timeoutMs },
  );
}

async function getMessageTexts(page: Page): Promise<string[]> {
  const texts = await page.locator('.message-content').allTextContents();
  return texts.map(t => t.replace(/\n+$/g, ''));
}

function generateSequentialMessages(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i.toString().padStart(5, '0')}`);
}

function getDeterministicSampleIndices(count: number): number[] {
  const candidates = [0, 1, 2, 3, 4, 10, 25, 50, 100, 250, 500, 750, 900, 995, 998, 999];
  return [...new Set(candidates.filter(i => i >= 0 && i < count))];
}

async function getPrefixedMessagesViaController(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate((pfx: string) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    if (!ctrl?.messageStore || !state?.activeChannelId) return [];

    return ctrl.messageStore
      .getMessages(state.activeChannelId)
      .filter((m: any) => String(m.content ?? '').startsWith(pfx))
      .slice()
      .sort((a: any, b: any) => {
        const tsDelta = Number(a.timestamp) - Number(b.timestamp);
        if (tsDelta !== 0) return tsDelta;
        return String(a.id).localeCompare(String(b.id));
      })
      .map((m: any) => String(m.content ?? ''));
  }, prefix);
}

/**
 * Inject N messages directly through the app's ChatController.sendMessage()
 * running inside the browser context — fast, exercises real send + encrypt + queue path.
 */
async function bulkSendViaController(page: Page, prefix: string, count: number) {
  await page.evaluate(async ({ prefix, count }) => {
    const ctrl = (window as any).__ctrl;
    if (!ctrl?.sendMessage) throw new Error('ChatController not available');
    for (let i = 0; i < count; i++) {
      await ctrl.sendMessage(`${prefix}${i.toString().padStart(5, '0')}`);
      // MessageStore requires strictly increasing timestamps; tight loops can
      // hit same-ms Date.now() and reject local addMessage().
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }, { prefix, count });
}

/**
 * Seed N messages directly into Alice's MessageStore (bypasses encryption/transport
 * entirely — used to pre-populate history before Bob joins, to test Negentropy sync).
 */
async function seedMessagesIntoStore(page: Page, channelId: string, messages: string[]) {
  // Use forceAdd (synchronous) instead of createMessage+addMessage (async SHA-256 per msg
  // + IndexedDB per msg) to avoid page.evaluate timing out at ~200 iterations.
  // forceAdd inserts directly into the in-memory store without hash-chain validation —
  // acceptable here because we're testing sync/delivery, not chain integrity.
  await page.evaluate(({ channelId, messages }: { channelId: string; messages: string[] }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    if (!ctrl?.messageStore) throw new Error('messageStore not available');
    const peerId = state.myPeerId;
    const GENESIS = '0'.repeat(64);
    const runTag = Date.now().toString(36);

    const seeded: any[] = [];
    let lastTs = Date.now() - 1;

    for (let i = 0; i < messages.length; i++) {
      const msg = {
        id: `seed-${runTag}-${i.toString().padStart(5, '0')}`,
        channelId,
        senderId: peerId,
        timestamp: ++lastTs,
        content: messages[i],
        type: 'text' as const,
        threadId: undefined,
        prevHash: GENESIS,
        status: 'pending',
      };
      ctrl.messageStore.forceAdd(msg);
      seeded.push(msg);
    }

    // Register all seeded messages in the CRDT index so Negentropy can compute
    // set-difference and advertise them to connecting peers.
    const crdt = ctrl.getOrCreateCRDT(channelId);
    for (const msg of seeded) {
      try { crdt.addReceived(msg); } catch {}
    }
  }, { channelId, messages });
}

async function waitForMessageCount(page: Page, count: number, timeoutMs = 60_000) {
  await page.waitForFunction(
    (n) => document.querySelectorAll('.message-content').length >= n,
    count,
    { timeout: timeoutMs },
  );
}

async function getMessageCountViaController(page: Page, prefix: string): Promise<number> {
  return page.evaluate((pfx) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    if (!ctrl?.messageStore || !state?.activeChannelId) return 0;
    return ctrl.messageStore
      .getMessages(state.activeChannelId)
      .filter((m: any) => String(m.content ?? '').startsWith(pfx)).length;
  }, prefix);
}

function makeSyncTrace(label: string) {
  const t0 = Date.now();
  return (phase: string, data: Record<string, unknown> = {}) => {
    console.log(`[SYNC_TRACE][${label}][${phase}] t=+${Date.now() - t0}ms ${JSON.stringify(data)}`);
  };
}

async function waitForPrefixCountWithTrace(
  page: Page,
  prefix: string,
  expected: number,
  timeoutMs: number,
  trace: (phase: string, data?: Record<string, unknown>) => void,
  label: string,
) {
  const started = Date.now();
  let lastCount = -1;

  while (Date.now() - started < timeoutMs) {
    const count = await getMessageCountViaController(page, prefix);
    if (count !== lastCount) {
      trace(`${label}-progress`, { count, expected });
      lastCount = count;
    }
    if (count >= expected) {
      trace(`${label}-done`, { count, expected });
      return;
    }
    await page.waitForTimeout(2_000);
  }

  const finalCount = await getMessageCountViaController(page, prefix);
  trace(`${label}-timeout`, { finalCount, expected, timeoutMs });
  throw new Error(`[${label}] timed out waiting for count ${expected}, got ${finalCount}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Sync Reliability', () => {

  // ─── 1. Basic real-time delivery ────────────────────────────────────────────

  test('basic real-time: Alice sends a message and Bob receives it', async ({ browser }) => {
    test.setTimeout(60_000);
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');

    try {
      const inviteUrl = await (async () => {
        await createWorkspace(alice.page, 'Basic Sync', 'Alice');
        return getInviteUrl(alice.page);
      })();

      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);

      const msg = `hello-${Date.now()}`;
      await sendMessageUI(alice.page, msg);
      await waitForTextInMessages(bob.page, msg, 20_000);

      expect(await getMessageTexts(bob.page)).toContain(msg);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── 2. Bi-directional delivery ─────────────────────────────────────────────

  test('bi-directional: both peers send and receive in alternating turns', async ({ browser }) => {
    test.setTimeout(90_000);
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Bi-Dir Sync', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);

      const ts = Date.now();
      const turns = [
        { sender: alice.page, receiver: bob.page, text: `A1-${ts}` },
        { sender: bob.page,   receiver: alice.page, text: `B1-${ts}` },
        { sender: alice.page, receiver: bob.page,  text: `A2-${ts}` },
        { sender: bob.page,   receiver: alice.page, text: `B2-${ts}` },
      ];

      for (const { sender, receiver, text } of turns) {
        await sendMessageUI(sender, text);
        await waitForTextInMessages(receiver, text, 20_000);
      }

      // Both peers must see ALL messages
      const allTexts = turns.map(t => t.text);
      for (const text of allTexts) {
        expect(await getMessageTexts(alice.page)).toContain(text);
        expect(await getMessageTexts(bob.page)).toContain(text);
      }
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── 3. Message ordering (CRDT convergence) ──────────────────────────────────

  test('ordering: alternating sends converge to the same causal order on both peers', async ({ browser }) => {
    test.setTimeout(90_000);
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Order Sync', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);

      const ts = Date.now();
      // Strict alternation: each message is sent only after the previous one
      // has been received by both sides to force causal ordering
      const seq = [`A1-${ts}`, `B1-${ts}`, `A2-${ts}`, `B2-${ts}`, `A3-${ts}`];
      const senders = [alice.page, bob.page, alice.page, bob.page, alice.page];
      const receivers = [bob.page, alice.page, bob.page, alice.page, bob.page];

      for (let i = 0; i < seq.length; i++) {
        await sendMessageUI(senders[i], seq[i]);
        await waitForTextInMessages(receivers[i], seq[i], 20_000);
      }

      // Filter to our sequence, verify same order on both peers
      const aliceOrder = (await getMessageTexts(alice.page)).filter(t => seq.includes(t));
      const bobOrder   = (await getMessageTexts(bob.page)).filter(t => seq.includes(t));

      expect(aliceOrder).toEqual(seq);
      expect(bobOrder).toEqual(seq);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── 4. Burst traffic: 50 messages in sequence ───────────────────────────────

  test('burst: Alice sends 50 messages rapidly and Bob receives all in correct order', async ({ browser }) => {
    test.setTimeout(120_000);
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Burst Sync', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);

      const COUNT = 50;
      const PREFIX = `burst-${Date.now()}-`;

      const start = Date.now();
      await bulkSendViaController(alice.page, PREFIX, COUNT);

      // Wait for last message to appear on Bob
      await waitForTextInMessages(bob.page, `${PREFIX}${(COUNT - 1).toString().padStart(5, '0')}`, 60_000);
      const elapsedMs = Date.now() - start;

      // All 50 must be present and ordered
      const bobMessages = (await getMessageTexts(bob.page)).filter(t => t.startsWith(PREFIX));
      expect(bobMessages).toHaveLength(COUNT);

      for (let i = 0; i < COUNT; i++) {
        expect(bobMessages[i]).toBe(`${PREFIX}${i.toString().padStart(5, '0')}`);
      }

      // Sanity bound — must be well under 60s (regression guard)
      console.log(`[SyncTest] Burst-50 delivery: ${elapsedMs}ms`);
      expect(elapsedMs).toBeLessThan(60_000);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── 5. Offline queue: 100 messages queued while Bob is disconnected ─────────

  test('offline queue: 100 messages sent while Bob is offline flush on reconnect', async ({ browser }) => {
    test.setTimeout(180_000);
    const trace = makeSyncTrace('offline-queue-100');
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');

    try {
      trace('start');
      await createWorkspace(alice.page, 'Offline Queue', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);
      trace('connected-initial');

      // Cut Bob's network — MockTransport WS closes, peer marked disconnected
      await bob.context.setOffline(true);
      trace('bob-offline-on');
      // Give transport time to register disconnection on Alice's side
      await alice.page.waitForTimeout(3_000);

      const COUNT = 100;
      const PREFIX = `offline-${Date.now()}-`;
      await bulkSendViaController(alice.page, PREFIX, COUNT);

      // Verify Alice has all messages locally
      const aliceCount = await getMessageCountViaController(alice.page, PREFIX);
      trace('alice-local-count', { aliceCount, expected: COUNT });
      expect(aliceCount).toBe(COUNT);

      // Restore Bob's network — WS reconnects (auto-reconnect fires after ~300ms).
      await bob.context.setOffline(false);
      trace('bob-offline-off');

      // Wait until Bob's MockTransport WebSocket is OPEN and re-registered on the relay
      // before telling Alice to reconnect. If we nudge Alice too early, the relay responds
      // with __error "Peer not found" and nobody retries.
      await bob.page.waitForFunction(
        () => {
          const t = (window as any).__transport;
          return t?._ws?.readyState === 1; // WebSocket.OPEN
        },
        { timeout: 30_000 },
      );
      await bob.page.waitForTimeout(150); // relay round-trip: __register → __registered
      trace('bob-ws-open-registered');

      // Now Bob is on the relay — nudge Alice to reconnect.
      await alice.page.evaluate(() => (window as any).__ctrl?.runPeerMaintenanceNow?.('post-offline-reconnect'));
      trace('alice-maintenance-nudged');

      // Wait for Bob to finish handshake and appear as connected.
      await bob.page.waitForFunction(
        () => {
          const s = (window as any).__state;
          return s?.connectedPeers && s.connectedPeers.size > 0;
        },
        { timeout: 60_000 },
      );
      trace('bob-connected-after-reconnect');

      // Bob must receive all queued messages (store-level assertion is robust
      // even if UI virtualizes / only partially renders long lists).
      await waitForPrefixCountWithTrace(
        bob.page,
        PREFIX,
        COUNT,
        90_000,
        trace,
        'offline-queue-flush',
      );

      const bobCount = await getMessageCountViaController(bob.page, PREFIX);
      trace('bob-final-count', { bobCount, expected: COUNT });
      expect(bobCount).toBe(COUNT);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── 6. Offline catch-up at scale: 1 000 messages while Bob is disconnected ─────────
  //
  // Strategy: seed messages directly into Alice's MessageStore (bypasses per-message
  // crypto so seeding is fast — ~1–2s for 1k) then rely on Negentropy to sync them
  // to Bob on reconnect. This isolates the offline-queue + Negentropy sync path.

  test('offline catch-up: Bob reconnects and receives 1 000 messages sent while offline', async ({ browser }) => {
    test.setTimeout(300_000);
    const trace = makeSyncTrace('offline-catchup-1k');
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');

    try {
      trace('start');
      await createWorkspace(alice.page, 'Offline Catchup 1k', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);
      trace('connected-initial');

      // Both peers are up — take Bob offline before seeding.
      await bob.context.setOffline(true);
      trace('bob-offline-on');
      await alice.page.waitForTimeout(2_000);

      const COUNT = 1_000;
      const PREFIX = `offline-1k-${Date.now()}-`;
      const expectedMessages = generateSequentialMessages(PREFIX, COUNT);

      // Grab Alice's active channel ID.
      const channelId = await alice.page.evaluate(() => (window as any).__state?.activeChannelId);
      expect(channelId).toBeTruthy();

      // Seed 1 000 messages directly into Alice's MessageStore + CRDT index.
      // This is ~1–2s vs ~60–120s for the encrypted send path.
      await seedMessagesIntoStore(alice.page, channelId, expectedMessages);
      const seededCount = await getMessageCountViaController(alice.page, PREFIX);
      trace('alice-seeded', { seededCount, expected: COUNT });
      expect(seededCount).toBe(COUNT);
      console.log(`[SyncTest] Seeded ${COUNT} messages into Alice's store.`);

      const reconnectStart = Date.now();

      // Bring Bob back — the MockTransport WS reconnects after ~300ms.
      await bob.context.setOffline(false);
      trace('bob-offline-off');

      // Wait until Bob's WS is OPEN and registered on the relay, THEN nudge Alice.
      // (If we call runPeerMaintenance before Bob is registered, Alice gets __error: Peer not found)
      await bob.page.waitForFunction(
        () => {
          const t = (window as any).__transport;
          return t?._ws?.readyState === 1;
        },
        { timeout: 30_000 },
      );
      await bob.page.waitForTimeout(150);
      trace('bob-ws-open-registered');
      await alice.page.evaluate(() => (window as any).__ctrl?.runPeerMaintenanceNow?.('post-offline-1k-reconnect'));
      trace('alice-maintenance-nudged');

      // Wait for Negentropy to deliver all 1 000 messages to Bob's store.
      await waitForPrefixCountWithTrace(
        bob.page,
        PREFIX,
        COUNT,
        180_000,
        trace,
        'offline-catchup-negentropy',
      );

      const catchupMs = Date.now() - reconnectStart;
      console.log(`[SyncTest] Offline 1k catch-up: ${catchupMs}ms`);

      const bobCount = await getMessageCountViaController(bob.page, PREFIX);
      trace('bob-final-count', { bobCount, expected: COUNT, catchupMs });
      expect(bobCount).toBe(COUNT);

      // Strong validation using store-level data (CI-stable with virtualized UI).
      const bobMessages = await getPrefixedMessagesViaController(bob.page, PREFIX);
      expect(bobMessages).toHaveLength(COUNT);

      // Sampled content checks across the full range.
      for (const idx of getDeterministicSampleIndices(COUNT)) {
        expect(bobMessages[idx]).toBe(expectedMessages[idx]);
      }

      // Full-order check: suffix numbers must be strictly increasing end-to-end.
      const ordered = bobMessages.every((msg, idx) => {
        if (idx === 0) return true;
        const prev = Number(bobMessages[idx - 1].slice(PREFIX.length));
        const curr = Number(msg.slice(PREFIX.length));
        return Number.isFinite(prev) && Number.isFinite(curr) && curr > prev;
      });
      expect(ordered).toBe(true);

      // Performance guard: 1k Negentropy catch-up must complete in under 3 minutes.
      expect(catchupMs).toBeLessThan(180_000);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── 6b. Offline chaos reconnect: repeated flaps during 1 000-message catch-up ───────

  test('offline chaos reconnect: Bob survives repeated disconnects and fully catches up 1 000 messages', async ({ browser }) => {
    test.setTimeout(420_000);
    const trace = makeSyncTrace('offline-chaos-1k');
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');

    try {
      trace('start');
      await createWorkspace(alice.page, 'Offline Chaos 1k', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);
      trace('connected-initial');

      await bob.context.setOffline(true);
      trace('bob-offline-initial');
      await alice.page.waitForTimeout(2_000);

      const COUNT = 1_000;
      const PREFIX = `offline-chaos-1k-${Date.now()}-`;
      const expectedMessages = generateSequentialMessages(PREFIX, COUNT);

      const channelId = await alice.page.evaluate(() => (window as any).__state?.activeChannelId);
      expect(channelId).toBeTruthy();

      await seedMessagesIntoStore(alice.page, channelId, expectedMessages);
      const seededCount = await getMessageCountViaController(alice.page, PREFIX);
      trace('alice-seeded', { seededCount, expected: COUNT });
      expect(seededCount).toBe(COUNT);

      const reconnectStart = Date.now();

      // Bring Bob online and intentionally flap his network while catch-up runs.
      await bob.context.setOffline(false);
      trace('bob-online-phase1');

      await bob.page.waitForFunction(
        () => {
          const t = (window as any).__transport;
          return t?._ws?.readyState === 1;
        },
        { timeout: 30_000 },
      );
      await bob.page.waitForTimeout(150);
      await alice.page.evaluate(() => (window as any).__ctrl?.runPeerMaintenanceNow?.('offline-chaos-phase1'));
      trace('alice-maintenance-phase1');

      // Perform deterministic reconnect flaps to stress retry/idempotency.
      const flapPlan = [
        { onlineMs: 2_500, offlineMs: 1_200 },
        { onlineMs: 3_000, offlineMs: 1_500 },
      ];

      for (let i = 0; i < flapPlan.length; i++) {
        const phase = flapPlan[i];
        await bob.page.waitForTimeout(phase.onlineMs);
        await bob.context.setOffline(true);
        trace('bob-flap-offline', { flap: i + 1, ...phase });
        await alice.page.waitForTimeout(300);

        await bob.page.waitForTimeout(phase.offlineMs);
        await bob.context.setOffline(false);
        trace('bob-flap-online', { flap: i + 1, ...phase });

        await bob.page.waitForFunction(
          () => {
            const t = (window as any).__transport;
            return t?._ws?.readyState === 1;
          },
          { timeout: 30_000 },
        );
        await bob.page.waitForTimeout(150);

        await alice.page.evaluate((n) => (window as any).__ctrl?.runPeerMaintenanceNow?.(`offline-chaos-phase-${n}`), i + 2);
        trace('alice-maintenance-after-flap', { flap: i + 1 });
      }

      await waitForPrefixCountWithTrace(
        bob.page,
        PREFIX,
        COUNT,
        240_000,
        trace,
        'offline-chaos-catchup',
      );

      const catchupMs = Date.now() - reconnectStart;
      const bobCount = await getMessageCountViaController(bob.page, PREFIX);
      trace('bob-final-count', { bobCount, expected: COUNT, catchupMs });
      expect(bobCount).toBe(COUNT);

      const bobMessages = await getPrefixedMessagesViaController(bob.page, PREFIX);
      expect(bobMessages).toHaveLength(COUNT);

      for (const idx of getDeterministicSampleIndices(COUNT)) {
        expect(bobMessages[idx]).toBe(expectedMessages[idx]);
      }

      const ordered = bobMessages.every((msg, idx) => {
        if (idx === 0) return true;
        const prev = Number(bobMessages[idx - 1].slice(PREFIX.length));
        const curr = Number(msg.slice(PREFIX.length));
        return Number.isFinite(prev) && Number.isFinite(curr) && curr > prev;
      });
      expect(ordered).toBe(true);

      // Guardrail: even with reconnect flaps, full catch-up should finish within 4 minutes.
      expect(catchupMs).toBeLessThan(240_000);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── 7. New-member history sync: Bob joins workspace with 1 000 pre-existing messages ──

  test('history sync: Bob joins after 1 000 messages exist and receives all via Negentropy', async ({ browser }) => {
    test.setTimeout(240_000);
    const trace = makeSyncTrace('history-sync-1k');
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');

    try {
      trace('start');
      await createWorkspace(alice.page, 'History 1k', 'Alice');

      // Capture Alice's active channel ID before bulk-seeding
      const channelId = await alice.page.evaluate(() => (window as any).__state?.activeChannelId);
      expect(channelId).toBeTruthy();

      const COUNT = 1_000;
      const PREFIX = `history-${Date.now()}-`;
      const expectedMessages = generateSequentialMessages(PREFIX, COUNT);

      // Seed 1 000 messages directly into Alice's store
      // (bypasses encryption so seeding is fast; tests the Negentropy/Merkle sync path)
      await seedMessagesIntoStore(alice.page, channelId, expectedMessages);

      // Verify Alice's store has all messages before Bob joins
      const aliceCount = await getMessageCountViaController(alice.page, PREFIX);
      trace('alice-seeded', { aliceCount, expected: COUNT });
      expect(aliceCount).toBe(COUNT);

      // Bob joins AFTER the history exists — must sync everything
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);
      trace('connected-after-join');

      // Negentropy sync should push all missing messages to Bob.
      // Use store-level wait (DOM may virtualize long histories).
      await waitForPrefixCountWithTrace(
        bob.page,
        PREFIX,
        COUNT,
        180_000,
        trace,
        'history-sync-negentropy',
      );

      // All 1 000 must be present
      const bobCount = await getMessageCountViaController(bob.page, PREFIX);
      trace('bob-final-count', { bobCount, expected: COUNT });
      expect(bobCount).toBe(COUNT);

      // Spot-check first and last
      const bobTexts = (await getMessageTexts(bob.page)).filter(t => t.startsWith(PREFIX));
      expect(bobTexts[0]).toBe(expectedMessages[0]);
      expect(bobTexts[COUNT - 1]).toBe(expectedMessages[COUNT - 1]);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── 8. Three-peer full sync ──────────────────────────────────────────────────

  test('three-peer sync: every message from any peer arrives on all others', async ({ browser }) => {
    test.setTimeout(120_000);
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');
    const carol = await createUser(browser, 'Carol');

    try {
      await createWorkspace(alice.page, '3-Peer Sync', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);

      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await joinViaUrl(carol.page, inviteUrl, 'Carol');

      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);
      await waitForPeerConnection(carol.page);

      const ts = Date.now();
      const msgs = {
        alice: `from-alice-${ts}`,
        bob:   `from-bob-${ts}`,
        carol: `from-carol-${ts}`,
      };

      await sendMessageUI(alice.page, msgs.alice);
      await sendMessageUI(bob.page, msgs.bob);
      await sendMessageUI(carol.page, msgs.carol);

      // Every peer must eventually see every message
      for (const page of [alice.page, bob.page, carol.page]) {
        for (const text of Object.values(msgs)) {
          await waitForTextInMessages(page, text, 30_000);
        }
      }

      for (const page of [alice.page, bob.page, carol.page]) {
        const texts = await getMessageTexts(page);
        expect(texts).toContain(msgs.alice);
        expect(texts).toContain(msgs.bob);
        expect(texts).toContain(msgs.carol);
      }
    } finally {
      await closeUser(alice);
      await closeUser(bob);
      await closeUser(carol);
    }
  });

  // ─── 9. Refresh restore: keep active channel + open thread ───────────────────

  test('refresh restore: same channel and thread stay open after reload', async ({ browser }) => {
    test.setTimeout(120_000);
    const alice = await createUser(browser, 'Alice');

    try {
      await createWorkspace(alice.page, 'Refresh Restore', 'Alice');

      // Create second channel via UI and switch to it.
      await alice.page.click('#add-channel-btn');
      await alice.page.waitForSelector('.modal input[name="name"]', { timeout: 10_000 });
      await alice.page.fill('.modal input[name="name"]', 'random');
      await alice.page.click('.modal .btn-primary');
      await expect(alice.page.locator('.channel-header h2')).toContainText('# random');

      const randomChannelId = await alice.page.evaluate(() => {
        const active = document.querySelector('.sidebar-item.active[data-channel-id]') as HTMLElement | null;
        return active?.dataset.channelId || '';
      });
      expect(randomChannelId).toBeTruthy();

      // Send root message and open thread panel.
      const rootText = `thread-root-${Date.now()}`;
      await sendMessageUI(alice.page, rootText);

      const rootThreadId = await alice.page.evaluate((text) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const msg = ctrl.messageStore
          .getMessages(state.activeChannelId)
          .find((m: any) => m.content === text && !m.threadId);
        return msg?.id || '';
      }, rootText);
      expect(rootThreadId).toBeTruthy();

      await alice.page.evaluate((threadId) => {
        const btn = document.querySelector(`.message-thread-btn[data-thread-id="${threadId}"]`) as HTMLButtonElement | null;
        btn?.click();
      }, rootThreadId);
      await alice.page.waitForSelector('#thread-panel.open:not(.hidden)', { timeout: 10_000 });

      // Reload and verify restored view.
      await alice.page.reload();
      await alice.page.waitForFunction(() => {
        const el = document.getElementById('loading');
        return !el || el.style.opacity === '0';
      }, { timeout: 15_000 });
      await alice.page.waitForSelector('.sidebar-header', { timeout: 15_000 });

      await expect(alice.page.locator(`.sidebar-item.active[data-channel-id="${randomChannelId}"]`)).toBeVisible();
      await expect(alice.page.locator('.channel-header h2')).toContainText('# random');
      await alice.page.waitForSelector('#thread-panel.open:not(.hidden)', { timeout: 10_000 });

      const activeThreadId = await alice.page.evaluate(() => (window as any).__state?.activeThreadId || null);
      expect(activeThreadId).toBe(rootThreadId);
    } finally {
      await closeUser(alice);
    }
  });

  // ─── 10. State isolation between workspaces ──────────────────────────────────

  test('isolation: messages from separate workspaces never cross-contaminate', async ({ browser }) => {
    test.setTimeout(60_000);
    const alice = await createUser(browser, 'Alice');
    const bob   = await createUser(browser, 'Bob');

    try {
      // Alice and Bob each create their own separate workspace
      await createWorkspace(alice.page, 'Alice Private', 'Alice');
      await createWorkspace(bob.page, 'Bob Private', 'Bob');

      const ts = Date.now();
      await sendMessageUI(alice.page, `alice-secret-${ts}`);
      await sendMessageUI(bob.page, `bob-secret-${ts}`);

      await alice.page.waitForTimeout(2_000);

      const aliceTexts = await getMessageTexts(alice.page);
      const bobTexts   = await getMessageTexts(bob.page);

      expect(aliceTexts).toContain(`alice-secret-${ts}`);
      expect(aliceTexts).not.toContain(`bob-secret-${ts}`);

      expect(bobTexts).toContain(`bob-secret-${ts}`);
      expect(bobTexts).not.toContain(`alice-secret-${ts}`);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
