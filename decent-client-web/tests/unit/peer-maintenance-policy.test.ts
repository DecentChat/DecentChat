import { describe, test, expect, mock } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function createPolicyController(overrides: Record<string, unknown> = {}): any {
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
  ctrl.ui = { updateSidebar: () => {} };
  ctrl.workspaceManager = {
    getWorkspace: (id: string) => {
      const workspaces = ctrl.workspaceManager.getAllWorkspaces();
      return workspaces.find((ws: any) => ws.id === id) ?? null;
    },
    getAllWorkspaces: () => [],
  };
  ctrl.peerCapabilities = new Map<string, Set<string>>();
  ctrl.peerLastSeenAt = new Map<string, number>();
  ctrl.peerLastConnectAttemptAt = new Map<string, number>();
  ctrl.peerLastSuccessfulSyncAt = new Map<string, number>();
  ctrl.peerConnectedAt = new Map<string, number>();
  ctrl.peerDisconnectCount = new Map<string, number>();
  ctrl.peerExplorerLastUsedAt = new Map<string, number>();
  ctrl.peerConnectFailureCount = new Map<string, number>();
  ctrl.peerConnectRetryAfterAt = new Map<string, number>();
  ctrl.peerLastConnectFailureAt = new Map<string, number>();
  ctrl.lastMessageSyncRequestAt = new Map<string, number>();
  ctrl.startedAt = Date.now() - (10 * 60 * 1000);
  ctrl.requestMessageSync = mock(async () => {});
  ctrl.isPartialMeshEnabled = () => false;
  // Instance fields normally initialized by the constructor — required by
  // _runPeerMaintenance which calls requestMessageSync (checks messageSyncInFlight).
  ctrl.messageSyncInFlight = new Map<string, Promise<void>>();
  Object.assign(ctrl, overrides);
  return ctrl;
}

