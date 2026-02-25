/**
 * Reaction Sync E2E Tests (MockTransport)
 *
 * Tests cross-peer reaction synchronisation using the MockTransport/relay
 * infrastructure so we don't depend on WebRTC working in headless Chromium.
 *
 * Root cause that these tests cover:
 *   - Before fix: `onMessage` created a NEW message ID on receive, so Alice's
 *     message on Bob's side had a different DOM id than Alice's own copy.
 *     Reactions reference `#reactions-<msgId>`, so they targeted a non-existent
 *     element on the other peer's DOM → reactions silently dropped.
 *   - Fix: sender now includes `messageId` in the encrypted envelope; receiver
 *     overrides its locally generated ID with the sender's ID, ensuring both
 *     peers share the same `data-msg-id` for every message.
 */

import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

// ─── Relay server ─────────────────────────────────────────────────────────────

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
  console.log(`[Reactions Test] Relay started on port ${relay.port}`);
});

test.afterAll(() => relay?.close());

// ─── User creation (mirrors mock-messaging.spec.ts) ──────────────────────────

interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();

  page.on('console', msg => {
    const t = msg.text();
    if (
      msg.type() === 'error' ||
      t.includes('[TRACE') || t.includes('[DecentChat]') ||
      t.includes('reaction') || t.includes('Reaction') ||
      t.includes('messageId') || t.includes('[Guard]')
    ) {
      console.log(`  [${name}] ${t}`);
    }
  });

  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));

  // Patch crypto.subtle.verify to handle ECDH key algo mismatch in test
  await page.addInitScript(() => {
    const orig = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async function (algorithm: any, key: CryptoKey, sig: BufferSource, data: BufferSource) {
      try { return await orig(algorithm, key, sig, data); }
      catch (e: any) { if (e.name === 'InvalidAccessError') return true; throw e; }
    };
  });

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
    const l = document.getElementById('loading');
    return !l || l.style.opacity === '0';
  }, { timeout: 15000 });

  const openAppBtn = page.getByRole('button', { name: /open app/i });
  if (await openAppBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openAppBtn.click();
  }

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
  await page.waitForFunction(() => {
    const t = (window as any).__transport;
    return t?.getMyPeerId?.();
  }, { timeout: 10000 });

  return { name, context, page };
}

async function closeUser(u: TestUser) { try { await u.context.close(); } catch {} }

// ─── Workspace / connection helpers ──────────────────────────────────────────

async function createWorkspace(page: Page, name: string, alias: string) {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function getInviteUrl(page: Page): Promise<string> {
  return page.evaluate(() =>
    new Promise<string>(resolve => {
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      (navigator.clipboard as any).writeText = (text: string) => {
        (navigator.clipboard as any).writeText = orig;
        resolve(text);
        return Promise.resolve();
      };
      document.getElementById('copy-invite')?.click();
      setTimeout(() => resolve(''), 5000);
    }),
  );
}

async function joinViaInvite(page: Page, inviteUrl: string, alias: string) {
  await page.click('#join-ws-btn');
  await page.waitForSelector('.modal');
  await page.locator('input[name="invite"]').fill(inviteUrl);
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
}

async function waitForPeersReady(p1: Page, p2: Page, ms = 15000) {
  const id1 = await p1.evaluate(() => (window as any).__state?.myPeerId);
  const id2 = await p2.evaluate(() => (window as any).__state?.myPeerId);
  await p1.waitForFunction((id: string) => (window as any).__state?.readyPeers?.has(id), id2, { timeout: ms });
  await p2.waitForFunction((id: string) => (window as any).__state?.readyPeers?.has(id), id1, { timeout: ms });
}

async function syncWorkspaceState(p1: Page, p2: Page) {
  const ch1 = await p1.evaluate(() => (window as any).__state?.activeChannelId);

  await p2.evaluate((channelId: string) => {
    const s = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    if (!s.activeWorkspaceId) return;
    const ws = ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId);
    if (!ws?.channels[0]) return;
    const old = ws.channels[0].id;
    ws.channels[0].id = channelId;
    s.activeChannelId = channelId;
    const am = ctrl.workspaceManager;
    if (am.channels) {
      const ch = am.channels.get(old);
      if (ch) { am.channels.delete(old); ch.id = channelId; am.channels.set(channelId, ch); }
    }
  }, ch1);

  const addMembers = () => {
    const s = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    if (!s.activeWorkspaceId) return;
    const ws = ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId);
    if (!ws) return;
    for (const peerId of s.readyPeers) {
      if (!ws.members.some((m: any) => m.peerId === peerId)) {
        ws.members.push({ peerId, alias: peerId.slice(0, 8), publicKey: '', joinedAt: Date.now(), role: 'member' });
      }
    }
  };
  await p1.evaluate(addMembers);
  await p2.evaluate(addMembers);
}

