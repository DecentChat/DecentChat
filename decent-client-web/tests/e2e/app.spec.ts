import { test, expect } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace, sendMessage, getMessages, openSettings, closeModal } from './helpers';

test.describe('DecentChat E2E', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
  });

  // ─── Loading & Welcome ─────────────────────────────────────────────────

  test('shows welcome screen on fresh load', async ({ page }) => {
    // Welcome screen should have create + join buttons
    await expect(page.locator('#create-ws-btn')).toBeVisible();
    await expect(page.locator('#join-ws-btn')).toBeVisible();
  });

  test('page title is DecentChat', async ({ page }) => {
    await expect(page).toHaveTitle(/DecentChat/);
  });

  // ─── Workspace Creation ────────────────────────────────────────────────

  test('create workspace shows modal', async ({ page }) => {
    await page.click('#create-ws-btn');
    await page.waitForURL('**/app', { timeout: 10000 });
    await waitForApp(page);

    if (await page.locator('.modal').count() === 0) {
      await page.click('#create-ws-btn-nav');
    }

    await expect(page.getByRole('heading', { name: 'Create Workspace' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'My Team' })).toBeVisible();
  });

  test('create workspace and see sidebar', async ({ page }) => {
    await createWorkspace(page, 'My Team', 'Alice');

    // Sidebar should show workspace name
    await expect(page.locator('.sidebar-header')).toContainText('My Team');
    // #general channel should exist
    await expect(page.locator('.sidebar-item:has-text("general")')).toBeVisible();
    // Channel header should show #general
    await expect(page.locator('.channel-header')).toContainText('general');
  });

  test('cancel create workspace closes modal', async ({ page }) => {
    await page.click('#create-ws-btn');
    await page.click('.modal .btn-secondary'); // Cancel button
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('create workspace without name does nothing', async ({ page }) => {
    await page.click('#create-ws-btn');
    await page.click('.modal .btn-primary'); // Submit with empty fields
    // Modal should still be open (validation failed)
    await expect(page.locator('.modal')).toBeVisible();
  });

  // ─── Welcome Screen ───────────────────────────────────────────────────

  test('welcome screen shows E2E encryption info', async ({ page }) => {
    await expect(page.locator('text=end-to-end encrypted')).toBeVisible();
  });

  // ─── Messaging ─────────────────────────────────────────────────────────

  test('send a message and see it in chat', async ({ page }) => {
    await createWorkspace(page);
    await sendMessage(page, 'Hello, world!');

    const messages = await getMessages(page);
    expect(messages).toContain('Hello, world!');
  });

  test('send multiple messages in order', async ({ page }) => {
    await createWorkspace(page);
    await sendMessage(page, 'First message');
    await sendMessage(page, 'Second message');
    await sendMessage(page, 'Third message');

    const messages = await getMessages(page);
    expect(messages).toContain('First message');
    expect(messages).toContain('Second message');
    expect(messages).toContain('Third message');

    // Order should be preserved
    const firstIdx = messages.indexOf('First message');
    const thirdIdx = messages.indexOf('Third message');
    expect(firstIdx).toBeLessThan(thirdIdx);
  });

  test('message input clears after sending', async ({ page }) => {
    await createWorkspace(page);
    const input = page.locator('#compose-input');
    await input.fill('Test message');
    await input.press('Enter');
    await expect(input).toHaveValue('');
  });

  test('empty message does not send', async ({ page }) => {
    await createWorkspace(page);
    const input = page.locator('#compose-input');
    await input.press('Enter');
    // No messages should appear (only the welcome message)
    const messages = await page.locator('.message').count();
    expect(messages).toBe(0);
  });

  test('send button works', async ({ page }) => {
    await createWorkspace(page);
    await page.locator('#compose-input').fill('Button send test');
    await page.click('#send-btn');
    await page.waitForSelector('.message-content:has-text("Button send test")');
  });

  // ─── Slash Commands ────────────────────────────────────────────────────

  test('/help shows command list', async ({ page }) => {
    await createWorkspace(page);
    const input = page.locator('#compose-input');
    await input.fill('/help');
    await input.press('Enter');

    // Should show system message with commands
    await expect(page.locator('.message.system')).toBeVisible({ timeout: 3000 });
  });

  test('/version shows version info', async ({ page }) => {
    await createWorkspace(page);
    await page.waitForTimeout(500); // Let workspace fully initialize
    const input = page.locator('#compose-input');
    await input.fill('/version');
    await input.press('Enter');

    await expect(page.locator('.message.system')).toBeVisible({ timeout: 5000 });
  });

  test('/whoami shows identity', async ({ page }) => {
    await createWorkspace(page);
    await page.waitForTimeout(500); // Let workspace fully initialize
    const input = page.locator('#compose-input');
    await input.fill('/whoami');
    await input.press('Enter');

    await expect(page.locator('.message.system')).toBeVisible({ timeout: 5000 });
  });

  test('command autocomplete appears on /', async ({ page }) => {
    await createWorkspace(page);
    const input = page.locator('#compose-input');
    await input.fill('/');

    // Autocomplete popup should appear
    await expect(page.locator('.command-autocomplete')).toBeVisible({ timeout: 3000 });
  });

  // ─── Emoji Picker ─────────────────────────────────────────────────────

  test('emoji picker opens and closes', async ({ page }) => {
    await createWorkspace(page);
    const emojiBtn = page.locator('#emoji-btn');
    await emojiBtn.waitFor({ state: 'visible' });
    await emojiBtn.click();
    await expect(page.locator('.emoji-picker')).toBeVisible({ timeout: 3000 });

    // Close by clicking outside (more reliable than Escape in headless)
    await page.locator('.messages-list').click();
    await expect(page.locator('.emoji-picker')).toBeHidden({ timeout: 3000 });
  });

  test('clicking emoji inserts into input', async ({ page }) => {
    await createWorkspace(page);
    await page.click('#emoji-btn');
    // Click first emoji button
    await page.locator('.emoji-btn').first().click();

    const inputValue = await page.locator('#compose-input').inputValue();
    expect(inputValue.length).toBeGreaterThan(0);
  });

  // ─── Keyboard Shortcuts ───────────────────────────────────────────────

  test('Escape closes modals', async ({ page }) => {
    await page.click('#create-ws-btn');
    await page.waitForURL('**/app', { timeout: 10000 });
    await waitForApp(page);

    if (await page.getByRole('heading', { name: 'Create Workspace' }).count() === 0) {
      await page.click('#create-ws-btn-nav');
    }

    await expect(page.getByRole('heading', { name: 'Create Workspace' })).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Create Workspace' })).not.toBeVisible({ timeout: 5000 });
  });

  test('Ctrl+F opens search', async ({ page }) => {
    await createWorkspace(page);
    await page.keyboard.press('Control+f');
    await expect(page.locator('.search-panel')).toBeVisible();
  });

  // ─── Search ───────────────────────────────────────────────────────────

  test('search finds messages', async ({ page }) => {
    await createWorkspace(page);
    await sendMessage(page, 'unique searchable text xyz123');

    // Open search
    await page.click('#search-btn');
    await page.locator('#search-input').fill('xyz123');

    // Should find the message
    await expect(page.locator('.search-result')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.search-result-text')).toContainText('xyz123');
  });

  test('search with no results shows hint', async ({ page }) => {
    await createWorkspace(page);
    await page.click('#search-btn');
    await page.locator('#search-input').fill('nonexistent_string_abc');
    await expect(page.locator('.search-hint')).toContainText('No results');
  });

  test('clicking search result scrolls to message', async ({ page }) => {
    await createWorkspace(page);
    // Send enough messages to make scrolling possible
    for (let i = 0; i < 5; i++) {
      await sendMessage(page, `Message number ${i}`);
    }
    await sendMessage(page, 'target_message_for_scroll');

    await page.click('#search-btn');
    await page.locator('#search-input').fill('target_message_for_scroll');
    await page.locator('.search-result').first().click();

    // Message should get highlight class
    await expect(page.locator('.message.highlight')).toBeVisible({ timeout: 3000 });
  });

  // ─── Settings ─────────────────────────────────────────────────────────

  test('settings panel opens and closes', async ({ page }) => {
    await createWorkspace(page);
    await openSettings(page);
    await expect(page.locator('.settings-modal')).toBeVisible();

    await page.click('#settings-close');
    await expect(page.locator('.settings-modal')).not.toBeVisible();
  });

  test('settings shows identity section', async ({ page }) => {
    await createWorkspace(page);
    await openSettings(page);
    await expect(page.locator('text=Identity')).toBeVisible();
    await expect(page.locator('text=Peer ID')).toBeVisible();
  });

  test('theme switch to dark applies', async ({ page }) => {
    await createWorkspace(page);
    await openSettings(page);

    // Select dark theme
    await page.locator('select[data-key="theme"]').selectOption('dark');

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });

  test('theme switch to light applies', async ({ page }) => {
    await createWorkspace(page);
    await openSettings(page);
    await page.locator('select[data-key="theme"]').selectOption('light');

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('light');
  });

  test('compact mode toggles body class', async ({ page }) => {
    await createWorkspace(page);
    await openSettings(page);
    await page.locator('input[data-key="compactMode"]').check();

    const hasClass = await page.evaluate(() => document.body.classList.contains('compact'));
    expect(hasClass).toBe(true);
  });

  // ─── Invite Link ──────────────────────────────────────────────────────

  test('copy invite link button exists in sidebar', async ({ page }) => {
    await createWorkspace(page);
    await expect(page.locator('#copy-invite')).toBeVisible();
    await expect(page.locator('#copy-invite')).toContainText('Copy invite link');
  });

  test('header invite button exists', async ({ page }) => {
    await createWorkspace(page);
    await expect(page.locator('#invite-btn')).toBeVisible();
  });

  // ─── Join Workspace ───────────────────────────────────────────────────

  test('join workspace modal opens', async ({ page }) => {
    await page.click('#join-ws-btn');
    await page.waitForURL('**/app', { timeout: 10000 });
    await waitForApp(page);

    if (await page.getByRole('heading', { name: 'Join Workspace' }).count() === 0) {
      await page.click('#join-ws-btn-nav');
    }

    await expect(page.getByRole('heading', { name: 'Join Workspace' })).toBeVisible();
  });

  // ─── Channel Header ───────────────────────────────────────────────────

  test('channel header shows search, invite, settings buttons', async ({ page }) => {
    await createWorkspace(page);
    await expect(page.locator('#search-btn')).toBeVisible();
    await expect(page.locator('#invite-btn')).toBeVisible();
    await expect(page.locator('#settings-btn')).toBeVisible();
  });

  // ─── Message Reactions ────────────────────────────────────────────────

  test('reaction buttons appear on message hover', async ({ page }) => {
    await createWorkspace(page);
    await sendMessage(page, 'React to me!');

    const message = page.locator('.message').last();
    await message.hover();
    await expect(message.locator('.message-actions-bar')).toBeVisible();
    const quickReactCount = await message.locator('.quick-react').count();
    expect(quickReactCount).toBeGreaterThanOrEqual(3);
  });

  test('clicking reaction adds reaction pill', async ({ page }) => {
    await createWorkspace(page);
    await sendMessage(page, 'React test');

    const message = page.locator('.message').last();
    await message.hover();
    await message.locator('.quick-react').first().click();

    // Reaction pill should appear
    await expect(message.locator('.reaction-pill')).toBeVisible({ timeout: 3000 });
  });

  // ─── Persistence ──────────────────────────────────────────────────────

  test('workspace persists after refresh', async ({ page }) => {
    await createWorkspace(page, 'Persistent WS', 'User');

    // Wait for IndexedDB writes to complete
    await page.waitForTimeout(1000);

    // Refresh the page
    await page.reload();
    await waitForApp(page);

    // Should show the workspace, not the welcome screen
    await expect(page.locator('.sidebar-header')).toContainText('Persistent WS', { timeout: 5000 });
  });

  test('messages persist after refresh', async ({ page }) => {
    await createWorkspace(page);
    await sendMessage(page, 'This should persist');

    // Wait for IndexedDB writes to flush
    await page.waitForTimeout(2000);

    await page.reload();
    await waitForApp(page);

    // Wait for messages to load from IndexedDB  
    await page.waitForTimeout(2000);
    const messages = await getMessages(page);
    expect(messages).toContain('This should persist');
  });

  // ─── Compose Area ─────────────────────────────────────────────────────

  test('compose area has placeholder', async ({ page }) => {
    await createWorkspace(page);
    const placeholder = await page.locator('#compose-input').getAttribute('placeholder');
    expect(placeholder).toContain('general');
  });

  test('emoji button visible in compose', async ({ page }) => {
    await createWorkspace(page);
    await expect(page.locator('#emoji-btn')).toBeVisible();
  });

  test('send button visible in compose', async ({ page }) => {
    await createWorkspace(page);
    await expect(page.locator('#send-btn')).toBeVisible();
  });

  // ─── Toast Notifications ──────────────────────────────────────────────

  test('workspace creation shows toast', async ({ page }) => {
    await createWorkspace(page);
    // Toast should appear
    await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
  });

  // ─── Offline Mode ─────────────────────────────────────────────────────

  test('app works without signaling server', async ({ page }) => {
    // The app should be functional even without port 9000
    await createWorkspace(page, 'Offline Test');
    await sendMessage(page, 'Offline message');

    const messages = await getMessages(page);
    expect(messages).toContain('Offline message');
  });
});
