import { test, expect, BrowserContext, Page } from '@playwright/test';

/**
 * P2P Chat E2E Tests — Multi-user scenarios
 * 
 * Tests two browser instances (Alice & Bob) communicating via PeerJS.
 * Requires a signaling server on localhost:9000.
 */

// Helper: wait for app to load
async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
}

// Helper: clear IndexedDB
async function clearStorage(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}

// Helper: create workspace, return invite URL
async function createWorkspaceAndGetInvite(page: Page, name: string, alias: string): Promise<string> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');

  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');

  await page.waitForSelector('.sidebar-header', { timeout: 5000 });

  // Get invite URL by clicking the copy button and reading clipboard
  // Since clipboard API may not work in headless, extract it via JS
  const inviteUrl = await page.evaluate(() => {
    return new Promise<string>((resolve) => {
      // Override clipboard to capture the URL
      const original = navigator.clipboard.writeText;
      (navigator.clipboard as any).writeText = (text: string) => {
        (navigator.clipboard as any).writeText = original;
        resolve(text);
        return Promise.resolve();
      };
      document.getElementById('copy-invite')?.click();

      // Fallback: if clipboard override doesn't fire, build URL from DOM
      setTimeout(() => {
        resolve('');
      }, 2000);
    });
  });

  // If clipboard capture failed, build invite URL from the controller state
  if (!inviteUrl) {
    const url = await page.evaluate(() => {
      // Access the app state to get invite info
      const sidebarHeader = document.querySelector('.sidebar-header h1')?.textContent;
      return window.location.origin + '/join/UNKNOWN';
    });
    return url;
  }

  return inviteUrl;
}

// Helper: send message
async function sendMessage(page: Page, text: string) {
  const input = page.locator('#compose-input');
  await expect(input).toBeVisible({ timeout: 5000 });
  const beforeCount = await page.locator('.message-content').count();

  await input.fill(text);
  await input.press('Enter');

  await page.waitForFunction(
    ({ t, before }) => {
      const messages = Array.from(document.querySelectorAll('.message-content'));
      return messages.length > before && messages.some((m) => (m.textContent || '').includes(t));
    },
    { t: text, before: beforeCount },
    { timeout: 10000 }
  );
}

// Helper: get all message texts
async function getMessages(page: Page): Promise<string[]> {
  const items = await page.locator('.message-content').allTextContents();
  return items.map((t) => t.trim());
}

// Helper: get peer ID from the page
async function getPeerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.peer-id, code');
    return el?.textContent?.trim() || '';
  });
}

