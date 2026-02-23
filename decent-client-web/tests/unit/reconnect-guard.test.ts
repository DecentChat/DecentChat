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
  ctrl.recreateTransportAndInit = mock(async () => 'me-peer');
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
    expect(ctrl.recreateTransportAndInit).not.toHaveBeenCalled();
  });

  test('reinitializeTransportIfStuck recreates transport once when signaling is fully down', async () => {
    const recreate = mock(async () => 'me-peer');
    const runMaintenance = mock(() => 1);

    const ctrl = createControllerStub({
      transport: {
        getConnectedPeers: () => [],
        getSignalingStatus: () => [{ connected: false }, { connected: false }],
      },
      recreateTransportAndInit: recreate,
      runPeerMaintenanceNow: runMaintenance,
    });

    const didReinit = await ctrl.reinitializeTransportIfStuck('test');
    expect(didReinit).toBe(true);
    expect(recreate).toHaveBeenCalledTimes(1);
    expect(runMaintenance).toHaveBeenCalledTimes(1);
  });

  test('reinitializeTransportIfStuck is cooldown-limited', async () => {
    const recreate = mock(async () => 'me-peer');

    const ctrl = createControllerStub({
      transport: {
        getConnectedPeers: () => [],
        getSignalingStatus: () => [{ connected: false }],
      },
      recreateTransportAndInit: recreate,
    });

    const first = await ctrl.reinitializeTransportIfStuck('first');
    const second = await ctrl.reinitializeTransportIfStuck('second');

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(recreate).toHaveBeenCalledTimes(1);
  });

  test('recreateTransportAndInit replaces stale transport instance', async () => {
    const oldDestroy = mock(() => {});
    const newInit = mock(async () => 'new-peer');
    const setupHandlers = mock(() => {});
    const replacementTransport = {
      init: newInit,
      getConnectedPeers: () => [],
      getSignalingStatus: () => [{ connected: true }],
    };

    const ctrl = createControllerStub({
      transport: {
        destroy: oldDestroy,
        getConnectedPeers: () => [],
        getSignalingStatus: () => [{ connected: false }],
      },
      setupTransportHandlers: setupHandlers,
    });

    ctrl.recreateTransportAndInit = ChatController.prototype.recreateTransportAndInit;
    ctrl._buildTransport = mock(() => replacementTransport);
    const assigned = await ctrl.recreateTransportAndInit('me-peer', 'test');

    expect(assigned).toBe('new-peer');
    expect(oldDestroy).toHaveBeenCalledTimes(1);
    expect(ctrl.transport).toBe(replacementTransport);
    expect(newInit).toHaveBeenCalledTimes(1);
    expect(setupHandlers).toHaveBeenCalledTimes(1);
  });
});
