import { test, expect, Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace, sendMessage } from './helpers';

async function openThreadFor(page: Page, messageText: string): Promise<string> {
  const threadId = await page.evaluate((text: string) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    const msg = ctrl?.messageStore
      ?.getMessages?.(state?.activeChannelId)
      ?.find((entry: any) => entry.content === text && !entry.threadId);
    return msg?.id || '';
  }, messageText);

  expect(threadId).toBeTruthy();

  await page.evaluate((id: string) => {
    const button = document.querySelector(`.message-thread-btn[data-thread-id="${id}"]`) as HTMLButtonElement | null;
    button?.click();
  }, threadId);

  await page.waitForSelector('#thread-panel.open:not(.hidden)', { timeout: 10000 });
  return threadId;
}

test.describe('Thread Panel Scroll', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
  });

  test('long threads keep a scrollable reply list', async ({ page }) => {
    await createWorkspace(page, 'Thread Scroll Test', 'Tester');

    const rootText = `thread-root-${Date.now()}`;
    await sendMessage(page, rootText);

    const threadId = await openThreadFor(page, rootText);

    await page.evaluate(async ({ id, count }) => {
      const ctrl = (window as any).__ctrl;
      for (let i = 1; i <= count; i += 1) {
        await ctrl.sendMessage(`Thread reply ${i.toString().padStart(2, '0')}`, id);
      }
    }, { id: threadId, count: 40 });

    await page.waitForFunction(
      (expectedCount: number) => document.querySelectorAll('#thread-messages .message').length >= expectedCount,
      41,
      { timeout: 15000 }
    );

    const metrics = await page.evaluate(() => {
      const container = document.getElementById('thread-messages') as HTMLElement | null;
      const messages = container?.querySelectorAll('.message');
      const lastMessage = messages?.[messages.length - 1] as HTMLElement | undefined;

      if (!container || !lastMessage) {
        return {
          exists: false,
          scrollHeight: 0,
          clientHeight: 0,
          scrollTopAfterScroll: 0,
          overflowY: '',
          lastMessageVisibleAfterScroll: false,
        };
      }

      container.scrollTop = container.scrollHeight;

      const containerRect = container.getBoundingClientRect();
      const lastRect = lastMessage.getBoundingClientRect();

      return {
        exists: true,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        scrollTopAfterScroll: container.scrollTop,
        overflowY: window.getComputedStyle(container).overflowY,
        lastMessageVisibleAfterScroll:
          lastRect.bottom <= containerRect.bottom + 1 &&
          lastRect.top >= containerRect.top - 1,
      };
    });

    expect(metrics.exists).toBe(true);
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.scrollTopAfterScroll).toBeGreaterThan(0);
    expect(metrics.lastMessageVisibleAfterScroll).toBe(true);
  });

  test('opening an existing thread auto-scrolls to the latest reply', async ({ page }) => {
    await createWorkspace(page, 'Thread Open Auto Scroll', 'Tester');

    const rootText = `thread-open-root-${Date.now()}`;
    await sendMessage(page, rootText);

    const threadId = await page.evaluate((text: string) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      const msg = ctrl?.messageStore
        ?.getMessages?.(state?.activeChannelId)
        ?.find((entry: any) => entry.content === text && !entry.threadId);
      return msg?.id || '';
    }, rootText);

    expect(threadId).toBeTruthy();

    const replyCount = 30;
    await page.evaluate(async ({ id, count }) => {
      const ctrl = (window as any).__ctrl;
      for (let i = 1; i <= count; i += 1) {
        await ctrl.sendMessage(`Late reply ${i.toString().padStart(2, '0')}`, id);
      }
    }, { id: threadId, count: replyCount });

    const openedThreadId = await openThreadFor(page, rootText);
    expect(openedThreadId).toBe(threadId);

    await page.waitForFunction(
      () => document.querySelectorAll('#thread-messages .message').length >= 6,
      { timeout: 15000 }
    );

    // allow open animation/layout to settle + auto-scroll effect to run
    await page.waitForTimeout(100);

    const metrics = await page.evaluate(() => {
      const container = document.getElementById('thread-messages') as HTMLElement | null;
      const messages = container?.querySelectorAll('.message');
      const lastMessage = messages?.[messages.length - 1] as HTMLElement | undefined;

      if (!container || !lastMessage) {
        return {
          exists: false,
          scrollTop: 0,
          clientHeight: 0,
          scrollHeight: 0,
          lastMessageVisible: false,
        };
      }

      const containerRect = container.getBoundingClientRect();
      const lastRect = lastMessage.getBoundingClientRect();

      return {
        exists: true,
        scrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
        lastMessageVisible:
          lastRect.bottom <= containerRect.bottom + 1 &&
          lastRect.top >= containerRect.top - 1,
      };
    });

    expect(metrics.exists).toBe(true);
    // On larger viewports, all replies may fit without overflow.
    if (metrics.scrollHeight > metrics.clientHeight) {
      expect(metrics.scrollTop).toBeGreaterThan(0);
    } else {
      expect(metrics.scrollTop).toBe(0);
    }
    expect(metrics.lastMessageVisible).toBe(true);
  });

});
