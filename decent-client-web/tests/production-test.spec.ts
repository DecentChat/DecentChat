const RUN_LIVE_P2P = process.env.PW_RUN_LIVE_P2P === '1';

import { test, expect, chromium } from '@playwright/test';

test('production P2P chat between Alice and Bob', async () => {
  test.skip(!RUN_LIVE_P2P, 'Live production P2P test — opt-in via PW_RUN_LIVE_P2P=1');
  test.setTimeout(90000);
  const browser = await chromium.launch({ headless: false });
  const context1 = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const context2 = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  
  const alice = await context1.newPage();
  const bob = await context2.newPage();
  
  try {
    // Alice goes to production site
    console.log('[Alice] Loading decentchat.app...');
    await alice.goto('https://decentchat.app');
    await alice.waitForLoadState('networkidle');
    
    // Wait for app to load
    await alice.waitForSelector('#create-ws-btn', { timeout: 15000 });
    
    // Create workspace
    console.log('[Alice] Creating workspace...');
    await alice.click('#create-ws-btn');
    await alice.waitForSelector('.modal');
    const inputs = alice.locator('.modal input');
    await inputs.nth(0).fill('Production Test');
    await inputs.nth(1).fill('Alice');
    await alice.click('.modal .btn-primary');
    
    // Wait for workspace to be created
    await alice.waitForSelector('.sidebar-header', { timeout: 10000 });
    console.log('[Alice] Workspace created!');
    
    // Get invite URL by clicking Copy invite link button
    console.log('[Alice] Copying invite URL...');
    await alice.click('button:has-text("Copy invite link")');
    await alice.waitForTimeout(500);
    const inviteUrl = await alice.evaluate(() => navigator.clipboard.readText());
    console.log('[Alice] Invite URL:', inviteUrl);
    
    if (!inviteUrl || !inviteUrl.includes('decentchat.app')) {
      throw new Error(`Invalid invite URL: ${inviteUrl}`);
    }
    
    // Bob joins via invite
    console.log('[Bob] Joining workspace...');
    await bob.goto(inviteUrl);
    await bob.waitForLoadState('networkidle');
    await bob.waitForSelector('.modal', { timeout: 10000 });
    await bob.locator('.modal input').fill('Bob');
    await bob.click('.modal .btn-primary');
    
    // Wait for connection
    await bob.waitForSelector('.sidebar-header', { timeout: 15000 });
    console.log('[Bob] Connected!');
    
    // Wait a bit for P2P handshake
    await alice.waitForTimeout(2000);
    
    // Alice sends message
    console.log('[Alice] Sending message...');
    await alice.locator('#compose-input').fill('Hello from Alice!');
    await alice.locator('#compose-input').press('Enter');
    
    // Bob should see it
    console.log('[Bob] Waiting for message...');
    await bob.waitForSelector('.message-content:has-text("Hello from Alice!")', { timeout: 10000 });
    console.log('[Bob] Message received!');
    
    // Bob replies
    console.log('[Bob] Sending reply...');
    await bob.locator('#compose-input').fill('Hey Alice!');
    await bob.locator('#compose-input').press('Enter');
    
    // Alice should see it
    console.log('[Alice] Waiting for reply...');
    await alice.waitForSelector('.message-content:has-text("Hey Alice!")', { timeout: 10000 });
    console.log('[Alice] Reply received!');
    
    console.log('✅ Production P2P chat test PASSED!');
    
  } finally {
    await browser.close();
  }
});
