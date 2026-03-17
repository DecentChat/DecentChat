import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../../decent-client-web/tests/mocks/mock-relay-server';
import { getMockTransportScript } from '../../decent-client-web/tests/mocks/MockTransport';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(async () => {
  relay?.close();
});

async function prepareMockedPage(page: Page): Promise<void> {
  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));
  await page.addInitScript(() => {
    const originalMediaDevices = navigator.mediaDevices;
    const fakeGetUserMedia = async () => {
      const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      const destination = ctx.createMediaStreamDestination();
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      return destination.stream;
    };

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        ...originalMediaDevices,
        getUserMedia: fakeGetUserMedia,
      },
    });
  });
}

async function clearAppState(page: Page): Promise<void> {
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
}

async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector('button:has-text("Get started"), .tab-bar, nav[aria-label="Primary"]', {
    timeout: 10000,
  });
}

async function completeOnboarding(page: Page, alias: string): Promise<void> {
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.fill('input[placeholder*="How should others"]', alias);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('nav[aria-label="Primary"], .tab-bar')).toBeVisible({ timeout: 10000 });
}

async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /you/i }).click();
  await page.locator('#create-workspace-input').last().fill(name);
  await page.getByRole('button', { name: 'Create workspace' }).last().click();
  await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 5000 });
}

async function getInviteUrl(page: Page): Promise<string> {
  const data = await page.evaluate(() => {
    const ctrl = (globalThis as any).__decentChatMobileController;
    const workspaces = ctrl.workspaceManager.getAllWorkspaces();
    const activeWorkspaceId = ctrl.stores.activeWorkspaceId ? null : null;
    const workspace = workspaces[0];
    const myPeerId = (window as any).__svelte?.stores?.myPeerId || null;
    const me = workspace.members[0];
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      inviteCode: workspace.inviteCode,
      peerId: me.peerId,
      publicKey: me.publicKey,
    };
  });

  const params = new URLSearchParams();
  params.set('signal', `localhost:${relay.port}`);
  params.set('peer', data.peerId);
  params.set('pk', data.publicKey);
  params.set('name', data.workspaceName);
  params.set('ws', data.workspaceId);
  params.set('path', '/peerjs');

  return `https://decentchat.app/join/${data.inviteCode}?${params.toString()}`;
}

async function joinWorkspaceFromYouTab(page: Page, inviteUrl: string): Promise<void> {
  await page.getByRole('button', { name: /you/i }).click();
  await page.locator('#join-workspace-input').last().fill(inviteUrl);
  await expect(page.getByRole('button', { name: 'Join workspace' }).last()).toBeEnabled({ timeout: 3000 });
  await page.getByRole('button', { name: 'Join workspace' }).last().click();
}

async function waitForReadyPeer(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ctrl = (globalThis as any).__decentChatMobileController;
    return !!ctrl && !!ctrl.readyPeers && ctrl.readyPeers.size > 0;
  }, { timeout: 15000 });
}

