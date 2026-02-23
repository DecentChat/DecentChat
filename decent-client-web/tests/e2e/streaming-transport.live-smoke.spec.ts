import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

async function createUser(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await clearStorage(page);
  await page.goto('/');
  await waitForApp(page);
  return { context, page };
}

async function getInviteUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    if (!state?.activeWorkspaceId || !ctrl?.generateInviteURL) return '';
    return ctrl.generateInviteURL(state.activeWorkspaceId);
  });
}

async function joinViaInvite(page: Page, inviteUrl: string, alias: string): Promise<void> {
  await page.goto(inviteUrl);
  await page.waitForSelector('.modal', { timeout: 15000 });
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('#compose-input', { timeout: 15000 });
}

async function waitForPeersReady(receiver: Page, sender: Page, timeoutMs = 30000): Promise<void> {
  const receiverPeerId = await receiver.evaluate(() => (window as any).__state?.myPeerId || '');
  const senderPeerId = await sender.evaluate(() => (window as any).__state?.myPeerId || '');

  await receiver.waitForFunction(
    (peerId: string) => (window as any).__state?.readyPeers?.has(peerId),
    senderPeerId,
    { timeout: timeoutMs },
  );
  await sender.waitForFunction(
    (peerId: string) => (window as any).__state?.readyPeers?.has(peerId),
    receiverPeerId,
    { timeout: timeoutMs },
  );
}

test.describe('Streaming Transport Live Smoke @live-smoke', () => {
  test('assistant stream arrives progressively via real transport across peers', async ({ browser }) => {
    test.setTimeout(120000);

    const alice = await createUser(browser);
    const bob = await createUser(browser);

    try {
      await createWorkspace(alice.page, 'Live Stream Smoke', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      expect(inviteUrl).toContain('/join/');

      await joinViaInvite(bob.page, inviteUrl, 'Bob');
      await waitForPeersReady(alice.page, bob.page);

      const [alicePeerId, aliceChannelId, aliceWorkspaceId, bobPeerId] = await Promise.all([
        alice.page.evaluate(() => (window as any).__state?.myPeerId),
        alice.page.evaluate(() => (window as any).__state?.activeChannelId),
        alice.page.evaluate(() => (window as any).__state?.activeWorkspaceId),
        bob.page.evaluate(() => (window as any).__state?.myPeerId),
      ]);

      expect(alicePeerId).toBeTruthy();
      expect(aliceChannelId).toBeTruthy();
      expect(aliceWorkspaceId).toBeTruthy();
      expect(bobPeerId).toBeTruthy();

      const messageId = `live-stream-${Date.now()}`;
      const chunkOne = 'Streaming smoke';
      const chunkTwo = 'Streaming smoke test over real transport';

      await bob.page.evaluate(
        ({ targetPeerId, channelId, workspaceId, peerId, messageId }) => {
          const ctrl = (window as any).__ctrl;
          ctrl.transport.send(targetPeerId, {
            type: 'stream-start',
            messageId,
            channelId,
            workspaceId,
            senderId: peerId,
            senderName: 'Assistant',
            isDirect: false,
          });
        },
        {
          targetPeerId: alicePeerId,
          channelId: aliceChannelId,
          workspaceId: aliceWorkspaceId,
          peerId: bobPeerId,
          messageId,
        },
      );

      await bob.page.evaluate(
        ({ targetPeerId, messageId, content }) => {
          const ctrl = (window as any).__ctrl;
          ctrl.transport.send(targetPeerId, { type: 'stream-delta', messageId, content });
        },
        {
          targetPeerId: alicePeerId,
          messageId,
          content: chunkOne,
        },
      );

      const streamingMessage = alice.page.locator(`.message[data-message-id="${messageId}"] .message-content`);
      await expect(streamingMessage).toContainText(chunkOne, { timeout: 15000 });

      const firstSnapshot = await streamingMessage.textContent();
      expect(firstSnapshot).toContain(chunkOne);

      await bob.page.waitForTimeout(120);
      await bob.page.evaluate(
        ({ targetPeerId, messageId, content }) => {
          const ctrl = (window as any).__ctrl;
          ctrl.transport.send(targetPeerId, { type: 'stream-delta', messageId, content });
        },
        {
          targetPeerId: alicePeerId,
          messageId,
          content: chunkTwo,
        },
      );

      await expect(streamingMessage).toContainText(chunkTwo, { timeout: 15000 });
      const secondSnapshot = await streamingMessage.textContent();
      expect(secondSnapshot).toContain(chunkTwo);
      expect(secondSnapshot).not.toBe(firstSnapshot);

      await bob.page.evaluate(
        ({ targetPeerId, messageId }) => {
          const ctrl = (window as any).__ctrl;
          ctrl.transport.send(targetPeerId, { type: 'stream-done', messageId });
        },
        {
          targetPeerId: alicePeerId,
          messageId,
        },
      );

      await expect(alice.page.locator(`.message[data-message-id="${messageId}"]`)).toHaveCount(1);
      await expect(streamingMessage).toContainText(chunkTwo);
      await expect(alice.page.locator(`.message[data-message-id="${messageId}"].streaming`)).toHaveCount(0);
    } finally {
      await alice.context.close();
      await bob.context.close();
    }
  });
});