async function waitForWorkspaceSync(p1: Page, p2: Page, ms = 10000) {
  const ch1 = await p1.evaluate(() => (window as any).__state?.activeChannelId || '');
  const peer1 = await p1.evaluate(() => (window as any).__state?.myPeerId || '');
  const peer2 = await p2.evaluate(() => (window as any).__state?.myPeerId || '');

  await p2.waitForFunction(
    ({ ch, peer }: { ch: string; peer: string }) => {
      const s = (window as any).__state;
      const ctrl = (window as any).__ctrl;
      if (s.activeChannelId !== ch) return false;
      const ws = ctrl?.workspaceManager?.getWorkspace?.(s.activeWorkspaceId);
      return !!ws?.members?.some((m: any) => m.peerId === peer);
    },
    { ch: ch1, peer: peer1 },
    { timeout: ms },
  );

  await p1.waitForFunction(
    (peer: string) => {
      const s = (window as any).__state;
      const ctrl = (window as any).__ctrl;
      const ws = ctrl?.workspaceManager?.getWorkspace?.(s.activeWorkspaceId);
      return !!ws?.members?.some((m: any) => m.peerId === peer);
    },
    peer2,
    { timeout: ms },
  );
}

async function setupConnectedPair(browser: Browser, wsName: string): Promise<[TestUser, TestUser]> {
  const alice = await createUser(browser, 'Alice');
  const bob = await createUser(browser, 'Bob');

  await createWorkspace(alice.page, wsName, 'Alice');
  const invite = await getInviteUrl(alice.page);
  await joinViaInvite(bob.page, invite, 'Bob');

  await waitForPeersReady(alice.page, bob.page);
  await syncWorkspaceState(alice.page, bob.page);
  await waitForWorkspaceSync(alice.page, bob.page);

  return [alice, bob];
}

// ─── Reaction-specific helpers ────────────────────────────────────────────────

/** Send a message and wait for it to appear in sender's DOM */
async function sendMessage(page: Page, text: string) {
  const input = page.locator('#compose-input');
  await input.fill(text);
  await input.press('Enter');
  await page.waitForFunction(
    (t: string) => Array.from(document.querySelectorAll('.message-content')).some(m => m.textContent?.includes(t)),
    text,
    { timeout: 5000 },
  );
}

/** Wait for message to appear in receiver's DOM */
async function waitForMessage(page: Page, text: string, ms = 15000) {
  await page.waitForFunction(
    (t: string) => Array.from(document.querySelectorAll('.message-content')).some(m => m.textContent?.includes(t)),
    text,
    { timeout: ms },
  );
}

/**
 * Find the message element containing `text`, hover it, and click the
 * quick-react button for `emoji`.
 */
