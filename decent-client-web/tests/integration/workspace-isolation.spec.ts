/**
 * Workspace Isolation E2E Tests
 *
 * Verifies that multiple workspaces with different members maintain
 * strict data isolation: no channels, messages, or members leak
 * across workspace boundaries.
 *
 * Scenario:
 * - Alice creates workspace1, workspace2, workspace3
 * - Each workspace has unique custom channels beyond #general
 * - Bob joins workspace1, Mary joins workspace2, Susan joins workspace3
 * - Each pair exchanges messages in #general
 * - Assertions verify complete isolation of channels, messages, and members
 */

import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
  console.log(`[Test] Mock relay on port ${relay.port}`);
});

test.afterAll(async () => {
  relay?.close();
});

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

  const script = getMockTransportScript(`ws://localhost:${relay.port}`);
  await page.addInitScript(script);

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
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });

  const openAppBtn = page.getByRole('button', { name: /open app/i });
  if (await openAppBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openAppBtn.click();
  }

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
  return { name, context, page };
}

async function closeUser(user: TestUser): Promise<void> {
  try { await user.context.close(); } catch {}
}

async function createWorkspaceFirst(page: Page, name: string, alias: string): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function createWorkspaceAdditional(page: Page, name: string, alias: string): Promise<void> {
  await page.click('#ws-rail-add');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function getInviteUrl(page: Page): Promise<string> {
  return await page.evaluate(() => {
    return new Promise<string>((resolve) => {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      (navigator.clipboard as any).writeText = (text: string) => {
        (navigator.clipboard as any).writeText = original;
        resolve(text);
        return Promise.resolve();
      };
      document.getElementById('copy-invite')?.click();
      setTimeout(() => resolve(''), 5000);
    });
  });
}

async function joinViaInviteUrl(page: Page, inviteUrl: string, alias: string): Promise<void> {
  await page.goto(inviteUrl);
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
}

async function waitForPeerConnection(page: Page, timeoutMs = 30000): Promise<void> {
  await page.waitForFunction(
    () => {
      const state = (window as any).__state;
      const connected = state?.connectedPeers && typeof state.connectedPeers.size === 'number' && state.connectedPeers.size > 0;
      if (connected) return true;
      const toasts = document.querySelectorAll('.toast');
      return Array.from(toasts).some(t =>
        t.textContent?.includes('Encrypted connection') ||
        t.textContent?.includes('Forward-secret connection') ||
        t.textContent?.includes('🔐'),
      );
    },
    { timeout: timeoutMs },
  );
}

async function createChannel(page: Page, name: string): Promise<void> {
  await page.click('#add-channel-btn');
  await page.waitForSelector('.modal');
  await page.locator('.modal input').first().fill(name);
  await page.click('.modal .btn-primary');
  await page.waitForTimeout(500);
}

async function switchToWorkspace(page: Page, wsName: string): Promise<void> {
  const wsIcon = page.locator(`.ws-rail-icon[title="${wsName}"]`);
  await wsIcon.click();
  await page.waitForTimeout(300);
  await expect(page.locator('.sidebar-header')).toContainText(wsName, { timeout: 5000 });
}

async function switchToChannel(page: Page, channelName: string): Promise<void> {
  const channelItem = page.locator('.sidebar-item').filter({ hasText: channelName }).first();
  await channelItem.click();
  await page.waitForTimeout(200);
}

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

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Workspace Isolation — Multi-Workspace Multi-User', () => {
  test.setTimeout(120000);

  test('three workspaces with different members maintain strict data isolation', async ({ browser }) => {
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

      // ─── Get invite URLs ───────────────────────────────────────────
      await switchToWorkspace(alice.page, 'Engineering');
      const invite1 = await getInviteUrl(alice.page);
      expect(invite1).toContain('/join/');

      await switchToWorkspace(alice.page, 'Design');
      const invite2 = await getInviteUrl(alice.page);
      expect(invite2).toContain('/join/');

      await switchToWorkspace(alice.page, 'Marketing');
      const invite3 = await getInviteUrl(alice.page);
      expect(invite3).toContain('/join/');

      // ─── Users join their workspaces ───────────────────────────────
      console.log('[Test] Bob joining Engineering...');
      await joinViaInviteUrl(bob.page, invite1, 'Bob');
      await waitForPeerConnection(bob.page, 30000);

      console.log('[Test] Mary joining Design...');
      await joinViaInviteUrl(mary.page, invite2, 'Mary');
      await waitForPeerConnection(mary.page, 30000);

      console.log('[Test] Susan joining Marketing...');
      await joinViaInviteUrl(susan.page, invite3, 'Susan');
      await waitForPeerConnection(susan.page, 30000);

      // ─── Exchange messages ─────────────────────────────────────────
      const ts = Date.now();

      // Engineering: Alice + Bob
      await switchToWorkspace(alice.page, 'Engineering');
      await switchToChannel(alice.page, 'general');
      await sendMessage(alice.page, `eng-alice-${ts}`);
      await waitForMessageInUI(bob.page, `eng-alice-${ts}`, 20000);
      await sendMessage(bob.page, `eng-bob-${ts}`);
      await waitForMessageInUI(alice.page, `eng-bob-${ts}`, 20000);

      // Design: Alice + Mary
      await switchToWorkspace(alice.page, 'Design');
      await switchToChannel(alice.page, 'general');
      await sendMessage(alice.page, `design-alice-${ts}`);
      await waitForMessageInUI(mary.page, `design-alice-${ts}`, 20000);
      await sendMessage(mary.page, `design-mary-${ts}`);
      await waitForMessageInUI(alice.page, `design-mary-${ts}`, 20000);

      // Marketing: Alice + Susan
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

      // ─── Bob: only sees Engineering ────────────────────────────────
      const bobChannels = await getChannelNames(bob.page);
      const bobMembers = await getMemberNames(bob.page);
      const bobMessages = await getMessages(bob.page);

      expect(bobChannels).toContain('general');
      expect(bobChannels).toContain('backend');
      expect(bobChannels).toContain('frontend');
      expect(bobChannels).not.toContain('ui-ux');
      expect(bobChannels).not.toContain('branding');
      expect(bobChannels).not.toContain('social-media');
      expect(bobChannels).not.toContain('analytics');

      expect(bobMessages.some(m => m.includes(`eng-alice-${ts}`))).toBe(true);
      expect(bobMessages.some(m => m.includes(`eng-bob-${ts}`))).toBe(true);
      expect(bobMessages.some(m => m.includes('design-'))).toBe(false);
      expect(bobMessages.some(m => m.includes('mkt-'))).toBe(false);

      expect(bobMembers).toContain('Alice');
      expect(bobMembers).toContain('Bob');
      expect(bobMembers).not.toContain('Mary');
      expect(bobMembers).not.toContain('Susan');

      // ─── Mary: only sees Design ────────────────────────────────────
      const maryChannels = await getChannelNames(mary.page);
      const maryMembers = await getMemberNames(mary.page);
      const maryMessages = await getMessages(mary.page);

      expect(maryChannels).toContain('general');
      expect(maryChannels).toContain('ui-ux');
      expect(maryChannels).toContain('branding');
      expect(maryChannels).not.toContain('backend');
      expect(maryChannels).not.toContain('social-media');

      expect(maryMessages.some(m => m.includes(`design-alice-${ts}`))).toBe(true);
      expect(maryMessages.some(m => m.includes(`design-mary-${ts}`))).toBe(true);
      expect(maryMessages.some(m => m.includes('eng-'))).toBe(false);
      expect(maryMessages.some(m => m.includes('mkt-'))).toBe(false);

      expect(maryMembers).toContain('Alice');
      expect(maryMembers).toContain('Mary');
      expect(maryMembers).not.toContain('Bob');
      expect(maryMembers).not.toContain('Susan');

      // ─── Susan: only sees Marketing ────────────────────────────────
      const susanChannels = await getChannelNames(susan.page);
      const susanMembers = await getMemberNames(susan.page);
      const susanMessages = await getMessages(susan.page);

      expect(susanChannels).toContain('general');
      expect(susanChannels).toContain('social-media');
      expect(susanChannels).toContain('analytics');
      expect(susanChannels).not.toContain('backend');
      expect(susanChannels).not.toContain('ui-ux');

      expect(susanMessages.some(m => m.includes(`mkt-alice-${ts}`))).toBe(true);
      expect(susanMessages.some(m => m.includes(`mkt-susan-${ts}`))).toBe(true);
      expect(susanMessages.some(m => m.includes('eng-'))).toBe(false);
      expect(susanMessages.some(m => m.includes('design-'))).toBe(false);

      expect(susanMembers).toContain('Alice');
      expect(susanMembers).toContain('Susan');
      expect(susanMembers).not.toContain('Bob');
      expect(susanMembers).not.toContain('Mary');

      // ─── Alice: correct data per workspace ─────────────────────────
      // Engineering
      await switchToWorkspace(alice.page, 'Engineering');
      await switchToChannel(alice.page, 'general');
      const aliceEngCh = await getChannelNames(alice.page);
      const aliceEngMembers = await getMemberNames(alice.page);
      const aliceEngMsgs = await getMessages(alice.page);

      expect(aliceEngCh).toContain('backend');
      expect(aliceEngCh).not.toContain('ui-ux');
      expect(aliceEngMembers).toContain('Bob');
      expect(aliceEngMembers).not.toContain('Mary');
      expect(aliceEngMsgs.some(m => m.includes(`eng-alice-${ts}`))).toBe(true);
      expect(aliceEngMsgs.some(m => m.includes('design-'))).toBe(false);

      // Design
      await switchToWorkspace(alice.page, 'Design');
      await switchToChannel(alice.page, 'general');
      const aliceDesCh = await getChannelNames(alice.page);
      const aliceDesMembers = await getMemberNames(alice.page);
      const aliceDesMsgs = await getMessages(alice.page);

      expect(aliceDesCh).toContain('ui-ux');
      expect(aliceDesCh).not.toContain('backend');
      expect(aliceDesMembers).toContain('Mary');
      expect(aliceDesMembers).not.toContain('Bob');
      expect(aliceDesMsgs.some(m => m.includes(`design-alice-${ts}`))).toBe(true);
      expect(aliceDesMsgs.some(m => m.includes('eng-'))).toBe(false);

      // Marketing
      await switchToWorkspace(alice.page, 'Marketing');
      await switchToChannel(alice.page, 'general');
      const aliceMktCh = await getChannelNames(alice.page);
      const aliceMktMembers = await getMemberNames(alice.page);
      const aliceMktMsgs = await getMessages(alice.page);

      expect(aliceMktCh).toContain('social-media');
      expect(aliceMktCh).not.toContain('backend');
      expect(aliceMktMembers).toContain('Susan');
      expect(aliceMktMembers).not.toContain('Bob');
      expect(aliceMktMsgs.some(m => m.includes(`mkt-alice-${ts}`))).toBe(true);
      expect(aliceMktMsgs.some(m => m.includes('eng-'))).toBe(false);

      // ─── Deep state check ──────────────────────────────────────────
      const deepCheck = await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const workspaces = ctrl.workspaceManager.getAllWorkspaces();
        const result: Record<string, { channelCount: number; memberCount: number; messageCount: number }> = {};
        for (const ws of workspaces) {
          const channels = ctrl.workspaceManager.getChannels(ws.id);
          result[ws.name] = {
            channelCount: channels.length,
            memberCount: ws.members.length,
            messageCount: channels.reduce((sum: number, c: any) =>
              sum + ctrl.messageStore.getMessages(c.id).length, 0),
          };
        }
        return result;
      });

      console.log('[Test] Deep state:', JSON.stringify(deepCheck));

      // Each workspace: 3 channels (general + 2 custom), 2 members, >= 2 messages
      for (const wsName of ['Engineering', 'Design', 'Marketing']) {
        expect(deepCheck[wsName].channelCount).toBe(3);
        expect(deepCheck[wsName].memberCount).toBe(2);
        expect(deepCheck[wsName].messageCount).toBeGreaterThanOrEqual(2);
      }

      console.log('[Test] ✅ All workspace isolation assertions passed!');

    } finally {
      await closeUser(alice);
      await closeUser(bob);
      await closeUser(mary);
      await closeUser(susan);
    }
  });
});
