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

  // Get the root message and its ID for threading
  const rootMsgId = await page.evaluate(() => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const messages = ctrl.messageStore.getMessages(state.activeChannelId);
    return messages.find((m: any) => !m.threadId)?.id;
  });

  // Simulate receiving a thread reply from another peer
  await page.evaluate(async ({ rootMsgId, replyText }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const wsId = state.activeWorkspaceId;
    const channelId = state.activeChannelId;

    const bobId = 'bob-thread-peer-' + Date.now();
    
    // Add Bob as a workspace member
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

    // Create a reply message in the thread
    const reply = await ctrl.messageStore.createMessage(channelId, bobId, replyText, 'text', rootMsgId);
    ctrl.messageStore.forceAdd(reply);

    // Simulate receiving this as an incoming message (triggers activity tracking)
    // by manually triggering the activity check as would happen in onIncomingMessage
    const id = `thread:${wsId}:${channelId}:${reply.id}`;
    if (!ctrl.activityItems?.some((i: any) => i.id === id)) {
      (ctrl as any).activityItems.unshift({
        id,
        type: 'thread-reply',
        workspaceId: wsId,
        channelId,
        threadId: rootMsgId,
        messageId: reply.id,
        actorId: bobId,
        snippet: replyText.slice(0, 140),
        timestamp: reply.timestamp,
        read: false,
      });
    }

    ctrl.ui.renderMessages();
    ctrl.ui.updateChannelHeader();
    ctrl.ui.updateWorkspaceRail();
  }, { rootMsgId, replyText });

  // Wait for activity badge to appear
  await page.waitForTimeout(500);  // Let DOM updates settle
  await page.waitForSelector('#activity-btn .activity-badge', { timeout: 10000 });
  await page.click('#activity-btn');
  await page.waitForSelector('.activity-row', { timeout: 10000 });
  await expect(page.locator('.activity-list')).toContainText(replyText);

  await page.locator('.activity-row').first().click();
  await page.waitForSelector('#thread-panel:not(.hidden)', { timeout: 10000 });
  await expect(page.locator('#thread-messages')).toContainText(replyText);
});
