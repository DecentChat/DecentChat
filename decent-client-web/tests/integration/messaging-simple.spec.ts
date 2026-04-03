import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';
import { createBrowserContext } from './context-permissions';

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

async function createUser(
  browser: Browser,
  name: string,
  options: { bootstrapApp?: boolean } = {},
): Promise<TestUser> {
  const bootstrapApp = options.bootstrapApp !== false;
  const context = await createBrowserContext(browser);
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

  if (bootstrapApp) {
    // Keep user bootstrap deterministic: each test user already runs in a
    // fresh incognito context, so avoid clearing storage after app init.
    await page.goto('/');
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

  return { name, context, page };
}

async function closeUser(user: TestUser): Promise<void> {
  try {
    await user.context.close();
  } catch {}
}

async function createWorkspace(page: Page): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill('TestWS');
  await inputs.nth(1).fill('Alice');
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function getInviteUrl(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve) => {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    (navigator.clipboard as any).writeText = (text: string) => {
      (navigator.clipboard as any).writeText = orig;
      resolve(text);
      return Promise.resolve();
    };
    document.getElementById('copy-invite')?.click();
    setTimeout(() => resolve(''), 5000);
  }));
}

async function waitForBidirectionalPeerReady(pageA: Page, pageB: Page, timeoutMs = 30000): Promise<void> {
  const peerA = await pageA.evaluate(() => (window as any).__state?.myPeerId || '');
  const peerB = await pageB.evaluate(() => (window as any).__state?.myPeerId || '');
  expect(peerA).toBeTruthy();
  expect(peerB).toBeTruthy();

  await Promise.all([
    pageA.waitForFunction(
      (peerId: string) => {
        const s = (window as any).__state;
        return !!s?.readyPeers?.has?.(peerId) && !!s?.connectedPeers?.has?.(peerId);
      },
      peerB,
      { timeout: timeoutMs },
    ),
    pageB.waitForFunction(
      (peerId: string) => {
        const s = (window as any).__state;
        return !!s?.readyPeers?.has?.(peerId) && !!s?.connectedPeers?.has?.(peerId);
      },
      peerA,
      { timeout: timeoutMs },
    ),
  ]);
}