describe('ChatController peer maintenance policy helpers', () => {
  test('isPartialMeshEnabled respects localStorage override before default', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => key === 'decentchat.partialMesh.enabled' ? 'true' : null,
      },
    });

    const ctrl = createPolicyController();
    ctrl.isPartialMeshEnabled = ChatController.prototype.isPartialMeshEnabled;
    expect(ctrl.isPartialMeshEnabled()).toBe(true);

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => key === 'decentchat.partialMesh.enabled' ? 'false' : null,
      },
    });
    expect(ctrl.isPartialMeshEnabled()).toBe(false);

    if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    else delete (globalThis as any).localStorage;
  });

  test('isPartialMeshEnabled defaults to enabled when no override is set', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const originalWindow = (globalThis as any).window;

    try {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
      } else {
        delete (globalThis as any).localStorage;
      }
      (globalThis as any).window = undefined;

      const ctrl = createPolicyController();
      ctrl.isPartialMeshEnabled = ChatController.prototype.isPartialMeshEnabled;
      expect(ctrl.isPartialMeshEnabled()).toBe(true);
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
      else delete (globalThis as any).localStorage;
      (globalThis as any).window = originalWindow;
    }
  });

  test('compute target, hard cap, explorer slots and desired budget by device class', () => {
    const ctrl = createPolicyController();

    expect(ctrl.computeTargetPeerCount({ isMobile: false })).toBe(8);
    expect(ctrl.computeTargetPeerCount({ isMobile: true })).toBe(5);
    expect(ctrl.computeHardCap({ isMobile: false })).toBe(12);
    expect(ctrl.computeHardCap({ isMobile: true })).toBe(8);
    expect(ctrl.computeExplorerSlotCount({ isMobile: false })).toBe(2);
    expect(ctrl.computeExplorerSlotCount({ isMobile: true })).toBe(1);

    expect(ctrl.computeDesiredPeerBudget(3, { isMobile: false })).toBe(3);
    expect(ctrl.computeDesiredPeerBudget(20, { isMobile: false })).toBe(8);
    expect(ctrl.computeDesiredPeerBudget(20, { isMobile: true })).toBe(5);
  });

  test('getWorkspacePeerCandidates excludes self and tracks overlap across workspaces', () => {
    const now = Date.now();
    const ctrl = createPolicyController({
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-1',
        connectingPeers: new Set<string>(['peer-b']),
        readyPeers: new Set<string>(['peer-a']),
        connectedPeers: new Set<string>(['peer-a']),
      },
      transport: {
        getConnectedPeers: () => ['peer-a'],
        isConnectingToPeer: () => false,
        connect: mock(async () => {}),
      },
      workspaceManager: {
        getWorkspace: (id: string) => {
          const workspaces = [
            {
              id: 'ws-1',
              members: [
                { peerId: 'me-peer', role: 'owner', joinedAt: now - 1000 },
                { peerId: 'peer-a', role: 'admin', joinedAt: now - 2000 },
                { peerId: 'peer-b', role: 'member', joinedAt: now - 3000 },
              ],
            },
            {
              id: 'ws-2',
              members: [
                { peerId: 'peer-a', role: 'member', joinedAt: now - 4000 },
                { peerId: 'peer-c', role: 'member', joinedAt: now - 5000 },
              ],
            },
          ];
          return workspaces.find((ws) => ws.id === id) ?? null;
        },
        getAllWorkspaces: () => [
          {
            id: 'ws-1',
            members: [
              { peerId: 'me-peer', role: 'owner', joinedAt: now - 1000 },
              { peerId: 'peer-a', role: 'admin', joinedAt: now - 2000 },
              { peerId: 'peer-b', role: 'member', joinedAt: now - 3000 },
            ],
          },
          {
            id: 'ws-2',
            members: [
              { peerId: 'peer-a', role: 'member', joinedAt: now - 4000 },
              { peerId: 'peer-c', role: 'member', joinedAt: now - 5000 },
            ],
          },
        ],
      },
    });

    ctrl.peerLastSeenAt.set('peer-a', now - 1_000);
    ctrl.peerLastSeenAt.set('peer-b', now - 2_000);

    const candidates = ctrl.getWorkspacePeerCandidates('ws-1', now);
    expect(candidates.map((c: any) => c.peerId)).toEqual(['peer-a', 'peer-b']);

    const peerA = candidates.find((c: any) => c.peerId === 'peer-a');
    const peerB = candidates.find((c: any) => c.peerId === 'peer-b');

    expect(peerA.connected).toBe(true);
    expect(peerA.ready).toBe(true);
    expect(peerA.sharedWorkspaceCount).toBe(2);

    expect(peerB.connected).toBe(false);
    expect(peerB.connecting).toBe(true);
    expect(peerB.sharedWorkspaceCount).toBe(1);
  });

  test('scoreWorkspacePeer prefers healthy, stable, overlapping peers over cold flappy peers', () => {
    const now = Date.now();
    const ctrl = createPolicyController();

    const strong = {
      peerId: 'peer-strong',
      role: 'admin',
      joinedAt: now - 10_000,
      connected: true,
      connecting: false,
      ready: true,
      likelyOnline: true,
      recentlySeenAt: now - 60_000,
      sharedWorkspaceCount: 2,
      connectedAt: now - (2 * 60 * 1000),
      lastSyncAt: now - 60_000,
      disconnectCount: 0,
      lastExplorerAt: undefined,
    };

    const weak = {
      peerId: 'peer-weak',
      role: 'member',
      joinedAt: now - 10_000,
      connected: false,
      connecting: false,
      ready: false,
      likelyOnline: false,
      recentlySeenAt: now - (7 * 60 * 60 * 1000),
      sharedWorkspaceCount: 1,
      connectedAt: undefined,
      lastSyncAt: undefined,
      disconnectCount: 3,
      lastExplorerAt: undefined,
    };

    expect(ctrl.scoreWorkspacePeer(strong, now)).toBeGreaterThan(ctrl.scoreWorkspacePeer(weak, now));
  });

  test('capability helpers parse handshake capabilities and advertise local peer capabilities', () => {
    const ctrl = createPolicyController({
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-1',
        connectingPeers: new Set<string>(),
        readyPeers: new Set<string>(),
        connectedPeers: new Set<string>(),
      },
      workspaceManager: {
        getWorkspace: (id: string) => id === 'ws-1' ? {
          id,
          shell: { capabilityFlags: ['large-workspace-v1'] },
          peerCapabilities: {
            'me-peer': {
              directory: { shardPrefixes: ['aa', 'bb'] },
              relay: { channels: ['general'] },
              archive: { retentionDays: 30 },
              presenceAggregator: true,
            },
          },
        } : null,
        getAllWorkspaces: () => [],
      },
    });

    ctrl.peerCapabilities.set('peer-helper', new Set([
      'negentropy-sync-v1',
      'directory-shard:aa',
      'directory-shard:bb',
      'relay-channel:general',
      'archive-history-v1',
      'presence-aggregator-v1',
    ]));

    const parsed = ctrl.getPeerCapabilitySummary('peer-helper');
    expect(parsed.directoryShardPrefixes).toEqual(['aa', 'bb']);
    expect(parsed.relayChannels).toEqual(['general']);
    expect(parsed.archiveCapable).toBe(true);
    expect(parsed.presenceAggregator).toBe(true);

    const advertised = ctrl.getAdvertisedControlCapabilities('ws-1');
    expect(advertised).toContain('negentropy-sync-v1');
    expect(advertised).toContain('directory-shard:aa');
    expect(advertised).toContain('directory-shard:bb');
    expect(advertised).toContain('relay-channel:general');
    expect(advertised).toContain('archive-history-v1');
    expect(advertised).toContain('presence-aggregator-v1');
  });

  test('scoreWorkspacePeer prefers helper-capable peers when health is otherwise equal', () => {
    const now = Date.now();
    const ctrl = createPolicyController();

    const base = {
      role: 'member',
      joinedAt: now - 10_000,
      connected: true,
      connecting: false,
      ready: true,
      likelyOnline: true,
      recentlySeenAt: now - 60_000,
      sharedWorkspaceCount: 1,
      connectedAt: now - (2 * 60 * 1000),
      lastSyncAt: now - 60_000,
      disconnectCount: 0,
      lastExplorerAt: undefined,
    };

    const helper = {
      peerId: 'peer-helper',
      ...base,
      directoryShardPrefixes: ['aa', 'bb'],
      relayChannels: ['general'],
      archiveCapable: true,
      presenceAggregator: true,
    };

    const plain = {
      peerId: 'peer-plain',
      ...base,
      directoryShardPrefixes: [],
      relayChannels: [],
      archiveCapable: false,
      presenceAggregator: false,
    };

    expect(ctrl.scoreWorkspacePeer(helper, now)).toBeGreaterThan(ctrl.scoreWorkspacePeer(plain, now));
  });

  test('pickAnchorPeers prefers owner/admin anchors and selectDesiredPeers keeps explorers unique', () => {
    const now = Date.now();
    const ctrl = createPolicyController({
      workspaceManager: {
        getWorkspace: (id: string) => ({
          id,
          members: [
            { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'member-a', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'member-b', role: 'member', joinedAt: now - 7_000 },
            { peerId: 'member-c', role: 'member', joinedAt: now - 6_000 },
            { peerId: 'member-d', role: 'member', joinedAt: now - 5_000 },
          ],
        }),
        getAllWorkspaces: () => [{
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'member-a', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'member-b', role: 'member', joinedAt: now - 7_000 },
            { peerId: 'member-c', role: 'member', joinedAt: now - 6_000 },
            { peerId: 'member-d', role: 'member', joinedAt: now - 5_000 },
          ],
        }],
      },
    });

    ['owner-peer', 'admin-peer', 'member-a', 'member-b', 'member-c', 'member-d'].forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
    });
    ctrl.peerExplorerLastUsedAt.set('member-a', now - 1000);
    ctrl.peerExplorerLastUsedAt.set('member-b', now - (10 * 60 * 1000));
    ctrl.peerExplorerLastUsedAt.set('member-c', now - (20 * 60 * 1000));

    const candidates = ctrl.getWorkspacePeerCandidates('ws-1', now);
    const anchors = ctrl.pickAnchorPeers(candidates, 2, now);
    expect(anchors.map((c: any) => c.peerId)).toEqual(['owner-peer', 'admin-peer']);

    const selection = ctrl.selectDesiredPeers('ws-1', now, { isMobile: false });
    expect(selection.anchors.map((c: any) => c.peerId)).toEqual(['owner-peer', 'admin-peer']);
    expect(new Set(selection.desiredPeerIds).size).toBe(selection.desiredPeerIds.length);
    expect(selection.desiredPeerIds.length).toBeLessThanOrEqual(6);
  });

  test('shouldKeepIncumbent prevents churn unless challenger wins by threshold after dwell', () => {
    const now = Date.now();
    const ctrl = createPolicyController();

    const incumbent = {
      peerId: 'incumbent',
      role: 'member',
      joinedAt: now - 20_000,
      connected: true,
      connecting: false,
      ready: true,
      likelyOnline: true,
      recentlySeenAt: now - 2_000,
      sharedWorkspaceCount: 1,
      connectedAt: now - 30_000,
      lastSyncAt: now - 1_000,
      disconnectCount: 0,
      lastExplorerAt: undefined,
    };

    const slightChallenger = {
      ...incumbent,
      peerId: 'challenger-slight',
      connected: false,
      ready: false,
      connectedAt: undefined,
      role: 'admin',
      sharedWorkspaceCount: 2,
    };

    const strongChallenger = {
      ...slightChallenger,
      peerId: 'challenger-strong',
      role: 'owner',
      sharedWorkspaceCount: 3,
      recentlySeenAt: now - 500,
    };

    expect(ctrl.shouldKeepIncumbent(incumbent, slightChallenger, now)).toBe(true);
    expect(ctrl.shouldKeepIncumbent({ ...incumbent, connectedAt: now - 1_000 }, strongChallenger, now)).toBe(true);
    expect(ctrl.shouldKeepIncumbent({ ...incumbent, connectedAt: now - (5 * 60 * 1000), likelyOnline: false, lastSyncAt: undefined }, strongChallenger, now)).toBe(false);
  });

  test('selectDesiredPeers preserves healthy incumbents against minor challenger improvements', () => {
    const now = Date.now();
    const ctrl = createPolicyController({
      workspaceManager: {
        getWorkspace: (id: string) => ({
          id,
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'incumbent-peer', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'challenger-a', role: 'member', joinedAt: now - 7_000 },
            { peerId: 'challenger-b', role: 'member', joinedAt: now - 6_000 },
            { peerId: 'challenger-c', role: 'member', joinedAt: now - 5_000 },
          ],
        }),
        getAllWorkspaces: () => [{
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'incumbent-peer', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'challenger-a', role: 'member', joinedAt: now - 7_000 },
            { peerId: 'challenger-b', role: 'member', joinedAt: now - 6_000 },
            { peerId: 'challenger-c', role: 'member', joinedAt: now - 5_000 },
          ],
        }],
      },
      transport: {
        getConnectedPeers: () => ['incumbent-peer'],
        isConnectingToPeer: () => false,
        connect: mock(async () => {}),
      },
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-1',
        connectingPeers: new Set<string>(),
        readyPeers: new Set<string>(['incumbent-peer']),
        connectedPeers: new Set<string>(['incumbent-peer']),
      },
    });

    ['owner-peer', 'admin-peer', 'incumbent-peer', 'challenger-a', 'challenger-b', 'challenger-c'].forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
    });
    ctrl.peerConnectedAt.set('incumbent-peer', now - (2 * 60 * 1000));
    ctrl.peerLastSuccessfulSyncAt.set('incumbent-peer', now - 3_000);

    const selection = ctrl.selectDesiredPeers('ws-1', now, { isMobile: true });
    expect(selection.desiredPeerIds).toContain('incumbent-peer');
  });

  test('selectDesiredPeers prefers peers shared with other workspaces under budget pressure', () => {
    const now = Date.now();
    const ctrl = createPolicyController({
      workspaceManager: {
        getWorkspace: (id: string) => {
          if (id !== 'ws-1') return null;
          return {
            id,
            members: [
              { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
              { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
              { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
              { peerId: 'overlap-peer', role: 'member', joinedAt: now - 8_000 },
              { peerId: 'member-a', role: 'member', joinedAt: now - 7_000 },
              { peerId: 'member-b', role: 'member', joinedAt: now - 6_000 },
              { peerId: 'member-c', role: 'member', joinedAt: now - 5_000 },
              { peerId: 'member-d', role: 'member', joinedAt: now - 4_000 },
              { peerId: 'member-e', role: 'member', joinedAt: now - 3_000 },
              { peerId: 'member-f', role: 'member', joinedAt: now - 2_000 },
              { peerId: 'member-g', role: 'member', joinedAt: now - 1_000 },
            ],
          };
        },
        getAllWorkspaces: () => [
          {
            id: 'ws-1',
            members: [
              { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
              { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
              { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
              { peerId: 'overlap-peer', role: 'member', joinedAt: now - 8_000 },
              { peerId: 'member-a', role: 'member', joinedAt: now - 7_000 },
              { peerId: 'member-b', role: 'member', joinedAt: now - 6_000 },
              { peerId: 'member-c', role: 'member', joinedAt: now - 5_000 },
              { peerId: 'member-d', role: 'member', joinedAt: now - 4_000 },
              { peerId: 'member-e', role: 'member', joinedAt: now - 3_000 },
              { peerId: 'member-f', role: 'member', joinedAt: now - 2_000 },
              { peerId: 'member-g', role: 'member', joinedAt: now - 1_000 },
            ],
          },
          {
            id: 'ws-2',
            members: [
              { peerId: 'overlap-peer', role: 'member', joinedAt: now - 60_000 },
            ],
          },
        ],
      },
    });

    ['owner-peer', 'admin-peer', 'overlap-peer', 'member-a', 'member-b', 'member-c', 'member-d', 'member-e', 'member-f', 'member-g']
      .forEach((peerId, i) => {
        ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
      });

    const selection = ctrl.selectDesiredPeers('ws-1', now, { isMobile: false });
    expect(selection.budget).toBe(8);
    expect(selection.desiredPeerIds).toContain('overlap-peer');
  });

  test('runPeerMaintenance respects per-peer retry-after cooldown to avoid reconnect churn', () => {
    const now = Date.now();
    const connect = mock(async () => {});
    const ctrl = createPolicyController({
      isPartialMeshEnabled: () => false,
      transport: {
        getConnectedPeers: () => [],
        isConnectingToPeer: () => false,
        connect,
      },
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-1',
        connectingPeers: new Set<string>(),
        readyPeers: new Set<string>(),
        connectedPeers: new Set<string>(),
      },
      workspaceManager: {
        getWorkspace: (id: string) => ({
          id,
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
          ],
        }),
        getAllWorkspaces: () => [{
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
          ],
        }],
      },
    });

    ctrl.peerLastSeenAt.set('admin-peer', now - 1000);
    ctrl.peerConnectRetryAfterAt.set('admin-peer', Date.now() + 60_000);

    const attempted = ctrl._runPeerMaintenance();
    expect(attempted).toBe(0);
    expect(connect).not.toHaveBeenCalled();
  });

  test('runPeerMaintenance keeps legacy connect-to-all behavior when partial mesh is disabled', () => {
    const now = Date.now();
    const connect = mock(async () => {});
    const ctrl = createPolicyController({
      isPartialMeshEnabled: () => false,
      transport: {
        getConnectedPeers: () => ['owner-peer'],
        isConnectingToPeer: () => false,
        connect,
      },
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-1',
        connectingPeers: new Set<string>(),
        readyPeers: new Set<string>(['owner-peer']),
        connectedPeers: new Set<string>(['owner-peer']),
      },
      workspaceManager: {
        getWorkspace: (id: string) => ({
          id,
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'member-a', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'member-b', role: 'member', joinedAt: now - 7_000 },
          ],
        }),
        getAllWorkspaces: () => [{
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'member-a', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'member-b', role: 'member', joinedAt: now - 7_000 },
          ],
        }],
      },
    });

    ['owner-peer', 'admin-peer', 'member-a', 'member-b'].forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
    });

    const attempted = ctrl._runPeerMaintenance();
    expect(attempted).toBe(3);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  test('runPeerMaintenance uses desired peers when partial mesh is enabled', () => {
    const now = Date.now();
    const connect = mock(async () => {});
    const ctrl = createPolicyController({
      isPartialMeshEnabled: () => true,
      transport: {
        getConnectedPeers: () => ['owner-peer'],
        isConnectingToPeer: () => false,
        connect,
      },
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-1',
        connectingPeers: new Set<string>(),
        readyPeers: new Set<string>(['owner-peer']),
        connectedPeers: new Set<string>(['owner-peer']),
      },
      workspaceManager: {
        getWorkspace: (id: string) => ({
          id,
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'member-a', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'member-b', role: 'member', joinedAt: now - 7_000 },
            { peerId: 'member-c', role: 'member', joinedAt: now - 6_000 },
          ],
        }),
        getAllWorkspaces: () => [{
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            { peerId: 'owner-peer', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'admin-peer', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'member-a', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'member-b', role: 'member', joinedAt: now - 7_000 },
            { peerId: 'member-c', role: 'member', joinedAt: now - 6_000 },
          ],
        }],
      },
    });

    ['owner-peer', 'admin-peer', 'member-a', 'member-b', 'member-c'].forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
    });

    const attempted = ctrl._runPeerMaintenance();
    expect(attempted).toBeGreaterThan(0);
    expect(connect).toHaveBeenCalled();
  });


  test('runPeerMaintenance does not reconnect every peer just to satisfy safe minimum recovery', () => {
    const now = Date.now();
    const connect = mock(async () => {});
    const members = [
      { peerId: 'me-peer', role: 'owner', joinedAt: now - 30_000 },
      { peerId: 'owner-peer', role: 'owner', joinedAt: now - 20_000 },
      { peerId: 'admin-peer', role: 'admin', joinedAt: now - 19_000 },
      { peerId: 'member-a', role: 'member', joinedAt: now - 18_000 },
      { peerId: 'member-b', role: 'member', joinedAt: now - 17_000 },
      { peerId: 'member-c', role: 'member', joinedAt: now - 16_000 },
      { peerId: 'member-d', role: 'member', joinedAt: now - 15_000 },
      { peerId: 'member-e', role: 'member', joinedAt: now - 14_000 },
      { peerId: 'member-f', role: 'member', joinedAt: now - 13_000 },
      { peerId: 'member-g', role: 'member', joinedAt: now - 12_000 },
      { peerId: 'member-h', role: 'member', joinedAt: now - 11_000 },
      { peerId: 'member-i', role: 'member', joinedAt: now - 10_000 },
      { peerId: 'member-j', role: 'member', joinedAt: now - 9_000 },
    ];
    const ctrl = createPolicyController({
      isPartialMeshEnabled: () => true,
      transport: {
        getConnectedPeers: () => [],
        isConnectingToPeer: () => false,
        connect,
      },
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-1',
        connectingPeers: new Set<string>(),
        readyPeers: new Set<string>(),
        connectedPeers: new Set<string>(),
      },
      workspaceManager: {
        getWorkspace: (id: string) => ({ id, members }),
        getAllWorkspaces: () => [{ id: 'ws-1', members }],
      },
    });

    for (const member of members) {
      if (member.peerId === 'me-peer') continue;
      ctrl.peerLastSeenAt.set(member.peerId, now - 1000);
    }

    const desired = ctrl.selectDesiredPeers('ws-1', now, { isMobile: false }).desiredPeerIds;
    const attempted = ctrl._runPeerMaintenance();
    const attemptedPeerIds = connect.mock.calls.map(([peerId]: [string]) => peerId).sort();

    expect(attempted).toBe(desired.length);
    expect(attemptedPeerIds).toEqual([...desired].sort());
  });

  test('runPeerMaintenance prunes excess non-desired peers conservatively and keeps shared-workspace links', () => {
    const now = Date.now();
    const disconnect = mock(() => {});
    const connectedPeers = ['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h', 'peer-i', 'peer-j'];
    const ctrl = createPolicyController({
      isPartialMeshEnabled: () => true,
      transport: {
        getConnectedPeers: () => connectedPeers,
        isConnectingToPeer: () => false,
        connect: mock(async () => {}),
        disconnect,
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
            { peerId: 'peer-a', role: 'owner', joinedAt: now - 10_000 },
            { peerId: 'peer-b', role: 'admin', joinedAt: now - 9_000 },
            { peerId: 'peer-c', role: 'member', joinedAt: now - 8_000 },
            { peerId: 'peer-d', role: 'member', joinedAt: now - 7_000 },
            { peerId: 'peer-e', role: 'member', joinedAt: now - 6_000 },
            { peerId: 'peer-f', role: 'member', joinedAt: now - 5_000 },
            { peerId: 'peer-g', role: 'member', joinedAt: now - 4_000 },
            { peerId: 'peer-h', role: 'member', joinedAt: now - 3_000 },
            { peerId: 'peer-i', role: 'member', joinedAt: now - 2_000 },
            { peerId: 'peer-j', role: 'member', joinedAt: now - 1_000 },
          ],
        }),
        getAllWorkspaces: () => [
          {
            id: 'ws-1',
            members: [
              { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
              ...connectedPeers.map((peerId, i) => ({ peerId, role: i < 2 ? 'admin' : 'member', joinedAt: now - (10_000 - i) })),
            ],
          },
          {
            id: 'ws-2',
            members: [
              { peerId: 'peer-j', role: 'member', joinedAt: now - 50_000 },
            ],
          },
        ],
      },
    });

    connectedPeers.forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
      ctrl.peerConnectedAt.set(peerId, now - (5 * 60 * 1000));
      ctrl.peerLastSuccessfulSyncAt.set(peerId, now - 3_000);
    });
    ctrl.peerLastSeenAt.set('peer-i', now - (8 * 60 * 60 * 1000));
    ctrl.peerLastSeenAt.set('peer-j', now - (8 * 60 * 60 * 1000));

    const desiredBefore = ctrl.selectDesiredPeers('ws-1', now).desiredPeerIds;
    ctrl._runPeerMaintenance();

    expect(disconnect).toHaveBeenCalledTimes(1);
    const prunedPeer = disconnect.mock.calls[0]?.[0] as string;
    expect(prunedPeer).toBeTruthy();
    expect(desiredBefore).not.toContain(prunedPeer);
    expect(prunedPeer).not.toBe('peer-j');
    expect(disconnect).not.toHaveBeenCalledWith('peer-j');
  });

  test('getConnectionStatus surfaces desired topology progress when partial mesh is enabled', () => {
    const now = Date.now();
    const connectedPeers = ['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f'];
    const ctrl = createPolicyController({
      isPartialMeshEnabled: () => true,
      transport: {
        getConnectedPeers: () => connectedPeers,
        getSignalingStatus: () => [{ connected: true }],
        isConnectingToPeer: () => false,
        connect: mock(async () => {}),
        disconnect: mock(() => {}),
      },
      state: {
        myPeerId: 'me-peer',
        activeWorkspaceId: 'ws-1',
        connectingPeers: new Set<string>(['peer-g', 'peer-h']),
        readyPeers: new Set<string>(connectedPeers),
        connectedPeers: new Set<string>(connectedPeers),
      },
      workspaceManager: {
        getWorkspace: (id: string) => ({
          id,
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            ...['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h', 'peer-i']
              .map((peerId, i) => ({ peerId, role: i === 0 ? 'owner' : (i === 1 ? 'admin' : 'member'), joinedAt: now - ((i + 1) * 2000) })),
          ],
        }),
        getAllWorkspaces: () => [{
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            ...['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h', 'peer-i']
              .map((peerId, i) => ({ peerId, role: i === 0 ? 'owner' : (i === 1 ? 'admin' : 'member'), joinedAt: now - ((i + 1) * 2000) })),
          ],
        }],
      },
    });

    ['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h', 'peer-i'].forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
      ctrl.peerConnectedAt.set(peerId, now - (2 * 60 * 1000));
      ctrl.peerLastSuccessfulSyncAt.set(peerId, now - 1_000);
    });

    const status = ctrl.getConnectionStatus();
    expect(status.level).toBe('info');
    expect(status.message).toBe('Connected 6/8 desired peers');
    expect(status.detail).toContain('Reconnecting to 2 desired peer(s)');
    expect(status.debug?.desiredPeerCount).toBe(8);
    expect(status.debug?.connectedDesiredPeerCount).toBe(6);
    expect(status.debug?.topology?.recentEvents).toBeDefined();
  });

  test('getConnectionStatus stays calm when desired target is fully satisfied', () => {
    const now = Date.now();
    const connectedPeers = ['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h'];
    const ctrl = createPolicyController({
      isPartialMeshEnabled: () => true,
      transport: {
        getConnectedPeers: () => connectedPeers,
        getSignalingStatus: () => [{ connected: true }],
        isConnectingToPeer: () => false,
        connect: mock(async () => {}),
        disconnect: mock(() => {}),
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
            ...['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h', 'peer-i']
              .map((peerId, i) => ({ peerId, role: i === 0 ? 'owner' : (i === 1 ? 'admin' : 'member'), joinedAt: now - ((i + 1) * 2000) })),
          ],
        }),
        getAllWorkspaces: () => [{
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
            ...['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h', 'peer-i']
              .map((peerId, i) => ({ peerId, role: i === 0 ? 'owner' : (i === 1 ? 'admin' : 'member'), joinedAt: now - ((i + 1) * 2000) })),
          ],
        }],
      },
    });

    ['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h', 'peer-i'].forEach((peerId, i) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((i + 1) * 1000));
      ctrl.peerConnectedAt.set(peerId, now - (2 * 60 * 1000));
      ctrl.peerLastSuccessfulSyncAt.set(peerId, now - 1_000);
    });

    const status = ctrl.getConnectionStatus();
    expect(status.showBanner).toBe(false);
    expect(status.level).toBe('info');
    expect(status.message).toBe('Connected 8/8 desired peers');
  });
});
