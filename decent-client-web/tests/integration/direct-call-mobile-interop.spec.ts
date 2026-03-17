import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';
import { createBrowserContext } from './context-permissions';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(async () => {
  relay?.close();
});

interface TestUser {
  context: BrowserContext;
  page: Page;
}

async function createUser(browser: Browser): Promise<TestUser> {
  const context = await createBrowserContext(browser);
  const page = await context.newPage();

  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));
  await page.addInitScript(() => {
    const track = { enabled: true, stop: () => {} } as MediaStreamTrack;
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;

    const nav = navigator as Navigator & { mediaDevices?: { getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream> } };
    if (!nav.mediaDevices) {
      Object.defineProperty(nav, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => stream },
      });
    } else {
      nav.mediaDevices.getUserMedia = async () => stream;
    }
  });

  await page.goto('/app');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
  });
  await page.reload();

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 20000 });
  return { context, page };
}

async function waitForPeersReady(pageA: Page, pageB: Page): Promise<{ peerA: string; peerB: string }> {
  await pageA.waitForFunction(() => !!(window as any).__ctrl, undefined, { timeout: 15000 });
  await pageB.waitForFunction(() => !!(window as any).__ctrl, undefined, { timeout: 15000 });

  const peerA = await pageA.evaluate(() => (window as any).__state?.myPeerId || '');
  const peerB = await pageB.evaluate(() => (window as any).__state?.myPeerId || '');

  for (let attempt = 0; attempt < 5; attempt++) {
    await pageA.evaluate((id: string) => (window as any).__ctrl?.connectPeer?.(id), peerB);
    await pageB.evaluate((id: string) => (window as any).__ctrl?.connectPeer?.(id), peerA);

    const aReady = await pageA.evaluate((id: string) => (window as any).__state?.readyPeers?.has(id), peerB);
    const bReady = await pageB.evaluate((id: string) => (window as any).__state?.readyPeers?.has(id), peerA);
    if (aReady && bReady) return { peerA, peerB };

    await pageA.waitForTimeout(500);
  }

  await pageA.waitForFunction((id: string) => (window as any).__state?.readyPeers?.has(id), peerB, { timeout: 15000 });
  await pageB.waitForFunction((id: string) => (window as any).__state?.readyPeers?.has(id), peerA, { timeout: 15000 });
  return { peerA, peerB };
}

async function installSignalRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    if ((window as any).__directCallSignalLogInstalled) return;

    const ctrl = (window as any).__ctrl;
    const original = ctrl.transport.onMessage;
    (window as any).__directCallSignalLog = [];

    ctrl.transport.onMessage = async (peerId: string, data: any) => {
      (window as any).__directCallSignalLog.push({ peerId, data });
      return await original?.(peerId, data);
    };

    (window as any).__directCallSignalLogInstalled = true;
  });
}

async function sendRing(fromPage: Page, targetPeerId: string, channelId: string): Promise<void> {
  await fromPage.evaluate(({ targetPeerId, channelId }) => {
    const ctrl = (window as any).__ctrl;
    ctrl.transport.send(targetPeerId, {
      type: 'call-ring',
      channelId,
      fromPeerId: (window as any).__state?.myPeerId,
      peerId: (window as any).__state?.myPeerId,
    });
  }, { targetPeerId, channelId });
}

async function waitForResponse(page: Page, fromPeerId: string, type: 'call-accept' | 'call-decline' | 'call-busy') {
  await page.waitForFunction(
    ({ fromPeerId, type }) => {
      const log = (window as any).__directCallSignalLog || [];
      return log.some((entry: any) => entry.peerId === fromPeerId && entry.data?.type === type);
    },
    { fromPeerId, type },
    { timeout: 10000 },
  );
}

test.describe('mixed-client direct call interop (mobile signal -> web behavior)', () => {
  test('mobile -> web: ring -> accept', async ({ browser }) => {
    const web = await createUser(browser);
    const mobile = await createUser(browser);

    try {
      const { peerA: webPeer, peerB: mobilePeer } = await waitForPeersReady(web.page, mobile.page);
      await installSignalRecorder(mobile.page);

      const channelId = `dm:${[webPeer, mobilePeer].sort().join(':')}`;
      await sendRing(mobile.page, webPeer, channelId);
      await waitForResponse(mobile.page, webPeer, 'call-accept');
    } finally {
      await web.context.close();
      await mobile.context.close();
    }
  });

  test('mobile -> web: ring -> decline', async ({ browser }) => {
    const web = await createUser(browser);
    const mobile = await createUser(browser);

    try {
      const { peerA: webPeer, peerB: mobilePeer } = await waitForPeersReady(web.page, mobile.page);
      await installSignalRecorder(mobile.page);

      await web.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        ctrl.huddle.joinHuddle = async () => {
          // Simulate failure to enter in-call state.
        };
      });

      const channelId = `dm:${[webPeer, mobilePeer].sort().join(':')}`;
      await sendRing(mobile.page, webPeer, channelId);
      await waitForResponse(mobile.page, webPeer, 'call-decline');
    } finally {
      await web.context.close();
      await mobile.context.close();
    }
  });

  test('mobile -> web: ring -> busy', async ({ browser }) => {
    const web = await createUser(browser);
    const mobile = await createUser(browser);

    try {
      const { peerA: webPeer, peerB: mobilePeer } = await waitForPeersReady(web.page, mobile.page);
      await installSignalRecorder(mobile.page);

      await web.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        ctrl.huddle.getState = () => 'in-call';
      });

      const channelId = `dm:${[webPeer, mobilePeer].sort().join(':')}`;
      await sendRing(mobile.page, webPeer, channelId);
      await waitForResponse(mobile.page, webPeer, 'call-busy');
    } finally {
      await web.context.close();
      await mobile.context.close();
    }
  });
});
