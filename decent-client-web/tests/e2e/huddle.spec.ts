import { test, expect, BrowserContext, Page } from '@playwright/test';

/**
 * Huddle (Voice Calling) E2E Tests
 *
 * Tests Slack-style P2P voice huddles over WebRTC.
 * Signaling goes through the existing data channel.
 * getUserMedia is mocked (no real mic in headless Chromium).
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

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

async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });
  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });
}

/** Mock getUserMedia so huddles work in headless Chromium (no real mic) */
async function mockGetUserMedia(context: BrowserContext) {
  await context.grantPermissions(['microphone']);
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      return dest.stream;
    };
  });
}

async function createWorkspaceAndGetInvite(
  page: Page,
  name: string,
  alias: string,
): Promise<string> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 5000 });

  const inviteUrl = await page.evaluate(() => {
    return new Promise<string>((resolve) => {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      (navigator.clipboard as any).writeText = (text: string) => {
        (navigator.clipboard as any).writeText = original;
        resolve(text);
        return Promise.resolve();
      };
      document.getElementById('copy-invite')?.click();
      setTimeout(() => resolve(''), 3000);
    });
  });

  return inviteUrl;
}

async function joinViaInvite(page: Page, inviteUrl: string, alias: string) {
  await page.goto(inviteUrl);
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForTimeout(2000);
}

async function createWorkspace(page: Page, name: string, alias: string) {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 5000 });
}

/** Wait for P2P connection between peers (encrypted connection toast) */
async function waitForPeerConnection(page: Page, timeoutMs = 30000) {
  await page.waitForFunction(
    () => {
      const toasts = document.querySelectorAll('.toast');
      return Array.from(toasts).some(t =>
        t.textContent?.includes('Encrypted connection') ||
        t.textContent?.includes('🔐'),
      );
    },
    { timeout: timeoutMs },
  );
}

// ─── Single-User Tests ──────────────────────────────────────────────────────

test.describe('Huddle — Single User', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    await mockGetUserMedia(context);
    page = await context.newPage();
    await clearStorage(page);
    await waitForApp(page);
    await createWorkspace(page, 'Huddle Test', 'Alice');
  });

  test.afterEach(async () => {
    await context?.close();
  });

  test('huddle start button appears in channel header', async () => {
    await expect(page.locator('#huddle-start-btn')).toBeVisible();
  });

  test('clicking start huddle shows active huddle bar', async () => {
    await page.click('#huddle-start-btn');

    // Huddle bar should appear
    await page.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      },
      { timeout: 10000 },
    );
    await expect(page.locator('#huddle-bar')).toBeVisible();

    // Should show at least one participant avatar (self)
    await expect(page.locator('#huddle-participants .huddle-avatar')).toHaveCount(1, { timeout: 5000 });
  });

  test('mute button toggles mute state', async () => {
    await page.click('#huddle-start-btn');
    await page.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      },
      { timeout: 10000 },
    );

    // Initially unmuted — button shows mic icon
    const muteBtn = page.locator('#huddle-mute-btn');
    const initialText = await muteBtn.textContent();
    expect(initialText).toContain('🎤');

    // Click mute
    await muteBtn.click();
    await page.waitForTimeout(300);

    // Should now show muted icon
    const mutedText = await muteBtn.textContent();
    expect(mutedText).toContain('🔇');

    // Click again to unmute
    await muteBtn.click();
    await page.waitForTimeout(300);

    const unmutedText = await muteBtn.textContent();
    expect(unmutedText).toContain('🎤');
  });

  test('leave button ends huddle and hides bar', async () => {
    await page.click('#huddle-start-btn');
    await page.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      },
      { timeout: 10000 },
    );
    await expect(page.locator('#huddle-bar')).toBeVisible();

    // Click leave
    await page.click('#huddle-leave-btn');

    // Bar should disappear
    await page.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return !bar || bar.style.display === 'none';
      },
      { timeout: 10000 },
    );

    // Join banner should also not be visible
    const joinBanner = page.locator('#huddle-join-banner');
    await expect(joinBanner).not.toBeVisible();
  });
});

// ─── Multi-User Tests ───────────────────────────────────────────────────────

