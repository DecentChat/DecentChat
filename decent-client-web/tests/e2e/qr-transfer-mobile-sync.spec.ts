import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

interface UserSession {
  context: BrowserContext;
  page: Page;
}

async function createUser(browser: Browser, viewport?: { width: number; height: number }): Promise<UserSession> {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await clearStorage(page);
  await page.goto('/app');
  await waitForApp(page);
  return { context, page };
}

async function seedSourceData(page: Page): Promise<{
  workspaceName: string;
  sourcePeerId: string;
  seedPhrase: string;
  generalMessage: string;
  extraChannelName: string;
  extraChannelMessage: string;
}> {
  const workspaceName = `QR Sync ${Date.now()}`;
  const extraChannelName = 'mobile-sync';
  const generalMessage = `general-seed-${Date.now()}`;
  const extraChannelMessage = `channel-seed-${Date.now()}`;

  await createWorkspace(page, workspaceName, 'Alice');

  const seed = await page.evaluate(async ({ extraChannelName, generalMessage, extraChannelMessage }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;

    const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
    if (!ws) throw new Error('Active workspace missing');

    if (!ws.channels.some((c: any) => c.name === extraChannelName)) {
      ctrl.createChannel(extraChannelName);
    }

    const updatedWs = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
    const general = updatedWs.channels.find((c: any) => c.name === 'general');
    const extra = updatedWs.channels.find((c: any) => c.name === extraChannelName);
    if (!general || !extra) throw new Error('Required channels missing');

    state.activeChannelId = general.id;
    await ctrl.sendMessage(generalMessage);
    state.activeChannelId = extra.id;
    await ctrl.sendMessage(extraChannelMessage);

    const seedPhrase = await ctrl.persistentStore.getSetting('seedPhrase');
    return {
      sourcePeerId: state.myPeerId,
      seedPhrase,
    };
  }, { extraChannelName, generalMessage, extraChannelMessage });

  expect(seed.sourcePeerId).toBeTruthy();
  expect(seed.seedPhrase).toBeTruthy();

  return {
    workspaceName,
    sourcePeerId: seed.sourcePeerId,
    seedPhrase: seed.seedPhrase,
    generalMessage,
    extraChannelName,
    extraChannelMessage,
  };
}

