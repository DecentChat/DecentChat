import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

type ChannelSnapshot = {
  id: string;
  name: string;
  type: string;
  members: string[];
  messages: string[];
};

type WorkspaceSnapshot = {
  id: string;
  name: string;
  inviteCode: string;
  members: Array<{ peerId: string; alias: string }>;
  channels: ChannelSnapshot[];
};

async function clearStorage(page: Page): Promise<void> {
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
  await page.reload();
}

async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 20000 });
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 20000 });
}

async function createUser(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await clearStorage(page);
  await waitForApp(page);
  return { context, page };
}

async function createWorkspace(page: Page, name: string, alias: string): Promise<string> {
  const createBtn = page.locator('#create-ws-btn:visible, #ws-rail-add:visible').first();
  await createBtn.click();
  await page.waitForSelector('.modal', { timeout: 10000 });

  await page.locator('.modal input[name="name"]').fill(name);
  await page.locator('.modal input[name="alias"]').fill(alias);
  await page.locator('.modal #modal-submit, .modal .btn-primary').first().click();

  await expect(page.locator('.sidebar-header h1')).toContainText(name, { timeout: 10000 });
  const wsId = await page.evaluate(() => (window as any).__state?.activeWorkspaceId || '');
  expect(wsId).toBeTruthy();

  // Ensure workspace write is persisted before tests trigger reloads.
  const persisted = await page.evaluate(async (workspaceId) => {
    const ctrl = (window as any).__ctrl;
    for (let i = 0; i < 30; i++) {
      const all = await ctrl?.persistentStore?.getAllWorkspaces?.();
      if (Array.isArray(all) && all.some((w: any) => w.id === workspaceId)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }, wsId);
  expect(persisted).toBe(true);

  return wsId;
}

async function switchWorkspaceByName(page: Page, workspaceName: string): Promise<string> {
  const wsId = await page.evaluate((name) => {
    const ctrl = (window as any).__ctrl;
    const ws = ctrl?.workspaceManager?.getAllWorkspaces?.().find((w: any) => w.name === name);
    return ws?.id || '';
  }, workspaceName);

  expect(wsId).toBeTruthy();
  await page.click(`.ws-rail-icon[data-ws-id="${wsId}"]`);
  await expect(page.locator('.sidebar-header h1')).toContainText(workspaceName, { timeout: 10000 });
  return wsId;
}

async function createChannel(page: Page, channelName: string): Promise<void> {
  await page.click('#add-channel-btn');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.locator('.modal input[name="name"]').fill(channelName);
  await page.locator('.modal #modal-submit, .modal .btn-primary').first().click();

  await page.waitForFunction(
    (name) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      const ws = state?.activeWorkspaceId ? ctrl?.workspaceManager?.getWorkspace?.(state.activeWorkspaceId) : null;
      return !!ws?.channels?.some((c: any) => c.name === name);
    },
    channelName,
    { timeout: 10000 },
  );
}

async function switchChannel(page: Page, channelName: string): Promise<void> {
  await page.click(`.sidebar-item[data-channel-id]:has-text("${channelName}")`);
  await expect(page.locator('.channel-header h2')).toContainText(channelName, { timeout: 10000 });
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.locator('#compose-input').fill(text);
  await page.locator('#compose-input').press('Enter');
  await page.waitForFunction(
    (msg) => Array.from(document.querySelectorAll('.message-content')).some((el) => el.textContent?.includes(msg)),
    text,
    { timeout: 10000 },
  );
}

async function captureInviteUrl(page: Page): Promise<string> {
  const inviteUrl: string = await page.evaluate(() => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    if (!state?.activeWorkspaceId) return '';
    return ctrl?.generateInviteURL?.(state.activeWorkspaceId) || '';
  });
  expect(inviteUrl).toContain('/join/');
  return inviteUrl;
}

