import { test, expect, Page } from '@playwright/test';

async function resetAndOpenApp(page: Page): Promise<void> {
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
}

async function createWorkspace(page: Page, wsName = 'Activity WS', alias = 'Alice'): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  await page.locator('.modal input[name="name"]').fill(wsName);
  await page.locator('.modal input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

async function sendRootMessage(page: Page, text: string): Promise<string> {
  await page.locator('#compose-input').fill(text);
  await page.locator('#compose-input').press('Enter');
  await expect(page.locator('.message-content')).toContainText(text);

  const rootMsgId = await page.evaluate(() => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const messages = ctrl.messageStore.getMessages(state.activeChannelId);
    return messages.find((m: any) => !m.threadId)?.id;
  });

  return rootMsgId;
}

test('activity shows thread reply and opens thread on click', async ({ page }) => {
  test.setTimeout(45000);

  await resetAndOpenApp(page);
  await createWorkspace(page);

  const rootText = `Root message for thread ${Date.now()}`;
  const replyText = `Reply from Bob in thread ${Date.now()}`;
  const rootMsgId = await sendRootMessage(page, rootText);

  // Simulate receiving a thread reply from another peer
  await page.evaluate(async ({ rootMsgId, replyText }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const wsId = state.activeWorkspaceId;
    const channelId = state.activeChannelId;

    const bobId = 'bob-thread-peer-' + Date.now();

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

    const reply = await ctrl.messageStore.createMessage(channelId, bobId, replyText, 'text', rootMsgId);
    ctrl.messageStore.forceAdd(reply);

    const id = `thread:${wsId}:${channelId}:${rootMsgId}`;
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

  await page.waitForTimeout(500);
  await page.waitForSelector('#activity-btn .activity-badge', { timeout: 10000 });
  await page.click('#activity-btn');
  await page.waitForSelector('.activity-row', { timeout: 10000 });
  await expect(page.locator('.activity-panel-list')).toContainText(replyText);

  await page.locator('.activity-row').first().click();
  await page.waitForSelector('#thread-panel:not(.hidden)', { timeout: 10000 });
  await expect(page.locator('#thread-messages')).toContainText(replyText);
});

test('badge updates without refresh when existing thread activity flips back to unread', async ({ page }) => {
  test.setTimeout(45000);

  await resetAndOpenApp(page);
  await createWorkspace(page, 'Badge WS', 'Alice');

  const rootMsgId = await sendRootMessage(page, `Root ${Date.now()}`);

  // Start with existing (already-read) activity item for the thread.
  await page.evaluate(async ({ rootMsgId }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const wsId = state.activeWorkspaceId;
    const channelId = state.activeChannelId;

    const bobId = 'bob-unread-peer';
    const ws = ctrl.workspaceManager.getWorkspace(wsId);
    if (!ws.members.some((m: any) => m.peerId === bobId)) {
      ws.members.push({ peerId: bobId, alias: 'Bob', publicKey: '', joinedAt: Date.now(), role: 'member' });
    }

    const firstReply = await ctrl.messageStore.createMessage(channelId, bobId, `first-${Date.now()}`, 'text', rootMsgId);
    ctrl.messageStore.forceAdd(firstReply);

    const threadActivityId = `thread:${wsId}:${channelId}:${rootMsgId}`;
    (ctrl as any).activityItems = [{
      id: threadActivityId,
      type: 'thread-reply',
      workspaceId: wsId,
      channelId,
      threadId: rootMsgId,
      messageId: firstReply.id,
      actorId: bobId,
      snippet: firstReply.content,
      timestamp: firstReply.timestamp,
      read: true,
    }];

    ctrl.ui.updateWorkspaceRail();
  }, { rootMsgId });

  await expect(page.locator('#activity-btn .activity-badge')).toHaveCount(0);

  // New streamed thread reply in same thread: should set existing activity.read=false.
  // Bug today: unread count changes, but item length doesn't, so rail badge stays stale.
  await page.evaluate(async ({ rootMsgId }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const channelId = state.activeChannelId;
    const bobId = 'bob-unread-peer';

    const secondReply = await ctrl.messageStore.createMessage(channelId, bobId, `second-${Date.now()}`, 'text', rootMsgId);
    ctrl.messageStore.forceAdd(secondReply);

    await ctrl.transport.onMessage(bobId, {
      type: 'stream-done',
      messageId: secondReply.id,
    });
  }, { rootMsgId });

  await expect(page.locator('#activity-btn .activity-badge')).toHaveText('1');
});

test('mark all read updates bell immediately without refresh', async ({ page }) => {
  test.setTimeout(45000);

  await resetAndOpenApp(page);
  await createWorkspace(page, 'MarkRead WS', 'Alice');

  const rootMsgId = await sendRootMessage(page, `Root ${Date.now()}`);

  await page.evaluate(async ({ rootMsgId }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const wsId = state.activeWorkspaceId;
    const channelId = state.activeChannelId;
    const bobId = 'bob-markall-peer';

    const ws = ctrl.workspaceManager.getWorkspace(wsId);
    if (!ws.members.some((m: any) => m.peerId === bobId)) {
      ws.members.push({ peerId: bobId, alias: 'Bob', publicKey: '', joinedAt: Date.now(), role: 'member' });
    }

    const reply = await ctrl.messageStore.createMessage(channelId, bobId, `reply-${Date.now()}`, 'text', rootMsgId);
    ctrl.messageStore.forceAdd(reply);

    const threadActivityId = `thread:${wsId}:${channelId}:${rootMsgId}`;
    (ctrl as any).activityItems = [{
      id: threadActivityId,
      type: 'thread-reply',
      workspaceId: wsId,
      channelId,
      threadId: rootMsgId,
      messageId: reply.id,
      actorId: bobId,
      snippet: reply.content,
      timestamp: reply.timestamp,
      read: false,
    }];

    ctrl.ui.updateWorkspaceRail();
  }, { rootMsgId });

  await expect(page.locator('#activity-btn .activity-badge')).toHaveText('1');

  await page.click('#activity-btn');
  await page.getByRole('button', { name: 'Mark all read' }).click();

  await expect(page.locator('#activity-btn .activity-badge')).toHaveCount(0);
});
