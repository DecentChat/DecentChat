/**
 * Test: channel header renders above message-actions-bar on hover
 *
 * Regression test for ALE-1028: the message-actions-bar (absolute, z-index:5)
 * was painting OVER the channel header because backdrop-filter on the header
 * created a stacking context without a z-index, leaving it at z-index:auto.
 *
 * Fix: add position:relative + z-index:10 to .channel-header so it always
 * sits above the messages layer.
 */
import { test, expect } from '@playwright/test';

test('channel header renders above message-actions-bar on hover', async ({ page }) => {
  // Navigate to /app route and wait for app to init
  await page.goto('http://localhost:5555/app');
  // Wait for either the channel header (already has workspace) or the create button
  await page.waitForSelector('[data-testid="channel-header"], #create-ws-btn, #create-ws-btn-nav', { timeout: 20000 });

  // If no workspace exists, create one
  const hasHeader = await page.locator('[data-testid="channel-header"]').isVisible();
  if (!hasHeader) {
    const createBtn = page.locator('#create-ws-btn, #create-ws-btn-nav').first();
    await createBtn.click();
    const modal = page.locator('[data-testid="modal-overlay"]');
    await modal.waitFor({ timeout: 5000 });
    await modal.locator('input[name="name"]').fill('Test Group');
    await modal.locator('input[name="alias"]').fill('Tester');
    await modal.locator('button[type="submit"]').click();
    await page.waitForSelector('[data-testid="channel-header"]', { timeout: 15000 });
  }

  // Send messages so we have something to hover
  const input = page.locator('#compose-input');
  for (let i = 0; i < 5; i++) {
    await input.fill(`Test message ${i + 1}`);
    await input.press('Enter');
    await page.waitForTimeout(150);
  }

  // Check channel header z-index
  const header = page.locator('[data-testid="channel-header"]');
  const headerZIndex = await header.evaluate((el) =>
    parseInt(window.getComputedStyle(el).zIndex, 10)
  );
  const headerPosition = await header.evaluate((el) =>
    window.getComputedStyle(el).position
  );
  console.log(`channel-header: position=${headerPosition}, z-index=${headerZIndex}`);

  // Header must be positioned and have z-index to form a proper stacking context
  expect(headerPosition).not.toBe('static');
  expect(headerZIndex).toBeGreaterThanOrEqual(5);

  // Hover the first message to show message-actions-bar
  const firstMessage = page.locator('.message').first();
  await firstMessage.hover();
  await page.waitForTimeout(200);

  const actionsBar = page.locator('.message-actions-bar').first();
  const actionsBarVisible = await actionsBar.isVisible();

  if (actionsBarVisible) {
    const actionsZIndex = await actionsBar.evaluate((el) =>
      parseInt(window.getComputedStyle(el).zIndex, 10)
    );
    console.log(`message-actions-bar: z-index=${actionsZIndex}`);

    // Channel header z-index must be HIGHER than message-actions-bar
    expect(headerZIndex).toBeGreaterThan(actionsZIndex);

    // Visual overlap check: hover the FIRST message which is closest to the header
    // Check that at the header's bottom edge, the header is on top
    const headerRect = await header.boundingBox();
    const actionsRect = await actionsBar.boundingBox();

    console.log('header rect:', headerRect);
    console.log('actions bar rect:', actionsRect);

    if (headerRect && actionsRect) {
      // Check if they overlap vertically (actions bar floats up with top:-14px)
      const overlap = actionsRect.y < headerRect.y + headerRect.height;
      if (overlap) {
        console.log('⚠️  Actions bar overlaps with header — checking which is on top');
        // At the overlapping point, the header should be on top
        const checkX = Math.min(headerRect.x + headerRect.width / 2, actionsRect.x + actionsRect.width / 2);
        const checkY = actionsRect.y + 5; // inside the actions bar, in the overlap zone

        const elementAtPoint = await page.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            if (!el) return 'nothing';
            // Walk up to find relevant ancestor
            const header = el.closest('[data-testid="channel-header"]');
            const actionsBar = el.closest('.message-actions-bar');
            if (header) return 'channel-header';
            if (actionsBar) return 'message-actions-bar';
            return el.className || el.tagName;
          },
          [checkX, checkY]
        );

        console.log(`element at overlap point (${checkX.toFixed(0)}, ${checkY.toFixed(0)}): ${elementAtPoint}`);
        // Header should be on top, not the actions bar
        expect(elementAtPoint).toBe('channel-header');
      } else {
        console.log('✅ No overlap between header and actions bar — OK');
      }
    }
  } else {
    console.log('No message-actions-bar visible (offline mode) — skipping overlap check');
  }

  // Also test overflow menu dropdown (secondary: should be at top of stacking order)
  const overflowBtn = page.locator('#overflow-menu-btn');
  if (await overflowBtn.isVisible()) {
    await overflowBtn.click();
    const overflowMenu = page.locator('.overflow-menu');
    if (await overflowMenu.isVisible()) {
      const menuPosition = await overflowMenu.evaluate((el) =>
        window.getComputedStyle(el).position
      );
      const menuZIndex = await overflowMenu.evaluate((el) =>
        parseInt(window.getComputedStyle(el).zIndex, 10)
      );
      console.log(`overflow-menu: position=${menuPosition}, z-index=${menuZIndex}`);
      expect(menuPosition).toBe('fixed');
      expect(menuZIndex).toBeGreaterThanOrEqual(9999);
    }
  }

  console.log('✅ Z-index stacking test passed');
});
