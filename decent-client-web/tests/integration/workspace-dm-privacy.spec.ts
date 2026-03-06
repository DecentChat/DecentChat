import { test, expect } from '@playwright/test';
import {
  startRelay,
  relay,
  createUser,
  closeUser,
  createWorkspace,
  getInviteUrl,
  joinViaInviteUrl,
  waitForPeerConnection,
} from './helpers';

test.beforeAll(async () => {
  await startRelay();
});

test.afterAll(async () => {
  relay?.close();
});

test.describe('Workspace DM privacy', () => {
  test.setTimeout(120000);

  test('joiner can disable workspace DMs at invite acceptance and sender is blocked', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Privacy WS', 'Alice');
      const invite = await getInviteUrl(alice.page);

      await joinViaInviteUrl(bob.page, invite, 'Bob', { allowWorkspaceDMs: false });
      await waitForPeerConnection(bob.page, 2, 30000);
      await waitForPeerConnection(alice.page, 2, 30000);

      // Bob's own member profile in this workspace should persist disabled workspace DMs
      const bobFlag = await bob.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const wsId = state?.activeWorkspaceId;
        if (!ctrl || !wsId) return null;
        const ws = ctrl.workspaceManager.getWorkspace(wsId);
        const me = ws?.members?.find((m: any) => m.peerId === state.myPeerId);
        return me?.allowWorkspaceDMs;
      });
      expect(bobFlag).toBe(false);

      const bobPeerId = await bob.page.evaluate(() => (window as any).__state?.myPeerId || '');

      // Alice should see Bob as DM-disallowed in workspace member list and be blocked on click.
      const bobRow = alice.page.locator('.member-row').filter({ hasText: 'Bob' }).first();
      await expect(bobRow).toBeVisible({ timeout: 10000 });
      await bobRow.click();

      await expect(alice.page.locator('.toast.error')).toContainText('disallows workspace DMs', { timeout: 5000 });

      // Ensure no direct conversation with Bob was created on Alice side from this click.
      const directConvs = await alice.page.evaluate(async () => {
        const ctrl = (window as any).__ctrl;
        const list = await ctrl.getDirectConversations();
        return list.map((c: any) => ({ id: c.id, peer: c.contactPeerId }));
      });
      expect(directConvs.some((c: any) => c.peer === bobPeerId)).toBe(false);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