async function joinViaInvite(page: Page, inviteUrl: string, alias: string): Promise<void> {
  await page.goto(inviteUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.modal', { timeout: 15000 });
  await page.locator('.modal input[name="alias"]').fill(alias);
  await page.locator('.modal #modal-submit, .modal .btn-primary').first().click();
  await page.waitForSelector('#compose-input', { timeout: 15000 });
}

async function waitForPeerHandshake(pageA: Page, pageB: Page, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [aReady, bReady] = await Promise.all([
      pageA.evaluate(() => (window as any).__state?.readyPeers?.size || 0),
      pageB.evaluate(() => (window as any).__state?.readyPeers?.size || 0),
    ]);
    if (aReady > 0 && bReady > 0) return;
    await pageA.waitForTimeout(1000);
  }
  throw new Error('Peer handshake did not complete in time');
}

async function snapshotWorkspaces(page: Page): Promise<WorkspaceSnapshot[]> {
  return page.evaluate(() => {
    const ctrl = (window as any).__ctrl;
    const workspaceManager = ctrl?.workspaceManager;
    const messageStore = ctrl?.messageStore;
    const all = workspaceManager?.getAllWorkspaces?.() || [];

    return all.map((ws: any) => ({
      id: ws.id,
      name: ws.name,
      inviteCode: ws.inviteCode,
      members: (ws.members || []).map((m: any) => ({ peerId: m.peerId, alias: m.alias })),
      channels: (ws.channels || []).map((ch: any) => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        members: [...(ch.members || [])],
        messages: (messageStore?.getMessages?.(ch.id) || []).map((msg: any) => msg.content),
      })),
    }));
  });
}

function getWorkspaceByName(workspaces: WorkspaceSnapshot[], name: string): WorkspaceSnapshot {
  const ws = workspaces.find((w) => w.name === name);
  if (!ws) throw new Error(`Workspace not found: ${name}`);
  return ws;
}

function uniqueCount(values: string[]): number {
  return new Set(values).size;
}

