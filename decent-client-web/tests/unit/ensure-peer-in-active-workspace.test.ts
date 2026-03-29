import { describe, expect, test, mock } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('ChatController.ensurePeerInActiveWorkspace', () => {
  test('does not auto-add an arbitrary connected peer into the sole local workspace', () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    const persistWorkspace = mock(() => Promise.resolve());
    const updateSidebar = mock(() => {});

    const workspace = {
      id: 'ws-testspace',
      name: 'TestSpace',
      members: [
        { peerId: 'me-1', alias: 'Me', publicKey: 'pk-me', joinedAt: Date.now(), role: 'owner' },
      ],
    };

    ctrl.workspaceManager = {
      getAllWorkspaces: () => [workspace],
      isBanned: () => false,
      addMember: (_workspaceId: string, member: any) => {
        workspace.members.push(member);
      },
    };
    ctrl.state = {
      myPeerId: 'me-1',
    };
    ctrl.persistWorkspace = persistWorkspace;
    ctrl.ui = {
      updateSidebar,
    };

    ChatController.prototype['ensurePeerInActiveWorkspace'].call(ctrl, 'peer-xenaland', 'pk-peer');

    expect(workspace.members.map((member: any) => member.peerId)).toEqual(['me-1']);
    expect(persistWorkspace).not.toHaveBeenCalled();
    expect(updateSidebar).not.toHaveBeenCalled();
  });
});
