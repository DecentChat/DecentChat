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

    const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
    if (ws && !ws.members.some((m: any) => m.peerId === peerId)) {
      ws.members.push({
        peerId,
        alias: senderName,
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
      senderName,
      isDirect: false,
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

    await expect(page.locator(`.message[data-message-id="${messageId}"] .message-content`))
      .toContainText('partial stream content');

    await finalizeStreamMessage(page, { peerId: 'assistant-peer-finalize', messageId });

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

    await expect(page.locator('.message-content', { hasText: 'plain incoming non-stream message' }).first()).toContainText('plain incoming non-stream message');
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


  test('streaming does not force-scroll when user scrolled up', async ({ page }) => {
    const messageId = 'stream-msg-scroll-lock';
    const peerId = 'assistant-peer-scroll';

    // Seed enough history to make the list scrollable, then simulate
    // a real user scroll-up (fires scroll event so the detector sees it).
    const before = await page.evaluate(async () => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      if (!ctrl || !state?.activeChannelId || !state?.activeWorkspaceId) {
        throw new Error('App state not ready for scroll test');
      }

      for (let i = 0; i < 140; i++) {
        const msg = await ctrl.messageStore.createMessage(
          state.activeChannelId,
          state.myPeerId,
          `Backlog message ${i} ${'x'.repeat(80)}`,
          'text',
        );
        ctrl.messageStore.forceAdd(msg);
      }
      ctrl.ui.renderMessages();

      const list = document.getElementById('messages-list') as HTMLElement | null;
      if (!list) throw new Error('messages-list missing');

      // Wait for renderMessages' rAF(scrollToBottom) to complete before scrolling up,
      // otherwise the scheduled scrollToBottom will override our scroll position.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Simulate user scroll-up by setting scrollTop and dispatching scroll event.
      list.scrollTop = 0;
      list.dispatchEvent(new Event('scroll'));

      return {
        top: list.scrollTop,
        distanceFromBottom: list.scrollHeight - list.scrollTop - list.clientHeight,
      };
    });

    expect(before.distanceFromBottom).toBeGreaterThan(400);

    // Now stream 20 deltas — scroll should NOT move.
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

      for (let i = 1; i <= 20; i++) {
        await ctrl.transport.onMessage(peerId, {
          type: 'stream-delta',
          messageId,
          content: `Streaming chunk ${i} ${'content '.repeat(i * 6)}`,
        });
        // Yield to let rAF clear programmatic-scroll flag between deltas.
        await new Promise(r => requestAnimationFrame(r));
      }
    }, { peerId, messageId });

    const after = await page.evaluate(() => {
      const list = document.getElementById('messages-list') as HTMLElement | null;
      if (!list) throw new Error('messages-list missing after stream');
      return {
        top: list.scrollTop,
        distanceFromBottom: list.scrollHeight - list.scrollTop - list.clientHeight,
      };
    });

    // Should stay near where user left it (top), not jump to the streaming bottom.
    // Allow up to ~120px drift from DOM insertion / browser scroll anchoring.
    expect(after.top).toBeLessThan(120);
    expect(after.distanceFromBottom).toBeGreaterThan(400);
  });
});

