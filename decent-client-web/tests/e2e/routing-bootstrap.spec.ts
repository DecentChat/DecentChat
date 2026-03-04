import { test, expect } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

const installMockTransport = async (page: any) => {
  await page.addInitScript(() => {
    class MockTransport {
      static initCalls = 0;
      onConnect: ((peerId: string) => void) | null = null;
      onDisconnect: ((peerId: string) => void) | null = null;
      onMessage: ((peerId: string, data: unknown) => void) | null = null;

      async init(peerId?: string) {
        (MockTransport as any).initCalls += 1;
        return peerId || 'mock-peer-id-1234';
      }

      destroy() {}
      send() {}
      async connect() { return; }
      getConnectedPeers() { return []; }
      setHeartbeatEnabled() {}
    }

    (window as any).__MockTransport = MockTransport;
  });
};

test.describe('routing bootstrap split', () => {
  test('landing route does not initialize transport', async ({ page }) => {
    await installMockTransport(page);
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);

    await expect(page.locator('#create-ws-btn')).toBeVisible();

    const initCalls = await page.evaluate(() => ((window as any).__MockTransport as any).initCalls || 0);
    expect(initCalls).toBe(0);
  });

  test('/app initializes transport', async ({ page }) => {
    await installMockTransport(page);
    await clearStorage(page);
    await page.goto('/app');
    await waitForApp(page);

    const initCalls = await page.evaluate(() => ((window as any).__MockTransport as any).initCalls || 0);
    expect(initCalls).toBeGreaterThan(0);
  });

  test('landing still shows Open App CTA when workspace exists locally', async ({ page }) => {
    await installMockTransport(page);
    await clearStorage(page);

    await page.goto('/app');
    await waitForApp(page);

    await createWorkspace(page, 'Route Test WS', 'Alex');
    await expect(page.locator('.sidebar-header')).toContainText('Route Test WS');

    await page.goto('/');
    await page.waitForSelector('#open-app-btn, #create-ws-btn, .sidebar-header', { timeout: 15000 });

    // The "Open App" CTA appears in the nav bar (#open-app-btn-nav) and/or
    // in the hero section (#open-app-btn) depending on async workspace restore.
    await expect(page.locator('#open-app-btn, #open-app-btn-nav').first()).toBeVisible();
  });
});
