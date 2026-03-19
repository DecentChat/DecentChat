import { describe, expect, test, mock } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('ChatController.sendWorkspaceState forceInclude workspace selection', () => {
  test('falls back to active workspace when peer is not yet in any member list', () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    const sendControlWithRetry = mock(() => {});

    const workspace = {
      id: 'ws-active',
      name: 'Team HQ',
      description: '',
      inviteCode: 'INV123',
      permissions: {},
      bans: [],
      channels: [{ id: 'ch-1', name: 'general', type: 'channel', members: [] }],
      members: [{ peerId: 'me-1', alias: 'Me', publicKey: 'pk-me', role: 'owner' }],
    };

    ctrl.workspaceManager = {
      getWorkspace: (id: string) => (id === workspace.id ? workspace : undefined),
      getAllWorkspaces: () => [workspace],
      isBanned: () => false,
    };
    ctrl.state = {
      myPeerId: 'me-1',
      activeWorkspaceId: workspace.id,
    };
    ctrl.sendControlWithRetry = sendControlWithRetry;

    ChatController.prototype['sendWorkspaceState'].call(ctrl, 'peer-new', undefined, { forceInclude: true });

    expect(sendControlWithRetry).toHaveBeenCalledTimes(1);
    const payload = sendControlWithRetry.mock.calls[0]?.[1];
    expect(payload.workspaceId).toBe('ws-active');
    expect(payload.sync?.type).toBe('workspace-state');
  });
});