test.describe('Workspace Data Integrity', () => {
  test.setTimeout(180000);

  test('workspace isolation: messages/channels/members do not leak across workspaces', async ({ browser }) => {
    const alice = await createUser(browser);
    const bob = await createUser(browser);

    try {
      await createWorkspace(alice.page, 'Integrity A', 'Alice');
      await createChannel(alice.page, 'alpha-only');
      await sendMessage(alice.page, 'A secret message');
      const inviteA = await captureInviteUrl(alice.page);

      await createWorkspace(alice.page, 'Integrity B', 'Alice');
      await createChannel(alice.page, 'beta-only');
      await sendMessage(alice.page, 'B separate message');

      await joinViaInvite(bob.page, inviteA, 'Bob');
      await waitForPeerHandshake(alice.page, bob.page);
      const bobPeerId = await bob.page.evaluate(() => (window as any).__state?.myPeerId || '');

      await alice.page.waitForTimeout(1000);
      const workspaces = await snapshotWorkspaces(alice.page);
      const wsA = getWorkspaceByName(workspaces, 'Integrity A');
      const wsB = getWorkspaceByName(workspaces, 'Integrity B');

      expect(wsA.channels.map((c) => c.name)).toContain('alpha-only');
      expect(wsB.channels.map((c) => c.name)).not.toContain('alpha-only');
      expect(wsB.channels.map((c) => c.name)).toContain('beta-only');
      expect(wsA.channels.map((c) => c.name)).not.toContain('beta-only');

      const wsAMessages = wsA.channels.flatMap((c) => c.messages);
      const wsBMessages = wsB.channels.flatMap((c) => c.messages);
      expect(wsAMessages).toContain('A secret message');
      expect(wsBMessages).not.toContain('A secret message');
      expect(wsBMessages).toContain('B separate message');
      expect(wsAMessages).not.toContain('B separate message');

      expect(wsA.members.map((m) => m.peerId)).toContain(bobPeerId);
      expect(wsB.members.map((m) => m.peerId)).not.toContain(bobPeerId);
    } finally {
      await bob.context.close();
      await alice.context.close();
    }
  });

  test('workspace identity preservation: workspace ID and state survive refresh and peer churn', async ({ browser }) => {
    const alice = await createUser(browser);
    const bob = await createUser(browser);

    try {
      await createWorkspace(alice.page, 'Identity WS', 'Alice');
      await createChannel(alice.page, 'stable-channel');
      await switchChannel(alice.page, 'stable-channel');
      await sendMessage(alice.page, 'ID must stay stable');

      const beforeRefresh = getWorkspaceByName(await snapshotWorkspaces(alice.page), 'Identity WS');
      const invite = await captureInviteUrl(alice.page);

      await alice.page.reload();
      await waitForApp(alice.page);

      const afterRefresh = getWorkspaceByName(await snapshotWorkspaces(alice.page), 'Identity WS');
      expect(afterRefresh.id).toBe(beforeRefresh.id);
      expect(afterRefresh.name).toBe(beforeRefresh.name);
      expect(afterRefresh.channels.map((c) => c.name)).toEqual(expect.arrayContaining(['general', 'stable-channel']));
      expect(afterRefresh.channels.flatMap((c) => c.messages)).toContain('ID must stay stable');

      await joinViaInvite(bob.page, invite, 'Bob');
      await waitForPeerHandshake(alice.page, bob.page);
      await alice.page.waitForTimeout(1000);

      const duringPeer = getWorkspaceByName(await snapshotWorkspaces(alice.page), 'Identity WS');
      expect(duringPeer.id).toBe(beforeRefresh.id);

      await bob.page.goto('about:blank');
      await alice.page.waitForTimeout(1500);

      await bob.page.goto('/app');
      await waitForApp(bob.page);
      await waitForPeerHandshake(alice.page, bob.page);

      const afterReconnect = getWorkspaceByName(await snapshotWorkspaces(alice.page), 'Identity WS');
      expect(afterReconnect.id).toBe(beforeRefresh.id);
      expect(afterReconnect.channels.map((c) => c.name)).toEqual(expect.arrayContaining(['stable-channel']));
      expect(afterReconnect.members.length).toBeGreaterThanOrEqual(2);
    } finally {
      await bob.context.close();
      await alice.context.close();
    }
  });

  test('no workspace duplication: creating and refreshing keeps exact workspace counts', async ({ browser }) => {
    const alice = await createUser(browser);

    try {
      await createWorkspace(alice.page, 'Duplicate Guard A', 'Alice');
      let snapshots = await snapshotWorkspaces(alice.page);
      expect(snapshots.filter((w) => w.name === 'Duplicate Guard A')).toHaveLength(1);
      expect(snapshots).toHaveLength(1);

      await alice.page.reload();
      await waitForApp(alice.page);
      snapshots = await snapshotWorkspaces(alice.page);
      expect(snapshots.filter((w) => w.name === 'Duplicate Guard A')).toHaveLength(1);
      expect(snapshots).toHaveLength(1);

      await createWorkspace(alice.page, 'Duplicate Guard B', 'Alice');
      snapshots = await snapshotWorkspaces(alice.page);
      expect(snapshots.filter((w) => w.name === 'Duplicate Guard A')).toHaveLength(1);
      expect(snapshots.filter((w) => w.name === 'Duplicate Guard B')).toHaveLength(1);
      expect(snapshots).toHaveLength(2);
    } finally {
      await alice.context.close();
    }
  });

  test('peer connect/disconnect resilience: workspace B untouched and reconnect does not duplicate data', async ({ browser }) => {
    const alice = await createUser(browser);
    const bob = await createUser(browser);

    try {
      await createWorkspace(alice.page, 'Resilience A', 'Alice');
      const inviteA = await captureInviteUrl(alice.page);

      await createWorkspace(alice.page, 'Resilience B', 'Alice');
      await createChannel(alice.page, 'b-only');
      await sendMessage(alice.page, 'Workspace B sentinel');

      const beforePeer = await snapshotWorkspaces(alice.page);
      const beforeA = getWorkspaceByName(beforePeer, 'Resilience A');
      const beforeB = getWorkspaceByName(beforePeer, 'Resilience B');

      await joinViaInvite(bob.page, inviteA, 'Bob');
      await waitForPeerHandshake(alice.page, bob.page);
      await alice.page.waitForTimeout(1000);

      const afterConnect = await snapshotWorkspaces(alice.page);
      const connectB = getWorkspaceByName(afterConnect, 'Resilience B');
      expect(connectB.id).toBe(beforeB.id);
      expect(connectB.channels.map((c) => c.name)).toContain('b-only');
      expect(connectB.channels.flatMap((c) => c.messages)).toContain('Workspace B sentinel');

      await bob.page.goto('about:blank');
      await alice.page.waitForTimeout(2000);

      const afterDisconnect = await snapshotWorkspaces(alice.page);
      const disconnectA = getWorkspaceByName(afterDisconnect, 'Resilience A');
      const disconnectB = getWorkspaceByName(afterDisconnect, 'Resilience B');
      expect(disconnectA.id).toBe(beforeA.id);
      expect(disconnectB.id).toBe(beforeB.id);
      expect(disconnectB.channels.map((c) => c.name)).toContain('b-only');

      await bob.page.goto('/app');
      await waitForApp(bob.page);
      await waitForPeerHandshake(alice.page, bob.page);
      await alice.page.waitForTimeout(1200);

      const afterReconnect = await snapshotWorkspaces(alice.page);
      const reconnectA = getWorkspaceByName(afterReconnect, 'Resilience A');

      const channelNames = reconnectA.channels.map((c) => c.name);
      expect(uniqueCount(channelNames)).toBe(channelNames.length);
      const memberPeerIds = reconnectA.members.map((m) => m.peerId);
      expect(uniqueCount(memberPeerIds)).toBe(memberPeerIds.length);
      expect(afterReconnect).toHaveLength(2);
    } finally {
      await bob.context.close();
      await alice.context.close();
    }
  });

  test('data persistence after refresh: workspaces/channels/messages/members survive hard reload', async ({ browser }) => {
    const alice = await createUser(browser);
    const bob = await createUser(browser);

    try {
      await createWorkspace(alice.page, 'Persist A', 'Alice');
      await createChannel(alice.page, 'persist-a');
      await switchChannel(alice.page, 'persist-a');
      await sendMessage(alice.page, 'Persist A message');
      const inviteA = await captureInviteUrl(alice.page);

      await createWorkspace(alice.page, 'Persist B', 'Alice');
      await createChannel(alice.page, 'persist-b');
      await switchChannel(alice.page, 'persist-b');
      await sendMessage(alice.page, 'Persist B message');

      await joinViaInvite(bob.page, inviteA, 'Bob');
      await waitForPeerHandshake(alice.page, bob.page);
      await alice.page.waitForTimeout(1000);

      const before = await snapshotWorkspaces(alice.page);
      const beforeA = getWorkspaceByName(before, 'Persist A');
      const beforeB = getWorkspaceByName(before, 'Persist B');

      await alice.page.reload({ waitUntil: 'domcontentloaded' });
      await waitForApp(alice.page);
      await alice.page.waitForTimeout(1200);

      const after = await snapshotWorkspaces(alice.page);
      const afterA = getWorkspaceByName(after, 'Persist A');
      const afterB = getWorkspaceByName(after, 'Persist B');

      expect(after).toHaveLength(before.length);

      expect(afterA.id).toBe(beforeA.id);
      expect(afterB.id).toBe(beforeB.id);

      expect(afterA.channels.map((c) => c.name)).toEqual(expect.arrayContaining(['general', 'persist-a']));
      expect(afterB.channels.map((c) => c.name)).toEqual(expect.arrayContaining(['general', 'persist-b']));

      expect(afterA.channels.flatMap((c) => c.messages)).toContain('Persist A message');
      expect(afterB.channels.flatMap((c) => c.messages)).toContain('Persist B message');

      expect(afterA.members.length).toBeGreaterThanOrEqual(2);
      expect(afterA.members.map((m) => m.alias)).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    } finally {
      await bob.context.close();
      await alice.context.close();
    }
  });
});
