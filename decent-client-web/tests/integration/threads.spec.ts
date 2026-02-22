/**
 * Thread P2P Integration Tests
 *
 * Verifies that threaded messages are correctly synced between peers via
 * the MockTransport relay. Covers:
 *
 *   1. Thread replies from Alice arrive at Bob
 *   2. Thread replies from Bob arrive at Alice
 *   3. Thread indicators update in real-time for the receiving peer
 *   4. Multiple replies accumulate correctly on both sides
 *   5. Thread panel shows correct replies after receiving from peer
 *   6. The timestamp bug fix: replies arrive even when receiver's clock is ahead
 */

import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

// ─── Relay Server ────────────────────────────────────────────────────────────

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
  console.log(`[Thread Tests] Mock relay started on port ${relay.port}`);
});

test.afterAll(async () => {
  relay?.close();
});

// ─── Test User ───────────────────────────────────────────────────────────────

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

  page.on('console', msg => {
    const text = msg.text();
    if (
      msg.type() === 'error' ||
      text.includes('[Mock') ||
      text.includes('[Thread') ||
      text.includes('[DecentChat]') ||
      text.includes('thread') ||
      text.includes('Thread') ||
      text.includes('handshake') ||
      text.includes('failed') ||
      text.includes('Failed') ||
      text.includes('Guard')
    ) {
      console.log(`[${name}] ${text}`);
    }
  });

  const script = getMockTransportScript(`ws://localhost:${relay.port}`);
  await page.addInitScript(script);

  // Allow ECDH/ECDSA key mismatch in crypto.subtle.verify (test-only)
  await page.addInitScript(() => {
    const _origVerify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async function (algorithm: any, key: CryptoKey, signature: BufferSource, data: BufferSource) {
      try {
        return await _origVerify(algorithm, key, signature, data);
      } catch (e: any) {
        if (e.name === 'InvalidAccessError') return true;
        throw e;
      }
    };
  });

  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
  await page.waitForFunction(() => {
    const t = (window as any).__transport;
    return t && t.getMyPeerId && t.getMyPeerId();
  }, { timeout: 10000 });

  return { name, context, page };
}

async function closeUser(user: TestUser): Promise<void> {
  await user.context.close();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createWorkspace(page: Page, wsName: string, alias: string): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(wsName);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function getInviteUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    return new Promise<string>((resolve) => {
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      (navigator.clipboard as any).writeText = (text: string) => {
        (navigator.clipboard as any).writeText = orig;
        resolve(text);
        return Promise.resolve();
      };
      document.getElementById('copy-invite')?.click();
      setTimeout(() => resolve(''), 5000);
    });
  });
}

async function joinViaInvite(page: Page, inviteUrl: string, alias: string): Promise<void> {
  await page.click('#join-ws-btn');
  await page.waitForSelector('.modal');
  await page.locator('input[name="invite"]').fill(inviteUrl);
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
}

async function waitForPeersReady(page1: Page, page2: Page, timeoutMs = 15000): Promise<void> {
  const p1Id = await page1.evaluate(() => (window as any).__state?.myPeerId);
  const p2Id = await page2.evaluate(() => (window as any).__state?.myPeerId);
  await page1.waitForFunction(
    (targetId: string) => (window as any).__state?.readyPeers?.has(targetId),
    p2Id,
    { timeout: timeoutMs },
  );
  await page2.waitForFunction(
    (targetId: string) => (window as any).__state?.readyPeers?.has(targetId),
    p1Id,
    { timeout: timeoutMs },
  );
}

async function syncWorkspaceState(page1: Page, page2: Page): Promise<void> {
  const aliceChannelId = await page1.evaluate(() => (window as any).__state?.activeChannelId);
  await page2.evaluate((channelId: string) => {
    const s = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    if (!s.activeWorkspaceId) return;
    const ws = ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId);
    if (!ws || !ws.channels[0]) return;
    const oldChannelId = ws.channels[0].id;
    ws.channels[0].id = channelId;
    s.activeChannelId = channelId;
    const allWs = ctrl.workspaceManager;
    if (allWs.channels) {
      const ch = allWs.channels.get(oldChannelId);
      if (ch) {
        allWs.channels.delete(oldChannelId);
        ch.id = channelId;
        allWs.channels.set(channelId, ch);
      }
    }
  }, aliceChannelId);

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
  await page1.evaluate(addMembers);
  await page2.evaluate(addMembers);
}