test.describe('Huddle — Multi User', () => {
  let aliceContext: BrowserContext;
  let bobContext: BrowserContext;
  let alice: Page;
  let bob: Page;

  test.beforeEach(async ({ browser }) => {
    aliceContext = await browser.newContext();
    bobContext = await browser.newContext();

    // Mock getUserMedia in BOTH contexts before any pages are created
    await mockGetUserMedia(aliceContext);
    await mockGetUserMedia(bobContext);

    alice = await aliceContext.newPage();
    bob = await bobContext.newPage();

    await clearStorage(alice);
    await clearStorage(bob);

    await waitForApp(alice);
    await waitForApp(bob);

    // Alice creates workspace, Bob joins via invite
    const inviteUrl = await createWorkspaceAndGetInvite(alice, 'Huddle Room', 'Alice');
    expect(inviteUrl).toBeTruthy();
    expect(inviteUrl).toContain('/join/');

    await joinViaInvite(bob, inviteUrl, 'Bob');
    await waitForApp(bob);

    // Wait for P2P connection to establish
    await waitForPeerConnection(alice);
  });

  test.afterEach(async () => {
    await aliceContext?.close();
    await bobContext?.close();
  });

  test('Bob sees join banner when Alice starts a huddle', async () => {
    // Alice starts huddle
    await alice.click('#huddle-start-btn');
    await alice.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      },
      { timeout: 10000 },
    );

    // Bob should see the join banner
    await bob.waitForFunction(
      () => {
        const banner = document.getElementById('huddle-join-banner');
        return banner && banner.style.display !== 'none';
      },
      { timeout: 15000 },
    );
    await expect(bob.locator('#huddle-join-banner')).toBeVisible();
    await expect(bob.locator('.huddle-join-text')).toContainText('Huddle in progress');
    await expect(bob.locator('#huddle-join-btn')).toBeVisible();
  });

  test('Bob joins huddle and both see participants', async () => {
    // Alice starts huddle
    await alice.click('#huddle-start-btn');
    await alice.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      },
      { timeout: 10000 },
    );

    // Wait for Bob to see join banner
    await bob.waitForFunction(
      () => {
        const banner = document.getElementById('huddle-join-banner');
        return banner && banner.style.display !== 'none';
      },
      { timeout: 15000 },
    );

    // Bob clicks join
    await bob.click('#huddle-join-btn');

    // Bob should now see the active huddle bar
    await bob.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      },
      { timeout: 10000 },
    );
    await expect(bob.locator('#huddle-bar')).toBeVisible();

    // Both should have mute and leave controls
    await expect(bob.locator('#huddle-mute-btn')).toBeVisible();
    await expect(bob.locator('#huddle-leave-btn')).toBeVisible();
    await expect(alice.locator('#huddle-mute-btn')).toBeVisible();
    await expect(alice.locator('#huddle-leave-btn')).toBeVisible();
  });

  test('huddle ends when last member leaves', async () => {
    // Alice starts huddle
    await alice.click('#huddle-start-btn');
    await alice.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      },
      { timeout: 10000 },
    );

    // Wait for Bob to see join banner
    await bob.waitForFunction(
      () => {
        const banner = document.getElementById('huddle-join-banner');
        return banner && banner.style.display !== 'none';
      },
      { timeout: 15000 },
    );

    // Bob joins
    await bob.click('#huddle-join-btn');
    await bob.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return bar && bar.style.display !== 'none';
      },
      { timeout: 10000 },
    );

    // Alice leaves
    await alice.click('#huddle-leave-btn');
    await alice.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return !bar || bar.style.display === 'none';
      },
      { timeout: 10000 },
    );

    // Bob leaves
    await bob.click('#huddle-leave-btn');
    await bob.waitForFunction(
      () => {
        const bar = document.getElementById('huddle-bar');
        return !bar || bar.style.display === 'none';
      },
      { timeout: 10000 },
    );

    // Neither should see any huddle UI
    await expect(alice.locator('#huddle-bar')).not.toBeVisible();
    await expect(alice.locator('#huddle-join-banner')).not.toBeVisible();
    await expect(bob.locator('#huddle-bar')).not.toBeVisible();
    await expect(bob.locator('#huddle-join-banner')).not.toBeVisible();
  });
});
