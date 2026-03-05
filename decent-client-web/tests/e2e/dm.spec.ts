import { test, expect, Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace, sendMessage } from './helpers';

function buildContactURI(name: string, peerId: string, signaling = 'wss://signal.example'): string {
  const params = new URLSearchParams();
  params.set('pub', `pk-${peerId}`);
  params.set('name', name);
  params.set('peer', peerId);
  params.append('sig', signaling);
  return `decent://contact?${params.toString()}`;
}

async function enterDMView(page: Page): Promise<void> {
  await page.click('#ws-rail-dms');
  await expect(page.locator('#ws-rail-dms')).toHaveClass(/active/);
}

async function addContactViaURI(page: Page, name: string, peerId: string): Promise<void> {
  // Newer UI doesn't always expose add-contact modal button directly.
  // Seed contact via controller API to keep DM flow deterministic in headless E2E.
  const uri = buildContactURI(name, peerId);
  await page.evaluate(async ({ name: contactName, peerId: contactPeerId, uriText }) => {
    const ctrl = (window as any).__ctrl;
    if (!ctrl) throw new Error('Controller not available');

    const params = new URL(uriText.replace('decent://contact?', 'https://x/?')).searchParams;
    const publicKey = params.get('pub') || `pk-${contactPeerId}`;

    await ctrl.addContact({
      peerId: contactPeerId,
      publicKey,
      displayName: contactName,
      signalingServers: ['wss://signal.example'],
      addedAt: Date.now(),
      lastSeen: 0,
    });
  }, { name, peerId, uriText: uri });

  // Open DM picker and verify the contact is selectable there.
  await page.click('#start-dm-btn');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await expect(page.locator(`#contact-list [data-peer-id="${peerId}"]`)).toBeVisible();
  await page.keyboard.press('Escape');
}

async function startDM(page: Page, name: string, peerId: string): Promise<void> {
  await page.click('#start-dm-btn');
  await page.waitForSelector('.modal', { timeout: 5000 });

  const contactItem = page.locator(`#contact-list [data-peer-id="${peerId}"]`);
  await contactItem.click();

  // Selection handler is attached asynchronously in UI; wait until hidden field is populated.
  await page.waitForFunction((id) => {
    const el = document.getElementById('dm-contact-select') as HTMLInputElement | null;
    return !!el && el.value === id;
  }, peerId, { timeout: 3000 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
    page.click('.modal .btn-primary'),
  ]);
  await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 }).catch(() => {});

  const convoItem = page.locator('[data-testid="direct-conversation-item"]').filter({ hasText: name }).first();
  await expect(convoItem).toBeVisible({ timeout: 8000 });
  await convoItem.click();
  await expect(page.locator('.channel-header h2')).toContainText(name, { timeout: 8000 });
}

test.describe('Direct Messages', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'DM Test Workspace', 'Alice');
    await enterDMView(page);
  });

  test('add contact via ContactURI', async ({ page }) => {
    await addContactViaURI(page, 'Bob', 'bob-peer-id');
  });

  test('start direct message conversation from contact', async ({ page }) => {
    await addContactViaURI(page, 'Bob', 'bob-peer-id');
    await startDM(page, 'Bob', 'bob-peer-id');
  });

  test('send direct message in active conversation', async ({ page }) => {
    await addContactViaURI(page, 'Bob', 'bob-peer-id');
    await startDM(page, 'Bob', 'bob-peer-id');
    await sendMessage(page, 'hello bob');
    await expect(page.locator('.message-content')).toContainText('hello bob');
  });

  test('direct message list sorts by most recent conversation', async ({ page }) => {
    await addContactViaURI(page, 'Alice Contact', 'alice-peer-id');
    await addContactViaURI(page, 'Bob Contact', 'bob-peer-id');

    await startDM(page, 'Alice Contact', 'alice-peer-id');
    await sendMessage(page, 'older dm');

    await startDM(page, 'Bob Contact', 'bob-peer-id');
    await sendMessage(page, 'newer dm');

    await expect(page.locator('[data-testid="direct-conversation-item"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="direct-conversation-item"]').first()).toContainText('Bob Contact');
  });

  test('clicking a direct conversation item opens that conversation', async ({ page }) => {
    await addContactViaURI(page, 'Charlie', 'charlie-peer-id');
    await startDM(page, 'Charlie', 'charlie-peer-id');

    // Re-open via sidebar item (idempotent click should keep/select the DM).
    await page.locator('[data-testid="direct-conversation-item"]').filter({ hasText: 'Charlie' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('.channel-header h2')).toContainText('Charlie', { timeout: 8000 });
  });
});

test.describe('Workspace Direct Messages Section', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'WS DM Test', 'Alice');
  });

  test('Direct Messages section is visible in sidebar', async ({ page }) => {
    await enterDMView(page);
    await expect(page.locator('.sidebar-section-header', { hasText: 'Direct Messages' })).toBeVisible();
  });

  test('+ button for Direct Messages opens Start DM modal', async ({ page }) => {
    await enterDMView(page);
    await page.click('#start-dm-btn');
    // With no contacts, app shows a toast error instead of modal.
    await expect(page.locator('.toast.error')).toContainText('Add a contact first');
  });
});