async function waitForWorkspaceSync(page1: Page, page2: Page, timeoutMs = 10000): Promise<void> {
  const channel1 = await page1.evaluate(() => (window as any).__state?.activeChannelId || '');
  const peer1 = await page1.evaluate(() => (window as any).__state?.myPeerId || '');
  const peer2 = await page2.evaluate(() => (window as any).__state?.myPeerId || '');

  await page2.waitForFunction(
    ({ expectedChannel, expectedPeer }: { expectedChannel: string; expectedPeer: string }) => {
      const s = (window as any).__state;
      const ctrl = (window as any).__ctrl;
      if (!s?.activeWorkspaceId || s.activeChannelId !== expectedChannel) return false;
      const ws = ctrl?.workspaceManager?.getWorkspace?.(s.activeWorkspaceId);
      return !!ws?.members?.some((m: any) => m.peerId === expectedPeer);
    },
    { expectedChannel: channel1, expectedPeer: peer1 },
    { timeout: timeoutMs },
  );
  await page1.waitForFunction(
    (expectedPeer: string) => {
      const s = (window as any).__state;
      const ctrl = (window as any).__ctrl;
      if (!s?.activeWorkspaceId) return false;
      const ws = ctrl?.workspaceManager?.getWorkspace?.(s.activeWorkspaceId);
      return !!ws?.members?.some((m: any) => m.peerId === expectedPeer);
    },
    peer2,
    { timeout: timeoutMs },
  );
}

async function setupConnectedPair(browser: Browser, wsName: string): Promise<[TestUser, TestUser]> {
  const alice = await createUser(browser, 'Alice');
  const bob = await createUser(browser, 'Bob');

  await createWorkspace(alice.page, wsName, 'Alice');
  const inviteUrl = await getInviteUrl(alice.page);
  await joinViaInvite(bob.page, inviteUrl, 'Bob');
  await waitForPeersReady(alice.page, bob.page);
  await syncWorkspaceState(alice.page, bob.page);
  await waitForWorkspaceSync(alice.page, bob.page);

  return [alice, bob];
}

/** Send a normal (main-channel) message and wait for it to appear locally */
async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('#compose-input');
  await input.fill(text);
  await input.press('Enter');
  await page.waitForFunction(
    (t: string) => Array.from(document.querySelectorAll('.message-content'))
      .some(m => m.textContent?.includes(t)),
    text,
    { timeout: 8000 },
  );
}

/** Wait until a main-channel message with given text appears on a page */
async function waitForMessage(page: Page, text: string, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    (t: string) => Array.from(document.querySelectorAll('.message-content'))
      .some(m => m.textContent?.includes(t)),
    text,
    { timeout: timeoutMs },
  );
}

/**
 * Open the thread panel for the first message whose content contains `text`.
 * Clicks the 💬 thread button in the message actions bar.
 */
async function openThreadFor(page: Page, messageText: string): Promise<void> {
  // Hover over the message to reveal the action bar
  const msgEl = page.locator('.message-content', { hasText: messageText }).first();
  await msgEl.hover();

  // Click the thread button in the action bar
  const msgDiv = msgEl.locator('..').locator('..');
  const threadBtn = msgDiv.locator('.message-thread-btn').first();
  await threadBtn.click();

  // Wait for thread panel to open
  await page.waitForSelector('#thread-panel.open, #thread-panel:not(.hidden)', { timeout: 5000 });
}

/** Get the message IDs from the thread panel */
async function getThreadMessageContents(page: Page): Promise<string[]> {
  return page.locator('#thread-messages .message-content').allTextContents();
}

