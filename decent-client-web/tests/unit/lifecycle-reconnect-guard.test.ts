import { describe, test, expect, mock } from 'bun:test';
import { LifecycleReconnectGuard } from '../../src/app/LifecycleReconnectGuard';

class MockDocumentTarget extends EventTarget {
  visibilityState: string = 'hidden';

  setVisible(): void {
    this.visibilityState = 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('LifecycleReconnectGuard', () => {
  test('startup grace triggers maintenance and stuck reinit when peers are expected', async () => {
    const windowTarget = new EventTarget();
    const documentTarget = new MockDocumentTarget();
    const runPeerMaintenanceNow = mock(() => 0);
    const reinitializeTransportIfStuck = mock(async () => true);

    const guard = new LifecycleReconnectGuard(
      {
        windowTarget,
        documentTarget,
        getExpectedPeers: () => 2,
        getConnectedPeers: () => 0,
        runPeerMaintenanceNow,
        reinitializeTransportIfStuck,
        isOnline: () => true,
      },
      {
        debounceMs: 5,
        initGraceMs: 10,
        initForceRecheckMs: 1000,
        reinitBackoffMs: [10],
      },
    );

    guard.start();
    await wait(30);
    guard.stop();

    expect(runPeerMaintenanceNow).toHaveBeenCalledTimes(1);
    expect(reinitializeTransportIfStuck).toHaveBeenCalledTimes(1);
  });

  test('event burst is debounced into one reconnect pass', async () => {
    const windowTarget = new EventTarget();
    const documentTarget = new MockDocumentTarget();
    const runPeerMaintenanceNow = mock(() => 1);
    const reinitializeTransportIfStuck = mock(async () => false);

    const guard = new LifecycleReconnectGuard(
      {
        windowTarget,
        documentTarget,
        getExpectedPeers: () => 1,
        getConnectedPeers: () => 0,
        runPeerMaintenanceNow,
        reinitializeTransportIfStuck,
      },
      {
        debounceMs: 10,
        initGraceMs: 5000,
        initForceRecheckMs: 9000,
      },
    );

    guard.start();
    windowTarget.dispatchEvent(new Event('online'));
    const pageShow = new Event('pageshow');
    Object.assign(pageShow, { persisted: true });
    windowTarget.dispatchEvent(pageShow);
    windowTarget.dispatchEvent(new Event('focus'));
    documentTarget.setVisible();

    await wait(30);
    guard.stop();

    expect(runPeerMaintenanceNow).toHaveBeenCalledTimes(1);
    expect(reinitializeTransportIfStuck).not.toHaveBeenCalled();
  });


  test('partial connectivity still triggers maintenance when expected peers are missing', async () => {
    const windowTarget = new EventTarget();
    const documentTarget = new MockDocumentTarget();
    const runPeerMaintenanceNow = mock(() => 1);
    const reinitializeTransportIfStuck = mock(async () => false);

    const guard = new LifecycleReconnectGuard(
      {
        windowTarget,
        documentTarget,
        getExpectedPeers: () => 2,
        getConnectedPeers: () => 1,
        runPeerMaintenanceNow,
        reinitializeTransportIfStuck,
      },
      {
        debounceMs: 1,
        initGraceMs: 5000,
        initForceRecheckMs: 9000,
      },
    );

    guard.start();
    guard.scheduleCheck('partial');
    await wait(10);
    guard.stop();

    expect(runPeerMaintenanceNow).toHaveBeenCalledTimes(1);
    expect(reinitializeTransportIfStuck).not.toHaveBeenCalled();
  });

  test('reinit attempts honor backoff and do not storm', async () => {
    const windowTarget = new EventTarget();
    const documentTarget = new MockDocumentTarget();
    const runPeerMaintenanceNow = mock(() => 0);
    const reinitializeTransportIfStuck = mock(async () => true);

    const guard = new LifecycleReconnectGuard(
      {
        windowTarget,
        documentTarget,
        getExpectedPeers: () => 1,
        getConnectedPeers: () => 0,
        runPeerMaintenanceNow,
        reinitializeTransportIfStuck,
      },
      {
        debounceMs: 1,
        initGraceMs: 5000,
        initForceRecheckMs: 9000,
        reinitBackoffMs: [40],
      },
    );

    guard.start();

    guard.scheduleCheck('one');
    await wait(10);
    guard.scheduleCheck('two');
    await wait(10);

    expect(reinitializeTransportIfStuck).toHaveBeenCalledTimes(1);

    await wait(45);
    guard.scheduleCheck('three');
    await wait(10);
    guard.stop();

    expect(reinitializeTransportIfStuck).toHaveBeenCalledTimes(2);
  });

  test('offline mode suppresses reinit attempts', async () => {
    const windowTarget = new EventTarget();
    const documentTarget = new MockDocumentTarget();
    const runPeerMaintenanceNow = mock(() => 0);
    const reinitializeTransportIfStuck = mock(async () => true);

    const guard = new LifecycleReconnectGuard(
      {
        windowTarget,
        documentTarget,
        getExpectedPeers: () => 1,
        getConnectedPeers: () => 0,
        runPeerMaintenanceNow,
        reinitializeTransportIfStuck,
        isOnline: () => false,
      },
      {
        debounceMs: 1,
        initGraceMs: 5000,
        initForceRecheckMs: 9000,
      },
    );

    guard.start();
    guard.scheduleCheck('offline', true);
    await wait(10);
    guard.stop();

    expect(runPeerMaintenanceNow).toHaveBeenCalledTimes(1);
    expect(reinitializeTransportIfStuck).not.toHaveBeenCalled();
  });
});