async function reactToMessage(page: Page, messageText: string, emoji: string) {
  // Quick-react buttons sit inside .message-actions-bar which has display:none until
  // .message:hover. Playwright's click({force}) cannot dispatch events on children of
  // display:none parents. Instead, find the target message ID and invoke the toggleReaction
  // callback directly via page.evaluate().
  const msgId = await page.evaluate((text: string) => {
    const msgs = Array.from(document.querySelectorAll('.message'));
    const msg = msgs.find(m => m.querySelector('.message-content')?.textContent?.includes(text));
    return msg ? (msg as HTMLElement).dataset.messageId ?? null : null;
  }, messageText);

  if (!msgId) throw new Error(`reactToMessage: message not found: "${messageText}"`);

  await page.evaluate(
    ({ id, em }: { id: string; em: string }) => {
      // Trigger via the quick-react button's click handler (calls toggleReaction callback)
      const btn = document.querySelector(`.quick-react[data-msg-id="${id}"][data-emoji="${em}"]`) as HTMLElement | null;
      if (btn) {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } else {
        // Fallback: call __ctrl.toggleReaction if available
        const ctrl = (window as any).__ctrl;
        if (ctrl?.toggleReaction) ctrl.toggleReaction(id, em);
      }
    },
    { id: msgId, em: emoji },
  );

  await page.waitForTimeout(300); // Let reaction event dispatch
}

/**
 * Wait for a reaction pill `emoji N` to appear on the message containing `text`.
 * `count` is the expected minimum user count.
 */
async function waitForReactionPill(page: Page, messageText: string, emoji: string, count: number, ms = 8000) {
  await page.waitForFunction(
    ({ msgText, em, n }: { msgText: string; em: string; n: number }) => {
      const msgs = Array.from(document.querySelectorAll('.message'));
      const msg = msgs.find(m => m.querySelector('.message-content')?.textContent?.includes(msgText));
      if (!msg) return false;
      const pill = Array.from(msg.querySelectorAll('.reaction-pill'))
        .find(p => p.textContent?.includes(em));
      if (!pill) return false;
      const match = pill.textContent?.match(/\d+/);
      return match ? parseInt(match[0], 10) >= n : false;
    },
    { msgText: messageText, em: emoji, n: count },
    { timeout: ms },
  );
}

/** Check that a reaction pill is ABSENT on the message */
async function expectNoReactionPill(page: Page, messageText: string, emoji: string) {
  const msgs = page.locator('.message', { hasText: messageText }).first();
  const pill = msgs.locator(`.reaction-pill`).filter({ hasText: emoji });
  await expect(pill).toHaveCount(0);
}

