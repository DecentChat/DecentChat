import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function makeWorkspace(options: {
  capabilityFlags?: string[];
  memberCount?: number;
  peerIds?: string[];
}) {
  const peerIds = options.peerIds ?? ['me', 'peer-1'];
  return {
    id: 'ws-1',
    name: 'Workspace',
    inviteCode: 'invite',
    createdBy: 'me',
    createdAt: 1,
    members: peerIds.map((peerId, idx) => ({
      peerId,
      alias: peerId,
      publicKey: `pk-${peerId}`,
      joinedAt: idx + 1,
      role: peerId === 'me' ? 'owner' as const : 'member' as const,
      allowWorkspaceDMs: true,
    })),
    channels: [],
    shell: {
      id: 'ws-1',
      name: 'Workspace',
      createdBy: 'me',
      createdAt: 1,
      version: 2,
      memberCount: options.memberCount ?? peerIds.length,
      channelCount: 0,
      capabilityFlags: options.capabilityFlags,
    },
  };
}

describe('public-workspace mixed-client rollout guardrails', () => {
  test('shell bootstrap still queries shell-capable peers before local capability is hydrated', () => {
    const sendControlWithRetry = mock(() => true);
    const workspace = makeWorkspace({
      capabilityFlags: undefined,
      peerIds: ['me', 'shell-peer'],
    });
    delete (workspace as any).shell;

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      readyPeers: new Set(['shell-peer']),
      connectedPeers: new Set(['shell-peer']),
      connectingPeers: new Set<string>(),
    };
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1' ? workspace : null,
    };
    ctrl.peerCapabilities = new Map<string, Set<string>>([
      ['shell-peer', new Set(['workspace-shell-v1'])],
    ]);
    ctrl.sendControlWithRetry = sendControlWithRetry;

    ChatController.prototype.requestWorkspaceShell.call(ctrl, 'shell-peer', 'ws-1');

    expect(sendControlWithRetry).toHaveBeenCalledTimes(1);
    expect(sendControlWithRetry).toHaveBeenCalledWith(
      'shell-peer',
      expect.objectContaining({
        type: 'workspace-sync',
        workspaceId: 'ws-1',
        sync: expect.objectContaining({ type: 'workspace-shell-request' }),
      }),
      { label: 'workspace-sync' },
    );
  });

  test('shell/delta capable peers are used while legacy snapshot peers are ignored', () => {
    const sendControlWithRetry = mock(() => true);
    const workspace = makeWorkspace({
      capabilityFlags: ['large-workspace-v1'],
      peerIds: ['me', 'shell-peer', 'legacy-peer'],
    });

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      readyPeers: new Set(['shell-peer', 'legacy-peer']),
      connectedPeers: new Set(['shell-peer', 'legacy-peer']),
      connectingPeers: new Set<string>(),
    };
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1' ? workspace : null,
    };
    ctrl.peerCapabilities = new Map<string, Set<string>>([
      ['shell-peer', new Set(['workspace-shell-v1'])],
      ['legacy-peer', new Set()],
    ]);
    ctrl.sendControlWithRetry = sendControlWithRetry;

    ChatController.prototype.requestWorkspaceShell.call(ctrl, 'shell-peer', 'ws-1');
    ChatController.prototype.requestWorkspaceShell.call(ctrl, 'legacy-peer', 'ws-1');

    expect(sendControlWithRetry).toHaveBeenCalledTimes(1);
    expect(sendControlWithRetry).toHaveBeenCalledWith(
      'shell-peer',
      expect.objectContaining({
        type: 'workspace-sync',
        workspaceId: 'ws-1',
        sync: expect.objectContaining({ type: 'workspace-shell-request' }),
      }),
      { label: 'workspace-sync' },
    );
  });

  test('workspace capability bit gates workspace-scoped helper advertisement', () => {
    const workspace = makeWorkspace({ capabilityFlags: [] });
    workspace.peerCapabilities = {
      me: {
        directory: { shardPrefixes: ['aa'] },
        relay: { channels: ['general'] },
        archive: { retentionDays: 7 },
        presenceAggregator: true,
      },
    };

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = { myPeerId: 'me' };
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1' ? workspace : null,
    };

    const advertised = ChatController.prototype.getAdvertisedControlCapabilities.call(ctrl, 'ws-1');

    expect(advertised).toContain('negentropy-sync-v1');
    expect(advertised).toContain('workspace-shell-v1');
    expect(advertised).toContain('member-directory-v1');
    expect(advertised).not.toContain('directory-shard:aa');
    expect(advertised).not.toContain('relay-channel:general');
    expect(advertised).not.toContain('archive-history-v1');
    expect(advertised).not.toContain('presence-aggregator-v1');
  });

  test('safe downgrade hides paged directory load-more when only legacy peers are available', async () => {
    const sendControlWithRetry = mock(() => true);
    const beginPageRequest = mock(() => true);
    const endPageRequest = mock(() => {});

    const workspace = makeWorkspace({
      capabilityFlags: ['large-workspace-v1'],
      memberCount: 200,
      peerIds: ['me', 'legacy-peer'],
    });

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      activeWorkspaceId: 'ws-1',
      activeChannelId: null,
      readyPeers: new Set(['legacy-peer']),
      connectedPeers: new Set(['legacy-peer']),
      connectingPeers: new Set<string>(),
    };
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1' ? workspace : null,
      getMember: (_workspaceId: string, peerId: string) => workspace.members.find((member: any) => member.peerId === peerId) ?? null,
    };
    ctrl.peerCapabilities = new Map<string, Set<string>>([
      ['legacy-peer', new Set(['negentropy-sync-v1'])],
    ]);
    ctrl.publicWorkspaceController = {
      getSnapshot: mock(() => ({
        members: workspace.members.map((member: any) => ({
          peerId: member.peerId,
          alias: member.alias,
          role: member.role,
          joinedAt: member.joinedAt,
          allowWorkspaceDMs: member.allowWorkspaceDMs,
        })),
        loadedCount: workspace.members.length,
        totalCount: 200,
        hasMore: true,
        nextCursor: 'cursor-1',
      })),
      beginPageRequest,
      endPageRequest,
    };
    ctrl.presence = {};
    ctrl.sendControlWithRetry = sendControlWithRetry;

    await ChatController.prototype.prefetchWorkspaceMemberDirectory.call(ctrl, 'ws-1', 'legacy-peer');

    expect(sendControlWithRetry).toHaveBeenCalledTimes(0);
    expect(beginPageRequest).toHaveBeenCalledWith('ws-1', 'cursor-1');
    expect(endPageRequest).toHaveBeenCalledWith('ws-1', 'cursor-1');

    const directory = ChatController.prototype.getWorkspaceMemberDirectory.call(ctrl, 'ws-1');
    expect(directory.loadedCount).toBe(workspace.members.length);
    expect(directory.totalCount).toBe(workspace.members.length);
    expect(directory.hasMore).toBe(false);
  });

  test('legacy workspaces ignore member-page requests and stay on snapshot sync', () => {
    const sendControlWithRetry = mock(() => true);
    const buildPageFromWorkspace = mock(() => ({ workspaceId: 'ws-1', pageSize: 100, members: [] }));

    const workspace = makeWorkspace({
      capabilityFlags: [],
      peerIds: ['me', 'member-1'],
    });

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1' ? workspace : null,
      isBanned: () => false,
    };
    ctrl.publicWorkspaceController = {
      getSnapshot: () => ({ members: [{ peerId: 'member-1' }] }),
      buildPageFromWorkspace,
    };
    ctrl.sendControlWithRetry = sendControlWithRetry;

    ChatController.prototype.handleMemberPageRequest.call(ctrl, 'member-1', { workspaceId: 'ws-1' });

    expect(buildPageFromWorkspace).toHaveBeenCalledTimes(0);
    expect(sendControlWithRetry).toHaveBeenCalledTimes(0);
  });
});
