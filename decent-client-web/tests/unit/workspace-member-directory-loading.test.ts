import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('Workspace member directory loading', () => {
  test('loadMoreWorkspaceMemberDirectory waits for the next page to advance', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;

    ctrl.prefetchWorkspaceMemberDirectory = mock(async () => {
      setTimeout(() => {
        ctrl.getWorkspaceMemberDirectory = mock(() => ({
          members: [{ peerId: 'a', alias: 'Alice', role: 'member', isBot: false, isOnline: true, isYou: false, allowWorkspaceDMs: true }],
          loadedCount: 1,
          totalCount: 2,
          hasMore: true,
        }));
      }, 20);
    });

    ctrl.getWorkspaceMemberDirectory = mock(() => ({
      members: [],
      loadedCount: 0,
      totalCount: 2,
      hasMore: true,
    }));

    const result = await ChatController.prototype.loadMoreWorkspaceMemberDirectory.call(ctrl, 'ws-1');

    expect(ctrl.prefetchWorkspaceMemberDirectory).toHaveBeenCalledWith('ws-1');
    expect(result?.loadedCount).toBe(1);
    expect(result?.members.map((member: any) => member.peerId)).toEqual(['a']);
  });

  test('loadMoreWorkspaceMemberDirectory returns immediately when no more pages remain', async () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    const snapshot = {
      members: [{ peerId: 'a', alias: 'Alice', role: 'member', isBot: false, isOnline: true, isYou: false, allowWorkspaceDMs: true }],
      loadedCount: 1,
      totalCount: 1,
      hasMore: false,
    };

    ctrl.prefetchWorkspaceMemberDirectory = mock(async () => {});
    ctrl.getWorkspaceMemberDirectory = mock(() => snapshot);

    const result = await ChatController.prototype.loadMoreWorkspaceMemberDirectory.call(ctrl, 'ws-1');

    expect(ctrl.prefetchWorkspaceMemberDirectory).not.toHaveBeenCalled();
    expect(result).toBe(snapshot);
  });
});
