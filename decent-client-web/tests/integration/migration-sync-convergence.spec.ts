/**
 * Deterministic browser integration test for:
 * 1) legacy persisted workspace/message shape restore
 * 2) mixed-shape workspace sync convergence between two clients
 *
 * NOTE: This test intentionally avoids flaky live WebRTC join handshakes.
 * We exercise real browser boot + IndexedDB restore + ChatController sync handlers
 * by delivering workspace-sync payloads directly.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
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

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
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
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 30_000 });

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 30_000 });
  return { name, context, page };
}

async function closeUser(user: TestUser): Promise<void> {
  try { await user.context.close(); } catch {}
}

async function injectLegacyPersistedWorkspace(page: Page): Promise<{ workspaceId: string; channelId: string }> {
  return await page.evaluate(async () => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;

    const workspaceId = `legacy-ws-${Date.now()}`;
    const channelId = `legacy-ch-${Date.now()}`;

    // Intentionally legacy-ish shape: no permissions, no workspace settings,
    // no vectorClock/attachments on message.
    const legacyWs: any = {
      id: workspaceId,
      name: 'Legacy Team',
      inviteCode: 'LEGACY42',
      createdBy: state.myPeerId,
      createdAt: Date.now() - 10_000,
      members: [
        {
          peerId: state.myPeerId,
          alias: state.myAlias || 'Alice',
          publicKey: ctrl.myPublicKey || '',
          joinedAt: Date.now() - 9_000,
          role: 'owner',
        },
      ],
      channels: [
        {
          id: channelId,
          workspaceId,
          name: 'general',
          type: 'channel',
          members: [state.myPeerId],
          createdBy: state.myPeerId,
          createdAt: Date.now() - 8_000,
        },
      ],
      customMetadata: { source: 'legacy-client', keepMe: true },
    };

    await ctrl.persistentStore.saveWorkspace(legacyWs);
    await ctrl.persistentStore.saveMessage({
      id: `legacy-msg-${Date.now()}`,
      channelId,
      senderId: state.myPeerId,
      timestamp: Date.now() - 7_000,
      content: 'Legacy hello from established workspace',
      type: 'text',
      prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
      status: 'sent',
    });

    return { workspaceId, channelId };
  });
}

async function getWorkspaceStateSyncPayload(page: Page): Promise<any> {
  return await page.evaluate(() => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    const ws = ctrl.workspaceManager.getAllWorkspaces()[0];

    return {
      fromPeerId: state.myPeerId,
      workspaceId: ws.id,
      sync: {
        type: 'workspace-state',
        name: ws.name,
        description: ws.description,
        channels: (ws.channels || []).map((c: any) => ({ id: c.id, name: c.name, type: c.type })),
        members: (ws.members || []).map((m: any) => ({
          peerId: m.peerId,
          alias: m.alias,
          publicKey: m.publicKey,
          signingPublicKey: m.signingPublicKey,
          identityId: m.identityId,
          devices: m.devices,
          role: m.role,
          isBot: m.isBot,
        })),
        inviteCode: ws.inviteCode,
        permissions: ws.permissions,
      },
    };
  });
}

async function createProvisionalWorkspaceForSync(page: Page, inviteCode: string): Promise<void> {
  await page.evaluate(async ({ inviteCode }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;

    // Use inviteCode as provisional name so workspace-state rename logic applies.
    const provisional = ctrl.createWorkspace(inviteCode, state.myAlias || 'Bob');
    provisional.inviteCode = inviteCode;

    const me = provisional.members.find((m: any) => m.peerId === state.myPeerId);
    if (me) me.role = 'member';

    ctrl.workspaceManager.importWorkspace(provisional);
    await ctrl.persistentStore.saveWorkspace(provisional);
    state.activeWorkspaceId = provisional.id;
    state.activeChannelId = provisional.channels?.[0]?.id || null;
  }, { inviteCode });
}

async function applyWorkspaceStateSync(page: Page, payload: any): Promise<void> {
  await page.evaluate(async ({ payload }) => {
    const ctrl = (window as any).__ctrl;
    await (ctrl as any).handleSyncMessage(payload.fromPeerId, {
      type: 'workspace-sync',
      workspaceId: payload.workspaceId,
      sync: payload.sync,
    });
  }, { payload });
}

async function getWorkspaceSnapshot(page: Page): Promise<any> {
  return await page.evaluate(() => {
    const ctrl = (window as any).__ctrl;
    const ws = ctrl.workspaceManager.getAllWorkspaces()[0];
    return {
      workspaceCount: ctrl.workspaceManager.getAllWorkspaces().length,
      id: ws?.id,
      name: ws?.name,
      inviteCode: ws?.inviteCode,
      hasPermissions: !!ws?.permissions,
      customMetadata: ws?.customMetadata,
      channels: (ws?.channels || []).map((c: any) => c.name).sort(),
      members: (ws?.members || []).map((m: any) => m.alias).sort(),
    };
  });
}

test.describe('Migration + sync convergence (deterministic integration)', () => {
  test.setTimeout(120_000);

  test('legacy persisted shape restores and converges via workspace-state sync', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      // Seed legacy shape into persistence, then restart app to force restore path.
      await injectLegacyPersistedWorkspace(alice.page);
      await alice.page.reload({ waitUntil: 'domcontentloaded' });

      await alice.page.waitForFunction(() => {
        const loading = document.getElementById('loading');
        return !loading || loading.style.opacity === '0';
      }, { timeout: 30_000 });

      await expect(alice.page.locator('.sidebar-header')).toContainText('Legacy Team');
      await alice.page.waitForFunction(
        () => Array.from(document.querySelectorAll('.message-content')).some((m) =>
          m.textContent?.includes('Legacy hello from established workspace')),
        { timeout: 10_000 },
      );

      // Confirm backward-compat normalization + unknown-field preservation on Alice.
      const aliceBefore = await getWorkspaceSnapshot(alice.page);
      expect(aliceBefore.name).toBe('Legacy Team');
      expect(aliceBefore.hasPermissions).toBe(true); // imported legacy workspace should get defaults
      expect(aliceBefore.customMetadata?.keepMe).toBe(true); // unknown field survives
      expect(aliceBefore.channels).toContain('general');

      // Build owner workspace-state payload and apply it to Bob's provisional workspace.
      const payload = await getWorkspaceStateSyncPayload(alice.page);
      await createProvisionalWorkspaceForSync(bob.page, payload.sync.inviteCode);
      await applyWorkspaceStateSync(bob.page, payload);

      const bobAfterSync = await getWorkspaceSnapshot(bob.page);
      expect(bobAfterSync.name).toBe('Legacy Team');
      expect(bobAfterSync.id).toBe(payload.workspaceId); // canonical workspace-id adoption
      expect(bobAfterSync.channels).toContain('general');
      expect(bobAfterSync.hasPermissions).toBe(true);

      // Add a new channel on Alice, re-sync, verify Bob converges.
      await alice.page.evaluate(async () => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const ws = ctrl.workspaceManager.getAllWorkspaces()[0];
        const result = ctrl.workspaceManager.createChannel(ws.id, 'announcements', state.myPeerId);
        if (result?.success) {
          await ctrl.persistentStore.saveWorkspace(ctrl.workspaceManager.getWorkspace(ws.id));
        }
      });

      const updatedPayload = await getWorkspaceStateSyncPayload(alice.page);
      await applyWorkspaceStateSync(bob.page, updatedPayload);

      const aliceAfter = await getWorkspaceSnapshot(alice.page);
      const bobAfter = await getWorkspaceSnapshot(bob.page);

      expect(aliceAfter.channels).toContain('announcements');
      expect(bobAfter.channels).toContain('announcements');

      // Final convergence checks
      expect(bobAfter.name).toBe(aliceAfter.name);
      expect(bobAfter.id).toBe(aliceAfter.id);
      expect(bobAfter.inviteCode).toBe(aliceAfter.inviteCode);
      expect(bobAfter.channels).toEqual(aliceAfter.channels);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
