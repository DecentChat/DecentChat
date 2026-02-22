import { test, expect } from '@playwright/test';

test.setTimeout(30_000);

test('lifecycle reconnect events are debounced into one reconnect pass', async ({ page }) => {
  await page.goto('/');

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as any).__ctrl, { timeout: 10_000 });

  await page.evaluate(() => {
    const ctrl = (window as any).__ctrl;
    let maintenanceCalls = 0;
    let reinitCalls = 0;

    ctrl.getExpectedWorkspacePeerCount = () => 1;
    ctrl.transport.getConnectedPeers = () => [];
    ctrl.runPeerMaintenanceNow = () => {
      maintenanceCalls += 1;
      return 0;
    };
    ctrl.reinitializeTransportIfStuck = async () => {
      reinitCalls += 1;
      return false;
    };

    (window as any).__reconnectProbe = {
      get maintenanceCalls() { return maintenanceCalls; },
      get reinitCalls() { return reinitCalls; },
    };

    window.dispatchEvent(new Event('online'));
    const pageShow = new Event('pageshow');
    Object.assign(pageShow, { persisted: true });
    window.dispatchEvent(pageShow);
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await page.waitForTimeout(2_200);

  const probe = await page.evaluate(() => {
    const p = (window as any).__reconnectProbe;
    return { maintenanceCalls: p.maintenanceCalls, reinitCalls: p.reinitCalls };
  });

  expect(probe.maintenanceCalls).toBe(1);
  expect(probe.reinitCalls).toBe(1);
});
