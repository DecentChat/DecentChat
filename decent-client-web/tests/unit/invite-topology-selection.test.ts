import { describe, test, expect, mock } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function createInviteController(overrides: Record<string, unknown> = {}): any {
  const ctrl = Object.create(ChatController.prototype) as any;
  ctrl.state = {
    myPeerId: 'me-peer',
    activeWorkspaceId: 'ws-1',
    connectingPeers: new Set<string>(),
    readyPeers: new Set<string>(),
    connectedPeers: new Set<string>(),
  };
  ctrl.transport = {
    getConnectedPeers: () => [],
    isConnectingToPeer: () => false,
    connect: mock(async () => {}),
    disconnect: mock(() => {}),
  };
  ctrl.workspaceManager = {
    getWorkspace: (_id: string) => null,
    getAllWorkspaces: () => [],
  };
  ctrl.peerLastSeenAt = new Map<string, number>();
  ctrl.peerLastConnectAttemptAt = new Map<string, number>();
  ctrl.peerLastSuccessfulSyncAt = new Map<string, number>();
  ctrl.peerConnectedAt = new Map<string, number>();
  ctrl.peerDisconnectCount = new Map<string, number>();
  ctrl.peerExplorerLastUsedAt = new Map<string, number>();
  ctrl.lastMessageSyncRequestAt = new Map<string, number>();
  ctrl.startedAt = Date.now() - (10 * 60 * 1000);
  Object.assign(ctrl, overrides);
  return ctrl;
}

describe('ChatController invite topology peer selection', () => {
  test('prefers desired healthy peers for invite fallbacks', () => {
    const now = Date.now();
    const wsMembers = [
      { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
      { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
      { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
      { peerId: 'member-a', role: 'member', joinedAt: now - 8_000 },
      { peerId: 'member-b', role: 'member', joinedAt: now - 7_000 },
      { peerId: 'member-c', role: 'member', joinedAt: now - 6_000 },
      { peerId: 'member-d', role: 'member', joinedAt: now - 5_000 },
    ];

    const ctrl = createInviteController({
      isPartialMeshEnabled: () => true,
      transport: {
        getConnectedPeers: () => ['owner-peer', 'admin-peer', 'member-a'],
        isConnectingToPeer: () => false,
        connect: mock(async () => {}),
        disconnect: mock(() => {}),
      },
      workspaceManager: {
        getWorkspace: (id: string) => (id === 'ws-1' ? { id, members: wsMembers } : null),
        getAllWorkspaces: () => [{ id: 'ws-1', members: wsMembers }],
      },
    });

    ['owner-peer', 'admin-peer', 'member-a', 'member-b', 'member-c', 'member-d'].forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
      ctrl.peerConnectedAt.set(peerId, now - (2 * 60 * 1000));
      ctrl.peerLastSuccessfulSyncAt.set(peerId, now - 2_000);
    });

    const peers = ctrl.getInviteAdditionalPeerIds('ws-1', 3, now);

    expect(peers.length).toBe(3);
    expect(peers[0]).toBe('owner-peer');
    expect(peers[1]).toBe('admin-peer');
    expect(peers).toContain('member-a');
  });

  test('invite additional peers list is capped at 3', () => {
    const now = Date.now();
    const peers = Array.from({ length: 10 }).map((_, i) => `peer-${i + 1}`);
    const wsMembers = [
      { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
      ...peers.map((peerId, i) => ({ peerId, role: i === 0 ? 'owner' : (i === 1 ? 'admin' : 'member'), joinedAt: now - ((i + 1) * 1000) })),
    ];

    const ctrl = createInviteController({
      isPartialMeshEnabled: () => true,
      transport: {
        getConnectedPeers: () => peers.slice(0, 5),
        isConnectingToPeer: () => false,
        connect: mock(async () => {}),
        disconnect: mock(() => {}),
      },
      workspaceManager: {
        getWorkspace: (id: string) => (id === 'ws-1' ? { id, members: wsMembers } : null),
        getAllWorkspaces: () => [{ id: 'ws-1', members: wsMembers }],
      },
    });

    peers.forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 500));
      ctrl.peerConnectedAt.set(peerId, now - (2 * 60 * 1000));
    });

    const selected = ctrl.getInviteAdditionalPeerIds('ws-1', 3, now);
    expect(selected).toHaveLength(3);
  });

  test('falls back to known members when desired topology list is unavailable', () => {
    const now = Date.now();
    const wsMembers = [
      { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
      { peerId: 'peer-a', role: 'member', joinedAt: now - 10_000 },
      { peerId: 'peer-b', role: 'member', joinedAt: now - 9_000 },
      { peerId: 'peer-c', role: 'member', joinedAt: now - 8_000 },
      { peerId: 'peer-d', role: 'member', joinedAt: now - 7_000 },
    ];

    const ctrl = createInviteController({
      isPartialMeshEnabled: () => true,
      workspaceManager: {
        getWorkspace: (id: string) => (id === 'ws-1' ? { id, members: wsMembers } : null),
        getAllWorkspaces: () => [{ id: 'ws-1', members: wsMembers }],
      },
      selectDesiredPeers: () => ({ anchors: [], core: [], explorers: [], desiredPeerIds: [], budget: 0 }),
    });

    const selected = ctrl.getInviteAdditionalPeerIds('ws-1', 3, now);
    expect(selected).toEqual(['peer-a', 'peer-b', 'peer-c']);
  });
});
