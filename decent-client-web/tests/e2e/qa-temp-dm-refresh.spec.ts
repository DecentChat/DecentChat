import { test, expect } from '@playwright/test';

async function clearStorage(page) {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) indexedDB.deleteDatabase(db.name);
        }
      }
    } catch {}
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) void r.unregister();
      }
    } catch {}
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) void caches.delete(k);
      }
    } catch {}
  });
}

async function waitForApp(page, maxTimeout = 18000) {
  const readySelector = '#create-ws-btn, #join-ws-btn, .sidebar-header, #compose-input, .channel-header';
  const waitReady = async (timeout) => {
    await page.waitForFunction(() => {
      const appReady = !!document.querySelector('#create-ws-btn, #join-ws-btn, .sidebar-header, #compose-input, .channel-header');
      if (appReady) return true;
      const loading = document.getElementById('loading');
      if (!loading) return true;
      const style = window.getComputedStyle(loading);
      return loading.style.opacity === '0' || loading.style.display === 'none' || style.display === 'none' || style.visibility === 'hidden';
    }, { timeout });
    await page.waitForSelector(readySelector, { timeout });
  };
  try {
    await waitReady(maxTimeout);
  } catch {
    if (page.isClosed()) throw new Error('page closed while waiting for app');
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitReady(maxTimeout);
  }
}

async function createWorkspace(page, name = 'QA Workspace', alias = 'Tester') {
  await page.goto('/');
  await waitForApp(page);

  const staleModalClose = page.locator('.modal .btn-secondary').first();
  if (await staleModalClose.count()) {
    await staleModalClose.click().catch(() => {});
  }

  if (await page.locator('#create-ws-btn').count()) {
    await page.locator('#create-ws-btn').click();
  } else {
    await page.evaluate(() => sessionStorage.setItem('decent:welcomeAction', 'create'));
    await page.goto('/app');
  }

  await page.locator('.modal').waitFor({ state: 'visible', timeout: 10000 });
  await expect(page.locator('.modal h2')).toHaveText(/Create private group|Create Workspace/);

  const nameInput = page.locator('.modal input[name="name"]');
  const aliasInput = page.locator('.modal input[name="alias"]');
  await nameInput.fill(name);
  await aliasInput.fill(alias);
  await page.click('.modal .btn-primary');
  await waitForApp(page, 10000);
}

async function seedDirectConversation(page, options = {}) {
  return page.evaluate(async ({
    peerId = 'dm-peer-1',
    displayName = 'Bob',
    message = 'Direct message that should survive refresh',
  }) => {
    const ctrl = window.__ctrl;
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
    await new Promise(resolve => {
      requestAnimationFrame(() => setTimeout(resolve, 200));
    });

    return { conversationId: conv.id, peerId, displayName, message };
  }, options);
}

async function getMessages(page) {
  const texts = await page.locator('.message-content').allTextContents();
  return texts.map((t) => t.trim()).filter(Boolean);
}

