import { test, expect } from '@playwright/test';

test('activity shows thread reply and opens thread on click', async ({ page }) => {
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

  const rootText = `Root message for thread ${Date.now()}`;
  const replyText = `Reply from Bob in thread ${Date.now()}`;

  // Alice sends root message.
  await page.locator('#compose-input').fill(rootText);
  await page.locator('#compose-input').press('Enter');
  await expect(page.locator('.message-content')).toContainText(rootText);

  // Deterministic injection of an incoming thread reply + activity item.
  await page.evaluate(async ({ replyText }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const wsId = state.activeWorkspaceId;
    const channelId = state.activeChannelId;

    const ws = ctrl.workspaceManager.getWorkspace(wsId);
    const bobId = 'bob-e2e-peer';
    if (!ws.members.some((m: any) => m.peerId === bobId)) {
      ws.members.push({
        peerId: bobId,
        alias: 'Bob',
        publicKey: '',
        joinedAt: Date.now(),
        role: 'member',
      });
    }

    const root = ctrl.messageStore.getMessages(channelId).find((m: any) => !m.threadId);
    const reply = await ctrl.messageStore.createMessage(channelId, bobId, replyText, 'text', root.id);
    ctrl.messageStore.forceAdd(reply);

    const activityId = `thread:${wsId}:${channelId}:${reply.id}`;
    ctrl.activityItems = ctrl.activityItems || [];
    ctrl.activityItems.unshift({
      id: activityId,
      type: 'thread-reply',
      workspaceId: wsId,
      channelId,
      threadId: root.id,
      messageId: reply.id,
      actorId: bobId,
      snippet: replyText,
      timestamp: Date.now(),
      read: false,
    });

    ctrl.ui.renderMessages();
    ctrl.ui.updateChannelHeader();
  }, { replyText });

  await page.waitForSelector('#activity-btn .activity-badge', { timeout: 10000 });
  await page.click('#activity-btn');
  await page.waitForSelector('.activity-row', { timeout: 10000 });
  await expect(page.locator('.activity-list')).toContainText(replyText);

  await page.locator('.activity-row').first().click();
  await page.waitForSelector('#thread-panel:not(.hidden)', { timeout: 10000 });
  await expect(page.locator('#thread-messages')).toContainText(replyText);
});
