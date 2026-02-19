import { test, expect, chromium } from '@playwright/test';

test('production site loads and can create workspace', async () => {
  const browser = await chromium.launch({ headless: false });
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  
  const alice = await context1.newPage();
  const bob = await context2.newPage();
  
  // Alice goes to production site
  await alice.goto('https://decentchat.app');
  await alice.waitForLoadState('networkidle');
  
  // Wait for app to load
  await alice.waitForSelector('#create-ws-btn', { timeout: 10000 });
  
  // Create workspace
  await alice.click('#create-ws-btn');
  await alice.waitForSelector('.modal');
  const inputs = alice.locator('.modal input');
  await inputs.nth(0).fill('Test Workspace');
  await inputs.nth(1).fill('Alice');
  await alice.click('.modal .btn-primary');
  
  // Wait for workspace to be created
  await alice.waitForSelector('.sidebar-header', { timeout: 10000 });
  
  // Get invite URL
  await alice.click('button:has-text("Invite")');
  await alice.waitForSelector('.invite-url');
  const inviteUrl = await alice.locator('.invite-url').inputValue();
  console.log('Invite URL:', inviteUrl);
  
  // Bob joins via invite
  await bob.goto(inviteUrl);
  await bob.waitForSelector('.modal');
  await bob.locator('.modal input').fill('Bob');
  await bob.click('.modal .btn-primary');
  
  // Wait for connection
  await bob.waitForSelector('.sidebar-header', { timeout: 15000 });
  
  // Alice sends message
  await alice.locator('#compose-input').fill('Hello from Alice!');
  await alice.locator('#compose-input').press('Enter');
  
  // Bob should see it
  await bob.waitForSelector('.message-content:has-text("Hello from Alice!")', { timeout: 10000 });
  
  // Bob replies
  await bob.locator('#compose-input').fill('Hey Alice!');
  await bob.locator('#compose-input').press('Enter');
  
  // Alice should see it
  await alice.waitForSelector('.message-content:has-text("Hey Alice!")', { timeout: 10000 });
  
  console.log('✅ Production test passed!');
  
  await browser.close();
});
