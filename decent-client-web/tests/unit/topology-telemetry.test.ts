import { describe, test, expect, mock } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';
import { TopologyTelemetry } from '../../src/app/topology/TopologyTelemetry';

function createController(overrides: Record<string, unknown> = {}): any {
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
    getSignalingStatus: () => [{ connected: true }],
    isConnectingToPeer: () => false,
    connect: mock(async () => {}),
    disconnect: mock(() => {}),
    send: mock(() => true),
    destroy: mock(() => {}),
  };
  ctrl.ui = { updateSidebar: () => {} };
  ctrl.workspaceManager = {
    getWorkspace: (_id: string) => null,
    getAllWorkspaces: () => [],
  };
  ctrl.messageProtocol = {
    createHandshake: mock(async () => ({ publicKey: 'pub', signedNonce: 'sig' })),
    clearSharedSecret: mock(() => {}),
    hasRatchetState: mock(() => false),
  };
  ctrl.peerLastSeenAt = new Map<string, number>();
  ctrl.peerLastConnectAttemptAt = new Map<string, number>();
  ctrl.peerLastSuccessfulSyncAt = new Map<string, number>();
  ctrl.peerConnectedAt = new Map<string, number>();
  ctrl.peerDisconnectCount = new Map<string, number>();
  ctrl.peerExplorerLastUsedAt = new Map<string, number>();
  ctrl.lastMessageSyncRequestAt = new Map<string, number>();
  ctrl.peerCapabilities = new Map<string, Set<string>>();
  ctrl.authenticatedPeers = new Set<string>();
  ctrl.pendingAuthChallenges = new Map<string, any>();
  ctrl.pendingNegentropyQueries = new Map<string, any>();
  ctrl.topologyTelemetry = new TopologyTelemetry({ emitConsole: false, maxEvents: 50 });
  ctrl.topologyDesiredSetByWorkspace = new Map<string, string[]>();
  ctrl.startedAt = Date.now() - (10 * 60 * 1000);
  ctrl.isPartialMeshEnabled = () => true;
  ctrl.requestTimestampMessageSync = mock(async () => {});
  ctrl.requestNegentropyMessageSync = mock(async () => {});
  ctrl.peerSupportsCapability = () => false;
  // Instance fields normally initialized by the constructor — required by
  // setupTransportHandlers (onDisconnect uses handshakeInFlight) and
  // requestMessageSync (checks messageSyncInFlight).
  ctrl.handshakeInFlight = new Set<string>();
  ctrl.messageSyncInFlight = new Map<string, Promise<void>>();
  ctrl.retryUnackedInFlight = new Map<string, Promise<void>>();
  ctrl._globalSyncLock = Promise.resolve();
  // Additional instance fields used by onDisconnect handler
  ctrl.pendingDeliveryRecoveryCooldowns = new Map<string, number>();
  ctrl.lastOfflineQueueFlushAt = new Map<string, number>();
  ctrl.pendingDeliveryWatchTimers = new Map<string, any>();
  ctrl.pendingCompanyTemplateInstallRequests = new Map<string, any>();
  ctrl.pendingCompanySimControlRequests = new Map<string, any>();
  // Per-peer in-flight guards cleaned by onDisconnect
  ctrl.offlineQueueFlushInFlight = new Map<string, Promise<void>>();
  ctrl.scheduledOfflineQueueFlushes = new Map<string, any>();
  ctrl.pendingPreKeyBundleFetches = new Map<string, any>();
  ctrl.pendingStreams = new Map<string, any>();
  ctrl.messageGuard = { rateLimiter: { removePeer: mock(() => {}) } };
  Object.assign(ctrl, overrides);
  return ctrl;
}

