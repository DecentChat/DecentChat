import { describe, test, expect, mock } from 'bun:test';
import { performance } from 'node:perf_hooks';
import { ChatController } from '../../src/app/ChatController';
import { TopologyTelemetry } from '../../src/app/topology/TopologyTelemetry';
import { TopologyAnomalyDetector } from '../../src/app/topology/TopologyAnomalyDetector';

function createController(overrides: Record<string, unknown> = {}): any {
  const ctrl = Object.create(ChatController.prototype) as any;
  ctrl.state = {
    myPeerId: 'me-peer',
    activeWorkspaceId: 'ws-stress',
    connectingPeers: new Set<string>(),
    readyPeers: new Set<string>(),
    connectedPeers: new Set<string>(),
  };
  ctrl.transport = {
    getConnectedPeers: () => [],
    isConnectingToPeer: () => false,
    connect: mock(async () => {}),
    disconnect: mock(() => {}),
    getSignalingStatus: () => [{ connected: true }],
  };
  ctrl.ui = { updateSidebar: () => {} };
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
  ctrl.topologyTelemetry = new TopologyTelemetry({ emitConsole: false, maxEvents: 20 });
  ctrl.topologyAnomalyDetector = new TopologyAnomalyDetector({ emitCooldownMs: 0 });
  ctrl.topologyDesiredSetByWorkspace = new Map<string, string[]>();
  Object.assign(ctrl, overrides);
  return ctrl;
}

function buildWorkspaceData(count: number, now: number) {
  const peers = Array.from({ length: count }, (_, index) => {
    const peerId = `peer-${String(index + 1).padStart(5, '0')}`;
    const isOverlap = index % 9 === 0;
    return {
      peerId,
      role: index === 0 ? 'owner' : index === 1 ? 'admin' : 'member',
      joinedAt: now - ((index + 1) * 1000),
      overlap: isOverlap,
      connected: index < 6,
      ready: index < 6,
      likelyOnline: index % 13 !== 0,
    };
  });

  const activeWorkspace = {
    id: 'ws-stress',
    members: [
      { peerId: 'me-peer', role: 'owner', joinedAt: now - 100_000 },
      ...peers.map((peer) => ({ peerId: peer.peerId, role: peer.role, joinedAt: peer.joinedAt })),
    ],
  };
  const overlapWorkspace = {
    id: 'ws-overlap',
    members: peers.filter((peer) => peer.overlap).map((peer) => ({ peerId: peer.peerId, role: 'member', joinedAt: peer.joinedAt })),
  };

  return { peers, activeWorkspace, overlapWorkspace };
}

describe('topology policy stress', () => {
  for (const [size, thresholdMs] of [[100, 25], [1000, 75], [10000, 500]] as const) {
    test(`selectDesiredPeers stays bounded and fast at ${size} members`, () => {
      const now = Date.now();
      const { peers, activeWorkspace, overlapWorkspace } = buildWorkspaceData(size, now);
      const connectedPeers = peers.filter((peer) => peer.connected).map((peer) => peer.peerId);
      const ctrl = createController({
        state: {
          myPeerId: 'me-peer',
          activeWorkspaceId: 'ws-stress',
          connectingPeers: new Set<string>(),
          readyPeers: new Set<string>(connectedPeers),
          connectedPeers: new Set<string>(connectedPeers),
        },
        transport: {
          getConnectedPeers: () => connectedPeers,
          isConnectingToPeer: () => false,
          connect: mock(async () => {}),
          disconnect: mock(() => {}),
          getSignalingStatus: () => [{ connected: true }],
        },
        workspaceManager: {
          getWorkspace: (id: string) => (id === 'ws-stress' ? activeWorkspace : (id === 'ws-overlap' ? overlapWorkspace : null)),
          getAllWorkspaces: () => [activeWorkspace, overlapWorkspace],
        },
      });

      for (const [index, peer] of peers.entries()) {
        ctrl.peerLastSeenAt.set(peer.peerId, now - ((index + 1) * 500));
        ctrl.peerDisconnectCount.set(peer.peerId, index % 17 === 0 ? 1 : 0);
        if (peer.connected) {
          ctrl.peerConnectedAt.set(peer.peerId, now - (3 * 60 * 1000));
          ctrl.peerLastSuccessfulSyncAt.set(peer.peerId, now - 2_000);
        }
      }

      const start = performance.now();
      const selection = ctrl.selectDesiredPeers('ws-stress', now, { emitTopologyEvents: false });
      const elapsedMs = performance.now() - start;

      expect(selection.desiredPeerIds.length).toBeLessThanOrEqual(ctrl.computeTargetPeerCount());
      expect(new Set(selection.desiredPeerIds).size).toBe(selection.desiredPeerIds.length);
      expect(elapsedMs).toBeLessThan(thresholdMs);
      expect(selection.desiredPeerIds.some((peerId: string) => overlapWorkspace.members.some((member: any) => member.peerId === peerId))).toBe(true);
    });
  }

  test('conservative prune avoids overlap peers under large candidate pressure', () => {
    const now = Date.now();
    const { peers, activeWorkspace, overlapWorkspace } = buildWorkspaceData(1000, now);
    const connectedPeers = peers.slice(0, 20).map((peer) => peer.peerId);
    const overlapProtectedPeer = peers.find((peer) => peer.overlap && !['owner', 'admin'].includes(peer.role))!;
    const ctrl = createController({
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-stress',
        connectingPeers: new Set<string>(),
        readyPeers: new Set<string>(connectedPeers),
        connectedPeers: new Set<string>(connectedPeers),
      },
      transport: {
        getConnectedPeers: () => connectedPeers,
        isConnectingToPeer: () => false,
        connect: mock(async () => {}),
        disconnect: mock(() => {}),
        getSignalingStatus: () => [{ connected: true }],
      },
      workspaceManager: {
        getWorkspace: (id: string) => (id === 'ws-stress' ? activeWorkspace : (id === 'ws-overlap' ? overlapWorkspace : null)),
        getAllWorkspaces: () => [activeWorkspace, overlapWorkspace],
      },
    });

    for (const peer of peers) {
      ctrl.peerLastSeenAt.set(peer.peerId, now - 1_000);
      ctrl.peerDisconnectCount.set(peer.peerId, 0);
      if (connectedPeers.includes(peer.peerId)) {
        ctrl.peerConnectedAt.set(peer.peerId, now - (5 * 60 * 1000));
        ctrl.peerLastSuccessfulSyncAt.set(peer.peerId, now - 1_000);
      }
    }

    const candidates = ctrl.getWorkspacePeerCandidates('ws-stress', now);
    const selection = ctrl.selectDesiredPeers('ws-stress', now, { emitTopologyEvents: false });
    const prune = ctrl.selectConservativePrunePeers(candidates, selection, new Set(connectedPeers), now);

    expect(prune.some((candidate: any) => candidate.peerId === overlapProtectedPeer.peerId)).toBe(false);
  });
});
