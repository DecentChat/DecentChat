import { test, expect } from '@playwright/test';

test.setTimeout(45_000);

async function bootController(page: any) {
  await page.goto('/');
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
  await page.reload();

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 20_000 });

  const clearDataBtn = page.getByRole('button', { name: /clear data/i });
  if (await clearDataBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await clearDataBtn.click();
    const retryBtn = page.getByRole('button', { name: /retry/i });
    if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await retryBtn.click();
    } else {
      await page.reload();
    }
  }

  await page.waitForFunction(() => {
    return !!(window as any).__ctrl || !!Array.from(document.querySelectorAll('button')).find((el) => /open app/i.test(el.textContent || ''));
  }, { timeout: 20_000 });

  if (!(await page.evaluate(() => !!(window as any).__ctrl))) {
    const openAppBtn = page.getByRole('button', { name: /open app/i });
    await openAppBtn.click();
  }

  await page.waitForFunction(() => !!(window as any).__ctrl, { timeout: 20_000 });
}

test('topology debug snapshot is populated, structured maintenance logs are emitted, and overlap peers survive prune', async ({ page }) => {
  await bootController(page);

  const result = await page.evaluate(() => {
    const ctrl = (window as any).__ctrl;
    const now = Date.now();
    const connected = new Set(['peer-a', 'peer-b', 'peer-c', 'peer-d', 'peer-e', 'peer-f', 'peer-g', 'peer-h', 'peer-i', 'peer-overlap']);
    const disconnects: string[] = [];
    const logs: Array<{ level: string; prefix: string; event: any }> = [];

    const capture = (level: string, orig: (...args: any[]) => void) => (...args: any[]) => {
      const [prefix, payload] = args;
      if (typeof prefix === 'string' && prefix.startsWith('[Topology')) {
        logs.push({ level, prefix, event: payload });
      }
      return orig(...args);
    };

    const origInfo = console.info.bind(console);
    const origWarn = console.warn.bind(console);
    const origDebug = console.debug.bind(console);
    console.info = capture('info', origInfo);
    console.warn = capture('warn', origWarn);
    console.debug = capture('debug', origDebug);

    try {
      const ws = {
        id: 'ws-observability',
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
          { peerId: 'peer-overlap', role: 'member', joinedAt: now - 1_000 },
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
          id: 'ws-shared',
          members: [{ peerId: 'peer-overlap', role: 'member', joinedAt: now - 50_000 }],
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
        ctrl.peerLastSeenAt.set(peerId, now - ((index + 1) * 1000));
        ctrl.peerConnectedAt.set(peerId, now - (5 * 60 * 1000));
        ctrl.peerLastSuccessfulSyncAt.set(peerId, now - 2_000);
        ctrl.peerDisconnectCount.set(peerId, 0);
      }
      ctrl.peerLastSeenAt.set('peer-i', now - (8 * 60 * 60 * 1000));
      ctrl.peerLastSeenAt.set('peer-overlap', now - 500);

      const desiredBefore = ctrl.selectDesiredPeers(ws.id, now).desiredPeerIds;
      ctrl.runPeerMaintenanceNow('integration-observability');
      const snapshot = ctrl.getTopologyDebugSnapshot(ws.id);
      const status = ctrl.getConnectionStatus();

      return {
        desiredBefore,
        disconnects,
        snapshot,
        status,
        logs,
      };
    } finally {
      console.info = origInfo;
      console.warn = origWarn;
      console.debug = origDebug;
    }
  });

  expect(result.snapshot.lastMaintenance?.workspaceId).toBe('ws-observability');
  expect(result.snapshot.lastMaintenance?.candidatePeerCount).toBeGreaterThan(0);
  expect(result.snapshot.lastMaintenance?.desiredPeerCount).toBeGreaterThan(0);
  expect(result.snapshot.lastMaintenance?.anchorPeerIds.length).toBeGreaterThan(0);
  expect(result.snapshot.recentEvents.some((event: any) => event.kind === 'topology.maintenance')).toBe(true);
  expect(result.snapshot.recentEvents.some((event: any) => event.kind === 'topology.peer')).toBe(true);
  expect(result.status.debug?.topology?.lastMaintenance?.workspaceId).toBe('ws-observability');

  const maintenanceLog = result.logs.find((entry: any) => entry.event?.kind === 'topology.maintenance');
  expect(maintenanceLog).toBeTruthy();
  expect(maintenanceLog.event.reason).toBe('integration-observability');
  expect(maintenanceLog.event).toHaveProperty('candidatePeerCount');
  expect(maintenanceLog.event).toHaveProperty('desiredPeerCount');
  expect(maintenanceLog.event).toHaveProperty('connectedDesiredPeerCount');
  expect(maintenanceLog.event).toHaveProperty('selectionDurationMs');

  expect(result.disconnects.length).toBeGreaterThan(0);
  expect(result.disconnects).not.toContain('peer-overlap');
  expect(result.snapshot.lastMaintenance?.overlapSelectedCount).toBeGreaterThan(0);
  expect(result.snapshot.lastMaintenance?.overlapDesiredPeerIds).toContain('peer-overlap');
  expect(result.desiredBefore).toContain('peer-overlap');
});