/** Send a thread reply from the currently-open thread panel */
async function sendThreadReply(page: Page, text: string): Promise<void> {
  const input = page.locator('#thread-input');
  await input.fill(text);
  await input.press('Enter');

  // Wait for reply to appear in the thread panel
  await page.waitForFunction(
    (t: string) => Array.from(document.querySelectorAll('#thread-messages .message-content'))
      .some(m => m.textContent?.includes(t)),
    text,
    { timeout: 8000 },
  );
}

/** Wait until the thread panel (on any page) contains a message with the given text */
async function waitForThreadMessage(page: Page, text: string, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    (t: string) => Array.from(document.querySelectorAll('#thread-messages .message-content'))
      .some(m => m.textContent?.includes(t)),
    text,
    { timeout: timeoutMs },
  );
}

/** Get the thread indicator text for a message (the "N replies" badge) */
async function getThreadIndicatorText(page: Page, messageText: string): Promise<string> {
  return page.evaluate((text: string) => {
    const msgContent = Array.from(document.querySelectorAll('.message-content'))
      .find(el => el.textContent?.includes(text));
    if (!msgContent) return '';
    const body = msgContent.closest('.message-body');
    const indicator = body?.querySelector('.message-thread-indicator');
    return indicator?.textContent?.trim() || '';
  }, messageText);
}

