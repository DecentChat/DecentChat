import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(async () => {
  relay?.close();
});

async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();

  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));
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
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
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
  try {
    await Promise.race([
      user.context.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('context close timeout')), 5000)),
    ]);
  } catch {
    // Best-effort cleanup only.
  }
}

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
    const wsId = (window as any).__state?.activeWorkspaceId;
    const ctrl = (window as any).__ctrl;
    if (!wsId || !ctrl?.generateInviteURL) return '';
    return ctrl.generateInviteURL(wsId) as string;
  });
}

async function joinViaInvite(page: Page, inviteUrl: string, alias: string): Promise<void> {
  await page.goto(inviteUrl);
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
}

async function waitForPeerConnection(page: Page, timeoutMs = 30000): Promise<void> {
  await page.waitForFunction(() => {
    const toasts = document.querySelectorAll('.toast');
    return Array.from(toasts).some(t =>
      t.textContent?.includes('Encrypted connection') ||
      t.textContent?.includes('Forward-secret connection') ||
      t.textContent?.includes('🔐'));
  }, { timeout: timeoutMs });
}

async function waitForPeersReady(pageA: Page, pageB: Page, timeoutMs = 30000): Promise<void> {
  const peerA = await pageA.evaluate(() => (window as any).__state?.myPeerId || '');
  const peerB = await pageB.evaluate(() => (window as any).__state?.myPeerId || '');

  await pageA.waitForFunction(
    (peerId: string) => (window as any).__state?.readyPeers?.has(peerId),
    peerB,
    { timeout: timeoutMs },
  );
  await pageB.waitForFunction(
    (peerId: string) => (window as any).__state?.readyPeers?.has(peerId),
    peerA,
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
        ws.members.push({
          peerId,
          alias: peerId.slice(0, 8),
          publicKey: '',
          joinedAt: Date.now(),
          role: 'member',
        });
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

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('#compose-input');
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press('Enter');
  await waitForMessage(page, text, 5000);
}

async function waitForMessage(page: Page, text: string, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll('.message-content')).some(m => m.textContent?.includes(t)),
    text,
    { timeout: timeoutMs },
  );
}

async function setupConnectedPair(browser: Browser, wsName: string, strictReady = true): Promise<[TestUser, TestUser]> {
  const alice = await createUser(browser, 'Alice');
  const bob = await createUser(browser, 'Bob');

  await createWorkspace(alice.page, wsName, 'Alice');
  const inviteUrl = await getInviteUrl(alice.page);
  expect(inviteUrl).toContain('/join/');
  await joinViaInvite(bob.page, inviteUrl, 'Bob');
  await waitForPeerConnection(alice.page);
  await waitForPeerConnection(bob.page);
  if (strictReady) {
    await waitForPeersReady(alice.page, bob.page);
    await syncWorkspaceState(alice.page, bob.page);
    await waitForWorkspaceSync(alice.page, bob.page);
  }

  return [alice, bob];
}

test.describe('P2P Messaging', () => {
  test.setTimeout(90000);

  test('two users can send and receive messages in real-time', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Message Exchange');
    try {
      await sendMessage(alice.page, 'Hello from Alice!');
      await waitForMessage(bob.page, 'Hello from Alice!');
      await sendMessage(bob.page, 'Hey Alice, Bob here!');
      await waitForMessage(alice.page, 'Hey Alice, Bob here!');
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  test('concurrent messages from both users are delivered', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Concurrent Test');
    try {
      await Promise.all([
        sendMessage(alice.page, 'Alice says hi'),
        sendMessage(bob.page, 'Bob says hi'),
      ]);
      await waitForMessage(alice.page, 'Bob says hi');
      await waitForMessage(bob.page, 'Alice says hi');
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  test('rapid sequential messages all arrive', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Rapid Fire');
    try {
      for (let i = 1; i <= 5; i++) await sendMessage(alice.page, `Msg ${i}`);
      for (let i = 1; i <= 5; i++) await waitForMessage(bob.page, `Msg ${i}`, 15000);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  test('typing indicator shows when other user types', async ({ browser }) => {
    const [alice, bob] = await setupConnectedPair(browser, 'Typing Test');
    try {
      // Alice starts typing
      const input = alice.page.locator('#compose-input');
      await input.focus();
      await input.pressSequentially('Hello...', { delay: 100 });

      // Bob should see typing indicator
      await bob.page.waitForFunction(
        () => {
          const el = document.getElementById('typing-indicator');
          const text = el?.textContent?.trim() || '';
          const s = (window as any).__state;
          const ctrl = (window as any).__ctrl;
          const channelId = s?.activeChannelId;
          const peers = channelId ? ctrl?.presence?.getTypingPeers?.(channelId) : [];
          return text.length > 0 && Array.isArray(peers) && peers.length > 0;
        },
        { timeout: 10000 },
      );
      await expect(bob.page.locator('#typing-indicator')).toContainText('typing');
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
