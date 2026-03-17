import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser } from './helpers';

test.setTimeout(30000);

test('P2P works with localhost-only ICE (no STUN)', async ({ browser }) => {
  const relay = await startRelay();
  const u1 = await createUser(browser, 'Alice');
  const u2 = await createUser(browser, 'Bob');

  try {
    const p1Id = await u1.page.evaluate(() => (window as any).__transport?.getMyPeerId?.());
    const p2Id = await u2.page.evaluate(() => (window as any).__transport?.getMyPeerId?.());
    expect(p1Id).toBeTruthy();
    expect(p2Id).toBeTruthy();

    await u1.page.evaluate(() => {
      (window as any).__data = [];
      const t = (window as any).__transport;
      const orig = t.onMessage;
      t.onMessage = (from: string, data: any) => {
        if (data?.type === 'ping') (window as any).__data.push(data.payload);
        if (orig) orig(from, data);
      };
    });

    await u2.page.evaluate(async (targetId: string) => {
      (window as any).__data = [];
      const t = (window as any).__transport;
      const orig = t.onMessage;
      t.onMessage = (from: string, data: any) => {
        if (data?.type === 'pong') (window as any).__data.push(data.payload);
        if (orig) orig(from, data);
      };
      await t.connect(targetId);
      t.send(targetId, { type: 'ping', payload: 'ping' });
    }, p1Id);

    await u1.page.waitForFunction(() => (window as any).__data.length > 0, undefined, { timeout: 10000 });
    const p1Data = await u1.page.evaluate(() => (window as any).__data);
    expect(p1Data).toContain('ping');

    await u1.page.evaluate((targetId: string) => {
      (window as any).__transport.send(targetId, { type: 'pong', payload: 'pong' });
    }, p2Id);

    await u2.page.waitForFunction(() => (window as any).__data.length > 0, undefined, { timeout: 10000 });
    const p2Data = await u2.page.evaluate(() => (window as any).__data);
    expect(p2Data).toContain('pong');
  } finally {
    await closeUser(u1);
    await closeUser(u2);
    relay.close();
  }
});