describe('TopologyTelemetry', () => {
  test('computes desired-set diff and caps ring buffer', () => {
    const telemetry = new TopologyTelemetry({ emitConsole: false, maxEvents: 2 });

    const event = telemetry.recordMaintenanceCycle({
      level: 'info',
      reason: 'maintenance:test',
      workspaceId: 'ws-1',
      activeWorkspace: true,
      partialMeshEnabled: true,
      candidatePeerCount: 5,
      desiredPeerIds: ['peer-b', 'peer-c'],
      previousDesiredPeerIds: ['peer-a', 'peer-b'],
      connectedPeerCount: 2,
      connectedDesiredPeerCount: 1,
      connectingDesiredPeerCount: 1,
      likelyPeerCount: 4,
      coldPeerCount: 1,
      anchorPeerIds: ['peer-b'],
      explorerPeerIds: ['peer-c'],
      reconnectAttemptsThisSweep: 1,
      pruneCountThisSweep: 0,
      safeMinimumRecovery: false,
      safeMinimumTarget: 3,
      overlapSelectedCount: 1,
      overlapDesiredPeerIds: ['peer-c'],
      selectionDurationMs: 7,
      maintenanceDurationMs: 11,
      desiredBudget: 2,
      hardCap: 12,
      targetDegree: 8,
    });

    expect(event.desiredAddedPeerIds).toEqual(['peer-c']);
    expect(event.desiredRemovedPeerIds).toEqual(['peer-a']);
    expect(event.desiredPeerCount).toBe(2);

    telemetry.recordPeerEvent({ level: 'info', workspaceId: 'ws-1', peerId: 'peer-b', event: 'connected' });
    telemetry.recordPeerEvent({ level: 'info', workspaceId: 'ws-1', peerId: 'peer-c', event: 'connect-attempt' });

    const recent = telemetry.getRecentEvents();
    expect(recent).toHaveLength(2);
    expect(recent[0].kind).toBe('topology.peer');
    expect((recent[1] as any).peerId).toBe('peer-c');
  });

  test('runPeerMaintenanceNow records maintenance summary and selection/connect events', () => {
    const now = Date.now();
    const connectedPeers = ['owner-peer', 'admin-peer'];
    const connect = mock(async () => {});
    const ctrl = createController({
      transport: {
        getConnectedPeers: () => connectedPeers,
        getSignalingStatus: () => [{ connected: true }],
        isConnectingToPeer: () => false,
        connect,
        disconnect: mock(() => {}),
        send: mock(() => true),
      },
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-1',
        connectingPeers: new Set<string>(),
        readyPeers: new Set<string>(connectedPeers),
        connectedPeers: new Set<string>(connectedPeers),
      },
      workspaceManager: {
        getWorkspace: (id: string) => ({
          id,
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'overlap-peer', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'member-a', role: 'member', joinedAt: now - 7_000 },
          ],
        }),
        getAllWorkspaces: () => [
          {
            id: 'ws-1',
            members: [
              { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
              { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
              { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
              { peerId: 'overlap-peer', role: 'member', joinedAt: now - 8_000 },
              { peerId: 'member-a', role: 'member', joinedAt: now - 7_000 },
            ],
          },
          {
            id: 'ws-2',
            members: [
              { peerId: 'overlap-peer', role: 'member', joinedAt: now - 30_000 },
            ],
          },
        ],
      },
      computeTargetPeerCount: () => 3,
      computeHardCap: () => 3,
      computeExplorerSlotCount: () => 1,
    });

    ['owner-peer', 'admin-peer', 'overlap-peer', 'member-a'].forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
    });
    ctrl.peerConnectedAt.set('owner-peer', now - (5 * 60 * 1000));
    ctrl.peerConnectedAt.set('admin-peer', now - (5 * 60 * 1000));

    const attempted = ctrl.runPeerMaintenanceNow('unit-test');
    // With computeTargetPeerCount=3 and 2 already connected (owner-peer, admin-peer),
    // only 1 more slot is available. overlap-peer is selected (multi-workspace overlap).
    expect(attempted).toBe(1);
    expect(connect).toHaveBeenCalledWith('overlap-peer');

    const snapshot = ctrl.getTopologyDebugSnapshot('ws-1');
    expect(snapshot.lastMaintenance?.workspaceId).toBe('ws-1');
    expect(snapshot.lastMaintenance?.desiredPeerCount).toBe(3);
    expect(snapshot.lastMaintenance?.connectedDesiredPeerCount).toBe(2);
    expect(snapshot.lastMaintenance?.connectingDesiredPeerCount).toBe(1);
    expect(snapshot.lastMaintenance?.safeMinimumRecovery).toBe(true);
    expect(snapshot.lastMaintenance?.overlapSelectedCount).toBe(1);
    expect(snapshot.lastMaintenance?.anchorPeerIds).toEqual(['owner-peer', 'admin-peer']);
    expect(snapshot.lastMaintenance?.desiredAddedPeerIds).toEqual(['owner-peer', 'admin-peer', 'overlap-peer']);

    const events = snapshot.recentEvents.filter((event: any) => event.kind === 'topology.peer');
    expect(events.some((event: any) => event.event === 'selected-anchor' && event.peerId === 'owner-peer')).toBe(true);
    expect(events.some((event: any) => event.event === 'selected-overlap' && event.peerId === 'overlap-peer')).toBe(true);
    expect(events.some((event: any) => event.event === 'connect-attempt' && event.peerId === 'overlap-peer')).toBe(true);
  });

  test('transport and sync emit connected/disconnected/sync events', async () => {
    const now = Date.now();
    const ctrl = createController({
      workspaceManager: {
        getWorkspace: (id: string) => ({
          id,
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'peer-1', role: 'member', joinedAt: now - 5_000 },
          ],
        }),
        getAllWorkspaces: () => [{
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'peer-1', role: 'member', joinedAt: now - 5_000 },
          ],
        }],
      },
    });

    ctrl.setupTransportHandlers();
    await ctrl.transport.onConnect('peer-1');
    ctrl.transport.onDisconnect('peer-1');

    await (ctrl as any).requestMessageSync('peer-1');
    ctrl.requestTimestampMessageSync = mock(async () => { throw new Error('boom'); });
    // Clear the throttle so the second sync actually runs the (now-throwing) mock
    ctrl.lastMessageSyncRequestAt.delete('peer-1');
    await expect((ctrl as any).requestMessageSync('peer-1')).rejects.toThrow('boom');

    const events = ctrl.getTopologyDebugSnapshot('ws-1').recentEvents.filter((event: any) => event.kind === 'topology.peer');
    expect(events.some((event: any) => event.event === 'connected' && event.peerId === 'peer-1')).toBe(true);
    expect(events.some((event: any) => event.event === 'disconnected' && event.peerId === 'peer-1')).toBe(true);
    expect(events.some((event: any) => event.event === 'sync-succeeded' && event.peerId === 'peer-1')).toBe(true);
    expect(events.some((event: any) => event.event === 'sync-failed' && event.peerId === 'peer-1')).toBe(true);
  });
});
