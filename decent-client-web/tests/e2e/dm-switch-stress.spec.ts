import { test, expect, Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

async function enterDMView(page: Page): Promise<void> {
  await page.click('#ws-rail-dms');
  await expect(page.locator('#ws-rail-dms')).toHaveClass(/active/);
}

async function seedHeavyDirectMessages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ctrl = (window as any).__ctrl;
    if (!ctrl) throw new Error('Controller not available');

    const contacts = [
      { name: 'Bob', peerId: 'bob-peer-id' },
      { name: 'Charlie', peerId: 'charlie-peer-id' },
    ];

    for (const contact of contacts) {
      await ctrl.addContact({
        peerId: contact.peerId,
        publicKey: `pk-${contact.peerId}`,
        displayName: contact.name,
        signalingServers: ['wss://signal.example'],
        addedAt: Date.now(),
        lastSeen: 0,
      });

      const conv = await ctrl.startDirectMessage(contact.peerId);
      let lastTimestamp = Date.now() - 120_000;
      for (let i = 0; i < 700; i += 1) {
        const msg = await ctrl.messageStore.createMessage(
          conv.id,
          i % 2 === 0 ? ctrl.state.myPeerId : contact.peerId,
          `${contact.name} history ${i}`,
          'text',
        );
        lastTimestamp += 10;
        msg.timestamp = lastTimestamp;
        msg.status = 'sent';
        ctrl.messageStore.forceAdd(msg);
      }
      await ctrl.directConversationStore.updateLastMessage(conv.id, lastTimestamp);
      await ctrl.persistentStore.saveDirectConversation({ ...conv, lastMessageAt: lastTimestamp });
    }

    ctrl.ui.updateSidebar();
  });
}

test.describe('Direct message switching under load', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'DM Stress Workspace', 'Alice');
    await enterDMView(page);
    await seedHeavyDirectMessages(page);
  });

  test('switching between DMs stays responsive', async ({ page }) => {
    const items = page.locator('[data-testid="direct-conversation-item"]');
    await expect(items).toHaveCount(2);

    const startedAt = Date.now();

    for (let i = 0; i < 8; i += 1) {
      const target = i % 2 === 0 ? 'Bob' : 'Charlie';
      await items.filter({ hasText: target }).first().click();
      await expect(page.locator('.channel-header h2')).toContainText(target, { timeout: 1500 });
      await expect(page.locator('.message-content').first()).toBeVisible({ timeout: 1500 });
    }

    expect(Date.now() - startedAt).toBeLessThan(8000);
  });

  test('switching between DMs does not re-fetch contacts from storage', async ({ page }) => {
    await page.evaluate(() => {
      const ctrl = (window as any).__ctrl;
      if (!ctrl) throw new Error('Controller not available');

      const originalGetContacts = ctrl.getContacts.bind(ctrl);
      const originalGetDirectConversations = ctrl.getDirectConversations.bind(ctrl);
      (window as any).__dmSwitchCounts = { contacts: 0, conversations: 0 };

      ctrl.getContacts = async (...args: any[]) => {
        (window as any).__dmSwitchCounts.contacts += 1;
        return originalGetContacts(...args);
      };

      ctrl.getDirectConversations = async (...args: any[]) => {
        (window as any).__dmSwitchCounts.conversations += 1;
        return originalGetDirectConversations(...args);
      };
    });

    const items = page.locator('[data-testid="direct-conversation-item"]');
    await expect(items).toHaveCount(2);

    for (let i = 0; i < 10; i += 1) {
      const target = i % 2 === 0 ? 'Bob' : 'Charlie';
      await items.filter({ hasText: target }).first().click();
      await expect(page.locator('.channel-header h2')).toContainText(target, { timeout: 1500 });
    }

    await expect.poll(async () => page.evaluate(() => (window as any).__dmSwitchCounts)).toEqual({
      contacts: 0,
      conversations: 0,
    });
  });
});