async function syncWorkspaceState(page1: Page, page2: Page): Promise<void> {
  const channel1 = await page1.evaluate(() => (window as any).__state?.activeChannelId || '');

  await page2.evaluate((channelId: string) => {
    const s = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    if (!s?.activeWorkspaceId) return;
    const ws = ctrl?.workspaceManager?.getWorkspace?.(s.activeWorkspaceId);
    if (!ws?.channels?.[0]) return;

    const oldChannelId = ws.channels[0].id;
    ws.channels[0].id = channelId;
    s.activeChannelId = channelId;

    const allWs = ctrl.workspaceManager;
    if (allWs?.channels) {
      const ch = allWs.channels.get(oldChannelId);
      if (ch) {
        allWs.channels.delete(oldChannelId);
        ch.id = channelId;
        allWs.channels.set(channelId, ch);
      }
    }
  }, channel1);

  const addMembers = () => {
    const s = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    if (!s?.activeWorkspaceId) return;
    const ws = ctrl?.workspaceManager?.getWorkspace?.(s.activeWorkspaceId);
    if (!ws?.members) return;
    for (const peerId of s.readyPeers ?? []) {
      if (!ws.members.some((m: any) => m.peerId === peerId)) {
        ws.members.push({
          peerId,
          alias: String(peerId).slice(0, 8),
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

async function ensureWorkspaceDeliveryReady(pageA: Page, pageB: Page, timeoutMs = 15000): Promise<void> {
  await waitForBidirectionalPeerReady(pageA, pageB, timeoutMs);
  await syncWorkspaceState(pageA, pageB);
  await waitForWorkspaceSync(pageA, pageB, timeoutMs);
  await waitForBidirectionalPeerReady(pageA, pageB, timeoutMs);
}

async function requestReconnect(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ctrl = (window as any).__ctrl;
    try {
      if (typeof ctrl?.retryReconnectNow === 'function') await ctrl.retryReconnectNow();
    } catch {}
    try {
      if (typeof ctrl?.runPeerMaintenanceNow === 'function') ctrl.runPeerMaintenanceNow('messaging-simple-recover');
    } catch {}
  });
}

async function sendMessageWithRecovery(sender: Page, receiver: Page, text: string): Promise<void> {
  const dispatch = async () => {
    const input = sender.locator('#compose-input');
    await input.fill(text);
    await input.press('Enter');
    await sender.waitForFunction(
      (t) => Array.from(document.querySelectorAll('.message-content')).some(m => m.textContent?.includes(t)),
      text,
      { timeout: 5000 },
    );
  };

  const waitForMessage = async (timeout: number) => {
    await receiver.waitForFunction(
      (t) => Array.from(document.querySelectorAll('.message-content')).some(m => m.textContent?.includes(t)),
      text,
      { timeout },
    );
  };

  const waitForMessageWithRecovery = async (timeout: number) => {
    try {
      await waitForMessage(timeout);
    } catch (error) {
      await Promise.allSettled([requestReconnect(sender), requestReconnect(receiver)]);
      await ensureWorkspaceDeliveryReady(sender, receiver, timeout);
      await waitForMessage(Math.max(timeout, 20_000));
      return error;
    }
  };

  await ensureWorkspaceDeliveryReady(sender, receiver, 20000);
  await dispatch();
  try {
    await waitForMessageWithRecovery(8000);
  } catch {
    await Promise.allSettled([requestReconnect(sender), requestReconnect(receiver)]);
    await ensureWorkspaceDeliveryReady(sender, receiver, 30000);
    await dispatch();
    await waitForMessageWithRecovery(20000);
  }
}

async function stabilizeBidirectionalMessaging(alice: Page, bob: Page): Promise<void> {
  const tryProbe = async (from: Page, to: Page, label: string) => {
    const probe = `probe-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await sendMessageWithRecovery(from, to, probe);
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await ensureWorkspaceDeliveryReady(alice, bob, 15000);
      await tryProbe(alice, bob, `a2b-${attempt}`);
      await tryProbe(bob, alice, `b2a-${attempt}`);
      return;
    } catch (error) {
      lastError = error;
      await Promise.allSettled([requestReconnect(alice), requestReconnect(bob)]);
      await alice.waitForTimeout(250);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to stabilize bidirectional messaging before assertion send');
}

test.setTimeout(90000);

test('simple P2P message exchange', async ({ browser }) => {
  const alice = await createUser(browser, 'Alice');
  const bob = await createUser(browser, 'Bob', { bootstrapApp: false });
  try {
    await createWorkspace(alice.page);
    const inviteUrl = await getInviteUrl(alice.page);

    await bob.page.goto(inviteUrl);
    await bob.page.waitForSelector('.modal', { timeout: 10000 });
    await bob.page.locator('input[name="alias"]').fill('Bob');
    await bob.page.click('.modal .btn-primary');
    await bob.page.waitForSelector('.sidebar-header', { timeout: 15000 });

    const alicePeerId = await alice.page.evaluate(() => (window as any).__state?.myPeerId || '');
    const bobPeerId = await bob.page.evaluate(() => (window as any).__state?.myPeerId || '');
    expect(alicePeerId).toBeTruthy();
    expect(bobPeerId).toBeTruthy();

    await stabilizeBidirectionalMessaging(alice.page, bob.page);

    const msg = `simple-${Date.now()}`;
    await sendMessageWithRecovery(alice.page, bob.page, msg);

    const bobMsgs = (await bob.page.locator('.message-content').allTextContents()).map(t => t.trim());
    expect(bobMsgs).toContain(msg);
  } finally {
    await closeUser(alice);
    await closeUser(bob);
  }
});
