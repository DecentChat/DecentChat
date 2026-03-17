/**
 * QR Transfer → Mobile Sync — Integration tests
 *
 * Simulates the flow where:
 *  1. Alice creates a workspace with channels, messages, and contacts
 *  2. A "mobile" device scans Alice's seed QR (restores identity)
 *  3. Mobile joins the workspace via invite link
 *  4. Mobile should receive: workspaces, channels, messages, contacts
 *
 * Uses MockTransport + relay server (no WebRTC) for deterministic CI.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';
import { createBrowserContext } from './context-permissions';

// ─── Relay ────────────────────────────────────────────────────────────────────

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
  console.log(`[QRSync] Mock relay on port ${relay.port}`);
});

test.afterAll(async () => {
  relay?.close();
});

// ─── Test user factory ────────────────────────────────────────────────────────

interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await createBrowserContext(browser);
  const page = await context.newPage();

  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));

  // Loosen ECDH/ECDSA verify (same pattern as multi-device-negentropy-sync)
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

// ─── Workspace helpers ────────────────────────────────────────────────────────

async function createWorkspace(page: Page, name: string, alias: string): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
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

async function joinViaInviteUrl(page: Page, inviteUrl: string, alias: string): Promise<{ peerId: string; workspaceId: string; inviteCode: string; workspaceCount: number }> {
  // Ensure we're on the /app route where __ctrl is available
  const currentUrl = page.url();
  if (!currentUrl.includes('/app') && !currentUrl.includes('/join/')) {
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
  }

  // Wait for controller to be ready
  await page.waitForFunction(() => !!(window as any).__ctrl, undefined, { timeout: 15000 });

  // Parse invite URL and join programmatically via controller.
  // IMPORTANT: return immediately after join so the caller can trigger owner
  // workspace-state before provisional join validation times out.
  const joined = await page.evaluate(async ({ url, alias }: { url: string; alias: string }) => {
    const ctrl = (window as any).__ctrl;
    if (!ctrl) return null;

    const ctor = ctrl.constructor as { JOIN_VALIDATION_TIMEOUT_MS?: number };
    if (ctor) ctor.JOIN_VALIDATION_TIMEOUT_MS = 60000;

    let lastToast: { message?: string; type?: string } | null = null;
    const originalShowToast = ctrl.ui?.showToast?.bind(ctrl.ui);
    if (ctrl.ui?.showToast) {
      ctrl.ui.showToast = ((message: string, type?: string) => {
        lastToast = { message: String(message), type: String(type || '') };
        return originalShowToast?.(message, type);
      }) as typeof ctrl.ui.showToast;
    }

    const parsed = new URL(url, window.location.origin);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const joinIdx = pathParts.indexOf('join');
    const code = joinIdx >= 0 && joinIdx + 1 < pathParts.length ? pathParts[joinIdx + 1] : '';

    const signalParam = parsed.searchParams.get('signal') || '';
    let host = parsed.hostname;
    let port = 443;
    let secure = true;
    if (signalParam) {
      const m = signalParam.match(/^(.+):(\d+)$/);
      if (m) {
        host = m[1];
        port = Number(m[2]);
        secure = parsed.searchParams.get('secure') === '1' || port === 443;
      }
    }

    const allPeers = parsed.searchParams.getAll('peer');
    const primaryPeer = allPeers[0] || '';
    const additionalPeers = allPeers.length > 1 ? allPeers.slice(1) : undefined;
    const expRaw = parsed.searchParams.get('exp');
    const maxRaw = parsed.searchParams.get('max');
    const expiresAt = expRaw ? Number(expRaw) : undefined;
    const maxUses = maxRaw ? Number(maxRaw) : undefined;
    const inviteId = parsed.searchParams.get('i') || undefined;

    const inviteData = {
      host,
      port,
      inviteCode: code,
      secure,
      path: parsed.searchParams.get('path') || '/peerjs',
      fallbackServers: parsed.searchParams.getAll('fallback'),
      turnServers: parsed.searchParams.getAll('turn'),
      peerId: primaryPeer || undefined,
      peers: additionalPeers,
      publicKey: parsed.searchParams.get('pk') || undefined,
      workspaceName: parsed.searchParams.get('name') || undefined,
      workspaceId: parsed.searchParams.get('ws') || undefined,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      maxUses: Number.isFinite(maxUses) ? maxUses : undefined,
      inviteId,
      inviterId: parsed.searchParams.get('inviter') || undefined,
      signature: parsed.searchParams.get('sig') || undefined,
    };

    let error: string | null = null;
    try {
      await ctrl.joinWorkspace(code, alias, primaryPeer, inviteData);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const workspaces = ctrl.workspaceManager.getAllWorkspaces();
    const joinedWs = workspaces.find((ws: any) => ws.inviteCode === code) || workspaces[0] || null;
    return {
      peerId: primaryPeer,
      workspaceId: joinedWs?.id || '',
      inviteCode: code,
      workspaceCount: workspaces.length,
      activeWorkspaceId: (window as any).__state?.activeWorkspaceId || '',
      toast: lastToast,
      error,
      urlAfter: window.location.href,
    };
  }, { url: inviteUrl, alias });

  if (!joined) throw new Error('joinViaInviteUrl: controller not available');
  return joined;
}

// ─── Peer helpers ─────────────────────────────────────────────────────────────

/**
 * Pre-connect two pages so they can exchange messages.
 * Does NOT wait for handshake/readyPeers — just ensures the transport
 * layer connection is initiated so workspace-state can arrive in time.
 */
