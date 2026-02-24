import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';

interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

interface SendOp {
  channelId: string;
  content: string;
  threadId?: string;
}

const MIXED_MESSAGE_COUNT = 1000;
const ROOT_MESSAGES = 4;
const EXPECTED_TOTAL_MESSAGES = MIXED_MESSAGE_COUNT + ROOT_MESSAGES;

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
  console.log(`[Test] Mock relay on port ${relay.port}`);
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
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });

  return { name, context, page };
}

async function closeUser(user: TestUser): Promise<void> {
  try { await user.context.close(); } catch {}
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
  return page.evaluate(() => new Promise<string>((resolve) => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    (navigator.clipboard as any).writeText = (text: string) => {
      (navigator.clipboard as any).writeText = original;
      resolve(text);
      return Promise.resolve();
    };
    document.getElementById('copy-invite')?.click();
    setTimeout(() => resolve(''), 5000);
  }));
}

async function joinViaInviteUrl(page: Page, inviteUrl: string, alias: string): Promise<void> {
  await page.goto(inviteUrl);
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
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

async function createChannel(page: Page, name: string): Promise<string> {
  const channelId = await page.evaluate((channelName: string) => {
    const ctrl = (window as any).__ctrl;
    const res = ctrl.createChannel(channelName);
    return res?.channel?.id || '';
  }, name);
  expect(channelId).toBeTruthy();
  return channelId;
}

async function getChannelIdByName(page: Page, channelName: string): Promise<string> {
  return page.evaluate((name: string) => {
    const s = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
    const ch = ws?.channels?.find((c: any) => c.name === name);
    return ch?.id || '';
  }, channelName);
}

async function sendMessageFromController(page: Page, channelId: string, content: string, threadId?: string): Promise<string> {
  const messageId = await page.evaluate(async ({ chId, text, thId }: { chId: string; text: string; thId?: string }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    state.activeChannelId = chId;
    await ctrl.sendMessage(text, thId);
    const messages = ctrl.messageStore.getMessages(chId);
    return messages[messages.length - 1]?.id || '';
  }, { chId: channelId, text: content, thId: threadId });
  expect(messageId).toBeTruthy();
  return messageId;
}

async function runSendOps(page: Page, ops: SendOp[]): Promise<void> {
  await page.evaluate(async (operations: SendOp[]) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    for (const op of operations) {
      state.activeChannelId = op.channelId;
      await ctrl.sendMessage(op.content, op.threadId);
    }
  }, ops);
}

async function restoreSeed(page: Page, seedPhrase: string): Promise<void> {
  await page.click('#restore-identity-btn');
  await page.waitForSelector('#restore-seed-input', { timeout: 10000 });
  await page.fill('#restore-seed-input', seedPhrase);
  await page.waitForFunction(() => !(document.getElementById('restore-confirm-btn') as HTMLButtonElement | null)?.disabled, { timeout: 10000 });
  await page.click('#restore-confirm-btn');
  await page.waitForSelector('#seed-restore-btn', { timeout: 10000 });
  await page.click('#seed-restore-btn');
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
}

async function getHistoryStats(page: Page): Promise<{
  total: number;
  unique: number;
  threadReplies: number;
  brokenThreadRefs: number;
}> {
  return page.evaluate(() => {
    const s = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
    if (!ws) return { total: 0, unique: 0, threadReplies: 0, brokenThreadRefs: 0 };

    let total = 0;
    let threadReplies = 0;
    let brokenThreadRefs = 0;
    const allIds = new Set<string>();

    for (const ch of ws.channels) {
      const messages = ctrl.messageStore.getMessages(ch.id);
      const channelIds = new Set(messages.map((m: any) => m.id));
      total += messages.length;
      for (const msg of messages) {
        allIds.add(msg.id);
        if (msg.threadId) {
          threadReplies += 1;
          if (!channelIds.has(msg.threadId)) brokenThreadRefs += 1;
        }
      }
    }

    return {
      total,
      unique: allIds.size,
      threadReplies,
      brokenThreadRefs,
    };
  });
}

