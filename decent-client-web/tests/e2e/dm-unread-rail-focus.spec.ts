import { test, expect, Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

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
  const uri = buildContactURI(name, peerId);
  await page.evaluate(async ({ name: contactName, peerId: contactPeerId, uriText }) => {
    const ctrl = (window as any).__ctrl;
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
}

async function startDM(page: Page, name: string): Promise<void> {
  await page.click('#start-dm-btn');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.locator('.modal .member-select-list .sidebar-item').filter({ hasText: name }).first().click();
  await page.locator('.modal .btn-primary').click();
  await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 }).catch(() => {});
  await page.locator('[data-testid="direct-conversation-item"]').filter({ hasText: name }).first().click();
  await expect(page.locator('.channel-header h2')).toContainText(name, { timeout: 8000 });
}

test.describe('DM rail unread after leaving a DM', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'DM Focus Workspace', 'Alice');
    await enterDMView(page);
  });

  test('incoming DM increments unread and shows badge after switching back to a workspace', async ({ page }) => {
    await addContactViaURI(page, 'Bob', 'bob-peer-id');
    await startDM(page, 'Bob');

    await page.locator('.ws-rail-icon[data-ws-id]').first().click();
    await expect(page.locator('#ws-rail-dms')).not.toHaveClass(/active/);

    const result = await page.evaluate(async () => {
      const ctrl = (window as any).__ctrl;
      const conversations = await ctrl.getDirectConversations();
      const conv = conversations.find((item: any) => item.contactPeerId === 'bob-peer-id');
      if (!conv) throw new Error('Direct conversation not found');

      ctrl.notifications.notify(conv.id, 'Bob', 'Bob', 'Ping from Bob');
      ctrl.ui.updateWorkspaceRail();

      return {
        unread: ctrl.notifications.getUnreadCount(conv.id),
        focused: (ctrl.notifications as any).focusedChannelId,
      };
    });

    expect(result.focused).not.toBeNull();
    expect(result.focused).not.toBeUndefined();
    expect(result.focused).not.toBe('');
    expect(result.unread).toBe(1);
    await expect(page.locator('#ws-rail-dms .activity-badge')).toHaveText('1');
  });
});
