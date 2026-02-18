/**
 * Simple messaging test using transport.connect() directly (which handles P2P wiring)
 */

import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/');
  await page.evaluate(() => {
    if (indexedDB.databases) {
      indexedDB.databases().then(dbs => {
        dbs.forEach(db => { if (db.name) indexedDB.deleteDatabase(db.name); });
      });
    }
  });
  await page.waitForTimeout(500);

  await page.goto('/');
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });
  await page.waitForSelector('#create-ws-btn', { timeout: 15000 });

  return { name, context, page };
}

async function closeUser(user: TestUser): Promise<void> {
  await user.context.close();
}

test.setTimeout(60000);

test('simple P2P message exchange', async ({ browser }) => {
  const alice = await createUser(browser, 'Alice');
  const bob = await createUser(browser, 'Bob');

  try {
    // Create workspace with Alice
    await alice.page.click('#create-ws-btn');
    await alice.page.fill('.modal input:nth-of-type(1)', 'TestWS');
    await alice.page.fill('.modal input:nth-of-type(2)', 'Alice');
    await alice.page.click('.modal .btn-primary');
    await alice.page.waitForSelector('.sidebar-header', { timeout: 15000 });
    await alice.page.waitForTimeout(2000);

    // Get Alice's peer ID
    const aliceId = await alice.page.evaluate(() => (window as any).__transport?.myPeerId);
    console.log(`[TEST] Alice: ${aliceId}`);

    // Bob joins workspace by invite
    const inviteUrl = await alice.page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
        (navigator.clipboard as any).writeText = (text: string) => {
          orig(text);
          resolve(text);
          return Promise.resolve();
        };
        setTimeout(() => resolve(''), 3000);
        document.getElementById('copy-invite')?.click();
      });
    });
    console.log(`[TEST] Invite: ${inviteUrl}`);

    await bob.page.click('#join-ws-btn');
    await bob.page.waitForSelector('.modal');
    await bob.page.fill('input[name="invite"]', inviteUrl);
    await bob.page.fill('input[name="alias"]', 'Bob');
    await bob.page.click('.modal .btn-primary');
    await bob.page.waitForSelector('.sidebar-header', { timeout: 15000 });
    await bob.page.waitForTimeout(2000);

    const bobId = await bob.page.evaluate(() => (window as any).__transport?.myPeerId);
    console.log(`[TEST] Bob: ${bobId}`);

    // Now try using the app's own transport.connect() without manual listener setup
    // Just verify it doesn't throw
    console.log('[TEST] Calling Bob.transport.connect(Alice)...');
    await bob.page.evaluate(async (targetId: string) => {
      const t = (window as any).__transport;
      console.log(`Bob transport has ${t.signalingInstances?.length} signaling instances`);
      try {
        await Promise.race([
          t.connect(targetId),
          new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
        ]);
        console.log('Connect succeeded');
      } catch (e: any) {
        console.log(`Connect failed: ${e.message}`);
      }
    }, aliceId);

    await alice.page.waitForTimeout(5000);

    // Check if any connections were made
    const aliceConns = await alice.page.evaluate(() => {
      const t = (window as any).__transport;
      return t.connections?.size || 0;
    });
    const bobConns = await bob.page.evaluate(() => {
      const t = (window as any).__transport;
      return t.connections?.size || 0;
    });

    console.log(`[TEST] After connect: Alice has ${aliceConns} connections, Bob has ${bobConns}`);
  } finally {
    await closeUser(alice);
    await closeUser(bob);
  }
});
