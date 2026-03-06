/**
 * E2E: Workspace revocation UX (kick/ban)
 *
 * Red phase (Task 1): verify that when a member is removed,
 * they immediately lose workspace visibility and local data.
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
  getWorkspaceSnapshot,
} from './helpers';

test.beforeAll(async () => { await startRelay(); });

test.describe('Workspace revocation UX', () => {
  test.setTimeout(90000);

  test('kicked member should lose workspace visibility and local persisted data', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Kick UX WS', 'Alice');
      const invite = await getInviteUrl(alice.page);
      await joinViaInviteUrl(bob.page, invite, 'Bob');

      await waitForPeerConnection(alice.page, 2, 30000);
      await waitForPeerConnection(bob.page, 2, 30000);

      // Create visible content so we can verify purge expectations on Bob.
      await sendMessage(alice.page, 'kick-purge-marker');
      await waitForMessageInUI(bob.page, 'kick-purge-marker', 20000);

      const bobBefore = await bob.page.evaluate(async () => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return {
          myPeerId: s.myPeerId,
          wsId: ws?.id,
          channelIds: (ws?.channels || []).map((ch: any) => ch.id),
          wsName: ws?.name,
        };
      });

      expect(bobBefore.wsId).toBeTruthy();

      // Alice removes Bob
      const result = await alice.page.evaluate(async (targetPeerId: string) => {
        return (window as any).__ctrl.removeWorkspaceMember(targetPeerId);
      }, bobBefore.myPeerId);
      expect(result.success).toBe(true);

      // Alice side sanity: Bob removed from member list
      await alice.page.waitForFunction((removedId) => {
        const s = (window as any).__state;
        const c = (window as any).__ctrl;
        const ws = c.workspaceManager.getWorkspace(s.activeWorkspaceId);
        return ws && !ws.members.some((m: any) => m.peerId === removedId);
      }, bobBefore.myPeerId, { timeout: 15000 });

      // Bob should lose workspace completely (UI + persisted data)
      await bob.page.waitForFunction((removedWsId) => {
        const c = (window as any).__ctrl;
        const ids = c.workspaceManager.getAllWorkspaces().map((w: any) => w.id);
        return !ids.includes(removedWsId);
      }, bobBefore.wsId, { timeout: 15000 });
      const bobAfter = await getWorkspaceSnapshot(bob.page);

      expect(bobAfter.workspaceIds).not.toContain(bobBefore.wsId);
      expect(bobAfter.persistedWorkspaceIds).not.toContain(bobBefore.wsId);

      // Old channel data should be gone from persistence
      const remainingMsgCounts = await bob.page.evaluate(async (channelIds: string[]) => {
        const c = (window as any).__ctrl;
        const out: Record<string, number> = {};
        for (const channelId of channelIds) {
          const msgs = await c.persistentStore.getChannelMessages(channelId);
          out[channelId] = msgs.length;
        }
        return out;
      }, bobBefore.channelIds);

      for (const count of Object.values(remainingMsgCounts)) {
        expect(count).toBe(0);
      }
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