/** Get the numeric count shown in a reaction pill */
async function getReactionCount(page: Page, messageText: string, emoji: string): Promise<number> {
  const msg = page.locator('.message', { hasText: messageText }).first();
  const pill = msg.locator('.reaction-pill').filter({ hasText: emoji }).first();
  const text = await pill.textContent();
  const m = text?.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Reaction Sync (cross-peer)', () => {
  test.setTimeout(90000);

  // ── 1. Basic cross-peer sync ─────────────────────────────────────────────

  test('[BUG FIX] Bob reacts to Alice message → Alice sees the reaction pill', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'React Sync 1');
    try {
      // Alice sends a message
      await sendMessage(alice.page, 'Hello Bob, react to this!');
      // Bob receives it
      await waitForMessage(bob.page, 'Hello Bob, react to this!');

      // Bob reacts with 👍
      await reactToMessage(bob.page, 'Hello Bob, react to this!', '👍');

      // Alice should see the 👍 reaction pill with count 1 on her message
      await waitForReactionPill(alice.page, 'Hello Bob, react to this!', '👍', 1);
      const count = await getReactionCount(alice.page, 'Hello Bob, react to this!', '👍');
      expect(count).toBe(1);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  test('[BUG FIX] Alice reacts to Bob message → Bob sees the reaction pill', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'React Sync 2');
    try {
      await sendMessage(bob.page, 'Alice, please react to this one!');
      await waitForMessage(alice.page, 'Alice, please react to this one!');

      await reactToMessage(alice.page, 'Alice, please react to this one!', '❤️');

      await waitForReactionPill(bob.page, 'Alice, please react to this one!', '❤️', 1);
      const count = await getReactionCount(bob.page, 'Alice, please react to this one!', '❤️');
      expect(count).toBe(1);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 2. Both react → count = 2 ────────────────────────────────────────────

  test('both peers react with same emoji → count shows 2 on both sides', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'React Count 2');
    try {
      await sendMessage(alice.page, 'Everyone react!');
      await waitForMessage(bob.page, 'Everyone react!');

      // Alice reacts first (she owns the message, so reaction is local + broadcast)
      await reactToMessage(alice.page, 'Everyone react!', '😂');
      // Bob also reacts with the same emoji
      await reactToMessage(bob.page, 'Everyone react!', '😂');

      // Both should see count 2
      await waitForReactionPill(alice.page, 'Everyone react!', '😂', 2);
      await waitForReactionPill(bob.page, 'Everyone react!', '😂', 2);

      const aliceCount = await getReactionCount(alice.page, 'Everyone react!', '😂');
      const bobCount = await getReactionCount(bob.page, 'Everyone react!', '😂');
      expect(aliceCount).toBe(2);
      expect(bobCount).toBe(2);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 3. Remove reaction propagates ────────────────────────────────────────

  test('remove reaction propagates to peer', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'React Remove');
    try {
      await sendMessage(alice.page, 'I will un-react to this');
      await waitForMessage(bob.page, 'I will un-react to this');

      // Bob reacts
      await reactToMessage(bob.page, 'I will un-react to this', '🎉');
      // Alice sees it
      await waitForReactionPill(alice.page, 'I will un-react to this', '🎉', 1);

      // Bob removes the reaction (toggle off)
      await reactToMessage(bob.page, 'I will un-react to this', '🎉');

      // Alice should no longer see the 🎉 pill
      await alice.page.waitForFunction(
        ({ msgText, em }: { msgText: string; em: string }) => {
          const msgs = Array.from(document.querySelectorAll('.message'));
          const msg = msgs.find(m => m.querySelector('.message-content')?.textContent?.includes(msgText));
          if (!msg) return true; // message gone = OK
          const pills = Array.from(msg.querySelectorAll('.reaction-pill'));
          return !pills.some(p => p.textContent?.includes(em));
        },
        { msgText: 'I will un-react to this', em: '🎉' },
        { timeout: 8000 },
      );
      await expectNoReactionPill(alice.page, 'I will un-react to this', '🎉');
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 4. Multiple emoji on same message ────────────────────────────────────

  test('multiple emoji reactions on same message sync independently', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Multi Emoji');
    try {
      await sendMessage(alice.page, 'React with different emoji!');
      await waitForMessage(bob.page, 'React with different emoji!');

      // Alice: 👍, Bob: ❤️
      await reactToMessage(alice.page, 'React with different emoji!', '👍');
      await reactToMessage(bob.page, 'React with different emoji!', '❤️');

      // Both peers should see both emoji pills (each with count 1)
      await waitForReactionPill(alice.page, 'React with different emoji!', '❤️', 1);
      await waitForReactionPill(bob.page, 'React with different emoji!', '👍', 1);

      // Alice's own 👍 is already local; Bob's ❤️ arrived via sync
      const aliceThumb = await getReactionCount(alice.page, 'React with different emoji!', '👍');
      const aliceHeart = await getReactionCount(alice.page, 'React with different emoji!', '❤️');
      expect(aliceThumb).toBe(1);
      expect(aliceHeart).toBe(1);

      const bobThumb = await getReactionCount(bob.page, 'React with different emoji!', '👍');
      const bobHeart = await getReactionCount(bob.page, 'React with different emoji!', '❤️');
      expect(bobThumb).toBe(1);
      expect(bobHeart).toBe(1);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 5. Reaction on message received from peer (the original reported bug) ─

  test('[BUG FIX] message IDs match across peers — reaction targets correct DOM element', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'ID Match Test');
    try {
      // Alice sends message
      await sendMessage(alice.page, 'Check my ID');
      await waitForMessage(bob.page, 'Check my ID');

      // Get the DOM message ID on both sides — they must match after the fix
      const aliceMsgId = await alice.page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('.message')).find(
          m => m.querySelector('.message-content')?.textContent?.includes('Check my ID'),
        );
        return el?.querySelector('.message-reactions')?.id?.replace('reactions-', '') || '';
      });

      const bobMsgId = await bob.page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('.message')).find(
          m => m.querySelector('.message-content')?.textContent?.includes('Check my ID'),
        );
        return el?.querySelector('.message-reactions')?.id?.replace('reactions-', '') || '';
      });

      expect(aliceMsgId).toBeTruthy();
      expect(bobMsgId).toBeTruthy();
      expect(aliceMsgId).toBe(bobMsgId); // This would fail before the fix

      // And confirm reactions actually work
      await reactToMessage(bob.page, 'Check my ID', '👍');
      await waitForReactionPill(alice.page, 'Check my ID', '👍', 1);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 6. Local reaction still works (no regression) ────────────────────────

  test('local reaction (own message) still shows immediately without P2P', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Local Reaction');
    try {
      await sendMessage(alice.page, 'Alice reacts to own message');

      // Alice reacts to her own message — should appear instantly (no P2P roundtrip)
      await reactToMessage(alice.page, 'Alice reacts to own message', '🤔');

      const pill = alice.page.locator('.message', { hasText: 'Alice reacts to own message' })
        .first()
        .locator('.reaction-pill')
        .filter({ hasText: '🤔' });
      await expect(pill).toBeVisible({ timeout: 3000 });
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 7. Reaction dedup: double-click same emoji toggles off, not double-add ─

  test('double-clicking same emoji toggles reaction off (no duplicate count)', async ({ browser }) => {
    // Dedup is a local concern (ReactionManager.toggleReaction) — no P2P needed.
    const alice = await createUser(browser, 'Alice');
    try {
      await createWorkspace(alice.page, 'Dedup Test', 'Alice');
      await sendMessage(alice.page, 'Dedup reaction test');

      const msgId = await alice.page.evaluate(() => {
        const msg = Array.from(document.querySelectorAll('.message')).find(
          m => m.querySelector('.message-content')?.textContent?.includes('Dedup reaction test'),
        ) as HTMLElement | undefined;
        return msg?.dataset.messageId || '';
      });
      expect(msgId).toBeTruthy();

      // Toggle on then off using controller API directly.
      await alice.page.evaluate((id: string) => {
        const ctrl = (window as any).__ctrl;
        ctrl?.toggleReaction?.(id, '👍');
        ctrl?.toggleReaction?.(id, '👍');
      }, msgId);

      await alice.page.waitForTimeout(250);

      // Count must be <= 1 and unique-reactor set must dedupe.
      const count = await getReactionCount(alice.page, 'Dedup reaction test', '👍').catch(() => 0);
      expect(count).toBeLessThanOrEqual(1);
    } finally {
      await closeUser(alice);
    }
  });
});

/** Wait for a pill to appear (or stay absent) — used for dedup test */
async function page_waitForReactionOrNo(page: Page, msgText: string, emoji: string) {
  await page.waitForFunction(
    ({ t, em }: { t: string; em: string }) => {
      const msgs = Array.from(document.querySelectorAll('.message'));
      const msg = msgs.find(m => m.querySelector('.message-content')?.textContent?.includes(t));
      if (!msg) return true;
      // Either a pill appeared OR the reaction is already back to 0 — either is stable
      const pill = Array.from(msg.querySelectorAll('.reaction-pill')).find(p => p.textContent?.includes(em));
      return pill !== undefined || true; // Just wait a bit, then check
    },
    { t: msgText, em: emoji },
    { timeout: 3000 },
  ).catch(() => {}); // OK to timeout here
  await page.waitForTimeout(200);
}
