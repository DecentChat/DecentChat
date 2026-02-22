import { test, expect, type Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

async function injectStreamMessage(page: Page, params: {
  peerId: string;
  messageId: string;
  senderName: string;
  content: string;
}) {
  await page.evaluate(async ({ peerId, messageId, senderName, content }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    if (!ctrl || !state?.activeChannelId || !state?.activeWorkspaceId) {
      throw new Error('App state not ready for stream injection');
    }

    await ctrl.transport.onMessage(peerId, {
      type: 'stream-start',
      messageId,
      channelId: state.activeChannelId,
      workspaceId: state.activeWorkspaceId,
      senderId: peerId,
      senderName,
      isDirect: false,
      replyToId: 'root-message',
    });
    await ctrl.transport.onMessage(peerId, {
      type: 'stream-delta',
      messageId,
      content,
    });
  }, params);
}

async function finalizeStreamMessage(page: Page, params: { peerId: string; messageId: string }) {
  await page.evaluate(async ({ peerId, messageId }) => {
    const ctrl = (window as any).__ctrl;
    await ctrl.transport.onMessage(peerId, {
      type: 'stream-done',
      messageId,
    });
  }, params);
}

test.describe('Streaming Message Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'Streaming Test Workspace', 'Alice');
  });

  test('streamed message appears once with no duplicate final copy', async ({ page }) => {
    const messageId = 'stream-msg-once';
    await injectStreamMessage(page, {
      peerId: 'assistant-peer-once',
      messageId,
      senderName: 'Assistant',
      content: 'streamed answer from assistant',
    });
    await finalizeStreamMessage(page, { peerId: 'assistant-peer-once', messageId });

    await expect(page.locator(`.message[data-message-id="${messageId}"]`)).toHaveCount(1);
    await expect(page.locator('.message-content', { hasText: 'streamed answer from assistant' })).toHaveCount(1);
  });

  test('stream finalization removes streaming marker and cursor', async ({ page }) => {
    const messageId = 'stream-msg-finalize';
    await injectStreamMessage(page, {
      peerId: 'assistant-peer-finalize',
      messageId,
      senderName: 'Assistant',
      content: 'partial stream content',
    });

    await expect(page.locator(`.message[data-message-id="${messageId}"].streaming`)).toHaveCount(1);
    await expect(page.locator(`.message[data-message-id="${messageId}"] .message-content`)).toContainText('▋');

    await finalizeStreamMessage(page, { peerId: 'assistant-peer-finalize', messageId });

    await expect(page.locator(`.message[data-message-id="${messageId}"].streaming`)).toHaveCount(0);
    await expect(page.locator(`.message[data-message-id="${messageId}"] .message-content`)).not.toContainText('▋');
    await expect(page.locator(`.message[data-message-id="${messageId}"] .message-content`))
      .toContainText('partial stream content');
  });

  test('normal non-stream incoming message still renders', async ({ page }) => {
    await page.evaluate(async () => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      const peerId = 'normal-peer';

      const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
      if (ws && !ws.members.some((m: any) => m.peerId === peerId)) {
        ws.members.push({
          peerId,
          alias: 'Normal Peer',
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

      const originalDecrypt = ctrl.messageProtocol.decryptMessage.bind(ctrl.messageProtocol);
      ctrl.messageProtocol.decryptMessage = async () => 'plain incoming non-stream message';
      try {
        await ctrl.transport.onMessage(peerId, {
          type: 'ciphertext',
          channelId: state.activeChannelId,
          workspaceId: state.activeWorkspaceId,
          messageId: 'normal-msg-1',
          timestamp: Date.now(),
          vectorClock: {},
        });
      } finally {
        ctrl.messageProtocol.decryptMessage = originalDecrypt;
      }
    });

    await expect(page.locator('.message-content', { hasText: 'plain incoming non-stream message' })).toHaveCount(1);
  });

  test('streamed message survives refresh (persisted)', async ({ page }) => {
    const messageId = 'stream-msg-persisted';
    await injectStreamMessage(page, {
      peerId: 'assistant-peer-persisted',
      messageId,
      senderName: 'Assistant',
      content: 'persist me after refresh',
    });
    await finalizeStreamMessage(page, { peerId: 'assistant-peer-persisted', messageId });

    await page.reload();
    await waitForApp(page);

    const persisted = await page.evaluate(async ({ id }) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      const channelId = state?.activeChannelId;
      if (!ctrl || !channelId) return false;
      const msgs = await ctrl.persistentStore.getChannelMessages(channelId);
      return msgs.some((m: any) => m.id === id && m.content === 'persist me after refresh' && !m.streaming);
    }, { id: messageId });

    expect(persisted).toBe(true);
  });
});
