import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser } from './helpers';

test.setTimeout(30000);

test('PeerJS data channel works between two browser contexts', async ({ browser }) => {
  const relay = await startRelay();
  const u1 = await createUser(browser, 'Alice');
  const u2 = await createUser(browser, 'Bob');

  try {
    const p1Id = await u1.page.evaluate(() => (window as any).__transport?.getMyPeerId?.());
    const p2Id = await u2.page.evaluate(() => (window as any).__transport?.getMyPeerId?.());
    expect(p1Id).toBeTruthy();
    expect(p2Id).toBeTruthy();

    await u1.page.evaluate(() => {
      (window as any).__received = [];
      const t = (window as any).__transport;
      const orig = t.onMessage;
      t.onMessage = (from: string, data: any) => {
        if (data?.type === 'test-data') (window as any).__received.push(`${from}:${data.payload}`);
        if (orig) orig(from, data);
      };
    });

    await u2.page.evaluate(async (targetId: string) => {
      const t = (window as any).__transport;
      await t.connect(targetId);
      t.send(targetId, { type: 'test-data', payload: 'hello-from-bob' });
    }, p1Id);

    await u1.page.waitForFunction(() => ((window as any).__received ?? []).length > 0, { timeout: 10000 });
    const received = await u1.page.evaluate(() => (window as any).__received as string[]);
    expect(received.some((m) => m.includes('hello-from-bob'))).toBe(true);

    const serverCount = await u1.page.evaluate(() => (window as any).__transport?.getConnectedServerCount?.() ?? 0);
    expect(serverCount).toBeGreaterThan(0);
  } finally {
    await closeUser(u1);
    await closeUser(u2);
    relay.close();
  }
});
