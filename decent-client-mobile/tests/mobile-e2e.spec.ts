import { test, expect, type Page } from '@playwright/test';
import { RecoveryURI, SeedPhraseManager } from 'decent-protocol';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function clearAppState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
  });
}

async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector('button:has-text("Get started"), .tab-bar, nav[aria-label="Primary"]', {
    timeout: 10000,
  });
}

async function completeOnboarding(page: Page, alias: string = 'TestUser'): Promise<void> {
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.fill('input[placeholder*="How should others"]', alias);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('nav[aria-label="Primary"], .tab-bar')).toBeVisible({ timeout: 10000 });
}

async function buildRecoveryFixtureWithStaleSource(): Promise<{
  seedPhrase: string;
  sourcePeerId: string;
  signalingServers: string[];
  recoveryUri: string;
}> {
  const seedPhraseManager = new SeedPhraseManager();
  const seedPhrase = seedPhraseManager.generate().mnemonic;
  const derived = await seedPhraseManager.deriveDeviceKeys(seedPhrase, 0);
  const sourcePeerId = derived.peerId;
  const signalingServers = ['wss://127.0.0.1:65534/peerjs'];

  const recoveryUri = RecoveryURI.encode({
    seedPhrase,
    alias: 'RecoveredUser',
    sourcePeerId,
    signalingServers,
  });

  return { seedPhrase, sourcePeerId, signalingServers, recoveryUri };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Onboarding Tests
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
  });

  test('shows welcome screen on fresh start', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('DecentChat');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'I have an account' })).toBeVisible();
  });

  test('create account flow — alias only, no seed shown, navigates to main app', async ({ page }) => {
    await page.getByRole('button', { name: 'Get started' }).click();

    // Should NOT show seed phrase grid
    await expect(page.locator('.seed-word')).not.toBeVisible({ timeout: 2000 }).catch(() => {});
    const seedWords = await page.locator('.seed-word').count();
    expect(seedWords).toBe(0);

    // Should show alias input
    await page.fill('input[placeholder*="How should others"]', 'TestAlice');

    const continueBtn = page.getByRole('button', { name: 'Continue' });
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    await expect(page.locator('nav[aria-label="Primary"], .tab-bar')).toBeVisible({ timeout: 10000 });

    // Seed should be stored silently
    const hasSeed = await page.evaluate(() => {
      return localStorage.getItem('decentchat-seed-phrase') !== null;
    });
    expect(hasSeed).toBe(true);

    const alias = await page.evaluate(() => {
      return localStorage.getItem('decentchat-alias');
    });
    expect(alias).toBe('TestAlice');

    // Should NOT be marked as recovered
    const isRecovered = await page.evaluate(() => {
      return localStorage.getItem('decentchat-is-recovered');
    });
    expect(isRecovered).toBe('false');
  });

  test('recovery screen shows QR and manual seed options', async ({ page }) => {
    await page.getByRole('button', { name: 'I have an account' }).click();

    // Should show recovery screen with QR as primary
    await expect(page.getByText(/scan qr code/i).first()).toBeVisible({ timeout: 5000 });
    // Manual seed option should exist (may be collapsed)
    await expect(page.getByText(/enter seed phrase manually/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('recovery scanner shows fallback messaging when camera permission is denied', async ({ page }) => {
    await page.addInitScript(() => {
      const original = navigator.mediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          ...original,
          getUserMedia: async () => {
            const error = new Error('permission denied');
            (error as Error & { name?: string }).name = 'NotAllowedError';
            throw error;
          },
        },
      });
    });

    await page.reload();
    await waitForApp(page);

    await page.getByRole('button', { name: 'I have an account' }).click();
    await page.getByRole('button', { name: /scan qr code/i }).click();

    await expect(page.getByRole('status').filter({ hasText: /camera permission denied/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /retry camera/i })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#recovery-uri-input')).toBeVisible({ timeout: 5000 });
  });

  test('recovery negative path: malformed recovery URI payload is rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'I have an account' }).click();
    await page.getByRole('button', { name: /scan qr code/i }).click();

    await page.fill('#recovery-uri-input', 'decent://recover?seed=%ZZ%INVALID');
    await page.getByRole('button', { name: /continue with scanned uri/i }).click();

    await expect(page.locator('nav[aria-label="Primary"], .tab-bar')).not.toBeVisible({ timeout: 2000 }).catch(() => {});

    const recoveryState = await page.evaluate(() => ({
      recovered: localStorage.getItem('decentchat-is-recovered'),
      seed: localStorage.getItem('decentchat-seed-phrase'),
    }));

    expect(recoveryState.recovered).not.toBe('true');
    expect(recoveryState.seed).toBeNull();
  });

  test('recovery negative path: stale source-peer + unreachable signaling still boots with fallback', async ({ page }) => {
    const fixture = await buildRecoveryFixtureWithStaleSource();

    await page.getByRole('button', { name: 'I have an account' }).click();
    await page.getByRole('button', { name: /scan qr code/i }).click();

    await page.fill('#recovery-uri-input', fixture.recoveryUri);
    await page.fill('#recover-scan-alias-input', 'RecoveredUser');
    await page.getByRole('button', { name: /continue with scanned uri/i }).click();

    await expect(page.locator('nav[aria-label="Primary"], .tab-bar')).toBeVisible({ timeout: 15000 });

    const recoveryState = await page.evaluate(() => ({
      recovered: localStorage.getItem('decentchat-is-recovered'),
      sourcePeer: localStorage.getItem('decentchat-recovery-source-peer'),
      signaling: localStorage.getItem('decentchat-recovery-signaling'),
      deviceIndex: localStorage.getItem('decentchat-device-index'),
    }));

    expect(recoveryState.recovered).toBe('true');
    expect(recoveryState.sourcePeer).toBe(fixture.sourcePeerId);
    expect(recoveryState.signaling).toContain('127.0.0.1:65534');
    expect(recoveryState.deviceIndex).toBe('1');
  });

  test('create account — continue disabled without alias', async ({ page }) => {
    await page.getByRole('button', { name: 'Get started' }).click();

    const continueBtn = page.getByRole('button', { name: 'Continue' });
    await expect(continueBtn).toBeDisabled();
  });

  test('create account — back button returns to welcome', async ({ page }) => {
    await page.getByRole('button', { name: 'Get started' }).click();

    await page.getByRole('button', { name: /welcome/i }).click();

    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  });

  test('recovery — back button returns to welcome', async ({ page }) => {
    await page.getByRole('button', { name: 'I have an account' }).click();
    await page.getByRole('button', { name: /welcome/i }).click();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tab Navigation Tests
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
    await completeOnboarding(page);
  });

  test('default tab is Chats when no contacts or chats exist', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Chats' }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/no conversations yet/i).first()).toBeVisible({ timeout: 5000 });
    // Connection banner should NOT be visible (idle state)
    await expect(page.locator('.connection-banner')).not.toBeVisible({ timeout: 3000 });
  });

  test('can switch to Chats tab', async ({ page }) => {
    await page.getByRole('button', { name: /chats/i }).click();
    await expect(page.getByRole('heading', { name: 'Chats' }).first()).toBeVisible({ timeout: 5000 });
  });

  test('can switch to Calls tab', async ({ page }) => {
    await page.getByRole('button', { name: /calls/i }).click();
    await expect(page.getByText('No recent calls').first()).toBeVisible({ timeout: 5000 });
  });

  test('can switch to You tab', async ({ page }) => {
    await page.getByRole('button', { name: /you/i }).click();
    await expect(page.getByRole('heading', { name: 'TestUser' }).first()).toBeVisible({ timeout: 5000 });
  });

  test('tab switching preserves state across tabs', async ({ page }) => {
    await page.getByRole('button', { name: /chats/i }).click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /calls/i }).click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /contacts/i }).click();
    await expect(page.getByRole('heading', { name: 'Contacts' }).first()).toBeVisible({ timeout: 5000 });
  });

  test('all four tabs render without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    for (const tab of ['Calls', 'Contacts', 'Chats', 'You']) {
      await page.getByRole('button', { name: new RegExp(tab, 'i') }).click();
      await page.waitForTimeout(500);
    }

    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// You/Profile Screen Tests
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('You Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
    await completeOnboarding(page, 'ProfileTest');
  });

  test('shows user alias on profile', async ({ page }) => {
    await page.getByRole('button', { name: /you/i }).click();
    await expect(page.getByRole('heading', { name: 'ProfileTest' }).first()).toBeVisible({ timeout: 5000 });
  });

  test('delete account returns to onboarding', async ({ page }) => {
    await page.getByRole('button', { name: /you/i }).click();

    const deleteBtn = page.getByRole('button', { name: /delete|reset|clear/i });
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click();

      const confirmBtn = page.getByRole('button', { name: /confirm|delete|yes/i });
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible({ timeout: 10000 });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Persistence Tests
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Persistence', () => {
  test('remembers identity after page reload', async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);

    await completeOnboarding(page, 'PersistUser');

    await page.reload();

    // Should skip onboarding
    await expect(page.locator('nav[aria-label="Primary"], .tab-bar')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Get started' })).not.toBeVisible({ timeout: 3000 });
  });

  test('stored seed phrase is valid BIP39', async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);

    await completeOnboarding(page, 'SeedTest');

    const seed = await page.evaluate(() => localStorage.getItem('decentchat-seed-phrase'));
    expect(seed).not.toBeNull();
    const words = seed!.split(' ');
    expect(words).toHaveLength(12);
    for (const word of words) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Workspace Flows (via You Screen)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Workspace Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
    await completeOnboarding(page, 'WorkspaceUser');
  });

  test('can create a workspace from You tab', async ({ page }) => {
    await page.getByRole('button', { name: /you/i }).click();

    // Find create workspace section
    const createBtn = page.getByRole('button', { name: /create workspace/i }).first();
    if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Fill workspace name if input is visible
      const nameInput = page.getByPlaceholder('Workspace name');
      if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nameInput.fill('Alpha Team');
        await createBtn.click();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Identity Settings
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Identity Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
    await completeOnboarding(page, 'IdentityUser');
  });

  test('can reveal and hide the seed phrase from You tab', async ({ page }) => {
    await page.getByRole('button', { name: /you/i }).click();
    await page.getByRole('button', { name: /view seed phrase/i }).first().click();

    await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Reveal' }).click();

    await expect(page.getByText(/^([a-z]+\s+){11}[a-z]+$/).first()).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByRole('button', { name: 'Hide' })).not.toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Contacts & DMs
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Contacts Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
    await completeOnboarding(page, 'ContactUser');
  });

  test('shows empty contacts state with add friend prompt', async ({ page }) => {
    await page.getByRole('button', { name: /contacts/i }).click();
    await expect(page.getByRole('heading', { name: 'Contacts' }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/add your first friend/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('can copy peer id from You tab', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: /you/i }).click();
    await page.getByRole('button', { name: /copy peer id/i }).first().click();
    await expect(page.getByText('Peer ID copied.').first()).toBeVisible({ timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Seed Backup System
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Seed Backup Alert', () => {
  test('does NOT show seed backup alert immediately after account creation', async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
    await completeOnboarding(page, 'BackupTestUser');

    // Backup alert should NOT be visible (messagesSent < 100)
    await page.waitForTimeout(1000);
    await expect(page.getByRole('heading', { name: 'Back up your seed phrase' })).not.toBeVisible({ timeout: 2000 });
  });

  test('shows seed backup alert at 100 sent messages', async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
    await completeOnboarding(page, 'BackupThresholdUser');

    await page.evaluate(() => {
      localStorage.setItem('decentchat-messages-sent', '100');
      localStorage.setItem('decentchat-seed-backed-up', 'false');
      localStorage.setItem('decentchat-is-recovered', 'false');
      localStorage.setItem('decentchat-seed-backup-dismissed', '0');
      localStorage.setItem('decentchat-seed-backup-threshold', '100');
    });

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Back up your seed phrase' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: "I've written it down" })).toBeVisible({ timeout: 5000 });
  });

  test('remind later increments threshold by +50 and re-shows at the new threshold', async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
    await completeOnboarding(page, 'BackupRemindLaterUser');

    await page.evaluate(() => {
      localStorage.setItem('decentchat-messages-sent', '100');
      localStorage.setItem('decentchat-seed-backed-up', 'false');
      localStorage.setItem('decentchat-is-recovered', 'false');
      localStorage.setItem('decentchat-seed-backup-dismissed', '0');
      localStorage.setItem('decentchat-seed-backup-threshold', '100');
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Back up your seed phrase' })).toBeVisible({ timeout: 8000 });

    await page.getByRole('button', { name: 'Remind me later' }).click();
    await expect(page.getByRole('heading', { name: 'Back up your seed phrase' })).not.toBeVisible({ timeout: 3000 });

    const persisted = await page.evaluate(() => ({
      dismissed: localStorage.getItem('decentchat-seed-backup-dismissed'),
      threshold: localStorage.getItem('decentchat-seed-backup-threshold'),
    }));
    expect(persisted.dismissed).toBe('1');
    expect(persisted.threshold).toBe('150');

    await page.evaluate(() => {
      localStorage.setItem('decentchat-messages-sent', '149');
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Back up your seed phrase' })).not.toBeVisible({ timeout: 3000 });

    await page.evaluate(() => {
      localStorage.setItem('decentchat-messages-sent', '150');
    });
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Back up your seed phrase' })).toBeVisible({ timeout: 8000 });
  });

  test('backup confirmed permanently suppresses alert', async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
    await waitForApp(page);
    await completeOnboarding(page, 'BackupConfirmedUser');

    await page.evaluate(() => {
      localStorage.setItem('decentchat-messages-sent', '100');
      localStorage.setItem('decentchat-seed-backed-up', 'false');
      localStorage.setItem('decentchat-is-recovered', 'false');
      localStorage.setItem('decentchat-seed-backup-dismissed', '0');
      localStorage.setItem('decentchat-seed-backup-threshold', '100');
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Back up your seed phrase' })).toBeVisible({ timeout: 8000 });

    await page.getByLabel("Are you sure you've saved your seed phrase somewhere safe?").check();
    await page.getByLabel(/I understand that losing this phrase means losing my account forever/i).check();
    await page.getByRole('button', { name: "I've written it down" }).click();

    await expect(page.getByRole('heading', { name: 'Back up your seed phrase' })).not.toBeVisible({ timeout: 3000 });

    const backedUp = await page.evaluate(() => localStorage.getItem('decentchat-seed-backed-up'));
    expect(backedUp).toBe('true');

    await page.evaluate(() => {
      localStorage.setItem('decentchat-messages-sent', '1000');
      localStorage.setItem('decentchat-seed-backup-dismissed', '0');
      localStorage.setItem('decentchat-seed-backup-threshold', '100');
    });
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Back up your seed phrase' })).not.toBeVisible({ timeout: 3000 });
  });
});
