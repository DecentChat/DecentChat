import { test, expect } from '@playwright/test';
import {
  createUser,
  closeUser,
  createWorkspaceAndGetInvite,
  joinViaInvite,
  waitForPeerConnection,
  type TestUser,
} from './multi-user-helpers';

test.describe('Offline peer behavior', () => {
  let alice: TestUser;
  let bob: TestUser;
  let bobClosed = false;

  test.beforeEach(async ({ browser }) => {
    alice = await createUser(browser, 'Alice');
    bob = await createUser(browser, 'Bob');
    bobClosed = false;
  });

  test.afterEach(async () => {
    await closeUser(alice).catch(() => {});
    if (!bobClosed) {
      await closeUser(bob).catch(() => {});
    }
  });

  test('disconnecting a peer shows reconnect pulse then offline without error toast', async () => {
    const inviteUrl = await createWorkspaceAndGetInvite(alice.page, 'Offline Peer Test', 'Alice');
    await joinViaInvite(bob.page, inviteUrl, 'Bob');

    await waitForPeerConnection(alice.page);
    await waitForPeerConnection(bob.page);

    const bobPeerId = await bob.page.evaluate(() => (window as any).__state?.myPeerId || '');
    expect(bobPeerId).toBeTruthy();

    const statusDot = alice.page.locator(`[data-member-peer-id="${bobPeerId}"] .dm-status`);
    await expect(statusDot).toBeVisible({ timeout: 10000 });

    await alice.page.evaluate(() => {
      (window as any).__errorToastSeen = false;
      const markError = (root: ParentNode) => {
        const hasError = !!root.querySelector?.('.toast.error');
        if (hasError) (window as any).__errorToastSeen = true;
      };
      markError(document);

      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of Array.from(m.addedNodes)) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches('.toast.error') || node.querySelector('.toast.error')) {
              (window as any).__errorToastSeen = true;
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      (window as any).__errorToastObserver = observer;
    });

    await bob.context.close();
    bobClosed = true;

    // Force local disconnect bookkeeping, then wait for the dot to stop showing online.
    await alice.page.evaluate((peerId: string) => {
      const ctrl = (window as any).__ctrl;
      ctrl?.transport?.disconnect?.(peerId);
    }, bobPeerId);
    await expect(statusDot).not.toHaveClass(/online/, { timeout: 10000 });

    // Trigger maintenance immediately so we don't wait for the periodic 20s sweep.
    await alice.page.evaluate(() => {
      const ctrl = (window as any).__ctrl;
      ctrl?._runPeerMaintenance?.();
    });

    await expect(statusDot).toHaveClass(/connecting/, { timeout: 4000 });
    const animationName = await statusDot.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toContain('pulse-connecting');

    // Connecting pulse should stop after ~4 seconds, then peer is shown as offline.
    await alice.page.waitForTimeout(4600);
    await expect(statusDot).not.toHaveClass(/connecting/);
    await expect(statusDot).not.toHaveClass(/online/);
    await expect(statusDot).toHaveAttribute('aria-label', 'Offline');

    const sawErrorToast = await alice.page.evaluate(() => Boolean((window as any).__errorToastSeen));
    expect(sawErrorToast).toBe(false);

    await alice.page.evaluate(() => {
      (window as any).__errorToastObserver?.disconnect?.();
      delete (window as any).__errorToastObserver;
    });
  });
});