test.describe('Multi-peer mobile messaging', () => {
  test('alice creates workspace, bob joins via invite, and messages sync both ways', async ({ browser }) => {
    const aliceContext = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const bobContext = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();

    await prepareMockedPage(alice);
    await prepareMockedPage(bob);

    await alice.goto('/');
    await bob.goto('/');

    await clearAppState(alice);
    await clearAppState(bob);
    await alice.reload();
    await bob.reload();
    await waitForApp(alice);
    await waitForApp(bob);

    await completeOnboarding(alice, 'Alice');
    await completeOnboarding(bob, 'Bob');

    await createWorkspace(alice, 'Alpha Team');

    const inviteUrl = await getInviteUrl(alice);
    await joinWorkspaceFromYouTab(bob, inviteUrl);

    await expect(bob.getByText(/workspace joined/i).first()).toBeVisible({ timeout: 10000 });
    await bob.getByRole('button', { name: /you/i }).click();
    await expect(bob.getByText('Alpha Team').first()).toBeVisible({ timeout: 10000 });

    // Wait until both clients have a ready peer/handshake before sending messages
    await waitForReadyPeer(alice);
    await waitForReadyPeer(bob);

    // Alice sends to #general
    const aliceGeneralChannelId = await alice.evaluate(() => {
      const ctrl = (globalThis as any).__decentChatMobileController;
      const workspace = ctrl.workspaceManager.getAllWorkspaces()[0];
      return workspace.channels.find((c: any) => c.name === 'general')?.id || null;
    });
    expect(aliceGeneralChannelId).toBeTruthy();
    await alice.evaluate(async ({ channelId }) => {
      const ctrl = (globalThis as any).__decentChatMobileController;
      await ctrl.sendMessage(channelId, 'hello from alice');
    }, { channelId: aliceGeneralChannelId });

    await bob.waitForFunction(() => {
      const ctrl = (globalThis as any).__decentChatMobileController;
      const workspace = ctrl.workspaceManager.getAllWorkspaces()[0];
      const generalId = workspace.channels.find((c: any) => c.name === 'general')?.id;
      const msgs = generalId ? ctrl.messageStore.getMessages(generalId) : [];
      return msgs.some((m: any) => m.content === 'hello from alice');
    }, { timeout: 10000 });

    // Bob replies to #general
    const bobGeneralChannelId = await bob.evaluate(() => {
      const ctrl = (globalThis as any).__decentChatMobileController;
      const workspace = ctrl.workspaceManager.getAllWorkspaces()[0];
      return workspace.channels.find((c: any) => c.name === 'general')?.id || null;
    });
    expect(bobGeneralChannelId).toBeTruthy();
    await bob.evaluate(async ({ channelId }) => {
      const ctrl = (globalThis as any).__decentChatMobileController;
      await ctrl.sendMessage(channelId, 'hello from bob');
    }, { channelId: bobGeneralChannelId });

    await alice.waitForFunction(() => {
      const ctrl = (globalThis as any).__decentChatMobileController;
      const workspace = ctrl.workspaceManager.getAllWorkspaces()[0];
      const generalId = workspace.channels.find((c: any) => c.name === 'general')?.id;
      const msgs = generalId ? ctrl.messageStore.getMessages(generalId) : [];
      return msgs.some((m: any) => m.content === 'hello from bob');
    }, { timeout: 10000 });

    await aliceContext.close();
    await bobContext.close();
  });
});

  test('alice can start a huddle and both mobile clients enter and exit call state', async ({ browser }) => {
    const aliceContext = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const bobContext = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();

    await prepareMockedPage(alice);
    await prepareMockedPage(bob);

    await alice.goto('/');
    await bob.goto('/');

    await clearAppState(alice);
    await clearAppState(bob);
    await alice.reload();
    await bob.reload();
    await waitForApp(alice);
    await waitForApp(bob);

    await completeOnboarding(alice, 'Alice');
    await completeOnboarding(bob, 'Bob');

    await createWorkspace(alice, 'Call Team');
    const inviteUrl = await getInviteUrl(alice);
    await joinWorkspaceFromYouTab(bob, inviteUrl);
    await expect(bob.getByText(/workspace joined/i).first()).toBeVisible({ timeout: 10000 });

    await waitForReadyPeer(alice);
    await waitForReadyPeer(bob);

    await alice.getByRole('button', { name: /calls/i }).click();
    await alice.getByRole('button', { name: /start huddle/i }).first().click();

    await expect(alice.getByRole('dialog', { name: /active call/i })).toBeVisible({ timeout: 10000 });
    await expect(bob.getByRole('dialog', { name: /active call/i })).toBeVisible({ timeout: 10000 });

    await alice.getByRole('button', { name: /end call/i }).click();

    await expect(alice.getByRole('dialog', { name: /active call/i })).not.toBeVisible({ timeout: 10000 });
    await expect(bob.getByRole('dialog', { name: /active call/i })).not.toBeVisible({ timeout: 10000 });

    await aliceContext.close();
    await bobContext.close();
  });

test('direct ring flow syncs between peers (ring -> accept -> active call -> end)', async ({ browser }) => {
  const aliceContext = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const bobContext = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await prepareMockedPage(alice);
  await prepareMockedPage(bob);

  await alice.goto('/');
  await bob.goto('/');

  await clearAppState(alice);
  await clearAppState(bob);
  await alice.reload();
  await bob.reload();
  await waitForApp(alice);
  await waitForApp(bob);

  await completeOnboarding(alice, 'Alice');
  await completeOnboarding(bob, 'Bob');

  await createWorkspace(alice, 'Direct Call Team');
  const inviteUrl = await getInviteUrl(alice);
  await joinWorkspaceFromYouTab(bob, inviteUrl);
  await expect(bob.getByText(/workspace joined/i).first()).toBeVisible({ timeout: 10000 });

  await waitForReadyPeer(alice);
  await waitForReadyPeer(bob);

  const alicePeerId = await alice.evaluate(() => {
    const ctrl = (globalThis as any).__decentChatMobileController;
    return ctrl?.transport?.getMyPeerId?.() ?? null;
  });
  expect(alicePeerId).toBeTruthy();

  await bob.evaluate(async ({ peerId }) => {
    const ctrl = (globalThis as any).__decentChatMobileController;
    await ctrl.callManager.ring(peerId);
  }, { peerId: alicePeerId });

  await expect(alice.getByRole('dialog', { name: /incoming call/i })).toBeVisible({ timeout: 10000 });
  await alice.getByRole('button', { name: /accept call/i }).click();

  await expect(alice.getByRole('dialog', { name: /active call/i })).toBeVisible({ timeout: 10000 });
  await expect(bob.getByRole('dialog', { name: /active call/i })).toBeVisible({ timeout: 10000 });

  await bob.getByRole('button', { name: /end call/i }).click();

  await expect(alice.getByRole('dialog', { name: /active call/i })).not.toBeVisible({ timeout: 10000 });
  await expect(bob.getByRole('dialog', { name: /active call/i })).not.toBeVisible({ timeout: 10000 });

  await aliceContext.close();
  await bobContext.close();
});
