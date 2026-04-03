import { test, expect } from '@playwright/test';

test.setTimeout(45_000);

test('partial mesh maintenance prunes conservatively and reports desired-topology status', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'Known Firefox bootstrap flake: app may hit initialization timeout before __ctrl exists; covered by stronger observability spec.');
  // Navigate to /app (not /) so full app bootstrap runs and __ctrl is exposed.
  // The landing page at / takes a lightweight path that never sets __ctrl.
  await page.goto('/app');
  await page.evaluate(async () => {
    if ((indexedDB as any).databases) {
      const dbs = await (indexedDB as any).databases();
      for (const db of dbs) {
        if (db?.name) indexedDB.deleteDatabase(db.name);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  // Re-navigate to /app after clearing storage (matches helpers.ts pattern)
  await page.goto('/app');

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 20_000 });

  await page.waitForFunction(() => !!(window as any).__ctrl, undefined, { timeout: 20_000 });

  const result = await page.evaluate(() => {
    const ctrl = (window as any).__ctrl;
    const now = Date.now();
    const connected = new Set(['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h', 'peer-i', 'peer-j']);
    const disconnects: string[] = [];

    const ws = {
      id: 'ws-partial-mesh',
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
    };

    ctrl.state.myPeerId = 'me-peer';
    ctrl.state.activeWorkspaceId = ws.id;
    ctrl.state.connectingPeers = new Set();
    ctrl.state.readyPeers = new Set(Array.from(connected));
    ctrl.state.connectedPeers = new Set(Array.from(connected));

    ctrl.workspaceManager.getWorkspace = (id: string) => (id === ws.id ? ws : null);
    ctrl.workspaceManager.getAllWorkspaces = () => [
      ws,
      {
        id: 'ws-overlap',
        members: [{ peerId: 'peer-j', role: 'member', joinedAt: now - 50_000 }],
      },
    ];

    ctrl.isPartialMeshEnabled = () => true;
    ctrl.transport.getConnectedPeers = () => Array.from(connected);
    ctrl.transport.getSignalingStatus = () => [{ connected: true }];
    ctrl.transport.isConnectingToPeer = () => false;
    ctrl.transport.connect = async () => {};
    ctrl.transport.disconnect = (peerId: string) => {
      disconnects.push(peerId);
      connected.delete(peerId);
    };

    for (const [index, peerId] of Array.from(connected).entries()) {
      ctrl.peerLastSeenAt.set(peerId, now - ((index + 1) * 1_000));
      ctrl.peerConnectedAt.set(peerId, now - (5 * 60 * 1000));
      ctrl.peerLastSuccessfulSyncAt.set(peerId, now - 2_000);
    }
    ctrl.peerLastSeenAt.set('peer-i', now - (8 * 60 * 60 * 1000));
    ctrl.peerLastSeenAt.set('peer-j', now - (8 * 60 * 60 * 1000));

    const desiredBefore = ctrl.selectDesiredPeers(ws.id, now).desiredPeerIds;
    ctrl.runPeerMaintenanceNow('integration-partial-mesh');
    const status = ctrl.getConnectionStatus();

    return {
      disconnects,
      desiredBefore,
      connectedAfter: Array.from(connected),
      status,
    };
  });

  expect(result.disconnects).toHaveLength(1);
  const [prunedPeer] = result.disconnects;
  expect(prunedPeer).toBeTruthy();
  expect(result.desiredBefore).not.toContain(prunedPeer);
  expect(result.disconnects).not.toContain('peer-j');
  expect(result.status.showBanner).toBe(false);
  expect(result.status.message).toBe('Connected 8/8 desired peers');
  expect(result.status.debug?.partialMeshEnabled).toBe(true);
});