test.describe('QA DM refresh signoff smoke', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
  });

  test('direct /app load restores intended DM from persisted lastView', async ({ page, context }) => {
    test.setTimeout(60000);
    await createWorkspace(page, 'Restorable Route Workspace', 'User');
    const seeded = await seedDirectConversation(page, {
      peerId: 'restorable-dm-peer',
      displayName: 'Restorable Bob',
      message: 'restorable dm survives direct app load',
    });

    await page.click('#ws-rail-dms');
    await page.locator(`[data-testid="direct-conversation-item"][data-direct-conv-id="${seeded.conversationId}"]`).click();
    await expect(page.locator('.channel-header h2')).toContainText('Restorable Bob');

    // Wait for fire-and-forget persistViewState IndexedDB write to complete
    await page.evaluate(async (convId) => {
      for (let i = 0; i < 20; i++) {
        const saved = await (window as any).__ctrl.persistentStore.getSetting('ui:lastView');
        if (saved?.directConversationId === convId) return;
        await new Promise(r => setTimeout(r, 100));
      }
    }, seeded.conversationId);

    // Close page1 first — the app enforces single-tab via BroadcastChannel
    await page.close();

    const page2 = await context.newPage();
    await page2.goto('/app');
    await waitForApp(page2);

    await expect(page2.locator('#ws-rail-dms')).toHaveClass(/active/);
    await expect(page2.locator('.channel-header h2')).toContainText('Restorable Bob');
    await expect(page2.locator(`[data-testid="direct-conversation-item"][data-direct-conv-id="${seeded.conversationId}"]`)).toHaveClass(/active/);
    const messages = await getMessages(page2);
    expect(messages).toContain('restorable dm survives direct app load');
  });

  test('missing saved DM falls back to workspace channel without stale DM content', async ({ page }) => {
    await createWorkspace(page, 'Fallback Workspace', 'User');
    await seedDirectConversation(page, {
      peerId: 'stale-dm-peer',
      displayName: 'Stale DM',
      message: 'THIS_STALE_DM_MUST_NOT_APPEAR',
    });

    await page.evaluate(async () => {
      const ctrl = window.__ctrl;
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
    await expect(page.locator('.channel-header h2')).not.toContainText('Stale DM');
    const messages = await getMessages(page);
    expect(messages).not.toContain('THIS_STALE_DM_MUST_NOT_APPEAR');
  });

  test('missing saved DM falls back to first available DM when no workspace exists', async ({ page }) => {
    test.setTimeout(60000);
    // Navigate to /app so __ctrl is available (it's not set on /)
    await page.goto('/app');
    await waitForApp(page);
    const seeded = await seedDirectConversation(page, {
      peerId: 'fallback-dm-peer',
      displayName: 'Fallback Bob',
      message: 'fallback dm visible',
    });

    await page.evaluate(async () => {
      const ctrl = window.__ctrl;
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

    await expect(page.locator('#ws-rail-dms')).toHaveClass(/active/);
    await expect(page.locator('.channel-header h2')).toContainText('Fallback Bob');
    await expect(page.locator(`[data-testid="direct-conversation-item"][data-direct-conv-id="${seeded.conversationId}"]`)).toHaveClass(/active/);
    const messages = await getMessages(page);
    expect(messages).toContain('fallback dm visible');
  });

  test('missing saved DM falls back to landing welcome when nothing else exists', async ({ page }) => {
    await page.goto('/app');
    await waitForApp(page);
    await page.evaluate(async () => {
      const ctrl = window.__ctrl;
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

    await expect(page.getByRole('heading', { name: 'Start private chat without giving up control.' })).toBeVisible();
    await expect(page.locator('#create-ws-btn')).toBeVisible();
    await expect(page.locator('#join-ws-btn')).toBeVisible();
  });

  test('refresh restore does not add history entries and back/forward stays stable', async ({ page, browserName }) => {
    test.setTimeout(60000);
    await createWorkspace(page, 'History Workspace', 'User');
    const seeded = await seedDirectConversation(page, {
      peerId: 'history-peer',
      displayName: 'History Bob',
      message: 'history dm survives refresh',
    });

    await page.click('#ws-rail-dms');
    await page.locator(`[data-testid="direct-conversation-item"][data-direct-conv-id="${seeded.conversationId}"]`).click();
    await expect(page.locator('.channel-header h2')).toContainText('History Bob');

    // Wait for fire-and-forget persistViewState IndexedDB write to complete
    await page.evaluate(async (convId) => {
      // Poll until lastView has our DM conversation persisted
      for (let i = 0; i < 20; i++) {
        const saved = await (window as any).__ctrl.persistentStore.getSetting('ui:lastView');
        if (saved?.directConversationId === convId) return;
        await new Promise(r => setTimeout(r, 100));
      }
    }, seeded.conversationId);

    const before = await page.evaluate(() => ({ url: location.pathname, len: history.length }));
    await page.reload();
    await waitForApp(page);
    const after = await page.evaluate(() => ({ url: location.pathname, len: history.length }));

    expect(after.url).toBe(before.url);
    if (browserName === 'firefox') {
      // Firefox may add one extra history entry around reload/navigation restore.
      expect(after.len).toBeGreaterThanOrEqual(before.len);
      expect(after.len).toBeLessThanOrEqual(before.len + 1);
    } else {
      expect(after.len).toBe(before.len);
    }
    await expect(page.locator('.channel-header h2')).toContainText('History Bob');

    await page.goBack();
    await waitForApp(page);
    const backState = await page.evaluate(() => ({ url: location.pathname, len: history.length }));
    expect(['/','/app']).toContain(backState.url);

    await page.goForward();
    await waitForApp(page);
    const forwardState = await page.evaluate(() => ({ url: location.pathname, len: history.length }));
    expect(forwardState.url).toBe('/app');
    await expect(page.locator('.channel-header h2')).toContainText('History Bob');
  });
});
