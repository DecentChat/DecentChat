import { test, expect, type Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

async function injectStart(page: Page, peerId: string, messageId: string) {
  await page.evaluate(async ({ peerId, messageId }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;

    const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
    if (ws && !ws.members.some((m: any) => m.peerId === peerId)) {
      ws.members.push({
        peerId,
        alias: 'Assistant',
        publicKey: ctrl.myPublicKey,
        joinedAt: Date.now(),
        role: 'member',
      });
    }

    await ctrl.persistentStore.savePeer({
      peerId,
      publicKey: ctrl.myPublicKey,
      lastSeen: Date.now(),
    });

    await ctrl.transport.onMessage(peerId, {
      type: 'stream-start',
      messageId,
      channelId: state.activeChannelId,
      workspaceId: state.activeWorkspaceId,
      senderId: peerId,
      senderName: 'Assistant',
      isDirect: false,
    });
  }, { peerId, messageId });
}

async function injectDelta(page: Page, peerId: string, messageId: string, content: string) {
  await page.evaluate(async ({ peerId, messageId, content }) => {
    const ctrl = (window as any).__ctrl;
    await ctrl.transport.onMessage(peerId, {
      type: 'stream-delta',
      messageId,
      content,
    });
  }, { peerId, messageId, content });
}

async function injectDone(page: Page, peerId: string, messageId: string) {
  await page.evaluate(async ({ peerId, messageId }) => {
    const ctrl = (window as any).__ctrl;
    await ctrl.transport.onMessage(peerId, {
      type: 'stream-done',
      messageId,
    });
  }, { peerId, messageId });
}

test.describe('Streaming contract (real-time UI behavior)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'Streaming Contract Workspace', 'Alice');
  });

  test('multiple deltas update one message progressively', async ({ page }) => {
    const peerId = 'assistant-peer-contract';
    const messageId = 'stream-contract-1';

    await injectStart(page, peerId, messageId);
    await injectDelta(page, peerId, messageId, 'Hel');
    await expect(page.locator(`.message[data-message-id="${messageId}"] .message-content`)).toContainText('Hel');

    await injectDelta(page, peerId, messageId, 'Hello world');
    await expect(page.locator(`.message[data-message-id="${messageId}"] .message-content`)).toContainText('Hello world');

    await injectDone(page, peerId, messageId);
    await expect(page.locator(`.message[data-message-id="${messageId}"].streaming`)).toHaveCount(0);
  });


  test('stream-start does not render an empty visible message before first delta', async ({ page }) => {
    const peerId = 'assistant-peer-contract-empty';
    const messageId = 'stream-contract-empty';

    await injectStart(page, peerId, messageId);
    await expect(page.locator(`.message[data-message-id="${messageId}"]`)).toHaveCount(0);

    await injectDelta(page, peerId, messageId, 'First real chunk');
    await expect(page.locator(`.message[data-message-id="${messageId}"] .message-content`))
      .toContainText('First real chunk');
  });

  test('finalized stream persists across refresh', async ({ page }) => {
    const peerId = 'assistant-peer-contract-2';
    const messageId = 'stream-contract-2';

    await injectStart(page, peerId, messageId);
    await injectDelta(page, peerId, messageId, 'Streaming persistence check');
    await injectDone(page, peerId, messageId);

    await page.reload();
    await waitForApp(page);

    await expect(page.locator(`.message[data-message-id="${messageId}"] .message-content`))
      .toContainText('Streaming persistence check');
  });
});