async function ensurePeersConnected(pageA: Page, pageB: Page): Promise<void> {
  await pageA.waitForFunction(() => !!(window as any).__ctrl, undefined, { timeout: 15000 });
  await pageB.waitForFunction(() => !!(window as any).__ctrl, undefined, { timeout: 15000 });

  const peerA = await pageA.evaluate(() => (window as any).__state?.myPeerId || '');
  const peerB = await pageB.evaluate(() => (window as any).__state?.myPeerId || '');

  await pageA.evaluate((id: string) => (window as any).__ctrl?.connectPeer?.(id), peerB);
  await pageB.evaluate((id: string) => (window as any).__ctrl?.connectPeer?.(id), peerA);

  // Wait for transport-level connection (not full handshake)
  await pageA.waitForFunction(
    (peerId: string) => {
      const s = (window as any).__state;
      return s?.readyPeers?.has(peerId) || s?.connectedPeers?.has(peerId) || s?.connectingPeers?.has(peerId);
    },
    peerB,
    { timeout: 15000 },
  );
}

/**
 * Connect two pages via MockTransport and wait until both have the other
 * in their readyPeers set.  MockTransport has no auto-discovery, so we
 * always call connectPeer() explicitly first.
 */
async function waitForPeersReady(pageA: Page, pageB: Page, timeoutMs = 60000): Promise<void> {
  // Wait for both controllers to be available (transport may still be initializing)
  await pageA.waitForFunction(() => !!(window as any).__ctrl, undefined, { timeout: 15000 });
  await pageB.waitForFunction(() => !!(window as any).__ctrl, undefined, { timeout: 15000 });

  const peerA = await pageA.evaluate(() => (window as any).__state?.myPeerId || '');
  const peerB = await pageB.evaluate(() => (window as any).__state?.myPeerId || '');

  // Initiate connection from both sides (MockTransport relay requires this).
  // Retry the connect calls a few times in case transport isn't ready yet.
  for (let attempt = 0; attempt < 5; attempt++) {
    await pageA.evaluate((id: string) => (window as any).__ctrl?.connectPeer?.(id), peerB);
    await pageB.evaluate((id: string) => (window as any).__ctrl?.connectPeer?.(id), peerA);

    const aReady = await pageA.evaluate((id: string) => (window as any).__state?.readyPeers?.has(id), peerB);
    const bReady = await pageB.evaluate((id: string) => (window as any).__state?.readyPeers?.has(id), peerA);
    if (aReady && bReady) return;

    await pageA.waitForTimeout(1000);
  }

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

async function joinAndSyncFromHost(
  hostPage: Page,
  joinerPage: Page,
  inviteUrl: string,
  alias: string,
  options?: { requestMessageSync?: boolean },
): Promise<void> {
  await ensurePeersConnected(hostPage, joinerPage);
  const joined = await joinViaInviteUrl(joinerPage, inviteUrl, alias);
  expect(joined.workspaceCount).toBeGreaterThan(0);
  expect(joined.workspaceId).toBeTruthy();

  const joinerPeerId = await joinerPage.evaluate(() => (window as any).__state?.myPeerId || '');
  const hostPeerId = await hostPage.evaluate(() => (window as any).__state?.myPeerId || '');

  // Push authoritative workspace state immediately over the already-open MockTransport connection.
  await hostPage.evaluate(({ peerId }: { peerId: string }) => {
    const ctrl = (window as any).__ctrl;
    ctrl?.sendWorkspaceState?.(peerId, undefined, { forceInclude: true });
  }, { peerId: joinerPeerId });

  await joinerPage.waitForFunction(() => {
    const ctrl = (window as any).__ctrl;
    return (ctrl?.workspaceManager?.getAllWorkspaces() || []).length > 0;
  }, { timeout: 15000 });

  await waitForPeersReady(hostPage, joinerPage);

  if (options?.requestMessageSync) {
    await joinerPage.evaluate((peerId: string) => {
      const ctrl = (window as any).__ctrl;
      return ctrl?.requestMessageSync?.(peerId);
    }, hostPeerId);
  }
}

// ─── Channel / message helpers ────────────────────────────────────────────────

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

async function sendMessageFromController(page: Page, channelId: string, content: string): Promise<string> {
  const messageId = await page.evaluate(async ({ chId, text }: { chId: string; text: string }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    state.activeChannelId = chId;
    await ctrl.sendMessage(text);
    const messages = ctrl.messageStore.getMessages(chId);
    return messages[messages.length - 1]?.id || '';
  }, { chId: channelId, text: content });
  expect(messageId).toBeTruthy();
  return messageId;
}

// ─── Seed restore ─────────────────────────────────────────────────────────────

async function restoreSeed(page: Page, seedPhrase: string, deviceIndex = 1): Promise<void> {
  // Force restored device onto a distinct HD device path so it gets a unique
  // peerId while sharing the same identity/seed.
  await page.evaluate(async (index: number) => {
    const ctrl = (window as any).__ctrl;
    const existing = await ctrl.persistentStore.getSettings<any>({});
    await ctrl.persistentStore.saveSettings({ ...existing, deviceIndex: index });
  }, deviceIndex);

  await page.click('#restore-identity-btn');
  await page.waitForSelector('#restore-seed-input', { timeout: 10000 });
  await page.fill('#restore-seed-input', seedPhrase);
  await page.waitForFunction(
    () => !(document.getElementById('restore-confirm-btn') as HTMLButtonElement | null)?.disabled,
    { timeout: 10000 },
  );
  await page.click('#restore-confirm-btn');
  await page.waitForSelector('#seed-restore-btn', { timeout: 10000 });

  // Restore triggers a full app reload. Wait for navigation + full bootstrap.
  await Promise.all([
    page.waitForLoadState('load').catch(() => {}),
    page.click('#seed-restore-btn'),
  ]);

  // The restore path can trigger more than one reload (derive keys, then boot app).
  // Wait until the controller and derived peerId are both stable.
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !!(window as any).__ctrl
      && !!(window as any).__state?.myPeerId
      && (!loading || loading.style.opacity === '0');
  }, { timeout: 30000 });

  // Give the browser a beat so any chained reloads finish before later evaluate() calls.
  await page.waitForTimeout(750);
}
// ─── Contact helpers ──────────────────────────────────────────────────────────

