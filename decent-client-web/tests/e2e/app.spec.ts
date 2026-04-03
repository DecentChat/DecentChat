import { test, expect } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace, sendMessage, getMessages, openSettings, closeModal } from './helpers';

test.describe('DecentChat E2E', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
  });

  async function seedMessagesViaController(page: any, count: number) {
    await page.evaluate(async (total: number) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      if (!ctrl || !state?.activeChannelId) {
        throw new Error('window.__ctrl or activeChannelId not available');
      }

      const channelId = state.activeChannelId;
      const peerId = state.myPeerId;

      for (let i = 0; i < total; i += 1) {
        const marker = i === 35 ? 'phase2_search_target_old' : `phase2_msg_${String(i).padStart(3, '0')}`;
        const payload = `${marker} ${'lorem ipsum '.repeat((i % 7) * 8)}`.trim();
        const msg = await ctrl.messageStore.createMessage(channelId, peerId, payload, 'text');
        ctrl.messageStore.forceAdd(msg);
      }

      // Trigger UI refresh
      ctrl.ui?.renderMessages?.();
    }, count);
  }
  async function seedDirectConversation(page: any, options?: { peerId?: string; displayName?: string; message?: string }) {
    return page.evaluate(async ({
      peerId = 'dm-peer-1',
      displayName = 'Bob',
      message = 'Direct message that should survive refresh',
    }) => {
      const ctrl = (window as any).__ctrl;
      if (!ctrl) throw new Error('window.__ctrl not available');

      await ctrl.addContact({
        peerId,
        publicKey: `pk-${peerId}`,
        displayName,
        signalingServers: ['wss://signal.example'],
        addedAt: Date.now(),
        lastSeen: Date.now(),
      });

      const conv = await ctrl.startDirectMessage(peerId);
      const msg = await ctrl.messageStore.createMessage(conv.id, ctrl.state.myPeerId, message, 'text');
      const result = await ctrl.messageStore.addMessage(msg);
      if (!result.success) throw new Error(result.error || 'failed to add DM seed message');

      await ctrl.persistentStore.saveMessage(msg);
      await ctrl.directConversationStore.updateLastMessage(conv.id, msg.timestamp);
      const updatedConv = await ctrl.directConversationStore.get(conv.id);
      await ctrl.persistentStore.saveDirectConversation(updatedConv || conv);

      // Trigger sidebar refresh with contacts+DM cache update, then wait for rAF + async
      ctrl.ui?.updateSidebar?.();
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => setTimeout(resolve, 200));
      });

      return { conversationId: conv.id, peerId, displayName, message };
    }, options || {});
  }

  async function flushPersistence(page: any) {
    await page.evaluate(async () => {
      const ctrl = (window as any).__ctrl;
      await ctrl?.persistentStore?.saveSetting?.('__e2e:flush', Date.now());
    });
  }


  // ─── Loading & Welcome ─────────────────────────────────────────────────

  test('shows welcome screen on fresh load', async ({ page }) => {
    // Welcome screen should have create + join buttons
    await expect(page.locator('#create-ws-btn')).toBeVisible();
    await expect(page.locator('#join-ws-btn')).toBeVisible();
  });

  test('page title is DecentChat', async ({ page }) => {
    await expect(page).toHaveTitle(/DecentChat/);
  });

  test('join workspace modal shows DM privacy checkbox checked by default', async ({ page }) => {
    // Navigate to /app so #join-ws-btn opens the modal directly (on / it navigates first)
    await page.goto('/app');
    await waitForApp(page);
    await page.click('#join-ws-btn-nav');
    await expect(page.locator('.modal')).toBeVisible({ timeout: 10000 });
    const checkbox = page.locator('input[name="allowWorkspaceDMs"]');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeChecked();
  });

  // ─── Workspace Creation ────────────────────────────────────────────────

  test('create workspace shows modal', async ({ page }) => {
    await page.click('#create-ws-btn');
    await page.waitForURL('**/app', { timeout: 10000 });
    await waitForApp(page);

    if (await page.locator('.modal').count() === 0) {
      await page.click('#create-ws-btn-nav');
    }

    await expect(page.getByRole('heading', { name: /Create private group/i })).toBeVisible();
    await expect(page.locator('.modal input[name="name"]')).toBeVisible();
  });

  test('create workspace modal explains next steps and action priority', async ({ page }) => {
    await page.click('#create-ws-btn');
    await page.waitForURL('**/app', { timeout: 10000 });
    await waitForApp(page);

    if (await page.locator('.modal').count() === 0) {
      await page.click('#create-ws-btn-nav');
    }

    const modal = page.locator('.modal');
    await expect(page.getByRole('heading', { name: /Create private group/i })).toBeVisible();
    await expect(modal.locator('.modal-intro')).toContainText('Create a private group chat');
    await expect(modal.locator('.modal-intro')).toContainText('#general');
    await expect(modal.getByText('Ready right away')).toBeVisible();
    await expect(modal.locator('.workspace-create-next-steps')).toContainText('Your group opens in #general.');
    await expect(modal.locator('.workspace-create-next-steps')).toContainText('Your invite link and QR code are ready to share.');
    await expect(modal.getByText('Visible to everyone you invite to this group.')).toBeVisible();
    await expect(modal.getByText('This is the name people see on your messages. You can change it later.')).toBeVisible();
    await expect(modal.locator('.btn-primary')).toHaveClass(/create-workspace-submit/);
    await expect(modal.locator('.btn-secondary')).toHaveClass(/create-workspace-cancel/);
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
    await page.waitForURL('**/app', { timeout: 10000 });
    await waitForApp(page);

    // The sessionStorage pending action should auto-open the modal, but fall back to click
    if (await page.locator('.modal').count() === 0) {
      await page.click('#create-ws-btn-nav');
    }
    await expect(page.locator('.modal')).toBeVisible({ timeout: 10000 });
    await page.click('.modal .btn-secondary'); // Cancel button
    await expect(page.locator('.modal')).not.toBeVisible();
  });

  test('create workspace without name does nothing', async ({ page }) => {
    await page.click('#create-ws-btn');
    await page.waitForURL('**/app', { timeout: 10000 });
    await waitForApp(page);

    if (await page.locator('.modal').count() === 0) {
      await page.click('#create-ws-btn-nav');
    }
    await expect(page.locator('.modal')).toBeVisible({ timeout: 10000 });
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
    const input = page.locator('#compose-input');
    await input.fill('/version');
    await input.press('Escape'); // dismiss command autocomplete
    await input.press('Enter');

    await expect(page.locator('.message.system')).toBeVisible({ timeout: 5000 });
  });

  test('/whoami shows identity', async ({ page }) => {
    await createWorkspace(page);
    const input = page.locator('#compose-input');
    await input.fill('/whoami');
    await input.press('Escape'); // dismiss command autocomplete
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

    if (await page.getByRole('heading', { name: /Create private group/i }).count() === 0) {
      await page.click('#create-ws-btn-nav');
    }

    await expect(page.getByRole('heading', { name: /Create private group/i })).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /Create private group/i })).not.toBeVisible({ timeout: 5000 });
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
    await expect(page.locator('.search-result').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.search-result').first().click();

    // Message should get highlight class (applied via requestAnimationFrame)
    await expect(page.locator('.message.highlight')).toBeVisible({ timeout: 5000 });
  });

  test('virtualized channel list stays bounded and search jump still works on large history', async ({ page }) => {
    test.slow();

    const totalMessages = 320;
    await createWorkspace(page);
    await seedMessagesViaController(page, totalMessages);

    await expect(page.locator('.message-content', { hasText: 'phase2_msg_319' })).toBeVisible({ timeout: 15000 });

    const bottomMetrics = await page.evaluate(() => {
      const list = document.getElementById('messages-list');
      const rendered = list?.querySelectorAll('.message[data-message-id]').length ?? 0;
      const topSpacer = list?.querySelector('.message-spacer') as HTMLElement | null;
      return {
        rendered,
        topSpacerHeight: topSpacer ? topSpacer.offsetHeight : 0,
      };
    });

    expect(bottomMetrics.rendered).toBeLessThan(totalMessages);
    expect(bottomMetrics.topSpacerHeight).toBeGreaterThan(0);

    await expect(page.locator('.message-content', { hasText: 'phase2_msg_319' })).toBeVisible({ timeout: 7000 });

    await page.click('#search-btn');
    await page.locator('#search-input').fill('phase2_search_target_old');
    const targetResult = page.locator('.search-result', { hasText: 'phase2_search_target_old' }).first();
    await expect(targetResult).toBeVisible({ timeout: 7000 });
    await targetResult.click();

    const jumpedMessage = page.locator('.message .message-content', { hasText: 'phase2_search_target_old' }).first();
    await expect(jumpedMessage).toBeVisible({ timeout: 10000 });

    const jumpMetrics = await page.evaluate(() => {
      const list = document.getElementById('messages-list');
      return list?.querySelectorAll('.message[data-message-id]').length ?? 0;
    });
    expect(jumpMetrics).toBeLessThan(totalMessages);
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
    const settingsModal = page.locator('.settings-modal');
    await expect(settingsModal.getByText('Identity')).toBeVisible();
    await expect(settingsModal.getByText('Peer ID', { exact: true })).toBeVisible();
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

    await expect.poll(async () => {
      return await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    }).toBe('light');
  });

  test('compact mode toggles body class', async ({ page }) => {
    await createWorkspace(page);
    await openSettings(page);
    const compactToggle = page.locator('.settings-modal input[data-key="compactMode"]').first();
    await compactToggle.setChecked(true);

    await expect.poll(async () => {
      return await page.evaluate(() => document.body.classList.contains('compact'));
    }).toBe(true);
  });

  // ─── Invite Link ──────────────────────────────────────────────────────

  test('workspace settings modal fits small viewport and is scrollable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await createWorkspace(page);

    await page.evaluate(async () => {
      const ctrl = (window as any).__ctrl;
      for (let i = 0; i < 12; i += 1) {
        await ctrl.generateInviteURL(ctrl.state.activeWorkspaceId, { permanent: i % 2 === 0 });
      }
    });

    await page.evaluate(() => {
      (document.getElementById('workspace-menu-trigger') as HTMLButtonElement | null)?.click();
    });
    await page.evaluate(() => {
      (document.getElementById('workspace-menu-settings') as HTMLButtonElement | null)?.click();
    });

    const modal = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'Workspace Settings' }) });
    await expect(modal).toBeVisible();

    const metrics = await modal.evaluate((node) => {
      const el = node as HTMLElement;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const form = el.querySelector('form') as HTMLElement | null;
      const formStyle = form ? window.getComputedStyle(form) : null;
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        modalOverflowY: style.overflowY,
        modalScrollHeight: el.scrollHeight,
        modalClientHeight: el.clientHeight,
        formOverflowY: formStyle?.overflowY ?? null,
        formScrollHeight: form?.scrollHeight ?? null,
        formClientHeight: form?.clientHeight ?? null,
      };
    });

    expect(metrics.top).toBeGreaterThanOrEqual(0);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(
      (metrics.modalOverflowY === 'auto' || metrics.modalOverflowY === 'scroll') && metrics.modalScrollHeight > metrics.modalClientHeight ||
      (metrics.formOverflowY === 'auto' || metrics.formOverflowY === 'scroll') && (metrics.formScrollHeight ?? 0) > (metrics.formClientHeight ?? 0)
    ).toBe(true);
  });

  test('copy invite link button exists in sidebar', async ({ page }) => {
    await createWorkspace(page);
    await expect(page.locator('#copy-invite')).toBeVisible();
    await expect(page.locator('#copy-invite')).toContainText('Invite people via link');
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

    if (await page.getByRole('heading', { name: 'Join workspace' }).count() === 0) {
      await page.click('#join-ws-btn-nav');
    }

    await expect(page.getByRole('heading', { name: 'Join workspace' })).toBeVisible();
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

    await flushPersistence(page);

    // Refresh the page
    await page.reload();
    await waitForApp(page);

    // Should show the workspace, not the welcome screen
    await expect(page.locator('.sidebar-header')).toContainText('Persistent WS', { timeout: 5000 });
  });

  test('messages persist after refresh', async ({ page }) => {
    await createWorkspace(page);
    await sendMessage(page, 'This should persist');

    await flushPersistence(page);

    await page.reload();
    await waitForApp(page);

    await page.waitForFunction(
      (text) => Array.from(document.querySelectorAll('.message-content')).some(el => el.textContent?.includes(text)),
      'This should persist',
      { timeout: 8000 },
    );
  });

  test('active direct conversation persists after refresh', async ({ page }) => {
    await createWorkspace(page, 'Persistent DM Workspace', 'User');
    const seeded = await seedDirectConversation(page, {
      peerId: 'persistent-dm-peer',
      displayName: 'Bob DM',
      message: 'DM survives refresh',
    });

    await page.click('#ws-rail-dms');
    const directConversationItem = page.locator(`[data-testid="direct-conversation-item"][data-direct-conv-id="${seeded.conversationId}"]`);
    await expect(directConversationItem).toBeVisible();
    await directConversationItem.click();
    await expect(page.locator('.channel-header h2')).toContainText('Bob DM');

    await page.evaluate(async (conversationId) => {
      const ctrl = (window as any).__ctrl;
      for (let i = 0; i < 20; i++) {
        const saved = await ctrl?.persistentStore?.getSetting?.('ui:lastView');
        if (saved?.directConversationId === conversationId) return;
        await new Promise(r => setTimeout(r, 100));
      }
    }, seeded.conversationId);
    await page.reload();
    await waitForApp(page);

    await expect(page.locator('#ws-rail-dms')).toHaveClass(/active/);
    await expect(page.locator('.channel-header h2')).toContainText('Bob DM');
    await expect(page.locator(`[data-testid="direct-conversation-item"][data-direct-conv-id="${seeded.conversationId}"]`)).toHaveClass(/active/);
    const messages = await getMessages(page);
    expect(messages).toContain('DM survives refresh');
  });

  test('missing saved direct conversation falls back gracefully on refresh', async ({ page }) => {
    await createWorkspace(page, 'Fallback Workspace', 'User');
    await seedDirectConversation(page, {
      peerId: 'stale-dm-peer',
      displayName: 'Stale DM',
      message: 'This DM is not the fallback target',
    });

    await page.evaluate(async () => {
      const ctrl = (window as any).__ctrl;
      if (!ctrl) throw new Error('window.__ctrl not available');

      await ctrl.persistentStore.saveSetting('ui:lastView', {
        workspaceId: null,
        channelId: 'missing-direct-conversation',
        directConversationId: 'missing-direct-conversation',
        threadId: null,
        threadOpen: false,
        at: Date.now(),
      });
    });

    await page.reload();
    await waitForApp(page);

    await expect(page.locator('.channel-header h2')).toContainText('general');
    await expect(page.locator('.sidebar-item.active[data-channel-id]')).toContainText('general');
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