test('safe-minimum recovery is reflected in topology status/debug data', async ({ page }) => {
  await bootController(page);

  const result = await page.evaluate(() => {
    const ctrl = (window as any).__ctrl;
    const now = Date.now();
    const connected = new Set(['peer-a']);
    const connectAttempts: string[] = [];

    const ws = {
      id: 'ws-recovery',
      members: [
        { peerId: 'me-peer', role: 'owner', joinedAt: now - 20_000 },
        { peerId: 'peer-a', role: 'owner', joinedAt: now - 10_000 },
        { peerId: 'peer-b', role: 'admin', joinedAt: now - 9_000 },
        { peerId: 'peer-c', role: 'member', joinedAt: now - 8_000 },
        { peerId: 'peer-d', role: 'member', joinedAt: now - 7_000 },
      ],
    };

    ctrl.state.myPeerId = 'me-peer';
    ctrl.state.activeWorkspaceId = ws.id;
    ctrl.state.connectingPeers = new Set();
    ctrl.state.readyPeers = new Set(Array.from(connected));
    ctrl.state.connectedPeers = new Set(Array.from(connected));

    ctrl.workspaceManager.getWorkspace = (id: string) => (id === ws.id ? ws : null);
    ctrl.workspaceManager.getAllWorkspaces = () => [ws];

    ctrl.isPartialMeshEnabled = () => true;
    ctrl.transport.getConnectedPeers = () => Array.from(connected);
    ctrl.transport.getSignalingStatus = () => [{ connected: true }];
    ctrl.transport.isConnectingToPeer = () => false;
    ctrl.transport.connect = async (peerId: string) => {
      connectAttempts.push(peerId);
    };
    ctrl.transport.disconnect = () => {};

    ['peer-a', 'peer-b', 'peer-c', 'peer-d'].forEach((peerId: string, index: number) => {
      ctrl.peerLastSeenAt.set(peerId, now - ((index + 1) * 1000));
      ctrl.peerDisconnectCount.set(peerId, 0);
    });
    ctrl.peerConnectedAt.set('peer-a', now - (2 * 60 * 1000));
    ctrl.peerLastSuccessfulSyncAt.set('peer-a', now - 1_000);

    ctrl.runPeerMaintenanceNow('integration-recovery');
      const snapshot = ctrl.getTopologyDebugSnapshot(ws.id);
      const status = ctrl.getConnectionStatus();

    return {
      connectAttempts,
      snapshot,
      status,
    };
  });

  expect(result.connectAttempts.length).toBeGreaterThan(0);
  expect(result.snapshot.lastMaintenance?.safeMinimumRecovery).toBe(true);
  expect(result.snapshot.lastMaintenance?.connectedPeerCount).toBeLessThan(result.snapshot.lastMaintenance?.safeMinimumTarget ?? 0);
  expect(result.status.message).toContain('Connected');
  expect(result.status.debug?.connectedDesiredPeerCount).toBeLessThan(result.status.debug?.desiredPeerCount ?? 0);
  expect(result.status.debug?.topology?.lastMaintenance?.safeMinimumRecovery).toBe(true);
});