test.describe('Runtime Negentropy full-history multi-device sync', () => {
  test.setTimeout(300000);

  test('syncs 1000 mixed channel/thread messages to same-user second device without duplicates', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    let bobSeed = '';
    let bobPeerId = '';

    try {
      await createWorkspace(alice.page, 'Negentropy Sync', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaInviteUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeersReady(alice.page, bob.page);

      const generalAlice = await alice.page.evaluate(() => (window as any).__state?.activeChannelId || '');
      const randomAlice = await createChannel(alice.page, 'random');
      await bob.page.waitForFunction(() => {
        const s = (window as any).__state;
        const ctrl = (window as any).__ctrl;
        const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
        return !!ws?.channels?.some((c: any) => c.name === 'random');
      }, { timeout: 15000 });

      const generalBob = await getChannelIdByName(bob.page, 'general');
      const randomBob = await getChannelIdByName(bob.page, 'random');
      expect(generalAlice).toBeTruthy();
      expect(generalBob).toBeTruthy();
      expect(randomAlice).toBeTruthy();
      expect(randomBob).toBeTruthy();

      const rootAliceGeneral = await sendMessageFromController(alice.page, generalAlice, 'root:alice:general');
      const rootBobGeneral = await sendMessageFromController(bob.page, generalBob, 'root:bob:general');
      const rootAliceRandom = await sendMessageFromController(alice.page, randomAlice, 'root:alice:random');
      const rootBobRandom = await sendMessageFromController(bob.page, randomBob, 'root:bob:random');

      const aliceOps: SendOp[] = [];
      const bobOps: SendOp[] = [];
      for (let i = 0; i < MIXED_MESSAGE_COUNT / 2; i++) {
        const aliceGeneral = i % 2 === 0;
        const bobGeneralOp = i % 2 !== 0;

        aliceOps.push({
          channelId: aliceGeneral ? generalAlice : randomAlice,
          content: `A-${i}-${aliceGeneral ? 'general' : 'random'}`,
          threadId: i % 5 === 0
            ? (aliceGeneral ? rootBobGeneral : rootBobRandom)
            : undefined,
        });

        bobOps.push({
          channelId: bobGeneralOp ? generalBob : randomBob,
          content: `B-${i}-${bobGeneralOp ? 'general' : 'random'}`,
          threadId: i % 5 === 0
            ? (bobGeneralOp ? rootAliceGeneral : rootAliceRandom)
            : undefined,
        });
      }

      await Promise.all([
        runSendOps(alice.page, aliceOps),
        runSendOps(bob.page, bobOps),
      ]);

      await alice.page.waitForFunction((expected: number) => {
        const s = (window as any).__state;
        const ctrl = (window as any).__ctrl;
        const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
        if (!ws) return false;
        let total = 0;
        for (const ch of ws.channels) total += ctrl.messageStore.getMessages(ch.id).length;
        return total >= expected;
      }, EXPECTED_TOTAL_MESSAGES, { timeout: 90000 });

      const bobIdentity = await bob.page.evaluate(async () => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        return {
          seed: await ctrl.persistentStore.getSetting('seedPhrase'),
          peerId: state?.myPeerId || '',
        };
      });
      bobSeed = bobIdentity.seed || '';
      bobPeerId = bobIdentity.peerId || '';
      expect(bobSeed).toBeTruthy();
      expect(bobPeerId).toBeTruthy();

      await closeUser(bob);

      const bobDevice2 = await createUser(browser, 'Bob Device 2');
      try {
        await restoreSeed(bobDevice2.page, bobSeed);

        const restoredPeerId = await bobDevice2.page.evaluate(() => (window as any).__state?.myPeerId || '');
        expect(restoredPeerId).toBe(bobPeerId);

        await joinViaInviteUrl(bobDevice2.page, inviteUrl, 'Bob Device 2');
        await waitForPeersReady(alice.page, bobDevice2.page, 60000);

        await bobDevice2.page.waitForFunction((expected: number) => {
          const s = (window as any).__state;
          const ctrl = (window as any).__ctrl;
          const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
          if (!ws) return false;
          let total = 0;
          for (const ch of ws.channels) total += ctrl.messageStore.getMessages(ch.id).length;
          return total >= expected;
        }, EXPECTED_TOTAL_MESSAGES, { timeout: 120000 });

        const stats = await getHistoryStats(bobDevice2.page);
        expect(stats.total).toBeGreaterThanOrEqual(EXPECTED_TOTAL_MESSAGES);
        expect(stats.unique).toBe(stats.total);
        expect(stats.threadReplies).toBeGreaterThan(0);
        expect(stats.brokenThreadRefs).toBe(0);
      } finally {
        await closeUser(bobDevice2);
      }
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
