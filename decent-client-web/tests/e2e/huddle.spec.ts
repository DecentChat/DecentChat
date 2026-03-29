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
  await page.goto('/app');
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
  await page.waitForSelector('#create-ws-btn-nav, #create-ws-btn, .sidebar-header', { timeout: 15000 });
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
  await page.click('#create-ws-btn-nav');
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
  await page.click('#create-ws-btn-nav');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 5000 });
}

/** Wait for peers to appear as online in the sidebar member list */
async function waitForPeerConnection(page: Page, expectedOnline = 2, timeoutMs = 30000) {
  await page.waitForFunction(
    (min: number) => {
      const headers = document.querySelectorAll('.member-group-header');
      for (const h of headers) {
        const match = h.textContent?.match(/Online\s*—\s*(\d+)/);
        if (match && parseInt(match[1], 10) >= min) return true;
      }
      return false;
    },
    expectedOnline,
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

// ─── Audio / WebRTC Diagnostic Tests ────────────────────────────────────────
// These tests check the actual WebRTC connection state and audio element state
// to catch audio playback bugs that don't surface in UI-only tests.

test.describe('Huddle — Audio & WebRTC Diagnostics', () => {
  let aliceContext: BrowserContext;
  let bobContext: BrowserContext;
  let alice: Page;
  let bob: Page;

  /** Mock getUserMedia with a real OscillatorNode so there's actual audio data flowing */
  async function mockWithOscillator(context: BrowserContext) {
    await context.grantPermissions(['microphone']);
    await context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const audioCtx = new AudioContext();
        const oscillator = audioCtx.createOscillator();
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
        const dest = audioCtx.createMediaStreamDestination();
        oscillator.connect(dest);
        oscillator.start();
        return dest.stream;
      };
    });
  }

  test.beforeEach(async ({ browser }) => {
    aliceContext = await browser.newContext();
    bobContext = await browser.newContext();
    await mockWithOscillator(aliceContext);
    await mockWithOscillator(bobContext);
    alice = await aliceContext.newPage();
    bob = await bobContext.newPage();
    await clearStorage(alice);
    await clearStorage(bob);
    await waitForApp(alice);
    await waitForApp(bob);
    const inviteUrl = await createWorkspaceAndGetInvite(alice, 'Audio Test', 'Alice');
    await joinViaInvite(bob, inviteUrl, 'Bob');
    await waitForApp(bob);
    await waitForPeerConnection(alice);
  });

  test.afterEach(async () => {
    await aliceContext?.close();
    await bobContext?.close();
  });

  test('WebRTC audio connection reaches connected state and audio elements play', async () => {
    // Capture console messages from both pages for diagnostics
    const aliceLogs: string[] = [];
    const bobLogs: string[] = [];
    alice.on('console', msg => { if (msg.text().includes('[Huddle]')) aliceLogs.push(`Alice: ${msg.text()}`); });
    bob.on('console', msg => { if (msg.text().includes('[Huddle]')) bobLogs.push(`Bob: ${msg.text()}`); });

    // Alice starts huddle
    await alice.click('#huddle-start-btn');
    await alice.waitForFunction(() => {
      const bar = document.getElementById('huddle-bar');
      return bar && bar.style.display !== 'none';
    }, { timeout: 10000 });

    // Bob sees join banner and joins
    await bob.waitForFunction(() => {
      const banner = document.getElementById('huddle-join-banner');
      return banner && banner.style.display !== 'none';
    }, { timeout: 15000 });
    await bob.click('#huddle-join-btn');
    await bob.waitForFunction(() => {
      const bar = document.getElementById('huddle-bar');
      return bar && bar.style.display !== 'none';
    }, { timeout: 10000 });

    // Give WebRTC time to complete ICE and reach 'connected'
    await alice.waitForTimeout(5000);

    // ── Check RTCPeerConnection states ────────────────────────────────────────
    const aliceConnStates = await alice.evaluate(() => {
      return Array.from(document.querySelectorAll('audio')).map(a => ({
        hasSrcObject: !!a.srcObject,
        paused: a.paused,
        readyState: a.readyState,
        srcObjectActive: a.srcObject ? (a.srcObject as MediaStream).active : null,
        tracks: a.srcObject ? (a.srcObject as MediaStream).getTracks().map(t => ({
          kind: t.kind, enabled: t.enabled, readyState: t.readyState, muted: t.muted,
        })) : [],
      }));
    });

    const bobConnStates = await bob.evaluate(() => {
      return Array.from(document.querySelectorAll('audio')).map(a => ({
        hasSrcObject: !!a.srcObject,
        paused: a.paused,
        readyState: a.readyState,
        srcObjectActive: a.srcObject ? (a.srcObject as MediaStream).active : null,
        tracks: a.srcObject ? (a.srcObject as MediaStream).getTracks().map(t => ({
          kind: t.kind, enabled: t.enabled, readyState: t.readyState, muted: t.muted,
        })) : [],
      }));
    });

    // Log diagnostics so failures are debuggable
    console.log('\n=== HUDDLE AUDIO DIAGNOSTICS ===');
    console.log('Alice audio elements:', JSON.stringify(aliceConnStates, null, 2));
    console.log('Bob audio elements:', JSON.stringify(bobConnStates, null, 2));
    console.log('Alice huddle logs:\n', aliceLogs.join('\n'));
    console.log('Bob huddle logs:\n', bobLogs.join('\n'));

    // ── Assertions ────────────────────────────────────────────────────────────

    // Each side should have received the other's audio track → one <audio> element
    expect(aliceConnStates.length).toBeGreaterThanOrEqual(1);
    expect(bobConnStates.length).toBeGreaterThanOrEqual(1);

    // srcObject must be set (stream attached)
    const aliceAudio = aliceConnStates[aliceConnStates.length - 1];
    const bobAudio = bobConnStates[bobConnStates.length - 1];
    expect(aliceAudio.hasSrcObject).toBe(true);
    expect(bobAudio.hasSrcObject).toBe(true);

    // Stream must be active
    expect(aliceAudio.srcObjectActive).toBe(true);
    expect(bobAudio.srcObjectActive).toBe(true);

    // Audio element must NOT be paused (play() succeeded)
    expect(aliceAudio.paused).toBe(false);
    expect(bobAudio.paused).toBe(false);

    // Audio tracks must be live and enabled
    const aliceTrack = aliceAudio.tracks.find(t => t.kind === 'audio');
    const bobTrack = bobAudio.tracks.find(t => t.kind === 'audio');
    expect(aliceTrack?.readyState).toBe('live');
    expect(bobTrack?.readyState).toBe('live');
  });
});
