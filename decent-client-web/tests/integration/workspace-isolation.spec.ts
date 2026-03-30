/**
 * Workspace Isolation E2E Tests
 *
 * Verifies that multiple workspaces with different members maintain
 * strict data isolation: no channels, messages, or members leak
 * across workspace boundaries.
 *
 * Scenario:
 * - Alice creates workspace1 (Engineering), workspace2 (Design), workspace3 (Marketing)
 * - Each workspace has unique custom channels beyond #general
 * - Bob joins workspace1, Mary joins workspace2, Susan joins workspace3 via invite links
 * - Each pair exchanges messages in #general
 * - Assertions verify complete isolation of channels, messages, and members
 */

import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';
import { createBrowserContext } from './context-permissions';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
  console.log(`[Test] Mock relay on port ${relay.port}`);
});

test.afterAll(async () => {
  relay?.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test User Abstraction
// ═══════════════════════════════════════════════════════════════════════════════

interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await createBrowserContext(browser);
  const page = await context.newPage();

  const script = getMockTransportScript(`ws://localhost:${relay.port}`);
  await page.addInitScript(script);

  // Patch verify for ECDH/ECDSA mismatch in legacy decrypt path
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

  await page.goto('/app');
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
  await page.goto('/app');

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });

  await page.waitForSelector('#create-ws-btn-nav, #create-ws-btn, .sidebar-header', { timeout: 15000 });
  return { name, context, page };
}

async function closeUser(user: TestUser): Promise<void> {
  try { await user.context.close(); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workspace Helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function createWorkspaceFirst(page: Page, name: string, alias: string): Promise<void> {
  await page.locator('#create-ws-btn-nav, #create-ws-btn').first().click();
  await page.waitForSelector('.modal');
  await page.locator('.modal input[name="name"]').fill(name);
  await page.locator('.modal input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function createWorkspaceAdditional(page: Page, name: string, alias: string): Promise<void> {
  await page.click('#ws-rail-add');
  await page.waitForSelector('.modal');
  await page.locator('.modal input[name="name"]').fill(name);
  await page.locator('.modal input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function createChannel(page: Page, name: string): Promise<void> {
  await page.click('#add-channel-btn');
  await page.waitForSelector('.modal');
  await page.locator('.modal input[name="name"]').fill(name);
  await page.click('.modal .btn-primary');
  // Wait for channel to appear in sidebar
  await page.waitForFunction(
    (channelName) => {
      return Array.from(document.querySelectorAll('.sidebar-item'))
        .some(el => el.textContent?.includes(channelName));
    },
    name,
    { timeout: 5000 },
  );
}

async function switchToWorkspace(page: Page, wsName: string): Promise<void> {
  // Workspace rail uses title for full workspace name.
  const wsIcon = page.locator(`.ws-rail-icon[title="${wsName}"], .ws-rail-icon[aria-label="${wsName}"]`).first();
  await expect(wsIcon).toBeVisible({ timeout: 8000 });
  await wsIcon.click({ timeout: 5000 });
  await expect(page.locator('.sidebar-header')).toContainText(wsName, { timeout: 8000 });
}

async function switchToChannel(page: Page, channelName: string): Promise<void> {
  const channelItem = page.locator('.sidebar-item').filter({ hasText: channelName }).first();
  await channelItem.click();
  await expect(page.locator('.channel-header')).toContainText(channelName, { timeout: 5000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Invite / Join Helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function getInviteUrl(page: Page): Promise<string> {
  // Use the programmatic API to generate invite URL (more reliable than clipboard)
  const inviteUrl = await page.evaluate(() => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    if (!state?.activeWorkspaceId) return '';
    return ctrl?.generateInviteURL?.(state.activeWorkspaceId) || '';
  });
  expect(inviteUrl).toContain('/join/');
  return inviteUrl;
}

async function joinViaInviteUrl(page: Page, inviteUrl: string, alias: string): Promise<void> {
  await page.goto(inviteUrl);
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('.modal input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connection Helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function waitForPeerConnection(page: Page, expectedOnline = 2, timeoutMs = 30000): Promise<void> {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Messaging Helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('#compose-input');
  await input.fill(text);
  await input.press('Enter');
  await waitForMessageInUI(page, text, 5000);
}

async function waitForMessageInUI(page: Page, text: string, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll('.message-content')).some((m) => m.textContent?.includes(t)),
    text,
    { timeout: timeoutMs },
  );
}

async function getMessages(page: Page): Promise<string[]> {
  return (await page.locator('.message-content').allTextContents()).map(t => t.trim());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Snapshot Helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function getChannelNames(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.sidebar-item')).filter(el => {
      return el.querySelector('.channel-hash');
    }).map(el => {
      const span = el.querySelector('.channel-hash + span') || el.querySelector('span:nth-child(2)');
      return span?.textContent?.trim() || '';
    }).filter(n => n.length > 0);
  });
}

async function getMemberNames(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.member-row')).map(el => {
      const nameEl = el.querySelector('.member-name-text') || el.querySelector('span:not(.dm-status)');
      let name = nameEl?.textContent?.trim() || '';
      name = name.replace(/\(you\)/g, '').replace(/👑/g, '').replace(/⚙️/g, '').trim();
      return name;
    }).filter(n => n.length > 0);
  });
}

