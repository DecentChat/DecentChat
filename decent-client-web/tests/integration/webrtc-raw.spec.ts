import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser } from './helpers';

test.setTimeout(30000);

test('raw transport connection between two browser contexts', async ({ browser }) => {
  const relay = await startRelay();
  const u1 = await createUser(browser, 'Alice');
  const u2 = await createUser(browser, 'Bob');

  try {
    const p1Id = await u1.page.evaluate(() => (window as any).__transport?.getMyPeerId?.());
    const p2Id = await u2.page.evaluate(() => (window as any).__transport?.getMyPeerId?.());
    expect(p1Id).toBeTruthy();
    expect(p2Id).toBeTruthy();

    const c1 = await u1.page.evaluate(() => (window as any).__transport?.getConnectedServerCount?.() ?? 0);
    const c2 = await u2.page.evaluate(() => (window as any).__transport?.getConnectedServerCount?.() ?? 0);
    expect(c1).toBeGreaterThan(0);
    expect(c2).toBeGreaterThan(0);

    await u2.page.evaluate(async (targetId: string) => {
      await (window as any).__transport.connect(targetId);
    }, p1Id);

    await u1.page.waitForFunction(() => ((window as any).__transport?.getConnectedPeers?.() ?? []).length > 0, { timeout: 10000 });

    const p1Peers = await u1.page.evaluate(() => (window as any).__transport.getConnectedPeers());
    const p2Peers = await u2.page.evaluate(() => (window as any).__transport.getConnectedPeers());
    expect(p1Peers).toContain(p2Id);
    expect(p2Peers).toContain(p1Id);
  } finally {
    await closeUser(u1);
    await closeUser(u2);
    relay.close();
  }
});
