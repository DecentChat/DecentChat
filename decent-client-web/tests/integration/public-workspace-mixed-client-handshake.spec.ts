import { test, expect, type Page } from '@playwright/test';
import { createUser, closeUser, startRelay, relay } from './helpers';

test.beforeAll(async () => {
  await startRelay();
});

test.afterAll(async () => {
  relay?.close();
});

async function waitForTransportReady(page: Page): Promise<string> {
  await page.waitForFunction(() => {
    const t = (window as any).__transport;
    return t && t.getMyPeerId && t.getMyPeerId();
  }, { timeout: 10_000 });

  return page.evaluate(() => (window as any).__transport.getMyPeerId());
}

async function waitForPeersReady(page1: Page, page2: Page, timeoutMs = 15_000): Promise<void> {
  const p1Id = await page1.evaluate(() => (window as any).__state?.myPeerId);
  const p2Id = await page2.evaluate(() => (window as any).__state?.myPeerId);

  await page1.waitForFunction(
    (targetId: string) => (window as any).__state?.readyPeers?.has(targetId),
    p2Id,
    { timeout: timeoutMs },
  );
  await page2.waitForFunction(
    (targetId: string) => (window as any).__state?.readyPeers?.has(targetId),
    p1Id,
    { timeout: timeoutMs },
  );
}

test.describe('public workspace mixed-client handshake regression', () => {
  test.setTimeout(60_000);

  test('shell bootstrap survives active-workspace mismatch at handshake time', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      const alicePeerId = await waitForTransportReady(alice.page);
      const bobPeerId = await waitForTransportReady(bob.page);

      const shared = await alice.page.evaluate(({ bobPeerId }) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const ws = ctrl.createWorkspace('Large Shared', 'Alice');
        ws.members.push({
          peerId: bobPeerId,
          alias: 'Bob',
          publicKey: '',
          joinedAt: Date.now(),
          role: 'member',
          allowWorkspaceDMs: true,
        });
        ws.shell = {
          id: ws.id,
          name: ws.name,
          createdBy: ws.createdBy,
          createdAt: ws.createdAt,
          version: 2,
          memberCount: 250,
          channelCount: ws.channels.length,
          capabilityFlags: ['large-workspace-v1'],
        };
        state.activeWorkspaceId = ws.id;
        state.activeChannelId = ws.channels[0].id;
        return { workspaceId: ws.id, inviteCode: ws.inviteCode };
      }, { bobPeerId });

      await bob.page.evaluate(({ workspaceId, inviteCode, alicePeerId }) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const ws = ctrl.workspaceManager.createWorkspace(
          'Large Shared',
          state.myPeerId,
          'Bob',
          ctrl.myPublicKey,
          { workspaceId, inviteCode },
        );
        ws.createdBy = alicePeerId;
        ws.members = [
          {
            peerId: alicePeerId,
            alias: 'Alice',
            publicKey: '',
            joinedAt: Date.now(),
            role: 'owner',
            allowWorkspaceDMs: true,
          },
          {
            peerId: state.myPeerId,
            alias: 'Bob',
            publicKey: ctrl.myPublicKey,
            joinedAt: Date.now(),
            role: 'member',
            allowWorkspaceDMs: true,
          },
        ];
        delete ws.shell;
        state.activeWorkspaceId = workspaceId;
        state.activeChannelId = ws.channels[0].id;
      }, { workspaceId: shared.workspaceId, inviteCode: shared.inviteCode, alicePeerId });

      await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const ws = ctrl.createWorkspace('Legacy Active', 'Alice');
        state.activeWorkspaceId = ws.id;
        state.activeChannelId = ws.channels[0].id;
      });

      await bob.page.evaluate(async ({ alicePeerId }) => {
        await (window as any).__transport.connect(alicePeerId);
      }, { alicePeerId });

      await waitForPeersReady(alice.page, bob.page);

      await expect.poll(async () => {
        return bob.page.evaluate(({ alicePeerId }) => Array.from((window as any).__ctrl.peerCapabilities.get(alicePeerId) || []), { alicePeerId });
      }).toContain('workspace-shell-v1');

      await expect.poll(async () => {
        return bob.page.evaluate(({ alicePeerId }) => Array.from((window as any).__ctrl.peerCapabilities.get(alicePeerId) || []), { alicePeerId });
      }).toContain('member-directory-v1');

      await bob.page.evaluate(({ alicePeerId, workspaceId }) => {
        (window as any).__ctrl.requestWorkspaceShell(alicePeerId, workspaceId);
      }, { alicePeerId, workspaceId: shared.workspaceId });

      await bob.page.waitForFunction(
        ({ workspaceId }) => {
          const ctrl = (window as any).__ctrl;
          const ws = ctrl.workspaceManager.getWorkspace(workspaceId);
          return ws?.shell?.capabilityFlags?.includes('large-workspace-v1') === true;
        },
        { workspaceId: shared.workspaceId },
        { timeout: 15_000 },
      );

      const shellFlags = await bob.page.evaluate(({ workspaceId }) => {
        const ctrl = (window as any).__ctrl;
        return ctrl.workspaceManager.getWorkspace(workspaceId)?.shell?.capabilityFlags || [];
      }, { workspaceId: shared.workspaceId });

      expect(shellFlags).toContain('large-workspace-v1');
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
