import { test } from '@playwright/test';
import { startRelay, createUser, closeUser } from './helpers';

test.beforeAll(async () => { await startRelay(); });

test('debug ctrl methods', async ({ browser }) => {
  const alice = await createUser(browser, 'Alice');
  try {
    const info = await alice.page.evaluate(() => {
      const c = (window as any).__ctrl;
      const proto = Object.getPrototypeOf(c);
      const methods = Object.getOwnPropertyNames(proto).filter((k) => typeof (c as any)[k] === 'function').sort();
      return {
        hasBan: typeof c.banWorkspaceMember === 'function',
        hasKick: typeof c.removeWorkspaceMember === 'function',
        methods,
      };
    });
    console.log('CTRL_INFO', JSON.stringify(info));
  } finally {
    await closeUser(alice);
  }
});