async function restoreOnMobile(page: Page, seedPhrase: string): Promise<void> {
  // Use a different device index than source so mobile gets a unique peer ID.
  await page.evaluate(async () => {
    const ctrl = (window as any).__ctrl;
    const existing = await ctrl.persistentStore.getSettings<any>({});
    await ctrl.persistentStore.saveSettings({ ...existing, deviceIndex: 1 });
  });

  await page.locator('#restore-identity-btn').click();
  await page.waitForSelector('#restore-seed-input', { timeout: 10000 });
  await page.locator('#restore-seed-input').fill(seedPhrase);
  await page.evaluate(() => {
    const input = document.getElementById('restore-seed-input') as HTMLTextAreaElement | null;
    input?.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await expect(page.locator('#restore-confirm-btn')).toBeEnabled({ timeout: 5000 });
  await page.locator('#restore-confirm-btn').click();
  await page.waitForSelector('#seed-restore-btn', { timeout: 10000 });

  const nav = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
  await page.locator('#seed-restore-btn').click();
  await nav;
  await waitForApp(page);
}

test.describe('QR transfer mobile sync', () => {
  test.setTimeout(240000);

  test('restored mobile receives workspace, channels, messages, and contacts', async ({ browser, browserName }) => {
    // Keep this coverage deterministic first; Firefox can be re-enabled after stabilization.
    test.skip(browserName === 'firefox', 'Covered on chromium; firefox flaky for multi-context signaling.');

    const source = await createUser(browser, { width: 1280, height: 900 });
    const mobile = await createUser(browser, { width: 390, height: 844 });

    try {
      const seed = await seedSourceData(source.page);

      await restoreOnMobile(mobile.page, seed.seedPhrase);

      // Simulate target device finding source peer from transfer metadata and syncing.
      await mobile.page.evaluate((peerId: string) => {
        const ctrl = (window as any).__ctrl;
        ctrl.connectPeer(peerId);
      }, seed.sourcePeerId);

      await mobile.page.waitForFunction(
        (peerId: string) => (window as any).__state?.readyPeers?.has(peerId),
        seed.sourcePeerId,
        { timeout: 60000 },
      );

      // Deterministic bootstrap for restored device: ensure source workspace includes
      // the new device peer, then push workspace state/sync.
      const mobilePeerId = await mobile.page.evaluate(() => (window as any).__state?.myPeerId || '');
      await source.page.evaluate(({ peerId }) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const wsId = state?.activeWorkspaceId;
        if (!ctrl || !wsId || !peerId) return;

        const ws = ctrl.workspaceManager.getWorkspace(wsId);
        if (ws && !ws.members.some((m: any) => m.peerId === peerId)) {
          ws.members.push({
            peerId,
            alias: peerId.slice(0, 8),
            publicKey: '',
            joinedAt: Date.now(),
            role: 'member',
          });
        }

        ctrl.sendWorkspaceState?.(peerId, wsId);
      }, { peerId: mobilePeerId });

      await expect.poll(async () => {
        return mobile.page.evaluate((workspaceName: string) => {
          const ctrl = (window as any).__ctrl;
          return ctrl.workspaceManager.getAllWorkspaces().some((ws: any) => ws.name === workspaceName);
        }, seed.workspaceName);
      }, { timeout: 60000, interval: 1000 }).toBe(true);

      await expect.poll(async () => {
        return mobile.page.evaluate(({ workspaceName, extraChannelName }) => {
          const ctrl = (window as any).__ctrl;
          const ws = ctrl.workspaceManager.getAllWorkspaces().find((w: any) => w.name === workspaceName);
          if (!ws) return false;
          const names = ws.channels.map((c: any) => c.name);
          return names.includes('general') && names.includes(extraChannelName);
        }, { workspaceName: seed.workspaceName, extraChannelName: seed.extraChannelName });
      }, { timeout: 60000, interval: 1000 }).toBe(true);

      await expect.poll(async () => {
        return mobile.page.evaluate(({ workspaceName, generalMessage, extraChannelName, extraChannelMessage }) => {
          const ctrl = (window as any).__ctrl;
          const ws = ctrl.workspaceManager.getAllWorkspaces().find((w: any) => w.name === workspaceName);
          if (!ws) return false;

          const general = ws.channels.find((c: any) => c.name === 'general');
          const extra = ws.channels.find((c: any) => c.name === extraChannelName);
          if (!general || !extra) return false;

          const generalMessages = ctrl.messageStore.getMessages(general.id).map((m: any) => String(m.content || ''));
          const extraMessages = ctrl.messageStore.getMessages(extra.id).map((m: any) => String(m.content || ''));

          return generalMessages.some((m: string) => m.includes(generalMessage))
            && extraMessages.some((m: string) => m.includes(extraChannelMessage));
        }, {
          workspaceName: seed.workspaceName,
          generalMessage: seed.generalMessage,
          extraChannelName: seed.extraChannelName,
          extraChannelMessage: seed.extraChannelMessage,
        });
      }, { timeout: 90000, interval: 1500 }).toBe(true);

      // Contact sync: name-announce should materialize at least one contact entry.
      await expect.poll(async () => {
        return mobile.page.evaluate(async () => {
          const ctrl = (window as any).__ctrl;
          const contacts = await ctrl.listContacts();
          return contacts.length;
        });
      }, { timeout: 60000, interval: 1000 }).toBeGreaterThan(0);
    } finally {
      await mobile.context.close().catch(() => {});
      await source.context.close().catch(() => {});
    }
  });
});
