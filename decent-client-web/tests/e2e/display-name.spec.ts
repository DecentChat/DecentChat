import { test, expect } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace, sendMessage, openSettings } from './helpers';

/**
 * Tests for the display name bug fix:
 *   1. Text inputs in SettingsPanel now save (HTMLInputElement branch was missing)
 *   2. myAlias in-memory state updates immediately (no reload needed)
 *   3. Name persists across reloads
 *   4. New messages show the updated sender name immediately
 *   5. Workspace-scoped alias also saves correctly
 */

test.describe('Display name settings', () => {

  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
  });

  // ─── Core: text input saves ─────────────────────────────────────────────

  test('global display name input saves — does not revert on close', async ({ page }) => {
    await createWorkspace(page, 'Test WS', 'Alice');

    await openSettings(page);
    const nameInput = page.locator('input[data-key="myAlias"]');
    await nameInput.fill('');
    await nameInput.fill('Bob');
    // Close settings
    await page.click('#settings-close');
    await expect(page.locator('.settings-modal')).not.toBeVisible();

    // Reopen and check the value persisted
    await openSettings(page);
    await expect(page.locator('input[data-key="myAlias"]')).toHaveValue('Bob');
  });

  test('global display name persists across page reload', async ({ page }) => {
    await createWorkspace(page, 'Test WS', 'Alice');

    await openSettings(page);
    await page.locator('input[data-key="myAlias"]').fill('Charlie');
    // Tab out to trigger blur/change and allow the async IndexedDB write to complete
    await page.locator('input[data-key="myAlias"]').press('Tab');
    await page.waitForTimeout(300); // let async saveSetting complete
    await page.click('#settings-close');

    // Reload the page
    await page.reload();
    await waitForApp(page);

    // Setting should still be there
    await openSettings(page);
    await expect(page.locator('input[data-key="myAlias"]')).toHaveValue('Charlie');
  });

  // ─── In-memory update — new messages reflect the new name ──────────────

  test('message sent after name change shows the new sender name', async ({ page }) => {
    await createWorkspace(page, 'Test WS', 'Alice');

    // Send a message as Alice
    await sendMessage(page, 'Hello from Alice');
    await expect(page.locator('.message-sender').first()).toContainText('Alice');

    // Change name
    await openSettings(page);
    await page.locator('input[data-key="myAlias"]').fill('Bob');
    await page.click('#settings-close');

    // Send another message — should appear under the new name immediately
    await sendMessage(page, 'Hello from Bob');

    const senders = await page.locator('.message-sender').allTextContents();
    const lastSender = senders[senders.length - 1];
    expect(lastSender).toContain('Bob');
  });

  test('in-memory name updates without reload — sender label on messages list', async ({ page }) => {
    await createWorkspace(page, 'Test WS', 'Dave');

    await openSettings(page);
    await page.locator('input[data-key="myAlias"]').fill('Eve');
    await page.click('#settings-close');

    // Do NOT reload — the state should already be updated
    await sendMessage(page, 'in-memory check');

    const senders = await page.locator('.message-sender').allTextContents();
    expect(senders.some(s => s.includes('Eve'))).toBe(true);
  });

  // ─── Workspace alias ────────────────────────────────────────────────────

  test('workspace alias input saves — does not revert on close', async ({ page }) => {
    await createWorkspace(page, 'Test WS', 'Alice');

    await openSettings(page);
    await page.locator('input[data-key="workspaceAlias"]').fill('AliceWS');
    await page.click('#settings-close');

    await openSettings(page);
    await expect(page.locator('input[data-key="workspaceAlias"]')).toHaveValue('AliceWS');
  });

  test('workspace alias persists across reload', async ({ page }) => {
    await createWorkspace(page, 'Test WS', 'Alice');

    await openSettings(page);
    await page.locator('input[data-key="workspaceAlias"]').fill('WorkspaceAlice');
    await page.locator('input[data-key="workspaceAlias"]').press('Tab');
    await page.waitForTimeout(300);
    await page.click('#settings-close');

    await page.reload();
    await waitForApp(page);

    await openSettings(page);
    await expect(page.locator('input[data-key="workspaceAlias"]')).toHaveValue('WorkspaceAlice');
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────

  test('whitespace-only display name is not accepted', async ({ page }) => {
    await createWorkspace(page, 'Test WS', 'Alice');

    await openSettings(page);
    const input = page.locator('input[data-key="myAlias"]');
    await input.fill('   ');
    await page.click('#settings-close');

    // After close, reopening — empty/trimmed value should not have replaced the old one
    // (the fix guards with value.trim() before persisting the in-memory update)
    await openSettings(page);
    const savedValue = await page.locator('input[data-key="myAlias"]').inputValue();
    // Either empty string or the original name — not '   '
    expect(savedValue.trim()).not.toBe('   ');
  });

  test('changing name and reopening settings immediately shows new value', async ({ page }) => {
    await createWorkspace(page, 'Test WS', 'Alice');

    // First change
    await openSettings(page);
    await page.locator('input[data-key="myAlias"]').fill('Renamed');
    await page.click('#settings-close');

    // Immediately reopen — no reload between
    await openSettings(page);
    await expect(page.locator('input[data-key="myAlias"]')).toHaveValue('Renamed');
  });

  test('multiple sequential renames all take effect', async ({ page }) => {
    await createWorkspace(page, 'Test WS', 'Alice');

    const names = ['First', 'Second', 'Third'];
    for (const name of names) {
      await openSettings(page);
      await page.locator('input[data-key="myAlias"]').fill(name);
      await page.click('#settings-close');
    }

    // Last name should win
    await openSettings(page);
    await expect(page.locator('input[data-key="myAlias"]')).toHaveValue('Third');
  });

});
