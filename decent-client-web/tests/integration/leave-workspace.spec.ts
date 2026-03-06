/**
 * E2E: Leave workspace + local data purge
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
  sendMessage,
  waitForMessageInUI,
} from './helpers';

test.beforeAll(async () => { await startRelay(); });

test.describe('Leave workspace', () => {
  test.setTimeout(120000);

  test('member can leave workspace and local workspace data is purged', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Leave WS', 'Alice');
      const invite = await getInviteUrl(alice.page);
      await joinViaInviteUrl(bob.page, invite, 'Bob');

      await waitForPeerConnection(alice.page, 2, 30000);
      await waitForPeerConnection(bob.page, 2, 30000);

      await sendMessage(alice.page, 'hello before leave');
      await waitForMessageInUI(bob.page, 'hello before leave', 20000);

      const bobBefore = await bob.page.evaluate(async () => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const wsId = state.activeWorkspaceId;
        const ws = ctrl.workspaceManager.getWorkspace(wsId);
        const channelIds = (ws?.channels || []).map((c: any) => c.id);
        const persisted = await ctrl.persistentStore.getAllWorkspaces();
        return {
          wsId,
          channelIds,
          memberCount: ws?.members?.length || 0,
          persistedHasWs: persisted.some((w: any) => w.id === wsId),
          workspaceCount: ctrl.workspaceManager.getAllWorkspaces().length,
        };
      });

      expect(bobBefore.memberCount).toBeGreaterThanOrEqual(2);
      expect(bobBefore.persistedHasWs).toBe(true);
      expect(bobBefore.workspaceCount).toBe(1);

      const leaveResult = await bob.page.evaluate(async (wsId: string) => {
        const ctrl = (window as any).__ctrl;
        return await ctrl.leaveWorkspace(wsId);
      }, bobBefore.wsId);

      expect(leaveResult.success, `leave failed: ${leaveResult.error || 'unknown'}`).toBe(true);

      const bobAfter = await bob.page.evaluate(async ({ wsId, channelIds }: { wsId: string; channelIds: string[] }) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;

        const inMemoryWs = ctrl.workspaceManager.getWorkspace(wsId);
        const allPersistedWs = await ctrl.persistentStore.getAllWorkspaces();

        const messageCounts: Record<string, number> = {};
        for (const channelId of channelIds) {
          const msgs = await ctrl.persistentStore.getChannelMessages(channelId);
          messageCounts[channelId] = msgs.length;
        }

        return {
          inMemoryWorkspaceExists: !!inMemoryWs,
          persistedWorkspaceExists: allPersistedWs.some((w: any) => w.id === wsId),
          totalWorkspacesInMemory: ctrl.workspaceManager.getAllWorkspaces().length,
          activeWorkspaceId: state.activeWorkspaceId,
          activeChannelId: state.activeChannelId,
          messageCounts,
        };
      }, { wsId: bobBefore.wsId, channelIds: bobBefore.channelIds });

      expect(bobAfter.inMemoryWorkspaceExists).toBe(false);
      expect(bobAfter.persistedWorkspaceExists).toBe(false);
      expect(bobAfter.totalWorkspacesInMemory).toBe(0);
      expect(bobAfter.activeWorkspaceId).toBeNull();
      expect(bobAfter.activeChannelId).toBeNull();

      for (const count of Object.values(bobAfter.messageCounts)) {
        expect(count).toBe(0);
      }

      const aliceMembers = await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
        return (ws?.members || []).map((m: any) => m.alias);
      });

      expect(aliceMembers).toContain('Alice');
      expect(aliceMembers).not.toContain('Bob');

    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  test('when member is removed by owner, removed member local workspace data is purged', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Remove Purge WS', 'Alice');
      const invite = await getInviteUrl(alice.page);
      await joinViaInviteUrl(bob.page, invite, 'Bob');

      await waitForPeerConnection(alice.page, 2, 30000);
      await waitForPeerConnection(bob.page, 2, 30000);

      await sendMessage(alice.page, 'hello before remove');
      await waitForMessageInUI(bob.page, 'hello before remove', 20000);

      const bobBefore = await bob.page.evaluate(async () => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const wsId = state.activeWorkspaceId;
        const ws = ctrl.workspaceManager.getWorkspace(wsId);
        const channelIds = (ws?.channels || []).map((c: any) => c.id);
        return { wsId, channelIds };
      });

      const bobPeerId = await bob.page.evaluate(() => (window as any).__state.myPeerId);
      const removeResult = await alice.page.evaluate(async (targetId: string) => {
        const ctrl = (window as any).__ctrl;
        return await ctrl.removeWorkspaceMember(targetId);
      }, bobPeerId);

      expect(removeResult.success, `remove failed: ${removeResult.error || 'unknown'}`).toBe(true);

      await bob.page.waitForTimeout(1500);

      const bobAfter = await bob.page.evaluate(async ({ wsId, channelIds }: { wsId: string; channelIds: string[] }) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;

        const inMemoryWs = ctrl.workspaceManager.getWorkspace(wsId);
        const allPersistedWs = await ctrl.persistentStore.getAllWorkspaces();

        const messageCounts: Record<string, number> = {};
        for (const channelId of channelIds) {
          const msgs = await ctrl.persistentStore.getChannelMessages(channelId);
          messageCounts[channelId] = msgs.length;
        }

        return {
          inMemoryWorkspaceExists: !!inMemoryWs,
          persistedWorkspaceExists: allPersistedWs.some((w: any) => w.id === wsId),
          totalWorkspacesInMemory: ctrl.workspaceManager.getAllWorkspaces().length,
          activeWorkspaceId: state.activeWorkspaceId,
          activeChannelId: state.activeChannelId,
          messageCounts,
        };
      }, { wsId: bobBefore.wsId, channelIds: bobBefore.channelIds });

      expect(bobAfter.inMemoryWorkspaceExists).toBe(false);
      expect(bobAfter.persistedWorkspaceExists).toBe(false);
      expect(bobAfter.totalWorkspacesInMemory).toBe(0);
      expect(bobAfter.activeWorkspaceId).toBeNull();
      expect(bobAfter.activeChannelId).toBeNull();

      for (const count of Object.values(bobAfter.messageCounts)) {
        expect(count).toBe(0);
      }

    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
