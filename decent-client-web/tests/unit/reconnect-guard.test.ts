import { describe, test, expect, mock } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function createControllerStub(overrides: Record<string, unknown> = {}): any {
  const ctrl = Object.create(ChatController.prototype) as any;
  ctrl.state = { myPeerId: 'me-peer' };
  ctrl.workspaceManager = {
    getAllWorkspaces: () => [],
  };
  ctrl.transportReinitInFlight = null;
  ctrl.lastTransportReinitAt = 0;
  ctrl.transport = {
    getConnectedPeers: () => [],
    getSignalingStatus: () => [],
    destroy: mock(() => {}),
    init: mock(async () => 'me-peer'),
  };
  ctrl.setupTransportHandlers = mock(() => {});
  ctrl.runPeerMaintenanceNow = mock(() => 0);
  Object.assign(ctrl, overrides);
  return ctrl;
}

describe('ChatController reconnect guard helpers', () => {
  test('getExpectedWorkspacePeerCount excludes self and deduplicates', () => {
    const ctrl = createControllerStub({
      workspaceManager: {
        getAllWorkspaces: () => [
          {
            members: [
              { peerId: 'me-peer' },
              { peerId: 'peer-a' },
              { peerId: 'peer-b' },
            ],
          },
          {
            members: [
              { peerId: 'peer-a' },
              { peerId: 'peer-c' },
            ],
          },
        ],
      },
    });

    expect(ctrl.getExpectedWorkspacePeerCount()).toBe(3);
  });

  test('reinitializeTransportIfStuck no-ops when peers already connected', async () => {
    const ctrl = createControllerStub({
      transport: {
        getConnectedPeers: () => ['peer-a'],
        getSignalingStatus: () => [{ connected: false }],
        destroy: mock(() => {}),
        init: mock(async () => 'me-peer'),
      },
    });

    const didReinit = await ctrl.reinitializeTransportIfStuck('test');
    expect(didReinit).toBe(false);
    expect(ctrl.transport.destroy).not.toHaveBeenCalled();
    expect(ctrl.transport.init).not.toHaveBeenCalled();
  });

  test('reinitializeTransportIfStuck re-inits once when signaling is fully down', async () => {
    const destroy = mock(() => {});
    const init = mock(async () => 'me-peer');
    const setupHandlers = mock(() => {});
    const runMaintenance = mock(() => 1);

    const ctrl = createControllerStub({
      transport: {
        getConnectedPeers: () => [],
        getSignalingStatus: () => [{ connected: false }, { connected: false }],
        destroy,
        init,
      },
      setupTransportHandlers: setupHandlers,
      runPeerMaintenanceNow: runMaintenance,
    });

    const didReinit = await ctrl.reinitializeTransportIfStuck('test');
    expect(didReinit).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(setupHandlers).toHaveBeenCalledTimes(1);
    expect(runMaintenance).toHaveBeenCalledTimes(1);
  });

  test('reinitializeTransportIfStuck is cooldown-limited', async () => {
    const destroy = mock(() => {});
    const init = mock(async () => 'me-peer');

    const ctrl = createControllerStub({
      transport: {
        getConnectedPeers: () => [],
        getSignalingStatus: () => [{ connected: false }],
        destroy,
        init,
      },
    });

    const first = await ctrl.reinitializeTransportIfStuck('first');
    const second = await ctrl.reinitializeTransportIfStuck('second');

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
  });
});
