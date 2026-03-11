import { describe, test, expect, mock } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';
import { TopologyTelemetry } from '../../src/app/topology/TopologyTelemetry';
import { TopologyAnomalyDetector } from '../../src/app/topology/TopologyAnomalyDetector';
import { TopologySimulator, type SimulatedPeer } from '../../src/app/topology/TopologySimulator';

function createController(): any {
  const ctrl = Object.create(ChatController.prototype) as any;
  ctrl.state = {
    myPeerId: 'me-peer',
    activeWorkspaceId: 'ws-sim',
    connectingPeers: new Set<string>(),
    readyPeers: new Set<string>(),
    connectedPeers: new Set<string>(),
  };
  ctrl.transport = {
    getConnectedPeers: () => [],
    getSignalingStatus: () => [{ connected: true }],
    isConnectingToPeer: () => false,
    connect: mock(async () => {}),
    disconnect: mock(() => {}),
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
  ctrl.topologyTelemetry = new TopologyTelemetry({ emitConsole: false, maxEvents: 50 });
  ctrl.topologyAnomalyDetector = new TopologyAnomalyDetector({ emitCooldownMs: 0 });
  ctrl.topologyDesiredSetByWorkspace = new Map<string, string[]>();
  ctrl.isPartialMeshEnabled = () => true;
  return ctrl;
}

function buildPeers(count: number, now: number): SimulatedPeer[] {
  return Array.from({ length: count }, (_, index) => ({
    peerId: `peer-${String(index + 1).padStart(5, '0')}`,
    role: index === 0 ? 'owner' : index === 1 ? 'admin' : 'member',
    joinedAt: now - ((index + 1) * 1000),
    sharedWorkspaceIds: index % 11 === 0 ? ['ws-shared'] : [],
    likelyOnline: index % 17 !== 0,
    connected: index < 6,
    ready: index < 6,
    connecting: false,
    disconnectCount: 0,
    lastSeenAt: now - ((index + 1) * 500),
    connectedAt: index < 6 ? now - (3 * 60 * 1000) : undefined,
    lastSyncAt: index < 6 ? now - 1_000 : undefined,
    lastExplorerAt: undefined,
  }));
}

describe('TopologySimulator', () => {
  test('stable 100-member room remains bounded and anomaly-quiet', () => {
    const now = Date.now();
    const ctrl = createController();
    const simulator = new TopologySimulator(ctrl, { anomalyDetector: new TopologyAnomalyDetector({ emitCooldownMs: 0 }) });
    const peers = buildPeers(100, now);

    const summary = simulator.runScenario({
      workspaceId: 'ws-sim',
      peers,
      ticks: 20,
      tickMs: 15_000,
      startTs: now,
      connectSuccessRate: 1,
      randomSeed: 42,
    });

    expect(summary.maxDesiredPeerCount).toBeLessThanOrEqual(ctrl.computeTargetPeerCount());
    expect(summary.timeBelowSafeMinimumMs).toBe(0);
    expect(summary.anomalyCounts['reconnect-storm'] ?? 0).toBe(0);
    expect(summary.anomalyCounts['desired-set-flapping'] ?? 0).toBe(0);
  });

  test('1000-member churn scenario stays bounded and recovers without storms', () => {
    const now = Date.now();
    const ctrl = createController();
    const simulator = new TopologySimulator(ctrl, { anomalyDetector: new TopologyAnomalyDetector({ emitCooldownMs: 0 }) });
    const peers = buildPeers(1000, now);

    const summary = simulator.runScenario({
      workspaceId: 'ws-sim',
      peers,
      ticks: 30,
      tickMs: 10_000,
      startTs: now,
      connectSuccessRate: 0.9,
      randomSeed: 123,
      mutateTick: ({ tick, peers }) => {
        if (tick % 5 === 0) {
          for (const peer of peers.slice(0, 4)) {
            peer.connected = false;
            peer.ready = false;
            peer.connecting = false;
            peer.disconnectCount += 1;
          }
        }
      },
    });

    expect(summary.maxDesiredPeerCount).toBeLessThanOrEqual(ctrl.computeTargetPeerCount());
    expect(summary.anomalyCounts['reconnect-storm'] ?? 0).toBe(0);
    expect(summary.tickSummaries.some((tick) => tick.connectedDesiredPeerCount >= 3)).toBe(true);
  });

  test('10000-member policy simulation stays bounded and within selection budget', () => {
    const now = Date.now();
    const ctrl = createController();
    const simulator = new TopologySimulator(ctrl, { anomalyDetector: new TopologyAnomalyDetector({ emitCooldownMs: 0 }) });
    const peers = buildPeers(10_000, now);

    const summary = simulator.runScenario({
      workspaceId: 'ws-sim',
      peers,
      ticks: 8,
      tickMs: 20_000,
      startTs: now,
      connectSuccessRate: 1,
      randomSeed: 999,
    });

    expect(summary.maxDesiredPeerCount).toBeLessThanOrEqual(ctrl.computeTargetPeerCount());
    expect(summary.maxSelectionDurationMs).toBeLessThan(250);
    expect(summary.overlapSelections).toBeGreaterThan(0);
  });

  test('overlap-heavy graph keeps selecting shared peers', () => {
    const now = Date.now();
    const ctrl = createController();
    const simulator = new TopologySimulator(ctrl, { anomalyDetector: new TopologyAnomalyDetector({ emitCooldownMs: 0 }) });
    const peers = buildPeers(300, now).map((peer, index) => ({
      ...peer,
      sharedWorkspaceIds: index < 40 ? ['ws-shared-a', 'ws-shared-b'] : peer.sharedWorkspaceIds,
    }));

    const summary = simulator.runScenario({
      workspaceId: 'ws-sim',
      peers,
      ticks: 12,
      tickMs: 15_000,
      startTs: now,
      connectSuccessRate: 1,
      randomSeed: 7,
    });

    expect(summary.overlapSelections).toBeGreaterThan(0);
  });

  test('stormy scenario trips reconnect-storm anomaly', () => {
    const now = Date.now();
    const ctrl = createController();
    const simulator = new TopologySimulator(ctrl, { anomalyDetector: new TopologyAnomalyDetector({ emitCooldownMs: 0 }) });
    const peers = buildPeers(200, now).map((peer, index) => ({
      ...peer,
      connected: index < 2,
      ready: index < 2,
      likelyOnline: true,
    }));

    const summary = simulator.runScenario({
      workspaceId: 'ws-sim',
      peers,
      ticks: 6,
      tickMs: 10_000,
      startTs: now,
      connectSuccessRate: 0,
      randomSeed: 5,
      mutateTick: ({ peers }) => {
        for (const peer of peers.slice(0, 30)) {
          peer.connected = false;
          peer.ready = false;
          peer.connecting = false;
        }
      },
    });

    expect(summary.anomalyCounts['reconnect-storm'] ?? 0).toBeGreaterThan(0);
  });
});