async function addContactViaController(page: Page, peerId: string, displayName: string): Promise<void> {
  await page.evaluate(async ({ peerId, displayName }) => {
    const ctrl = (window as any).__ctrl;
    await ctrl.addContact({
      peerId,
      publicKey: `pk-${peerId}`,
      displayName,
      signalingServers: [],
      addedAt: Date.now(),
      lastSeen: Date.now(),
    });
  }, { peerId, displayName });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('QR transfer → mobile sync', () => {
  test.setTimeout(180000);

  test('mobile restores seed, joins via invite, receives workspace + channels', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');

    try {
      await createWorkspace(alice.page, 'QR Sync WS', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      expect(inviteUrl).toContain('/join/');

      await createChannel(alice.page, 'announcements');

      const aliceSeed = await alice.page.evaluate(async () => {
        return await (window as any).__ctrl.persistentStore.getSetting('seedPhrase');
      });
      expect(aliceSeed).toBeTruthy();

      const mobile = await createUser(browser, 'Mobile');
      try {
        await restoreSeed(mobile.page, aliceSeed);

        // Wait for the app to fully stabilize after seed restore reload.
        await mobile.page.waitForLoadState('load');
        await mobile.page.waitForFunction(() => {
          return !!(window as any).__ctrl && !!(window as any).__state?.myPeerId;
        }, { timeout: 30000 });

        await joinAndSyncFromHost(alice.page, mobile.page, inviteUrl, 'Alice Mobile');

        // After connecting to Alice, workspace-state should update the name.
        await mobile.page.waitForFunction((wsName: string) => {
          const ctrl = (window as any).__ctrl;
          return ctrl?.workspaceManager?.getAllWorkspaces()?.some((ws: any) => ws.name === wsName);
        }, 'QR Sync WS', { timeout: 30000 });

        // Verify channels synced (general + announcements)
        await mobile.page.waitForFunction(() => {
          const s = (window as any).__state;
          const ctrl = (window as any).__ctrl;
          const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
          if (!ws) return false;
          const names = ws.channels.map((c: any) => c.name);
          return names.includes('general') && names.includes('announcements');
        }, { timeout: 30000 });

        const mobileChannels = await mobile.page.evaluate(() => {
          const s = (window as any).__state;
          const ctrl = (window as any).__ctrl;
          const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
          return ws?.channels?.map((c: any) => c.name) || [];
        });
        expect(mobileChannels).toContain('general');
        expect(mobileChannels).toContain('announcements');
      } finally {
        await closeUser(mobile);
      }
    } finally {
      await closeUser(alice);
    }
  });

  test('mobile receives messages after sync', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Msg Sync WS', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinAndSyncFromHost(alice.page, bob.page, inviteUrl, 'Bob');

      const generalAlice = await alice.page.evaluate(() => (window as any).__state?.activeChannelId || '');
      const generalBob = await getChannelIdByName(bob.page, 'general');

      for (let i = 0; i < 5; i++) {
        await sendMessageFromController(alice.page, generalAlice, `alice-msg-${i}`);
        await sendMessageFromController(bob.page, generalBob, `bob-msg-${i}`);
      }

      // Wait for Alice to have all 10 messages
      await alice.page.waitForFunction(() => {
        const s = (window as any).__state;
        const ctrl = (window as any).__ctrl;
        return ctrl.messageStore.getMessages(s.activeChannelId).length >= 10;
      }, { timeout: 30000 });

      const bobSeed = await bob.page.evaluate(async () => {
        return await (window as any).__ctrl.persistentStore.getSetting('seedPhrase');
      });
      expect(bobSeed).toBeTruthy();
      await closeUser(bob);

      const mobile = await createUser(browser, 'Mobile Bob');
      try {
        await restoreSeed(mobile.page, bobSeed);
        await joinAndSyncFromHost(alice.page, mobile.page, inviteUrl, 'Bob Mobile', { requestMessageSync: true });

        const mobileGeneral = await getChannelIdByName(mobile.page, 'general');
        expect(mobileGeneral).toBeTruthy();

        await mobile.page.waitForFunction((chId: string) => {
          const ctrl = (window as any).__ctrl;
          return ctrl.messageStore.getMessages(chId).length >= 10;
        }, mobileGeneral, { timeout: 60000 });

        const mobileMessages = await mobile.page.evaluate((chId: string) => {
          const ctrl = (window as any).__ctrl;
          return ctrl.messageStore.getMessages(chId).map((m: any) => String(m.content || ''));
        }, mobileGeneral);

        expect(mobileMessages).toContain('alice-msg-0');
        expect(mobileMessages).toContain('alice-msg-4');
        expect(mobileMessages).toContain('bob-msg-0');
        expect(mobileMessages).toContain('bob-msg-4');
      } finally {
        await closeUser(mobile);
      }
    } finally {
      await closeUser(alice);
    }
  });

  test('mobile receives workspace members after sync', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Members WS', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinAndSyncFromHost(alice.page, bob.page, inviteUrl, 'Bob');

      const bobSeed = await bob.page.evaluate(async () => {
        return await (window as any).__ctrl.persistentStore.getSetting('seedPhrase');
      });
      await closeUser(bob);

      const mobile = await createUser(browser, 'Mobile');
      try {
        await restoreSeed(mobile.page, bobSeed);
        await joinAndSyncFromHost(alice.page, mobile.page, inviteUrl, 'Bob Mobile');

        // Verify workspace member list includes Alice
        await mobile.page.waitForFunction(() => {
          const s = (window as any).__state;
          const ctrl = (window as any).__ctrl;
          const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
          if (!ws) return false;
          return ws.members.some((m: any) => m.alias === 'Alice');
        }, { timeout: 30000 });

        const members = await mobile.page.evaluate(() => {
          const s = (window as any).__state;
          const ctrl = (window as any).__ctrl;
          const ws = ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId);
          return ws?.members?.map((m: any) => m.alias) || [];
        });
        expect(members).toContain('Alice');
      } finally {
        await closeUser(mobile);
      }
    } finally {
      await closeUser(alice);
    }
  });

  test('mobile receives contacts via name-announce after connect', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');

    try {
      await createWorkspace(alice.page, 'Contacts WS', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);

      const aliceSeed = await alice.page.evaluate(async () => {
        return await (window as any).__ctrl.persistentStore.getSetting('seedPhrase');
      });
      expect(aliceSeed).toBeTruthy();

      const mobile = await createUser(browser, 'Mobile');
      try {
        await restoreSeed(mobile.page, aliceSeed);
        await joinAndSyncFromHost(alice.page, mobile.page, inviteUrl, 'Alice Mobile');

        // After connecting to Alice, name-announce populates workspace members
        await mobile.page.waitForFunction(() => {
          const s = (window as any).__state;
          const ctrl = (window as any).__ctrl;
          const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
          return ws?.members?.length >= 1;
        }, { timeout: 30000 });

        const memberAliases = await mobile.page.evaluate(() => {
          const s = (window as any).__state;
          const ctrl = (window as any).__ctrl;
          const ws = ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId);
          return ws?.members?.map((m: any) => m.alias) || [];
        });
        expect(memberAliases.length).toBeGreaterThan(0);
      } finally {
        await closeUser(mobile);
      }
    } finally {
      await closeUser(alice);
    }
  });

  test('mobile receives messages in multiple channels', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Multi-Ch WS', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);

      const randomId = await createChannel(alice.page, 'random');
      const devId = await createChannel(alice.page, 'dev');

      await joinAndSyncFromHost(alice.page, bob.page, inviteUrl, 'Bob');

      // Wait for Bob to see all channels
      await bob.page.waitForFunction(() => {
        const s = (window as any).__state;
        const ctrl = (window as any).__ctrl;
        const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
        return ws?.channels?.length >= 3;
      }, { timeout: 15000 });

      const generalAlice = await getChannelIdByName(alice.page, 'general');
      await sendMessageFromController(alice.page, generalAlice, 'gen-msg-1');
      await sendMessageFromController(alice.page, generalAlice, 'gen-msg-2');
      await sendMessageFromController(alice.page, randomId, 'random-msg-1');
      await sendMessageFromController(alice.page, devId, 'dev-msg-1');
      await sendMessageFromController(alice.page, devId, 'dev-msg-2');
      await sendMessageFromController(alice.page, devId, 'dev-msg-3');

      // Wait for Bob to have all 6 messages
      await bob.page.waitForFunction(() => {
        const ctrl = (window as any).__ctrl;
        const s = (window as any).__state;
        const ws = ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId);
        if (!ws) return false;
        let total = 0;
        for (const ch of ws.channels) total += ctrl.messageStore.getMessages(ch.id).length;
        return total >= 6;
      }, { timeout: 30000 });

      const bobSeed = await bob.page.evaluate(async () => {
        return await (window as any).__ctrl.persistentStore.getSetting('seedPhrase');
      });
      await closeUser(bob);

      const mobile = await createUser(browser, 'Mobile');
      try {
        await restoreSeed(mobile.page, bobSeed);
        await joinAndSyncFromHost(alice.page, mobile.page, inviteUrl, 'Bob Mobile', { requestMessageSync: true });

        // Wait for all channels to arrive
        await mobile.page.waitForFunction(() => {
          const s = (window as any).__state;
          const ctrl = (window as any).__ctrl;
          const ws = s?.activeWorkspaceId ? ctrl.workspaceManager.getWorkspace(s.activeWorkspaceId) : null;
          return ws?.channels?.length >= 3;
        }, { timeout: 30000 });

        const hostPeerId = await alice.page.evaluate(() => (window as any).__state?.myPeerId || '');
        const mobileGeneral = await getChannelIdByName(mobile.page, 'general');
        const mobileRandom = await getChannelIdByName(mobile.page, 'random');
        const mobileDev = await getChannelIdByName(mobile.page, 'dev');
        expect(mobileGeneral).toBeTruthy();
        expect(mobileRandom).toBeTruthy();
        expect(mobileDev).toBeTruthy();

        // Request a fresh sync after channel metadata is fully available on mobile.
        // (The initial sync during join can happen before all channels are hydrated.)
        await mobile.page.evaluate((peerId: string) => {
          const ctrl = (window as any).__ctrl;
          return ctrl?.requestMessageSync?.(peerId);
        }, hostPeerId);

        // Wait for per-channel message hydration, not just total counts.
        await mobile.page.waitForFunction(({ generalId, randomId, devId }) => {
          const ctrl = (window as any).__ctrl;
          const general = ctrl.messageStore.getMessages(generalId).length;
          const random = ctrl.messageStore.getMessages(randomId).length;
          const dev = ctrl.messageStore.getMessages(devId).length;
          return general >= 2 && random >= 1 && dev >= 3;
        }, { generalId: mobileGeneral, randomId: mobileRandom, devId: mobileDev }, { timeout: 60000 });

        const generalMsgs = await mobile.page.evaluate((chId: string) =>
          (window as any).__ctrl.messageStore.getMessages(chId).map((m: any) => String(m.content || '')),
          mobileGeneral,
        );
        const randomMsgs = await mobile.page.evaluate((chId: string) =>
          (window as any).__ctrl.messageStore.getMessages(chId).map((m: any) => String(m.content || '')),
          mobileRandom,
        );
        const devMsgs = await mobile.page.evaluate((chId: string) =>
          (window as any).__ctrl.messageStore.getMessages(chId).map((m: any) => String(m.content || '')),
          mobileDev,
        );

        expect(generalMsgs).toContain('gen-msg-1');
        expect(generalMsgs).toContain('gen-msg-2');
        expect(randomMsgs).toContain('random-msg-1');
        expect(devMsgs).toContain('dev-msg-1');
        expect(devMsgs).toContain('dev-msg-2');
        expect(devMsgs).toContain('dev-msg-3');
      } finally {
        await closeUser(mobile);
      }
    } finally {
      await closeUser(alice);
    }
  });
});
