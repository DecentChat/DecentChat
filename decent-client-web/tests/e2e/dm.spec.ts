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
  await expect(page.locator('#nav-dms-btn')).toHaveClass(/active/);
}

async function addContactViaURI(page: Page, name: string, peerId: string): Promise<void> {
  await page.click('#add-contact-btn');
  await page.waitForSelector('.modal');
  await page.locator('#contact-uri-input').fill(buildContactURI(name, peerId));
  await page.click('.modal .btn-primary');
  await expect(page.locator('[data-testid="contact-card"]').filter({ hasText: name })).toBeVisible();
}

async function startDM(page: Page, name: string, peerId: string): Promise<void> {
  await page.click('#start-dm-btn');
  await page.waitForSelector('.modal');
  await page.locator(`#contact-list [data-peer-id="${peerId}"]`).click();
  await page.click('.modal .btn-primary');
  await expect(page.locator('.channel-header h2')).toContainText(name);
  await expect(page.locator('[data-testid="direct-conversation-item"]').filter({ hasText: name })).toBeVisible();
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
    await expect(page.locator('[data-testid="contact-card"]').filter({ hasText: 'pk-bob-peer-id' })).toBeVisible();
    await expect(page.locator('[data-testid="contact-card"]').filter({ hasText: 'wss://signal.example' })).toBeVisible();
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

  test('clicking a contact card in DM view opens a direct conversation', async ({ page }) => {
    await addContactViaURI(page, 'Charlie', 'charlie-peer-id');
    // Click the contact card directly instead of using the Start DM modal
    await page.locator('.contact-card[data-contact-peer-id="charlie-peer-id"]').click();
    // Channel header should show the contact's name
    await expect(page.locator('.channel-header h2')).toContainText('Charlie');
  });
});

test.describe('Workspace Direct Messages Section', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'WS DM Test', 'Alice');
  });

  test('Direct Messages section is visible in workspace sidebar', async ({ page }) => {
    // In workspace view, the sidebar should have a Direct Messages section
    await expect(page.locator('[data-testid="ws-direct-messages-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="ws-direct-messages-section"]')).toContainText('Direct Messages');
  });

  test('+ button next to Direct Messages in workspace opens the DM modal', async ({ page }) => {
    // First switch to DM view to add a contact (required for the modal to work)
    await page.click('#ws-rail-dms');
    await expect(page.locator('#nav-dms-btn')).toHaveClass(/active/);
    await addContactViaURI(page, 'Eve', 'eve-peer-id');

    // Switch back to workspace view
    await page.click('[data-testid="workspaces-tab"]');
    await expect(page.locator('[data-testid="ws-direct-messages-section"]')).toBeVisible();

    // Click the + button in the workspace Direct Messages section
    await page.click('#start-ws-dm-btn');
    await page.waitForSelector('.modal');
    await expect(page.locator('.modal h2')).toContainText('Start Direct Message');
  });
});
