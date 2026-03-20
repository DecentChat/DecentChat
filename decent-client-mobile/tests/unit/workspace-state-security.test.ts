import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { MobileController } from '../../src/app/MobileController';
import * as appState from '../../src/stores/appState';

function makeWorkspace(overrides: Partial<any> = {}): any {
  return {
    id: 'ws-1',
    name: 'Workspace',
    inviteCode: 'INV123',
    description: '',
    createdBy: 'peer-owner',
    createdAt: 1,
    permissions: { canCreateChannels: false },
    bans: [],
    members: [
      { peerId: 'me', alias: 'Me', publicKey: 'pk-me', role: 'member', joinedAt: 1, allowWorkspaceDMs: true },
      { peerId: 'peer-owner', alias: 'Owner', publicKey: 'pk-owner', role: 'owner', joinedAt: 1, allowWorkspaceDMs: true },
      { peerId: 'peer-target', alias: 'Target', publicKey: 'pk-target', role: 'member', joinedAt: 1, allowWorkspaceDMs: true },
    ],
    channels: [
      {
        id: 'ch-1',
        workspaceId: 'ws-1',
        name: 'general',
        type: 'channel',
        members: ['me', 'peer-owner', 'peer-target'],
        accessPolicy: { mode: 'public-workspace', workspaceId: 'ws-1' },
        createdBy: 'peer-owner',
        createdAt: 1,
      },
    ],
    ...overrides,
  };
}

function makeController(workspacesRef: { current: any[] }): any {
  const ctrl = Object.create(MobileController.prototype) as any;
  ctrl.connectedPeers = new Set<string>();
  ctrl.syncWorkspaceStores = mock(() => {});
  ctrl.syncChannelMessages = mock(() => {});
  ctrl.connectPeer = mock(() => {});
  ctrl.messageStore = {
    remapChannel: mock(() => {}),
  };
  ctrl.persistentStore = {
    saveWorkspace: mock(async () => {}),
    deleteWorkspace: mock(async () => {}),
    remapChannelMessages: mock(async () => {}),
  };
  ctrl.workspaceManager = {
    getAllWorkspaces: mock(() => workspacesRef.current),
    importWorkspace: mock((workspace: any) => {
      const idx = workspacesRef.current.findIndex((item) => item.id === workspace.id);
      if (idx >= 0) workspacesRef.current[idx] = workspace;
      else workspacesRef.current.push(workspace);
    }),
    removeWorkspace: mock((workspaceId: string) => {
      workspacesRef.current = workspacesRef.current.filter((item) => item.id !== workspaceId);
    }),
    isBanned: mock((workspaceId: string, peerId: string) => {
      const ws = workspacesRef.current.find((item) => item.id === workspaceId);
      return Boolean(ws?.bans?.some((ban: any) => ban.peerId === peerId));
    }),
  };
  return ctrl;
}

describe('MobileController workspace-state security', () => {
  beforeEach(() => {
    appState.myPeerId.set('me');
    appState.activeWorkspaceId.set('ws-1');
  });

  test('non-owner workspace-state cannot escalate member roles or overwrite permissions', async () => {
    const workspacesRef = {
      current: [
        makeWorkspace({
          members: [
            { peerId: 'me', alias: 'Me', publicKey: 'pk-me', role: 'member', joinedAt: 1, allowWorkspaceDMs: true },
            { peerId: 'peer-owner', alias: 'Owner', publicKey: 'pk-owner', role: 'owner', joinedAt: 1, allowWorkspaceDMs: true },
            { peerId: 'peer-rogue', alias: 'Rogue', publicKey: 'pk-rogue', role: 'member', joinedAt: 1, allowWorkspaceDMs: true },
            { peerId: 'peer-target', alias: 'Target', publicKey: 'pk-target', role: 'member', joinedAt: 1, allowWorkspaceDMs: true },
          ],
        })],
    };
    const ctrl = makeController(workspacesRef);

    await (MobileController.prototype as any).applyWorkspaceState.call(ctrl, 'peer-rogue', 'ws-1', {
      type: 'workspace-state',
      name: 'Workspace',
      channels: [{ id: 'ch-1', name: 'general', type: 'channel' }],
      members: [
        { peerId: 'peer-rogue', alias: 'Rogue', publicKey: 'pk-rogue', role: 'member' },
        { peerId: 'peer-target', alias: 'Target', publicKey: 'pk-target', role: 'admin' },
      ],
      permissions: { canCreateChannels: true },
    });

    const workspace = workspacesRef.current[0];
    expect(workspace.permissions.canCreateChannels).toBe(false);
    expect(workspace.members.find((member: any) => member.peerId === 'peer-target')?.role).toBe('member');
  });

  test('ignores workspace-state from non-member sender for an existing workspace', async () => {
    const workspacesRef = { current: [makeWorkspace()] };
    const ctrl = makeController(workspacesRef);

    await (MobileController.prototype as any).applyWorkspaceState.call(ctrl, 'peer-outsider', 'ws-1', {
      type: 'workspace-state',
      name: 'Compromised',
      channels: [
        { id: 'ch-evil', name: 'evil', type: 'channel' },
      ],
      members: [
        { peerId: 'peer-outsider', alias: 'Outsider', publicKey: 'pk-outsider', role: 'owner' },
      ],
      permissions: { canCreateChannels: true },
    });

    const workspace = workspacesRef.current[0];
    expect(workspace.name).toBe('Workspace');
    expect(workspace.channels.some((channel: any) => channel.id === 'ch-evil')).toBe(false);
  });

  test('owner workspace-state syncs channel members and access policy', async () => {
    const workspacesRef = { current: [makeWorkspace()] };
    const ctrl = makeController(workspacesRef);

    await (MobileController.prototype as any).applyWorkspaceState.call(ctrl, 'peer-owner', 'ws-1', {
      type: 'workspace-state',
      name: 'Workspace',
      channels: [
        {
          id: 'ch-1',
          name: 'general',
          type: 'channel',
          members: ['me', 'peer-owner'],
          accessPolicy: {
            mode: 'explicit',
            explicitMemberPeerIds: ['me', 'peer-owner'],
          },
        },
      ],
      members: [
        { peerId: 'peer-owner', alias: 'Owner', publicKey: 'pk-owner', role: 'owner' },
        { peerId: 'me', alias: 'Me', publicKey: 'pk-me', role: 'member', allowWorkspaceDMs: false },
      ],
    });

    const workspace = workspacesRef.current[0];
    const channel = workspace.channels[0];
    expect(channel.members).toEqual(['me', 'peer-owner']);
    expect(channel.accessPolicy).toEqual({
      mode: 'explicit',
      explicitMemberPeerIds: ['me', 'peer-owner'],
    });
    expect(workspace.members.find((member: any) => member.peerId === 'me')?.allowWorkspaceDMs).toBe(false);
  });
});
