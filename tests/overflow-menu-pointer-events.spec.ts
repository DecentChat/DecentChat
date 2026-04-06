/**
 * Test: overflow menu blocks pointer events to messages behind it
 *
 * Bug: When moving cursor over overflow menu items, messages BEHIND the menu
 * show their hover highlight (message-actions-bar) as if the cursor is on them.
 *
 * Root cause: the menu is visually above messages (z-index:9999) but the
 * message elements still receive pointer events because the menu doesn't
 * properly block them.
 *
 * Fix: the .overflow-menu container must have solid background (no pointer
 * passthrough) and cover the full area.
 */
import { test, expect } from '@playwright/test';

test('overflow menu blocks pointer events to messages behind it', async ({ page }) => {
  // Navigate to /app route and wait for app to init
  await page.goto('http://localhost:5555/app');
  await page.waitForSelector('[data-testid="channel-header"], #create-ws-btn, #create-ws-btn-nav', { timeout: 20000 });

  const hasHeader = await page.locator('[data-testid="channel-header"]').isVisible();
  if (!hasHeader) {
    await page.locator('#create-ws-btn, #create-ws-btn-nav').first().click();
    const modal = page.locator('[data-testid="modal-overlay"]');
    await modal.waitFor({ timeout: 5000 });
    await modal.locator('input[name="name"]').fill('Test Group');
    await modal.locator('input[name="alias"]').fill('Tester');
    await modal.locator('button[type="submit"]').click();
    await page.waitForSelector('[data-testid="channel-header"]', { timeout: 15000 });
  }

  // Send enough messages so the messages area has content in the top-right area
  const input = page.locator('#compose-input');
  for (let i = 0; i < 8; i++) {
    await input.fill(`Test message ${i + 1} — some text to make the message row wide enough to overlap with the overflow menu`);
    await input.press('Enter');
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(300);

  // Open the overflow menu
  const overflowBtn = page.locator('#overflow-menu-btn');
  await expect(overflowBtn).toBeVisible();
  await overflowBtn.click();

  const overflowMenu = page.locator('.overflow-menu');
  await expect(overflowMenu).toBeVisible({ timeout: 3000 });

  // Get overflow menu position
  const menuRect = await overflowMenu.boundingBox();
  expect(menuRect).toBeTruthy();
  console.log('Overflow menu rect:', menuRect);

  // Get first menu item rect
  const firstItem = overflowMenu.locator('.overflow-menu-item').first();
  const firstItemRect = await firstItem.boundingBox();
  expect(firstItemRect).toBeTruthy();
  console.log('First menu item rect:', firstItemRect);

  // Check: are there messages in the area behind the menu?
  const messages = page.locator('.message');
  const messageCount = await messages.count();
  console.log('Message count:', messageCount);

  // Move cursor over each menu item and check if any message-actions-bar appears
  const menuItems = overflowMenu.locator('.overflow-menu-item');
  const itemCount = await menuItems.count();

  let messageActionsBarAppearedBehindMenu = false;

  for (let i = 0; i < itemCount; i++) {
    const item = menuItems.nth(i);
    const itemRect = await item.boundingBox();
    if (!itemRect) continue;

    // Hover over the center of this menu item
    await page.mouse.move(
      itemRect.x + itemRect.width / 2,
      itemRect.y + itemRect.height / 2
    );
    await page.waitForTimeout(100);

    // Check if any message-actions-bar is visible
    const actionsBar = page.locator('.message-actions-bar');
    const actionsBarCount = await actionsBar.count();

    for (let j = 0; j < actionsBarCount; j++) {
      const bar = actionsBar.nth(j);
      if (await bar.isVisible()) {
        const barRect = await bar.boundingBox();
        if (barRect && menuRect) {
          // Check if this actions bar overlaps with the menu area
          const overlapsWithMenu = (
            barRect.x < menuRect.x + menuRect.width &&
            barRect.x + barRect.width > menuRect.x &&
            barRect.y < menuRect.y + menuRect.height &&
            barRect.y + barRect.height > menuRect.y
          );
          if (overlapsWithMenu) {
            console.log(`❌ FAIL: message-actions-bar visible at (${barRect.x.toFixed(0)},${barRect.y.toFixed(0)}) behind overflow menu (item ${i})`);
            messageActionsBarAppearedBehindMenu = true;
          }
        }
      }
    }

    // Also check: is the element that would receive a click at the menu item
    // position actually the menu item (not a message behind it)?
    const elementAtPoint = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return { tag: 'nothing', class: '' };
        return {
          tag: el.tagName,
          class: el.className,
          isMenuItem: el.closest('.overflow-menu') !== null,
          isMessage: el.closest('.message') !== null,
        };
      },
      [itemRect.x + itemRect.width / 2, itemRect.y + itemRect.height / 2]
    );

    console.log(`Item ${i}: element at point:`, elementAtPoint);

    if (!elementAtPoint.isMenuItem) {
      console.log(`❌ FAIL: menu item ${i} is NOT getting pointer events — underlying element gets them instead`);
    }
    expect(elementAtPoint.isMenuItem).toBe(true);
  }

  if (messageActionsBarAppearedBehindMenu) {
    console.log('❌ BUG CONFIRMED: message-actions-bar appears behind overflow menu');
  } else {
    console.log('✅ PASS: no message hover effects while cursor is on overflow menu');
  }

  expect(messageActionsBarAppearedBehindMenu).toBe(false);
});