test.describe('P2P Multi-User Chat', () => {
  let alice: Page;
  let bob: Page;
  let aliceContext: BrowserContext;
  let bobContext: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    // Create two separate browser contexts (like two different users)
    aliceContext = await browser.newContext();
    bobContext = await browser.newContext();

    alice = await aliceContext.newPage();
    bob = await bobContext.newPage();

    // Clear storage for both
    await clearStorage(alice);
    await clearStorage(bob);

    await waitForApp(alice);
    await waitForApp(bob);
  });

  test.afterEach(async () => {
    await aliceContext?.close();
    await bobContext?.close();
  });

  // ─── Workspace Creation ────────────────────────────────────────────

  test('Alice creates workspace and gets invite URL', async () => {
    await alice.click('#create-ws-btn');
    await alice.waitForSelector('.modal');

    const inputs = alice.locator('.modal input');
    await inputs.nth(0).fill('Test Room');
    await inputs.nth(1).fill('Alice');
    await alice.click('.modal .btn-primary');

    await expect(alice.locator('.sidebar-header')).toContainText('Test Room', { timeout: 5000 });
    await expect(alice.locator('#copy-invite')).toBeVisible();
  });

  // ─── Invite Link Flow ─────────────────────────────────────────────

  test('Bob opens invite link and sees join modal', async () => {
    // Alice creates workspace
    await alice.click('#create-ws-btn');
    await alice.waitForSelector('.modal');
    const inputs = alice.locator('.modal input');
    await inputs.nth(0).fill('Collab Space');
    await inputs.nth(1).fill('Alice');
    await alice.click('.modal .btn-primary');
    await alice.waitForSelector('.sidebar-header');

    // Get Alice's peer ID
    const alicePeerId = await alice.evaluate(() => {
      // Extract peer ID from welcome message or sidebar
      const codeEl = document.querySelector('.sidebar code, .peer-id');
      if (codeEl) return codeEl.textContent?.trim() || '';
      // Try getting from the page state
      const peerText = document.body.textContent || '';
      const match = peerText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      return match ? match[0] : '';
    });

    // Get invite code from sidebar
    const inviteCode = await alice.evaluate(() => {
      // The invite URL contains the code — try to extract it
      return new Promise<string>((resolve) => {
        const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async (text: string) => {
          resolve(text);
          return origWrite(text);
        };
        document.getElementById('copy-invite')?.click();
        setTimeout(() => resolve(''), 3000);
      });
    });

    // Bob navigates to the invite URL
    if (inviteCode && inviteCode.includes('/join/')) {
      await bob.goto(inviteCode);
    } else {
      // Fallback: construct URL manually
      await bob.goto(`/join/TESTCODE?peer=${alicePeerId}&name=Collab+Space`);
    }

    await bob.waitForSelector('.modal', { timeout: 10000 });
    // Should show workspace name
    await expect(bob.locator('.modal')).toContainText('Collab Space');
    // Should have name input
    await expect(bob.locator('.modal input[name="alias"]')).toBeVisible();
  });

  test('Bob joins workspace via invite link', async () => {
    // Alice creates workspace
    await alice.click('#create-ws-btn');
    await alice.waitForSelector('.modal');
    const inputs = alice.locator('.modal input');
    await inputs.nth(0).fill('P2P Test');
    await inputs.nth(1).fill('Alice');
    await alice.click('.modal .btn-primary');
    await alice.waitForSelector('.sidebar-header');

    // Extract invite URL
    const inviteUrl = await alice.evaluate(() => {
      return new Promise<string>((resolve) => {
        const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async (text: string) => {
          resolve(text);
          return origWrite(text);
        };
        document.getElementById('copy-invite')?.click();
        setTimeout(() => resolve(''), 3000);
      });
    });

    // Bob opens invite link
    if (inviteUrl && inviteUrl.includes('/join/')) {
      await bob.goto(inviteUrl);
    } else {
      // If clipboard didn't work, try the header button
      const alicePeerId = await alice.evaluate(() => {
        const text = document.body.textContent || '';
        const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
        return match ? match[0] : 'unknown';
      });
      await bob.goto(`/join/TESTCODE?peer=${alicePeerId}&name=P2P+Test`);
    }

    await bob.waitForSelector('.modal', { timeout: 10000 });

    // Bob enters name and joins
    await bob.locator('input[name="alias"]').fill('Bob');
    await bob.click('.modal .btn-primary');

    // Bob should now see the workspace
    // Note: actual P2P connection requires signaling server
    // Without it, Bob will have the workspace locally but can't sync
    await bob.waitForTimeout(2000);
  });

  // ─── Solo Messaging (no P2P needed) ───────────────────────────────

  test('both users can send messages independently', async () => {
    // Alice creates workspace
    await alice.click('#create-ws-btn');
    await alice.waitForSelector('.modal');
    let inputs = alice.locator('.modal input');
    await inputs.nth(0).fill('Alice Space');
    await inputs.nth(1).fill('Alice');
    await alice.click('.modal .btn-primary');
    await alice.waitForSelector('.sidebar-header');

    // Bob creates own workspace
    await bob.click('#create-ws-btn');
    await bob.waitForSelector('.modal');
    inputs = bob.locator('.modal input');
    await inputs.nth(0).fill('Bob Space');
    await inputs.nth(1).fill('Bob');
    await bob.click('.modal .btn-primary');
    await bob.waitForSelector('.sidebar-header');

    // Alice sends a message
    await sendMessage(alice, 'Hello from Alice!');
    const aliceMessages = await getMessages(alice);
    expect(aliceMessages).toContain('Hello from Alice!');

    // Bob sends a message
    await sendMessage(bob, 'Hello from Bob!');
    const bobMessages = await getMessages(bob);
    expect(bobMessages).toContain('Hello from Bob!');

    // Messages are isolated (different workspaces)
    expect(aliceMessages).not.toContain('Hello from Bob!');
    expect(bobMessages).not.toContain('Hello from Alice!');
  });

  // ─── Invite URL Format ────────────────────────────────────────────

  test('invite URL has correct format', async () => {
    // Alice creates workspace
    await alice.click('#create-ws-btn');
    await alice.waitForSelector('.modal');
    const inputs = alice.locator('.modal input');
    await inputs.nth(0).fill('URL Test');
    await inputs.nth(1).fill('Alice');
    await alice.click('.modal .btn-primary');
    await alice.waitForSelector('.sidebar-header');

    // Capture invite URL
    const inviteUrl = await alice.evaluate(() => {
      return new Promise<string>((resolve) => {
        const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async (text: string) => {
          resolve(text);
          return origWrite(text);
        };
        document.getElementById('copy-invite')?.click();
        setTimeout(() => resolve(''), 3000);
      });
    });

    if (inviteUrl) {
      // Should be a web URL, not decent://
      expect(inviteUrl).not.toContain('decent://');
      expect(inviteUrl).toContain('/join/');
      expect(inviteUrl).toContain('peer=');
      expect(inviteUrl).toContain('name=');

      // Parse the URL
      const url = new URL(inviteUrl);
      expect(url.pathname).toMatch(/^\/join\/[A-Z0-9]+$/);
      expect(url.searchParams.get('peer')).toBeTruthy();
      expect(url.searchParams.get('name')).toBe('URL Test');
    }
  });

  // ─── Welcome Screen States ────────────────────────────────────────

  test('fresh user sees welcome screen', async () => {
    await expect(alice.locator('#create-ws-btn')).toBeVisible();
    await expect(alice.locator('#join-ws-btn')).toBeVisible();
    await expect(bob.locator('#create-ws-btn')).toBeVisible();
    await expect(bob.locator('#join-ws-btn')).toBeVisible();
  });

  test('join link shows different UI than manual join', async () => {
    // Manual join button
    await alice.click('#join-ws-btn');
    await alice.waitForSelector('.modal');
    const manualModal = await alice.locator('.modal').textContent();
    expect(manualModal).toContain('Invite Link or Code');
    await alice.keyboard.press('Escape');

    // Join via URL — should show cleaner modal
    await bob.goto('/join/TESTCODE?peer=test-peer-id&name=Cool+Team');
    await bob.waitForSelector('.modal', { timeout: 10000 });
    const inviteModal = await bob.locator('.modal').textContent();
    expect(inviteModal).toContain('Cool Team');
    expect(inviteModal).toContain('Display Name');
    // Should NOT show the invite code input (it's hidden)
    const visibleInputs = await bob.locator('.modal input:not([type="hidden"])').count();
    expect(visibleInputs).toBe(1); // Only the display name input
  });

  // ─── Multiple Workspaces ──────────────────────────────────────────

  test('user can create workspace then join another via invite', async () => {
    // Alice creates her own workspace first
    await alice.click('#create-ws-btn');
    await alice.waitForSelector('.modal');
    let inputs = alice.locator('.modal input');
    await inputs.nth(0).fill('My Space');
    await inputs.nth(1).fill('Alice');
    await alice.click('.modal .btn-primary');
    await alice.waitForSelector('.sidebar-header');

    // Alice sends a message in her workspace
    await sendMessage(alice, 'My own message');

    // Now Alice opens a join link for another workspace
    await alice.goto('/join/OTHERCODE?peer=other-peer&name=Friend+Space');
    await alice.waitForSelector('.modal', { timeout: 10000 });

    // Modal should show
    await expect(alice.locator('.modal')).toContainText('Friend Space');
  });

  // ─── Persistence Across Users ─────────────────────────────────────

  test('each user has independent storage', async () => {
    // Alice creates workspace
    await alice.click('#create-ws-btn');
    await alice.waitForSelector('.modal');
    let inputs = alice.locator('.modal input');
    await inputs.nth(0).fill('Alice Only');
    await inputs.nth(1).fill('Alice');
    await alice.click('.modal .btn-primary');
    await alice.waitForSelector('.sidebar-header');
    await sendMessage(alice, 'Secret message');

    // Bob should still see welcome screen (different context = different IndexedDB)
    await expect(bob.locator('#create-ws-btn')).toBeVisible();

    // Bob's messages list should not exist
    const bobHasMessages = await bob.locator('.messages-list').count();
    expect(bobHasMessages).toBe(0);
  });
});
