import { describe, expect, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('company-sim directory consumption', () => {
  test('getWorkspaceMemberDirectory preserves companySim profile metadata', () => {
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.publicWorkspaceController = {
      getSnapshot: () => ({
        members: [{
          peerId: 'backend-peer',
          alias: 'Rian Backend',
          role: 'member',
          identityId: 'backend-identity',
          isBot: true,
          allowWorkspaceDMs: true,
          companySim: {
            automationKind: 'openclaw-agent',
            roleTitle: 'Backend Engineer',
            teamId: 'engineering',
            managerPeerId: 'manager-peer',
            avatarUrl: 'https://example.com/backend.png',
          },
        }],
        loadedCount: 1,
        totalCount: 1,
        hasMore: false,
      }),
    };
    ctrl.workspaceManager = {
      getWorkspace: () => ({ id: 'ws-1' }),
      getMember: () => ({
        peerId: 'backend-peer',
        alias: 'Rian Backend',
        role: 'member',
        companySim: {
          automationKind: 'openclaw-agent',
          roleTitle: 'Backend Engineer',
          teamId: 'engineering',
          managerPeerId: 'manager-peer',
          avatarUrl: 'https://example.com/backend.png',
        },
      }),
    };
    ctrl.workspaceHasLargeWorkspaceCapability = () => false;
    ctrl.selectWorkspaceSyncTargetPeers = () => [];
    ctrl.presence = {
      getPresenceAggregate: () => undefined,
      getPeerPresence: () => ({ online: true }),
    };
    ctrl.deviceRegistry = { getAllPeerIds: () => [] };
    ctrl.state = {
      myPeerId: 'my-peer',
      readyPeers: new Set(['backend-peer']),
      activeWorkspaceId: 'ws-1',
      activeChannelId: 'engineering-channel',
    };
    ctrl.myIdentityId = null;
    ctrl.myPublicKey = null;
    ctrl.getMyAliasForWorkspace = () => 'Me';

    const result = ChatController.prototype.getWorkspaceMemberDirectory.call(ctrl, 'ws-1');
    const backend = result.members.find((member: any) => member.peerId === 'backend-peer');
    expect(backend).toBeDefined();
    expect(backend?.companySim).toEqual({
      automationKind: 'openclaw-agent',
      roleTitle: 'Backend Engineer',
      teamId: 'engineering',
      managerPeerId: 'manager-peer',
      avatarUrl: 'https://example.com/backend.png',
    });
    expect(backend?.isBot).toBe(true);
  });
});