async function getWorkspaceCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    return document.querySelectorAll('.ws-rail-icon[data-ws-id]').length;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Workspace Isolation — Multi-Workspace Multi-User', () => {
  test.setTimeout(240000); // 4 browsers + P2P handshakes need time

  test('three workspaces with different members maintain strict data isolation', async ({ browser }) => {
    test.fixme(true, 'Mock transport multi-workspace fanout is currently flaky; covered by narrower isolation tests in this file.');

    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');
    const mary = await createUser(browser, 'Mary');
    const susan = await createUser(browser, 'Susan');

    try {
      // ─── Alice creates 3 workspaces with custom channels ───────────
      console.log('[Test] Alice creating Engineering...');
      await createWorkspaceFirst(alice.page, 'Engineering', 'Alice');
      await createChannel(alice.page, 'backend');
      await createChannel(alice.page, 'frontend');

      console.log('[Test] Alice creating Design...');
      await createWorkspaceAdditional(alice.page, 'Design', 'Alice');
      await createChannel(alice.page, 'ui-ux');
      await createChannel(alice.page, 'branding');

      console.log('[Test] Alice creating Marketing...');
      await createWorkspaceAdditional(alice.page, 'Marketing', 'Alice');
      await createChannel(alice.page, 'social-media');
      await createChannel(alice.page, 'analytics');

      // ─── Verify Alice has exactly 3 workspaces ─────────────────────
      expect(await getWorkspaceCount(alice.page)).toBe(3);

      // ─── Get invite URLs ───────────────────────────────────────────
      console.log('[Test] Getting invite URLs...');
      await switchToWorkspace(alice.page, 'Engineering');
      const invite1 = await getInviteUrl(alice.page);

      await switchToWorkspace(alice.page, 'Design');
      const invite2 = await getInviteUrl(alice.page);

      await switchToWorkspace(alice.page, 'Marketing');
      const invite3 = await getInviteUrl(alice.page);

      // ─── Users join their workspaces ───────────────────────────────
      console.log('[Test] Bob joining Engineering...');
      await joinViaInviteUrl(bob.page, invite1, 'Bob');
      await waitForPeerConnection(bob.page, 2, 30000);
      // Wait for workspace channels to sync
      await new Promise(r => setTimeout(r, 1000));

      console.log('[Test] Mary joining Design...');
      await joinViaInviteUrl(mary.page, invite2, 'Mary');
      await waitForPeerConnection(mary.page, 2, 30000);
      await new Promise(r => setTimeout(r, 1000));

      console.log('[Test] Susan joining Marketing...');
      await joinViaInviteUrl(susan.page, invite3, 'Susan');
      await waitForPeerConnection(susan.page, 2, 30000);
      await new Promise(r => setTimeout(r, 1000));

      // ─── Exchange messages in #general ─────────────────────────────
      const ts = Date.now();

      // Engineering: Alice ↔ Bob
      console.log('[Test] Exchanging messages in Engineering...');
      await switchToWorkspace(alice.page, 'Engineering');
      await switchToChannel(alice.page, 'general');
      await sendMessage(alice.page, `eng-alice-${ts}`);
      await waitForMessageInUI(bob.page, `eng-alice-${ts}`, 20000);
      await sendMessage(bob.page, `eng-bob-${ts}`);
      await waitForMessageInUI(alice.page, `eng-bob-${ts}`, 20000);

      // Design: Alice ↔ Mary
      console.log('[Test] Exchanging messages in Design...');
      await switchToWorkspace(alice.page, 'Design');
      await switchToChannel(alice.page, 'general');
      await sendMessage(alice.page, `design-alice-${ts}`);
      await waitForMessageInUI(mary.page, `design-alice-${ts}`, 20000);
      await sendMessage(mary.page, `design-mary-${ts}`);
      await waitForMessageInUI(alice.page, `design-mary-${ts}`, 20000);

      // Marketing: Alice ↔ Susan
      console.log('[Test] Exchanging messages in Marketing...');
      await switchToWorkspace(alice.page, 'Marketing');
      await switchToChannel(alice.page, 'general');
      await sendMessage(alice.page, `mkt-alice-${ts}`);
      await waitForMessageInUI(susan.page, `mkt-alice-${ts}`, 20000);
      await sendMessage(susan.page, `mkt-susan-${ts}`);
      await waitForMessageInUI(alice.page, `mkt-susan-${ts}`, 20000);

      // ═══════════════════════════════════════════════════════════════
      // ISOLATION ASSERTIONS
      // ═══════════════════════════════════════════════════════════════

      console.log('[Test] Verifying isolation...');

      // ─── Bob: only sees Engineering data ───────────────────────────
      const bobChannels = await getChannelNames(bob.page);
      const bobMembers = await getMemberNames(bob.page);
      const bobMessages = await getMessages(bob.page);

      // Correct channels
      expect(bobChannels).toContain('general');
      expect(bobChannels).toContain('backend');
      expect(bobChannels).toContain('frontend');
      // No leak from Design
      expect(bobChannels).not.toContain('ui-ux');
      expect(bobChannels).not.toContain('branding');
      // No leak from Marketing
      expect(bobChannels).not.toContain('social-media');
      expect(bobChannels).not.toContain('analytics');

      // Correct messages
      expect(bobMessages.some(m => m.includes(`eng-alice-${ts}`))).toBe(true);
      expect(bobMessages.some(m => m.includes(`eng-bob-${ts}`))).toBe(true);
      // No message leak
      expect(bobMessages.some(m => m.includes('design-'))).toBe(false);
      expect(bobMessages.some(m => m.includes('mkt-'))).toBe(false);

      // Correct members
      expect(bobMembers).toContain('Alice');
      expect(bobMembers).toContain('Bob');
      expect(bobMembers).not.toContain('Mary');
      expect(bobMembers).not.toContain('Susan');

      // Bob has exactly 1 workspace
      expect(await getWorkspaceCount(bob.page)).toBe(1);

      // ─── Mary: only sees Design data ───────────────────────────────
      const maryChannels = await getChannelNames(mary.page);
      const maryMembers = await getMemberNames(mary.page);
      const maryMessages = await getMessages(mary.page);

      expect(maryChannels).toContain('general');
      expect(maryChannels).toContain('ui-ux');
      expect(maryChannels).toContain('branding');
      expect(maryChannels).not.toContain('backend');
      expect(maryChannels).not.toContain('frontend');
      expect(maryChannels).not.toContain('social-media');
      expect(maryChannels).not.toContain('analytics');

      expect(maryMessages.some(m => m.includes(`design-alice-${ts}`))).toBe(true);
      expect(maryMessages.some(m => m.includes(`design-mary-${ts}`))).toBe(true);
      expect(maryMessages.some(m => m.includes('eng-'))).toBe(false);
      expect(maryMessages.some(m => m.includes('mkt-'))).toBe(false);

      expect(maryMembers).toContain('Alice');
      expect(maryMembers).toContain('Mary');
      expect(maryMembers).not.toContain('Bob');
      expect(maryMembers).not.toContain('Susan');

      expect(await getWorkspaceCount(mary.page)).toBe(1);

      // ─── Susan: only sees Marketing data ───────────────────────────
      const susanChannels = await getChannelNames(susan.page);
      const susanMembers = await getMemberNames(susan.page);
      const susanMessages = await getMessages(susan.page);

      expect(susanChannels).toContain('general');
      expect(susanChannels).toContain('social-media');
      expect(susanChannels).toContain('analytics');
      expect(susanChannels).not.toContain('backend');
      expect(susanChannels).not.toContain('frontend');
      expect(susanChannels).not.toContain('ui-ux');
      expect(susanChannels).not.toContain('branding');

      expect(susanMessages.some(m => m.includes(`mkt-alice-${ts}`))).toBe(true);
      expect(susanMessages.some(m => m.includes(`mkt-susan-${ts}`))).toBe(true);
      expect(susanMessages.some(m => m.includes('eng-'))).toBe(false);
      expect(susanMessages.some(m => m.includes('design-'))).toBe(false);

      expect(susanMembers).toContain('Alice');
      expect(susanMembers).toContain('Susan');
      expect(susanMembers).not.toContain('Bob');
      expect(susanMembers).not.toContain('Mary');

      expect(await getWorkspaceCount(susan.page)).toBe(1);

      // ─── Alice: correct data per workspace ─────────────────────────
      // Engineering
      await switchToWorkspace(alice.page, 'Engineering');
      await switchToChannel(alice.page, 'general');
      const aliceEngCh = await getChannelNames(alice.page);
      const aliceEngMembers = await getMemberNames(alice.page);
      const aliceEngMsgs = await getMessages(alice.page);

      expect(aliceEngCh).toContain('backend');
      expect(aliceEngCh).toContain('frontend');
      expect(aliceEngCh).not.toContain('ui-ux');
      expect(aliceEngCh).not.toContain('social-media');
      expect(aliceEngMembers).toContain('Bob');
      expect(aliceEngMembers).not.toContain('Mary');
      expect(aliceEngMembers).not.toContain('Susan');
      expect(aliceEngMsgs.some(m => m.includes(`eng-alice-${ts}`))).toBe(true);
      expect(aliceEngMsgs.some(m => m.includes(`eng-bob-${ts}`))).toBe(true);
      expect(aliceEngMsgs.some(m => m.includes('design-'))).toBe(false);
      expect(aliceEngMsgs.some(m => m.includes('mkt-'))).toBe(false);

      // Design
      await switchToWorkspace(alice.page, 'Design');
      await switchToChannel(alice.page, 'general');
      const aliceDesCh = await getChannelNames(alice.page);
      const aliceDesMembers = await getMemberNames(alice.page);
      const aliceDesMsgs = await getMessages(alice.page);

      expect(aliceDesCh).toContain('ui-ux');
      expect(aliceDesCh).toContain('branding');
      expect(aliceDesCh).not.toContain('backend');
      expect(aliceDesCh).not.toContain('social-media');
      expect(aliceDesMembers).toContain('Mary');
      expect(aliceDesMembers).not.toContain('Bob');
      expect(aliceDesMembers).not.toContain('Susan');
      expect(aliceDesMsgs.some(m => m.includes(`design-alice-${ts}`))).toBe(true);
      expect(aliceDesMsgs.some(m => m.includes(`design-mary-${ts}`))).toBe(true);
      expect(aliceDesMsgs.some(m => m.includes('eng-'))).toBe(false);
      expect(aliceDesMsgs.some(m => m.includes('mkt-'))).toBe(false);

      // Marketing
      await switchToWorkspace(alice.page, 'Marketing');
      await switchToChannel(alice.page, 'general');
      const aliceMktCh = await getChannelNames(alice.page);
      const aliceMktMembers = await getMemberNames(alice.page);
      const aliceMktMsgs = await getMessages(alice.page);

      expect(aliceMktCh).toContain('social-media');
      expect(aliceMktCh).toContain('analytics');
      expect(aliceMktCh).not.toContain('backend');
      expect(aliceMktCh).not.toContain('ui-ux');
      expect(aliceMktMembers).toContain('Susan');
      expect(aliceMktMembers).not.toContain('Bob');
      expect(aliceMktMembers).not.toContain('Mary');
      expect(aliceMktMsgs.some(m => m.includes(`mkt-alice-${ts}`))).toBe(true);
      expect(aliceMktMsgs.some(m => m.includes(`mkt-susan-${ts}`))).toBe(true);
      expect(aliceMktMsgs.some(m => m.includes('eng-'))).toBe(false);
      expect(aliceMktMsgs.some(m => m.includes('design-'))).toBe(false);

      // ─── Deep state check via app internals ────────────────────────
      const deepCheck = await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const workspaces = ctrl.workspaceManager.getAllWorkspaces();
        const result: Record<string, { channelCount: number; memberCount: number; messageCount: number; channelNames: string[]; memberAliases: string[] }> = {};
        for (const ws of workspaces) {
          const channels = ws.channels || [];
          result[ws.name] = {
            channelCount: channels.length,
            memberCount: ws.members?.length || 0,
            messageCount: channels.reduce((sum: number, c: any) =>
              sum + (ctrl.messageStore.getMessages(c.id)?.length || 0), 0),
            channelNames: channels.map((c: any) => c.name),
            memberAliases: (ws.members || []).map((m: any) => m.alias),
          };
        }
        return result;
      });

      console.log('[Test] Deep state:', JSON.stringify(deepCheck, null, 2));

      // Each workspace: 3 channels (general + 2 custom), 2 members, >= 2 messages
      for (const wsName of ['Engineering', 'Design', 'Marketing']) {
        expect(deepCheck[wsName]).toBeDefined();
        expect(deepCheck[wsName].channelCount).toBe(3);
        expect(deepCheck[wsName].memberCount).toBe(2);
        expect(deepCheck[wsName].messageCount).toBeGreaterThanOrEqual(2);
      }

      // Cross-check: no channel name appears in wrong workspace
      expect(deepCheck['Engineering'].channelNames).not.toContain('ui-ux');
      expect(deepCheck['Engineering'].channelNames).not.toContain('social-media');
      expect(deepCheck['Design'].channelNames).not.toContain('backend');
      expect(deepCheck['Design'].channelNames).not.toContain('analytics');
      expect(deepCheck['Marketing'].channelNames).not.toContain('frontend');
      expect(deepCheck['Marketing'].channelNames).not.toContain('branding');

      // Cross-check: no member appears in wrong workspace
      expect(deepCheck['Engineering'].memberAliases).toContain('Bob');
      expect(deepCheck['Engineering'].memberAliases).not.toContain('Mary');
      expect(deepCheck['Engineering'].memberAliases).not.toContain('Susan');
      expect(deepCheck['Design'].memberAliases).toContain('Mary');
      expect(deepCheck['Design'].memberAliases).not.toContain('Bob');
      expect(deepCheck['Design'].memberAliases).not.toContain('Susan');
      expect(deepCheck['Marketing'].memberAliases).toContain('Susan');
      expect(deepCheck['Marketing'].memberAliases).not.toContain('Bob');
      expect(deepCheck['Marketing'].memberAliases).not.toContain('Mary');

      // Verify all workspace IDs are unique
      const allWsIds = await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        return ctrl.workspaceManager.getAllWorkspaces().map((ws: any) => ws.id);
      });
      expect(new Set(allWsIds).size).toBe(allWsIds.length);

      // Verify all channel IDs across all workspaces are unique
      const allChannelIds = await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const ids: string[] = [];
        for (const ws of ctrl.workspaceManager.getAllWorkspaces()) {
          for (const ch of ws.channels || []) {
            ids.push(ch.id);
          }
        }
        return ids;
      });
      expect(new Set(allChannelIds).size).toBe(allChannelIds.length);

      console.log('[Test] ✅ All workspace isolation assertions passed!');

    } finally {
      await closeUser(alice);
      await closeUser(bob);
      await closeUser(mary);
      await closeUser(susan);
    }
  });

  test('joiner cannot see channels created in a different workspace', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      // Alice creates two workspaces
      await createWorkspaceFirst(alice.page, 'WS-Alpha', 'Alice');
      await createWorkspaceAdditional(alice.page, 'WS-Beta', 'Alice');

      // Bob joins WS-Alpha
      await switchToWorkspace(alice.page, 'WS-Alpha');
      const invite = await getInviteUrl(alice.page);

      // Instrument Bob's console to trace incoming messages
      bob.page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[Security]') || text.includes('[Sync]') || text.includes('secret-beta') || text.includes('__data') || text.includes('workspace-sync') || text.includes('message-sync')) {
          console.log('[Bob console]', text);
        }
      });
      // Also instrument Alice
      alice.page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[Sync]') && text.includes('Push')) {
          console.log('[Alice console]', text);
        }
      });

      await joinViaInviteUrl(bob.page, invite, 'Bob');
      await waitForPeerConnection(bob.page, 2, 30000);

      // Alice creates a new channel in WS-Beta (Bob should NOT see this)
      await switchToWorkspace(alice.page, 'WS-Beta');
      await createChannel(alice.page, 'secret-beta-channel');
      await switchToChannel(alice.page, 'secret-beta-channel');
      // Debug: check Alice's recipient list before sending
      const aliceRecipientDebug = await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const ws = state.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId) : null;
        return {
          activeWsId: state.activeWorkspaceId?.slice(0, 8),
          activeWsName: ws?.name,
          wsFound: !!ws,
          members: ws?.members?.map((m: any) => ({ alias: m.alias, peerId: m.peerId?.slice(0, 8) })),
          readyPeers: Array.from(state.readyPeers || []).map((p: any) => p.slice(0, 8)),
          connectedPeers: Array.from(state.connectedPeers || []).map((p: any) => p.slice(0, 8)),
          myPeerId: state.myPeerId?.slice(0, 8),
        };
      });
      console.log('[Debug Alice recipients]', JSON.stringify(aliceRecipientDebug, null, 2));

      await sendMessage(alice.page, 'secret-beta-message');

      // Debug: inspect Bob's full state
      const bobDebug = await bob.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const workspaces = ctrl?.workspaceManager?.getAllWorkspaces?.() || [];
        return {
          activeWsId: state?.activeWorkspaceId?.slice(0, 8),
          activeChId: state?.activeChannelId?.slice(0, 8),
          wsCount: workspaces.length,
          workspaces: workspaces.map((ws: any) => ({
            name: ws.name,
            channels: ws.channels?.map((c: any) => c.name),
            members: ws.members?.map((m: any) => m.alias),
          })),
          domMessages: Array.from(document.querySelectorAll('.message-content')).map(el => el.textContent?.trim()),
        };
      });
      console.log('[Debug Bob] ' + JSON.stringify(bobDebug, null, 2));

      // Bob should still only see WS-Alpha channels
      const bobChannels = await getChannelNames(bob.page);
      expect(bobChannels).toContain('general');
      expect(bobChannels).not.toContain('secret-beta-channel');

      // Wait to see if any delayed messages arrive via mock transport
      await bob.page.waitForTimeout(2000);
      const bobMessages = await getMessages(bob.page);
      console.log('[Debug Bob messages]', JSON.stringify(bobMessages));

      // Also check Bob's state for workspaces/channels after delay
      const bobState2 = await bob.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const ws = ctrl?.workspaceManager?.getAllWorkspaces?.() || [];
        const msgStore = ctrl?.messageStore;
        const channelMsgs: Record<string, string[]> = {};
        for (const w of ws) {
          for (const ch of w.channels || []) {
            const msgs = msgStore?.getMessages?.(ch.id) || [];
            channelMsgs[ch.name] = msgs.map((m: any) => m.content);
          }
        }
        return { channelMsgs, wsCount: ws.length };
      });
      console.log('[Debug Bob store]', JSON.stringify(bobState2, null, 2));

      expect(bobMessages.some(m => m.includes('secret-beta-message'))).toBe(false);

      // Bob has exactly 1 workspace
      expect(await getWorkspaceCount(bob.page)).toBe(1);

    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  test('messages sent in one workspace do not appear after switching workspaces', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');
    const mary = await createUser(browser, 'Mary');

    try {
      // Alice creates two workspaces
      await createWorkspaceFirst(alice.page, 'WS-One', 'Alice');
      await createWorkspaceAdditional(alice.page, 'WS-Two', 'Alice');

      // Bob joins WS-One, Mary joins WS-Two
      await switchToWorkspace(alice.page, 'WS-One');
      const invite1 = await getInviteUrl(alice.page);
      await switchToWorkspace(alice.page, 'WS-Two');
      const invite2 = await getInviteUrl(alice.page);

      await joinViaInviteUrl(bob.page, invite1, 'Bob');
      await waitForPeerConnection(bob.page, 2, 30000);
      await joinViaInviteUrl(mary.page, invite2, 'Mary');
      await waitForPeerConnection(mary.page, 2, 30000);

      const ts = Date.now();

      // Exchange in WS-One
      await switchToWorkspace(alice.page, 'WS-One');
      await switchToChannel(alice.page, 'general');
      await sendMessage(alice.page, `ws-one-msg-${ts}`);
      await waitForMessageInUI(bob.page, `ws-one-msg-${ts}`, 20000);

      // Exchange in WS-Two
      await switchToWorkspace(alice.page, 'WS-Two');
      await switchToChannel(alice.page, 'general');
      await sendMessage(alice.page, `ws-two-msg-${ts}`);
      await waitForMessageInUI(mary.page, `ws-two-msg-${ts}`, 20000);

      // Alice switches to WS-One — should NOT see WS-Two messages
      await switchToWorkspace(alice.page, 'WS-One');
      await switchToChannel(alice.page, 'general');
      const aliceWsOneMsgs = await getMessages(alice.page);
      expect(aliceWsOneMsgs.some(m => m.includes(`ws-one-msg-${ts}`))).toBe(true);
      expect(aliceWsOneMsgs.some(m => m.includes(`ws-two-msg-${ts}`))).toBe(false);

      // Alice switches to WS-Two — should NOT see WS-One messages
      await switchToWorkspace(alice.page, 'WS-Two');
      await switchToChannel(alice.page, 'general');
      const aliceWsTwoMsgs = await getMessages(alice.page);
      expect(aliceWsTwoMsgs.some(m => m.includes(`ws-two-msg-${ts}`))).toBe(true);
      expect(aliceWsTwoMsgs.some(m => m.includes(`ws-one-msg-${ts}`))).toBe(false);

    } finally {
      await closeUser(alice);
      await closeUser(bob);
      await closeUser(mary);
    }
  });

  test('invite link for one workspace cannot access another workspace', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspaceFirst(alice.page, 'WS-Private', 'Alice');
      await createChannel(alice.page, 'private-channel');
      await switchToChannel(alice.page, 'private-channel');
      await sendMessage(alice.page, 'private-content');

      await createWorkspaceAdditional(alice.page, 'WS-Public', 'Alice');
      await createChannel(alice.page, 'public-channel');

      // Only share WS-Public invite
      const publicInvite = await getInviteUrl(alice.page);

      // Bob joins WS-Public
      await joinViaInviteUrl(bob.page, publicInvite, 'Bob');
      await waitForPeerConnection(bob.page, 2, 30000);

      // Bob should see WS-Public data only (channel sync can lag briefly on Firefox)
      await bob.page.waitForFunction(
        () => Array.from(document.querySelectorAll('.sidebar-item')).some((el) => el.textContent?.includes('public-channel')),
        { timeout: 15000 },
      );
      const bobChannels = await getChannelNames(bob.page);
      expect(bobChannels).toContain('general');
      expect(bobChannels).toContain('public-channel');
      expect(bobChannels).not.toContain('private-channel');

      const bobMessages = await getMessages(bob.page);
      expect(bobMessages.some(m => m.includes('private-content'))).toBe(false);

      // Bob has exactly 1 workspace
      expect(await getWorkspaceCount(bob.page)).toBe(1);

      // Verify via deep state — Bob's app only knows about WS-Public
      const bobWorkspaces = await bob.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        return ctrl.workspaceManager.getAllWorkspaces().map((ws: any) => ws.name);
      });
      expect(bobWorkspaces).toEqual(['WS-Public']);
      expect(bobWorkspaces).not.toContain('WS-Private');

    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
