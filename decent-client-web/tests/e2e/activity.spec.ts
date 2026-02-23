import { test, expect } from '@playwright/test';

test.fixme('activity shows thread reply and opens thread on click', async ({ page }) => {
  test.setTimeout(45000);

  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  await page.waitForSelector('#create-ws-btn', { timeout: 15000 });
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill('Activity WS');
  await inputs.nth(1).fill('Alice');
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });

  // Alice sends root message.
  await page.locator('#compose-input').fill('Root message for thread');
  await page.locator('#compose-input').press('Enter');

  // Simulate incoming thread reply from a workspace member.
  await page.evaluate(async () => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const transport = (window as any).__transport;
    const wsId = state.activeWorkspaceId;
    const channelId = state.activeChannelId;

    const root = ctrl.messageStore.getMessages(channelId).find((m: any) => m.content === 'Root message for thread');
    if (!root) throw new Error('Root message not found');

    const bobId = 'bob-peer-activity';
    const ws = ctrl.workspaceManager.getWorkspace(wsId);
    if (!ws.members.some((m: any) => m.peerId === bobId)) {
      ws.members.push({
        peerId: bobId,
        alias: 'Bob',
        publicKey: '',
        joinedAt: Date.now(),
        role: 'member',
      });
    }

    state.connectedPeers.add(bobId);
    state.readyPeers?.add?.(bobId);

    const reply = ctrl.messageStore.createMessage(channelId, bobId, 'Reply from Bob in thread', root.id);
    ctrl.messageStore.addMessage(reply);
    const crdt = ctrl.getOrCreateCRDT ? ctrl.getOrCreateCRDT(channelId) : null;
    crdt?.addReceived?.(reply);

    // Record Activity using the same app path and refresh UI.
    ctrl.maybeRecordThreadActivity?.(reply, channelId);
    ctrl.ui?.renderMessages?.();
    ctrl.ui?.updateChannelHeader?.();
  });

  await page.click('#activity-btn');
  await page.waitForSelector('.activity-row', { timeout: 10000 });
  await expect(page.locator('.activity-list')).toContainText('Reply from Bob in thread');

  await page.locator('.activity-row').first().click();
  await page.waitForSelector('#thread-panel:not(.hidden)', { timeout: 10000 });
  await expect(page.locator('#thread-messages')).toContainText('Reply from Bob in thread');
});
