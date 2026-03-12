import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('workspace directory sync guards', () => {
  test('does not answer member-page requests from non-members', () => {
    const sendControlWithRetry = mock(() => {});
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1' ? {
        id: 'ws-1',
        members: [{ peerId: 'member-1' }],
      } : null,
      isBanned: () => false,
    };
    ctrl.publicWorkspaceController = {
      getSnapshot: () => ({ members: [{ peerId: 'member-1' }] }),
      buildPageFromWorkspace: () => ({ workspaceId: 'ws-1', pageSize: 100, members: [] }),
    };
    ctrl.sendControlWithRetry = sendControlWithRetry;

    ctrl.handleMemberPageRequest('outsider', { workspaceId: 'ws-1' });

    expect(sendControlWithRetry).toHaveBeenCalledTimes(0);
  });

  test('answers member-page requests from known members', () => {
    const sendControlWithRetry = mock(() => {});
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1' ? {
        id: 'ws-1',
        members: [{ peerId: 'member-1' }],
        shell: { capabilityFlags: ['large-workspace-v1'] },
      } : null,
      isBanned: () => false,
    };
    ctrl.publicWorkspaceController = {
      getSnapshot: () => ({ members: [{ peerId: 'member-1' }] }),
      buildPageFromWorkspace: () => ({ workspaceId: 'ws-1', pageSize: 100, members: [] }),
    };
    ctrl.sendControlWithRetry = sendControlWithRetry;

    ctrl.handleMemberPageRequest('member-1', { workspaceId: 'ws-1' });

    expect(sendControlWithRetry).toHaveBeenCalledTimes(1);
  });

  test('does not answer workspace-shell requests from non-members', () => {
    const sendControlWithRetry = mock(() => {});
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1' ? {
        id: 'ws-1',
        inviteCode: 'INVITE123',
        members: [{ peerId: 'member-1' }],
      } : null,
      isBanned: () => false,
    };
    ctrl.publicWorkspaceController = {
      getSnapshot: () => ({ members: [{ peerId: 'member-1' }] }),
    };
    ctrl.buildWorkspaceShell = () => ({ id: 'ws-1', name: 'Workspace', createdBy: 'owner', createdAt: 1, version: 1, memberCount: 1, channelCount: 1 });
    ctrl.sendControlWithRetry = sendControlWithRetry;

    ctrl.handleWorkspaceShellRequest('outsider', 'ws-1');

    expect(sendControlWithRetry).toHaveBeenCalledTimes(0);
  });
});
