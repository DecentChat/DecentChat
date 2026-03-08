import { test, expect, type Page } from '@playwright/test';

async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 30000 });

  const openAppBtn = page.getByRole('button', { name: /open app/i });
  if (await openAppBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openAppBtn.click();
  }

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 20000 });
}

async function ensureWorkspace(page: Page): Promise<void> {
  if (await page.locator('#create-ws-btn').isVisible().catch(() => false)) {
    await page.click('#create-ws-btn');
    await page.waitForSelector('.modal', { timeout: 5000 });
    await page.locator('.modal input[name="name"]').fill('Paste Isolation');
    await page.locator('.modal input[name="alias"]').fill('Alice');
    await page.click('.modal .btn-primary');
    await page.waitForSelector('#compose-input', { timeout: 10000 });
  }
}

test('pasting image in thread composer does not also attach into main composer', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await ensureWorkspace(page);

  const rootText = `thread-root-${Date.now()}`;
  await page.locator('#compose-input').fill(rootText);
  await page.locator('#compose-input').press('Enter');

  await page.waitForFunction(
    (text) => Array.from(document.querySelectorAll('.message-content')).some((m) => m.textContent?.includes(text as string)),
    rootText,
    { timeout: 10000 },
  );

  // Open thread using the message action button.
  await page.evaluate((text) => {
    const rows = Array.from(document.querySelectorAll('.message'));
    const row = rows.find((r) => r.textContent?.includes(text as string));
    const btn = row?.querySelector('.message-thread-btn') as HTMLButtonElement | null;
    if (!btn) throw new Error('Thread button not found');
    btn.click();
  }, rootText);

  await page.waitForSelector('#thread-input', { timeout: 5000 });

  const before = await page.evaluate(() => {
    const countFor = (inputId: string) => {
      const input = document.getElementById(inputId);
      const composeBox = input?.closest('.compose-box');
      return composeBox?.querySelectorAll('.pending-attachment').length ?? 0;
    };
    return {
      main: countFor('compose-input'),
      thread: countFor('thread-input'),
    };
  });

  expect(before.main).toBe(0);
  expect(before.thread).toBe(0);

  // Simulate clipboard image paste into thread input.
  await page.evaluate(() => {
    const threadInput = document.getElementById('thread-input') as HTMLTextAreaElement | null;
    if (!threadInput) throw new Error('thread-input not found');

    threadInput.focus();

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'clipboard.png', { type: 'image/png' });
    const item = {
      type: 'image/png',
      getAsFile: () => file,
    };

    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', {
      value: { items: [item] },
      configurable: true,
    });

    threadInput.dispatchEvent(ev);
  });

  await page.waitForTimeout(120);

  const after = await page.evaluate(() => {
    const countFor = (inputId: string) => {
      const input = document.getElementById(inputId);
      const composeBox = input?.closest('.compose-box');
      return composeBox?.querySelectorAll('.pending-attachment').length ?? 0;
    };
    return {
      main: countFor('compose-input'),
      thread: countFor('thread-input'),
    };
  });

  expect(after.thread).toBe(1);
  expect(after.main).toBe(0);
});
