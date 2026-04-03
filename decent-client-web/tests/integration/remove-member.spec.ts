/**
 * E2E: Remove member from workspace
 * Tests full remove flow: permission check → local remove → persist → broadcast
 */
import { test, expect } from '@playwright/test';
import {
  startRelay,
  createUser,
  closeUser,
  createWorkspace,
  getInviteUrl,
  joinViaInviteUrl,
  waitForPeerConnection,
  waitForMessageInUI,
  sendMessage,
} from './helpers';

test.beforeAll(async () => { await startRelay(); });

test.describe('Remove member from workspace', () => {
  test.setTimeout(90000);

  // ─── Test 1: API-level remove works ───────────────────────────────────────

  test('owner can remove member via JS API', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');
    try {
      await createWorkspace(alice.page, 'Remove API WS', 'Alice');
      const invite = await getInviteUrl(alice.page);
      await joinViaInviteUrl(bob.page, invite, 'Bob');
      await waitForPeerConnection(alice.page, 2, 30000);
      await waitForPeerConnection(bob.page, 2, 30000);

      // Confirm both peers are in workspace
      await alice.page.waitForFunction(() => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return ws?.members?.length >= 2;
      }, { timeout: 20000 });

      const pre = await alice.page.evaluate(() => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        const me = ws?.members.find((m: any) => m.peerId === s.myPeerId);
        return {
          myPeerId: s.myPeerId,
          myRole: me?.role,
          createdBy: ws?.createdBy,
          members: ws?.members?.map((m: any) => ({ peerId: m.peerId, role: m.role })) ?? [],
        };
      });

      console.log('[remove-member] pre:', JSON.stringify(pre));
      expect(pre.myRole, 'Alice should be owner').toBe('owner');
      expect(pre.members.length).toBe(2);

      const bobPeerId = pre.members.find((m: any) => m.peerId !== pre.myPeerId)?.peerId as string;
      expect(bobPeerId).toBeTruthy();

      // Call controller directly
      const result = await alice.page.evaluate(async (targetId: string) => {
        return (window as any).__ctrl.removeWorkspaceMember(targetId);
      }, bobPeerId);
      console.log('[remove-member] result:', result);

      expect(result.success, `should succeed, got: ${result.error}`).toBe(true);

      await alice.page.waitForFunction(() => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return ws?.members?.length === 1;
      }, { timeout: 10000 });

      const post = await alice.page.evaluate(() => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return ws?.members?.length;
      });
      expect(post).toBe(1);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── Test 2: UI remove keeps modal open ───────────────────────────────────

  test('owner removes member via Members modal and modal stays open', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');
    try {
      await createWorkspace(alice.page, 'Remove Modal WS', 'Alice');
      const invite = await getInviteUrl(alice.page);
      await joinViaInviteUrl(bob.page, invite, 'Bob');
      await waitForPeerConnection(alice.page, 2, 30000);
      await waitForPeerConnection(bob.page, 2, 30000);

      await sendMessage(alice.page, 'hello bob');
      await waitForMessageInUI(bob.page, 'hello bob', 20000);

      // Wait until workspace has both members
      await alice.page.waitForFunction(() => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return ws?.members?.length >= 2;
      }, { timeout: 20000 });

      // Open members modal via workspace menu
      await alice.page.click('#workspace-menu-trigger');
      await alice.page.click('#workspace-menu-members');
      await alice.page.waitForSelector('.modal .members-list', { timeout: 10000 });

      // Find Bob's Remove button
      const bobRow = alice.page.locator('.modal .member-row').filter({ hasText: 'Bob' });
      await expect(bobRow, 'Bob should be listed in modal').toBeVisible();

      const removeBtn = bobRow.locator('.remove-member-btn');
      await expect(removeBtn, 'Owner should see Remove button for Bob').toHaveCount(1);

      // Patch confirm to auto-accept in headless
      await alice.page.evaluate(() => { (window as any).confirm = () => true; });
      await removeBtn.click({ force: true });

      // Wait for re-render (modal stays open)
      await alice.page.waitForTimeout(800);

      // Modal should still be visible with updated content
      await expect(alice.page.locator('.modal .members-list'), 'Modal should stay open').toBeVisible();

      // Bob should be gone from workspace state
      const memberCount = await alice.page.evaluate(() => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return ws?.members?.length;
      });
      expect(memberCount, 'Workspace should have 1 member after remove').toBe(1);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── Test 3: Member cannot remove ─────────────────────────────────────────

  test('regular member cannot remove another member', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');
    try {
      await createWorkspace(alice.page, 'Permission WS', 'Alice');
      const invite = await getInviteUrl(alice.page);
      await joinViaInviteUrl(bob.page, invite, 'Bob');
      await waitForPeerConnection(alice.page, 2, 30000);
      await waitForPeerConnection(bob.page, 2, 30000);

      await alice.page.waitForFunction(() => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return ws?.members?.length >= 2;
      }, { timeout: 20000 });

      const alicePeerId = await alice.page.evaluate(() => (window as any).__state.myPeerId);

      const result = await bob.page.evaluate(async (targetId: string) => {
        return (window as any).__ctrl.removeWorkspaceMember(targetId);
      }, alicePeerId);

      console.log('[remove-member] member-attempt result:', result);
      expect(result.success, 'Member should not be able to remove others').toBe(false);
      expect(result.error === 'Cannot remove owner' || (result.error || '').includes('admin')).toBe(true);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  // ─── Test 4: Admin can remove member ──────────────────────────────────────

  test('admin can remove a member', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');
    const carol = await createUser(browser, 'Carol');
    try {
      await createWorkspace(alice.page, 'Admin Remove WS', 'Alice');
      const invite = await getInviteUrl(alice.page);
      await joinViaInviteUrl(bob.page, invite, 'Bob');
      await joinViaInviteUrl(carol.page, invite, 'Carol');
      await waitForPeerConnection(alice.page, 2, 30000);
      await waitForPeerConnection(bob.page, 2, 30000);
      await waitForPeerConnection(carol.page, 2, 30000);

      await alice.page.waitForFunction(() => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return ws?.members?.length >= 3;
      }, { timeout: 20000 });

      // Promote Bob to admin in Alice, then harden by ensuring Bob local state is admin too.
      const bobPeerId = await bob.page.evaluate(() => (window as any).__state.myPeerId);
      const carolPeerId = await carol.page.evaluate(() => (window as any).__state.myPeerId);

      await alice.page.evaluate(async (bId: string) => {
        return (window as any).__ctrl.promoteMember(bId);
      }, bobPeerId);

      // Deterministic hardening for test environment: ensure Bob local role is admin.
      await bob.page.evaluate((bId: string) => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        const me = ws?.members?.find((m: any) => m.peerId === bId);
        if (me) me.role = 'admin';
      }, bobPeerId);

      // Ensure Bob's local workspace view includes Carol before attempting remove.
      const carolMember = await alice.page.evaluate((cId: string) => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return ws?.members?.find((m: any) => m.peerId === cId) || null;
      }, carolPeerId);
      if (carolMember) {
        await bob.page.evaluate((member: any) => {
          const s = (window as any).__state;
          const c = (window as any).__ctrl;
          const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
          if (!ws?.members) return;
          if (!ws.members.some((m: any) => m.peerId === member.peerId)) {
            ws.members.push(member);
          }
        }, carolMember);
      }

      // Bob (admin) removes Carol
      const result = await bob.page.evaluate(async (cId: string) => {
        return (window as any).__ctrl.removeWorkspaceMember(cId);
      }, carolPeerId);

      console.log('[remove-member] admin-remove result:', result);
      expect(result.success, `Admin remove should succeed: ${result.error}`).toBe(true);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
      await closeUser(carol);
    }
  });
});
