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

test('activity jump finds older replies inside a virtualized thread', async ({ page }) => {
  test.setTimeout(60000);

  await resetAndOpenApp(page);
  await createWorkspace(page, 'Virtualized Activity WS', 'Alice');

  const rootMsgId = await sendRootMessage(page, `Virtualized root ${Date.now()}`);

  const seeded = await page.evaluate(async ({ rootMsgId }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const wsId = state.activeWorkspaceId;
    const channelId = state.activeChannelId;

    const bobId = 'bob-virtual-thread-peer';
    const ws = ctrl.workspaceManager.getWorkspace(wsId);
    if (!ws.members.some((m: any) => m.peerId === bobId)) {
      ws.members.push({ peerId: bobId, alias: 'Bob', publicKey: '', joinedAt: Date.now(), role: 'member' });
    }

    const targetIndex = 24;
    const totalReplies = 220;
    let targetId = '';
    let targetText = '';

    for (let i = 0; i < totalReplies; i += 1) {
      const text = i === targetIndex
        ? `phase3_thread_target_${Date.now()}`
        : `phase3_thread_filler_${String(i).padStart(3, '0')}`;
      const reply = await ctrl.messageStore.createMessage(channelId, bobId, text, 'text', rootMsgId);
      ctrl.messageStore.forceAdd(reply);
      if (i === targetIndex) {
        targetId = reply.id;
        targetText = text;
      }
    }

    const id = `thread:${wsId}:${channelId}:${rootMsgId}`;
    (ctrl as any).activityItems = [{
      id,
      type: 'thread-reply',
      workspaceId: wsId,
      channelId,
      threadId: rootMsgId,
      messageId: targetId,
      actorId: bobId,
      snippet: targetText,
      timestamp: Date.now(),
      read: false,
    }];

    ctrl.ui.renderMessages();
    ctrl.ui.updateWorkspaceRail();

    return { targetText, totalReplies };
  }, { rootMsgId });

  await expect(page.locator('#activity-btn .activity-badge')).toHaveText('1');
  await page.click('#activity-btn');
  await page.waitForSelector('.activity-row', { timeout: 10000 });
  await expect(page.locator('.activity-panel-list')).toContainText(seeded.targetText);

  await page.locator('.activity-row').first().click();
  await page.waitForSelector('#thread-panel:not(.hidden)', { timeout: 10000 });

  const targetMessage = page.locator('#thread-messages .message .message-content', { hasText: seeded.targetText }).first();
  await expect(targetMessage).toBeVisible({ timeout: 10000 });
  await expect(targetMessage).toBeInViewport();

  const metrics = await page.evaluate(() => {
    const container = document.getElementById('thread-messages');
    const rendered = container?.querySelectorAll('.message[data-message-id]').length ?? 0;
    const spacers = container?.querySelectorAll('.message-spacer').length ?? 0;
    return { rendered, spacers };
  });

  expect(metrics.rendered).toBeLessThan(seeded.totalReplies + 1);
  expect(metrics.spacers).toBeGreaterThan(0);
});

test('replaying the same thread reply does not resurrect a read activity badge', async ({ page }) => {
  test.setTimeout(45000);

  await resetAndOpenApp(page);
  await createWorkspace(page, 'Badge WS', 'Alice');

  const rootMsgId = await sendRootMessage(page, `Root ${Date.now()}`);

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
    await ctrl.persistentStore.saveSetting('activityItems', (ctrl as any).activityItems);

    // Historical replay of the SAME reply should not flip the item back to unread.
    (ctrl as any).maybeRecordThreadActivity(firstReply, channelId);
    ctrl.ui.updateWorkspaceRail();
  }, { rootMsgId });

  await expect(page.locator('#activity-btn .activity-badge')).toHaveCount(0);
});

test('clicking an activity item marks it read and persists that state', async ({ page }) => {
  test.setTimeout(45000);

  await resetAndOpenApp(page);
  await createWorkspace(page, 'Activity Read WS', 'Alice');

  const rootMsgId = await sendRootMessage(page, `Root ${Date.now()}`);

  await page.evaluate(async ({ rootMsgId }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const wsId = state.activeWorkspaceId;
    const channelId = state.activeChannelId;
    const bobId = 'bob-clickread-peer';

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
    await ctrl.persistentStore.saveSetting('activityItems', (ctrl as any).activityItems);
  }, { rootMsgId });

  await expect(page.locator('#activity-btn .activity-badge')).toHaveText('1');

  await page.click('#activity-btn');
  await page.locator('.activity-row').first().click();
  await page.waitForSelector('#thread-panel:not(.hidden)', { timeout: 10000 });
  await expect(page.locator('#activity-btn .activity-badge')).toHaveCount(0);

  const persistedRead = await page.evaluate(async ({ rootMsgId }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const wsId = state.activeWorkspaceId;
    const channelId = state.activeChannelId;
    const threadActivityId = `thread:${wsId}:${channelId}:${rootMsgId}`;
    const saved = await ctrl.persistentStore.getSetting('activityItems');
    const item = Array.isArray(saved) ? saved.find((i: any) => i.id === threadActivityId) : null;
    return item?.read ?? null;
  }, { rootMsgId });

  expect(persistedRead).toBe(true);
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