test.describe('Streaming Message Persistence on Refresh', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'Stream Persist Test', 'Alice');
  });

  test('partial streamed message recoverable after mid-stream refresh', async ({ page }) => {
    const messageId = 'stream-msg-midrefresh';
    await injectStreamMessage(page, {
      peerId: 'assistant-peer-midrefresh',
      messageId,
      senderName: 'Assistant',
      content: 'partial content before refresh',
    });

    // DO NOT call finalizeStreamMessage — simulate refresh mid-stream
    await page.reload();
    await waitForApp(page);

    const recovered = await page.evaluate(async ({ id }) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      const channelId = state?.activeChannelId;
      if (!ctrl || !channelId) return null;
      const msgs = await ctrl.persistentStore.getChannelMessages(channelId);
      const found = msgs.find((m: any) => m.id === id);
      return found ? { content: found.content, streaming: found.streaming } : null;
    }, { id: messageId });

    expect(recovered).not.toBeNull();
    expect(recovered!.content).toBe('partial content before refresh');
  });

  test('recovered mid-stream message has streaming flag cleared', async ({ page }) => {
    const messageId = 'stream-msg-incomplete';
    await injectStreamMessage(page, {
      peerId: 'assistant-peer-incomplete',
      messageId,
      senderName: 'Assistant',
      content: 'this was interrupted',
    });

    await page.reload();
    await waitForApp(page);

    const state = await page.evaluate(async ({ id }) => {
      const ctrl = (window as any).__ctrl;
      const channelId = (window as any).__state?.activeChannelId;
      if (!ctrl || !channelId) return null;
      const msgs = await ctrl.persistentStore.getChannelMessages(channelId);
      const found = msgs.find((m: any) => m.id === id);
      return found ? { streaming: found.streaming, content: found.content } : null;
    }, { id: messageId });

    expect(state).not.toBeNull();
    expect(state!.content).toBe('this was interrupted');
    expect(state!.streaming).toBeFalsy();
  });

  test('no duplicate when final message arrives after streaming', async ({ page }) => {
    const messageId = 'stream-msg-dedup';
    const peerId = 'assistant-peer-dedup';

    // Start streaming and finalize
    await injectStreamMessage(page, {
      peerId,
      messageId,
      senderName: 'Assistant',
      content: 'final streamed content',
    });
    await finalizeStreamMessage(page, { peerId, messageId });

    // Simulate a normal ciphertext message arriving with the same messageId
    // (as if bot sent final message for sync)
    await page.evaluate(async ({ peerId, messageId }) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;

      // Mock decrypt to return same content
      const originalDecrypt = ctrl.messageProtocol.decryptMessage.bind(ctrl.messageProtocol);
      ctrl.messageProtocol.decryptMessage = async () => 'final streamed content';
      try {
        await ctrl.transport.onMessage(peerId, {
          type: 'ciphertext',
          channelId: state.activeChannelId,
          workspaceId: state.activeWorkspaceId,
          messageId,
          timestamp: Date.now(),
          vectorClock: {},
        });
      } finally {
        ctrl.messageProtocol.decryptMessage = originalDecrypt;
      }
    }, { peerId, messageId });

    // Count messages with this ID — should be exactly 1
    const count = await page.evaluate(({ id }) => {
      return document.querySelectorAll(`.message[data-message-id="${id}"]`).length;
    }, { id: messageId });

    expect(count).toBe(1);
  });


  test('sync repairs a truncated streamed message with the full content', async ({ page }) => {
    const messageId = 'stream-msg-sync-repair';
    const peerId = 'assistant-peer-sync-repair';
    const partial = 'This message got cut halfway';
    const full = 'This message got cut halfway because the last delta was missed, but sync repaired it.';

    await injectStreamMessage(page, {
      peerId,
      messageId,
      senderName: 'Assistant',
      content: partial,
    });
    await finalizeStreamMessage(page, { peerId, messageId });

    await page.evaluate(async ({ peerId, messageId, full }) => {
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

      await ctrl.transport.onMessage(peerId, {
        type: 'message-sync-response',
        workspaceId: state.activeWorkspaceId,
        messages: [{
          id: messageId,
          channelId: state.activeChannelId,
          senderId: peerId,
          content: full,
          timestamp: Date.now() + 1,
          type: 'text',
          vectorClock: {},
        }],
      });
    }, { peerId, messageId, full });

    await expect(page.locator(`.message[data-message-id="${messageId}"] .message-content`))
      .toContainText(full);

    await expect(page.locator(`.message[data-message-id="${messageId}"]`)).toHaveCount(1);
  });
});