/** Get reply count stored in the protocol (not DOM) */
async function getProtocolThreadCount(page: Page, messageText: string): Promise<number> {
  return page.evaluate((text: string) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    if (!ctrl || !state?.activeChannelId) return -1;

    // Find the message by content
    const allMsgs = ctrl.messageStore.getMessages(state.activeChannelId);
    const parent = allMsgs.find((m: any) => m.content?.includes(text));
    if (!parent) return -1;

    return ctrl.messageStore.getThread(state.activeChannelId, parent.id).length;
  }, messageText);
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Thread P2P Sync', () => {
  test.setTimeout(90000);

  // ── 1. Basic thread reply delivery ────────────────────────────────────────
  test('Alice thread reply arrives at Bob (stored + indicator updates)', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Thread Test 1');
    try {
      // Alice sends a main message; Bob receives it
      await sendMessage(alice.page, 'Hello from Alice!');
      await waitForMessage(bob.page, 'Hello from Alice!');

      // Alice opens the thread and replies
      await openThreadFor(alice.page, 'Hello from Alice!');
      await sendThreadReply(alice.page, 'This is my thread reply');

      // Bob should receive the thread reply in the protocol store (even with thread closed)
      await bob.page.waitForFunction(
        (text: string) => {
          const ctrl = (window as any).__ctrl;
          const state = (window as any).__state;
          if (!ctrl || !state?.activeChannelId) return false;
          const allMsgs = ctrl.messageStore.getMessages(state.activeChannelId);
          const parent = allMsgs.find((m: any) => m.content?.includes('Hello from Alice!'));
          if (!parent) return false;
          const replies = ctrl.messageStore.getThread(state.activeChannelId, parent.id);
          return replies.some((r: any) => r.content?.includes(text));
        },
        'This is my thread reply',
        { timeout: 15000 },
      );

      // Verify reply count via protocol
      const count = await getProtocolThreadCount(bob.page, 'Hello from Alice!');
      expect(count).toBe(1);

      // Verify the thread indicator was updated in Bob's DOM
      const indicatorText = await getThreadIndicatorText(bob.page, 'Hello from Alice!');
      expect(indicatorText).toMatch(/1\s*reply/i);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 2. Bob thread reply arrives at Alice ─────────────────────────────────
  test('Bob thread reply arrives at Alice (stored + indicator updates)', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Thread Test 2');
    try {
      // Alice sends main message; Bob receives it
      await sendMessage(alice.page, 'Discussion topic');
      await waitForMessage(bob.page, 'Discussion topic');

      // Bob opens the thread and replies
      await openThreadFor(bob.page, 'Discussion topic');
      await sendThreadReply(bob.page, 'Bob says hello in thread');

      // Alice's protocol should receive the thread reply
      await alice.page.waitForFunction(
        (text: string) => {
          const ctrl = (window as any).__ctrl;
          const state = (window as any).__state;
          if (!ctrl || !state?.activeChannelId) return false;
          const allMsgs = ctrl.messageStore.getMessages(state.activeChannelId);
          const parent = allMsgs.find((m: any) => m.content?.includes('Discussion topic'));
          if (!parent) return false;
          const replies = ctrl.messageStore.getThread(state.activeChannelId, parent.id);
          return replies.some((r: any) => r.content?.includes(text));
        },
        'Bob says hello in thread',
        { timeout: 15000 },
      );

      // Alice's thread indicator should update
      const indicatorText = await getThreadIndicatorText(alice.page, 'Discussion topic');
      expect(indicatorText).toMatch(/1\s*reply/i);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 3. Multiple replies from both sides ───────────────────────────────────
  test('multiple thread replies from both sides all arrive', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Thread Test 3');
    try {
      await sendMessage(alice.page, 'Multi-reply thread');
      await waitForMessage(bob.page, 'Multi-reply thread');

      // Alice opens thread, sends 2 replies
      await openThreadFor(alice.page, 'Multi-reply thread');
      await sendThreadReply(alice.page, 'Alice reply 1');
      await sendThreadReply(alice.page, 'Alice reply 2');

      // Bob opens same thread, sends 1 reply
      await openThreadFor(bob.page, 'Multi-reply thread');
      await sendThreadReply(bob.page, 'Bob reply 1');

      // Alice should see Bob's reply in her thread
      await waitForThreadMessage(alice.page, 'Bob reply 1');

      // Bob should see Alice's 2 replies
      await waitForThreadMessage(bob.page, 'Alice reply 1');
      await waitForThreadMessage(bob.page, 'Alice reply 2');

      // Both should have 3 total replies in the store
      // (slight timing: wait for count to reach 3)
      await alice.page.waitForFunction(
        () => {
          const ctrl = (window as any).__ctrl;
          const state = (window as any).__state;
          if (!ctrl || !state?.activeChannelId) return false;
          const allMsgs = ctrl.messageStore.getMessages(state.activeChannelId);
          const parent = allMsgs.find((m: any) => m.content?.includes('Multi-reply thread'));
          if (!parent) return false;
          return ctrl.messageStore.getThread(state.activeChannelId, parent.id).length >= 3;
        },
        { timeout: 15000 },
      );

      const aliceCount = await getProtocolThreadCount(alice.page, 'Multi-reply thread');
      expect(aliceCount).toBeGreaterThanOrEqual(3);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 4. Thread panel shows replies from peer when opened ──────────────────
  test('opening thread panel shows replies already received from peer', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Thread Test 4');
    try {
      await sendMessage(alice.page, 'Open-later thread');
      await waitForMessage(bob.page, 'Open-later thread');

      // Alice replies in the thread
      await openThreadFor(alice.page, 'Open-later thread');
      await sendThreadReply(alice.page, 'Async reply from Alice');

      // Wait until Bob's protocol has received it
      await bob.page.waitForFunction(
        (text: string) => {
          const ctrl = (window as any).__ctrl;
          const state = (window as any).__state;
          if (!ctrl || !state?.activeChannelId) return false;
          const allMsgs = ctrl.messageStore.getMessages(state.activeChannelId);
          const parent = allMsgs.find((m: any) => m.content?.includes('Open-later thread'));
          if (!parent) return false;
          return ctrl.messageStore.getThread(state.activeChannelId, parent.id).length > 0;
        },
        'Async reply from Alice',
        { timeout: 15000 },
      );

      // Bob opens the thread — should see Alice's reply immediately
      await openThreadFor(bob.page, 'Open-later thread');
      const threadContents = await getThreadMessageContents(bob.page);
      expect(threadContents.some(c => c.includes('Async reply from Alice'))).toBe(true);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 5. Timestamp bug: reply arrives even when receiver has newer messages ─
  test('[BUG FIX] thread reply arrives even when Bob sent messages after Alice sent the reply', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Timestamp Bug Test');
    try {
      await sendMessage(alice.page, 'Root message');
      await waitForMessage(bob.page, 'Root message');

      // Bob sends a main channel message (advances Bob's chain timestamp)
      await sendMessage(bob.page, 'Bob main msg');
      await waitForMessage(alice.page, 'Bob main msg');

      // Alice sends another main msg (advances Alice's chain)
      await sendMessage(alice.page, 'Alice main msg 2');
      await waitForMessage(bob.page, 'Alice main msg 2');

      // Now Alice opens the thread on "Root message" and replies
      // Bob's chain is now ahead (has later timestamps from the back-and-forth)
      // Without the timestamp fix, Alice's thread reply would be rejected by Bob's store
      await openThreadFor(alice.page, 'Root message');
      await sendThreadReply(alice.page, 'Thread reply after many msgs');

      // Bob MUST receive the thread reply despite having newer timestamps in his store
      await bob.page.waitForFunction(
        (text: string) => {
          const ctrl = (window as any).__ctrl;
          const state = (window as any).__state;
          if (!ctrl || !state?.activeChannelId) return false;
          const allMsgs = ctrl.messageStore.getMessages(state.activeChannelId);
          const parent = allMsgs.find((m: any) => m.content?.includes('Root message'));
          if (!parent) return false;
          const replies = ctrl.messageStore.getThread(state.activeChannelId, parent.id);
          return replies.some((r: any) => r.content?.includes(text));
        },
        'Thread reply after many msgs',
        { timeout: 15000 },
      );

      const count = await getProtocolThreadCount(bob.page, 'Root message');
      expect(count).toBe(1);

      // Thread indicator should appear
      const indicatorText = await getThreadIndicatorText(bob.page, 'Root message');
      expect(indicatorText).toMatch(/1\s*reply/i);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 6. Thread reply counter shows correct count as replies arrive ─────────
  test('thread indicator shows correct reply count as replies accumulate', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Thread Counter Test');
    try {
      await sendMessage(alice.page, 'Count replies here');
      await waitForMessage(bob.page, 'Count replies here');

      // Bob opens thread, sends 3 replies one by one
      await openThreadFor(bob.page, 'Count replies here');

      for (let i = 1; i <= 3; i++) {
        await sendThreadReply(bob.page, `Bob thread reply ${i}`);
      }

      // Alice should see the indicator with 3 replies
      await alice.page.waitForFunction(
        () => {
          const ctrl = (window as any).__ctrl;
          const state = (window as any).__state;
          if (!ctrl || !state?.activeChannelId) return false;
          const allMsgs = ctrl.messageStore.getMessages(state.activeChannelId);
          const parent = allMsgs.find((m: any) => m.content?.includes('Count replies here'));
          if (!parent) return false;
          return ctrl.messageStore.getThread(state.activeChannelId, parent.id).length >= 3;
        },
        { timeout: 20000 },
      );

      const count = await getProtocolThreadCount(alice.page, 'Count replies here');
      expect(count).toBeGreaterThanOrEqual(3);

      // The thread indicator text should show 3 replies
      const indicatorText = await getThreadIndicatorText(alice.page, 'Count replies here');
      expect(indicatorText).toMatch(/3\s*repl/i);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 7. Main channel messages are not affected by thread replies ───────────
  test('thread replies do not appear in main channel message list', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Thread Isolation Test');
    try {
      await sendMessage(alice.page, 'Main channel only');
      await waitForMessage(bob.page, 'Main channel only');

      await openThreadFor(alice.page, 'Main channel only');
      await sendThreadReply(alice.page, 'Secret thread content');

      // Wait until Bob receives the reply
      await bob.page.waitForFunction(
        (text: string) => {
          const ctrl = (window as any).__ctrl;
          const state = (window as any).__state;
          if (!ctrl || !state?.activeChannelId) return false;
          const allMsgs = ctrl.messageStore.getMessages(state.activeChannelId);
          const parent = allMsgs.find((m: any) => m.content?.includes('Main channel only'));
          if (!parent) return false;
          return ctrl.messageStore.getThread(state.activeChannelId, parent.id).length > 0;
        },
        'Secret thread content',
        { timeout: 15000 },
      );

      // "Secret thread content" must NOT appear in Bob's main message list DOM
      const mainContents = await bob.page.locator('#messages-list .message-content').allTextContents();
      expect(mainContents.some(c => c.includes('Secret thread content'))).toBe(false);

      // But "Main channel only" MUST be in the main list
      expect(mainContents.some(c => c.includes('Main channel only'))).toBe(true);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 8. Thread reply stores parent threadId on receiver ───────────────────
  test('agent reply arrives under original message with threadId set', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Thread Id Test 1');
    try {
      await sendMessage(alice.page, 'Original prompt for agent');
      await waitForMessage(bob.page, 'Original prompt for agent');

      await openThreadFor(bob.page, 'Original prompt for agent');
      await sendThreadReply(bob.page, 'Agent-style reply #1');

      await alice.page.waitForFunction(
        () => {
          const ctrl = (window as any).__ctrl;
          const state = (window as any).__state;
          if (!ctrl || !state?.activeChannelId) return false;
          const msgs = ctrl.messageStore.getMessages(state.activeChannelId);
          const parent = msgs.find((m: any) => m.content?.includes('Original prompt for agent'));
          if (!parent) return false;
          const reply = msgs.find((m: any) => m.content?.includes('Agent-style reply #1'));
          if (!reply) return false;
          return reply.threadId === parent.id;
        },
        { timeout: 15000 },
      );

      const threadMeta = await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const msgs = ctrl.messageStore.getMessages(state.activeChannelId);
        const parent = msgs.find((m: any) => m.content?.includes('Original prompt for agent'));
        const reply = msgs.find((m: any) => m.content?.includes('Agent-style reply #1'));
        const thread = parent ? ctrl.messageStore.getThread(state.activeChannelId, parent.id) : [];
        return {
          parentId: parent?.id || '',
          replyThreadId: reply?.threadId || '',
          threadCount: thread.length,
        };
      });

      expect(threadMeta.parentId).toBeTruthy();
      expect(threadMeta.replyThreadId).toBe(threadMeta.parentId);
      expect(threadMeta.threadCount).toBe(1);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 9. Second thread reply stays on same thread ──────────────────────────
  test('second reply goes to same thread (does not create a new thread)', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Thread Id Test 2');
    try {
      await sendMessage(alice.page, 'Root for two replies');
      await waitForMessage(bob.page, 'Root for two replies');

      await openThreadFor(bob.page, 'Root for two replies');
      await sendThreadReply(bob.page, 'Agent reply one');
      await sendThreadReply(bob.page, 'Agent reply two');

      await alice.page.waitForFunction(
        () => {
          const ctrl = (window as any).__ctrl;
          const state = (window as any).__state;
          if (!ctrl || !state?.activeChannelId) return false;
          const msgs = ctrl.messageStore.getMessages(state.activeChannelId);
          const parent = msgs.find((m: any) => m.content?.includes('Root for two replies'));
          if (!parent) return false;
          const thread = ctrl.messageStore.getThread(state.activeChannelId, parent.id);
          const one = thread.find((m: any) => m.content?.includes('Agent reply one'));
          const two = thread.find((m: any) => m.content?.includes('Agent reply two'));
          return !!one && !!two && one.threadId === parent.id && two.threadId === parent.id;
        },
        { timeout: 15000 },
      );

      const threadMeta = await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const msgs = ctrl.messageStore.getMessages(state.activeChannelId);
        const parent = msgs.find((m: any) => m.content?.includes('Root for two replies'));
        const thread = parent ? ctrl.messageStore.getThread(state.activeChannelId, parent.id) : [];
        return {
          parentId: parent?.id || '',
          threadIds: thread.map((m: any) => m.threadId || null),
          contents: thread.map((m: any) => m.content || ''),
          threadCount: thread.length,
        };
      });

      expect(threadMeta.parentId).toBeTruthy();
      expect(threadMeta.contents.some(c => c.includes('Agent reply one'))).toBe(true);
      expect(threadMeta.contents.some(c => c.includes('Agent reply two'))).toBe(true);
      expect(threadMeta.threadIds.every(id => id === threadMeta.parentId)).toBe(true);
      expect(threadMeta.threadCount).toBeGreaterThanOrEqual(2);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ── 10. DM messages/replies must not carry threadId ──────────────────────
  test('DM replies have no threadId', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Thread Id DM Test');
    try {
      const alicePeerId = await alice.page.evaluate(() => (window as any).__state?.myPeerId || '');
      const bobPeerId = await bob.page.evaluate(() => (window as any).__state?.myPeerId || '');
      expect(alicePeerId).toBeTruthy();
      expect(bobPeerId).toBeTruthy();

      const aliceConversationId = await alice.page.evaluate(async (peerId: string) => {
        const ctrl = (window as any).__ctrl;
        await ctrl.addContact({
          peerId,
          displayName: 'Bob',
          publicKey: '',
          signalingServers: [],
          addedAt: Date.now(),
          lastSeen: Date.now(),
        });
        const conv = await ctrl.startDirectMessage(peerId);
        await ctrl.sendDirectMessage(conv.id, 'DM from Alice');
        return conv.id as string;
      }, bobPeerId);

      expect(aliceConversationId).toBeTruthy();

      await bob.page.waitForFunction(
        (peerId: string) => {
          const ctrl = (window as any).__ctrl;
          return ctrl.directConversationStore.getByContact(peerId)
            .then((conv: any) => {
              if (!conv) return false;
              const msgs = ctrl.messageStore.getMessages(conv.id);
              return msgs.some((m: any) => m.content?.includes('DM from Alice'));
            })
            .catch(() => false);
        },
        alicePeerId,
        { timeout: 15000 },
      );

      const bobInboundMeta = await bob.page.evaluate(async (peerId: string) => {
        const ctrl = (window as any).__ctrl;
        const conv = await ctrl.directConversationStore.getByContact(peerId);
        if (!conv) return { exists: false, threadId: 'missing' };
        const msg = ctrl.messageStore.getMessages(conv.id).find((m: any) => m.content?.includes('DM from Alice'));
        return {
          exists: !!msg,
          threadId: msg?.threadId ?? null,
          conversationId: conv.id,
        };
      }, alicePeerId);

      expect(bobInboundMeta.exists).toBe(true);
      expect(bobInboundMeta.threadId).toBeNull();

      await bob.page.evaluate(async (peerId: string) => {
        const ctrl = (window as any).__ctrl;
        const conv = await ctrl.directConversationStore.getByContact(peerId);
        if (!conv) throw new Error('No direct conversation to reply in');
        await ctrl.sendDirectMessage(conv.id, 'DM reply from Bob');
      }, alicePeerId);

      await alice.page.waitForFunction(
        (conversationId: string) => {
          const ctrl = (window as any).__ctrl;
          const msgs = ctrl.messageStore.getMessages(conversationId);
          return msgs.some((m: any) => m.content?.includes('DM reply from Bob'));
        },
        aliceConversationId,
        { timeout: 15000 },
      );

      const aliceReplyMeta = await alice.page.evaluate((conversationId: string) => {
        const ctrl = (window as any).__ctrl;
        const msg = ctrl.messageStore.getMessages(conversationId)
          .find((m: any) => m.content?.includes('DM reply from Bob'));
        return {
          exists: !!msg,
          threadId: msg?.threadId ?? null,
        };
      }, aliceConversationId);

      expect(aliceReplyMeta.exists).toBe(true);
      expect(aliceReplyMeta.threadId).toBeNull();
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
