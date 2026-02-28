import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser } from './helpers';

test.setTimeout(30000);

test('check transport state and attempt P2P connect', async ({ browser }) => {
  const relay = await startRelay();
  const u1 = await createUser(browser, 'Alice');
  const u2 = await createUser(browser, 'Bob');

  try {
    const p1State = await u1.page.evaluate(() => {
      const t = (window as any).__transport;
      return {
        peerId: t?.getMyPeerId?.(),
        serverCount: t?.getConnectedServerCount?.() ?? 0,
        signalingStatus: t?.getSignalingStatus?.() ?? [],
      };
    });

    const p2State = await u2.page.evaluate(() => {
      const t = (window as any).__transport;
      return {
        peerId: t?.getMyPeerId?.(),
        serverCount: t?.getConnectedServerCount?.() ?? 0,
        signalingStatus: t?.getSignalingStatus?.() ?? [],
      };
    });

    expect(p1State.peerId).toBeTruthy();
    expect(p2State.peerId).toBeTruthy();
    expect(p1State.serverCount).toBeGreaterThan(0);
    expect(p2State.serverCount).toBeGreaterThan(0);
    expect(p1State.signalingStatus[0]?.connected).toBe(true);
    expect(p2State.signalingStatus[0]?.connected).toBe(true);

    const connectResult = await u2.page.evaluate(async (targetId: string) => {
      try {
        await (window as any).__transport.connect(targetId);
        return 'SUCCESS';
      } catch (e: any) {
        return `FAILED: ${e.message}`;
      }
    }, p1State.peerId);

    expect(connectResult).toBe('SUCCESS');

    await u1.page.waitForFunction(() => ((window as any).__transport?.getConnectedPeers?.() ?? []).length > 0, { timeout: 10000 });

    const p1Peers = await u1.page.evaluate(() => (window as any).__transport.getConnectedPeers());
    const p2Peers = await u2.page.evaluate(() => (window as any).__transport.getConnectedPeers());
    expect(p1Peers.length).toBeGreaterThan(0);
    expect(p2Peers.length).toBeGreaterThan(0);
  } finally {
    await closeUser(u1);
    await closeUser(u2);
    relay.close();
  }
});
