import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser } from './helpers';

test.setTimeout(30000);

test('P2P data channel between two browser contexts', async ({ browser }) => {
  const relay = await startRelay();
  const u1 = await createUser(browser, 'Alice');
  const u2 = await createUser(browser, 'Bob');

  try {
    const p1Id = await u1.page.evaluate(() => (window as any).__transport?.getMyPeerId?.());
    const p2Id = await u2.page.evaluate(() => (window as any).__transport?.getMyPeerId?.());
    expect(p1Id).toBeTruthy();
    expect(p2Id).toBeTruthy();

    await u1.page.evaluate(() => {
      (window as any).__p2pData = [];
      const t = (window as any).__transport;
      const orig = t.onMessage;
      t.onMessage = (from: string, data: any) => {
        if (data?.type === 'test-data') (window as any).__p2pData.push(data.payload);
        if (orig) orig(from, data);
      };
    });

    await u2.page.evaluate(async (targetId: string) => {
      const t = (window as any).__transport;
      await t.connect(targetId);
      t.send(targetId, { type: 'test-data', payload: 'hello from P2' });
    }, p1Id);

    await u1.page.waitForFunction(() => (window as any).__p2pData.length > 0, { timeout: 10000 });
    const p1Data = await u1.page.evaluate(() => (window as any).__p2pData);
    expect(p1Data).toContain('hello from P2');

    await u2.page.evaluate(() => {
      (window as any).__p2pData = [];
      const t = (window as any).__transport;
      const orig = t.onMessage;
      t.onMessage = (from: string, data: any) => {
        if (data?.type === 'test-data') (window as any).__p2pData.push(data.payload);
        if (orig) orig(from, data);
      };
    });

    await u1.page.evaluate((targetId: string) => {
      (window as any).__transport.send(targetId, { type: 'test-data', payload: 'hello again from P1' });
    }, p2Id);

    await u2.page.waitForFunction(() => (window as any).__p2pData.length > 0, { timeout: 10000 });
    const p2Data = await u2.page.evaluate(() => (window as any).__p2pData);
    expect(p2Data).toContain('hello again from P1');
  } finally {
    await closeUser(u1);
    await closeUser(u2);
    relay.close();
  }
});
