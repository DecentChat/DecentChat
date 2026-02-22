import { test, expect, Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

// Minimal 1×1 red PNG (valid, browser-decodable)
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG = Buffer.from(TINY_PNG_B64, 'base64');

/** Set files on the hidden #file-input and wait for at least one .attachment */
async function sendFileViaInput(
  page: Page,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
) {
  await page.locator('#file-input').setInputFiles(files);
  await page.waitForSelector('.attachment', { timeout: 8000 });
}

/** Dispatch a synthetic drop event with File objects onto .messages-area */
async function dropFileOnMessagesArea(page: Page, name: string, base64: string, mimeType: string) {
  await page.evaluate(
    async ({ name, base64, mimeType }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], name, { type: mimeType });

      const dt = new DataTransfer();
      dt.items.add(file);

      const area = document.querySelector('.messages-area') as HTMLElement;
      area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { name, base64: TINY_PNG_B64, mimeType },
  );
  await page.waitForSelector('.attachment', { timeout: 8000 });
}

/** Dispatch a synthetic paste event with an image File */
async function pasteImageFile(page: Page, targetSelector?: string) {
  await page.evaluate(async ({ base64, targetSelector }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'pasted-image.png', { type: 'image/png' });

    const dt = new DataTransfer();
    dt.items.add(file);

    const target = targetSelector
      ? (document.querySelector(targetSelector) as HTMLElement | null)
      : null;

    if (target) {
      target.focus();
      target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt as unknown as DataTransfer }));
    } else {
      document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt as unknown as DataTransfer }));
    }
  }, { base64: TINY_PNG_B64, targetSelector });
  await page.waitForSelector('.attachment', { timeout: 8000 });
}

/** Open thread panel for message containing text */
async function openThreadFor(page: Page, messageText: string): Promise<void> {
  const msgEl = page.locator('.message-content', { hasText: messageText }).first();
  await msgEl.hover();
  const msgDiv = msgEl.locator('..').locator('..');
  const threadBtn = msgDiv.locator('.message-thread-btn').first();
  await threadBtn.click();
  await page.waitForSelector('#thread-panel.open, #thread-panel:not(.hidden)', { timeout: 5000 });
}

// ─── Setup ─────────────────────────────────────────────────────────────────

test.describe('File Attachments', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page);
  });

  // ─── Attach Button ──────────────────────────────────────────────────────

  test('attach button is visible in compose area', async ({ page }) => {
    await expect(page.locator('#attach-btn')).toBeVisible();
  });

  test('clicking attach button opens file picker (file input exists)', async ({ page }) => {
    // The hidden file input must exist in the DOM
    await expect(page.locator('#file-input')).toHaveCount(1);
    // Clicking attach btn triggers it — we just verify no crash
    // (can't assert OS dialog in headless; enough to confirm no JS error)
    await page.locator('#attach-btn').click();
  });

  // ─── Image Upload ───────────────────────────────────────────────────────

  test('uploading an image shows attachment in message', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await expect(page.locator('.attachment')).toBeVisible();
  });

  test('image attachment shows thumbnail', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    // Thumbnail <img> inside .attachment-image should be present
    await expect(page.locator('.attachment-thumbnail')).toBeVisible({ timeout: 6000 });
  });

  test('image attachment shows filename', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'my-photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await expect(page.locator('.attachment-name')).toContainText('my-photo.png');
  });

  test('image attachment shows file size', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await expect(page.locator('.attachment-size')).toBeVisible();
    // Should show a size string (e.g. "85 B" or "1 KB")
    const sizeText = await page.locator('.attachment-size').first().textContent();
    expect(sizeText?.trim().length).toBeGreaterThan(0);
  });

  // ─── Non-image File Upload ──────────────────────────────────────────────

  test('uploading a text file shows attachment without thumbnail', async ({ page }) => {
    const textFile = Buffer.from('Hello world!');
    await sendFileViaInput(page, [{ name: 'readme.txt', mimeType: 'text/plain', buffer: textFile }]);
    await expect(page.locator('.attachment')).toBeVisible();
    // No thumbnail for non-image files
    expect(await page.locator('.attachment-thumbnail').count()).toBe(0);
  });

  test('non-image attachment shows filename', async ({ page }) => {
    const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf content');
    await sendFileViaInput(page, [{ name: 'document.pdf', mimeType: 'application/pdf', buffer: pdfBuffer }]);
    await expect(page.locator('.attachment-name')).toContainText('document.pdf');
  });

  // ─── Multiple Files ─────────────────────────────────────────────────────

  test('uploading multiple files shows multiple attachments', async ({ page }) => {
    await sendFileViaInput(page, [
      { name: 'first.png', mimeType: 'image/png', buffer: TINY_PNG },
      { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') },
    ]);
    // Each file should produce its own message/attachment
    const attachments = page.locator('.attachment');
    await expect(attachments).toHaveCount(2, { timeout: 8000 });
  });

  // ─── Lightbox ───────────────────────────────────────────────────────────

  test('clicking image thumbnail opens lightbox', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await page.locator('.attachment-thumbnail').click();
    await expect(page.locator('#lightbox')).toBeVisible({ timeout: 3000 });
  });

  test('lightbox shows image', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await page.locator('.attachment-thumbnail').click();
    const img = page.locator('#lightbox-img');
    await expect(img).toBeVisible();
    // src should be a data URL (inline thumbnail) or object URL
    const src = await img.getAttribute('src');
    expect(src?.length).toBeGreaterThan(0);
  });

  test('lightbox shows filename', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'my-beautiful-photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await page.locator('.attachment-thumbnail').click();
    await expect(page.locator('#lightbox-name')).toContainText('my-beautiful-photo.png');
  });

  test('lightbox close button closes lightbox', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await page.locator('.attachment-thumbnail').click();
    await expect(page.locator('#lightbox')).toBeVisible();

    await page.locator('#lightbox-close').click();
    await expect(page.locator('#lightbox')).toBeHidden({ timeout: 3000 });
  });

  test('clicking lightbox backdrop closes lightbox', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await page.locator('.attachment-thumbnail').click();
    await expect(page.locator('#lightbox')).toBeVisible();

    await page.locator('#lightbox-backdrop').click();
    await expect(page.locator('#lightbox')).toBeHidden({ timeout: 3000 });
  });

  test('Escape key closes lightbox', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await page.locator('.attachment-thumbnail').click();
    await expect(page.locator('#lightbox')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#lightbox')).toBeHidden({ timeout: 3000 });
  });

  test('lightbox is initially hidden', async ({ page }) => {
    await expect(page.locator('#lightbox')).toBeHidden();
  });

  // ─── Drag & Drop ────────────────────────────────────────────────────────

  test('dragging over messages area adds drag-active class', async ({ page }) => {
    // Dispatch dragover event
    await page.evaluate(() => {
      const area = document.querySelector('.messages-area') as HTMLElement;
      area.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
    });
    await expect(page.locator('.messages-area.drag-active')).toBeVisible({ timeout: 2000 });
  });

  test('dragleave removes drag-active class', async ({ page }) => {
    await page.evaluate(() => {
      const area = document.querySelector('.messages-area') as HTMLElement;
      area.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
    });
    await expect(page.locator('.messages-area.drag-active')).toBeVisible();

    // Simulate dragleave from outside the area
    await page.evaluate(() => {
      const area = document.querySelector('.messages-area') as HTMLElement;
      const rect = area.getBoundingClientRect();
      area.dispatchEvent(
        new DragEvent('dragleave', {
          bubbles: true,
          clientX: rect.left - 10,
          clientY: rect.top - 10,
        }),
      );
    });
    await expect(page.locator('.messages-area.drag-active')).toHaveCount(0, { timeout: 2000 });
  });

  test('dropping an image file sends attachment', async ({ page }) => {
    await dropFileOnMessagesArea(page, 'dropped.png', TINY_PNG_B64, 'image/png');
    await expect(page.locator('.attachment')).toBeVisible();
  });

  test('dropping a text file sends attachment', async ({ page }) => {
    const textB64 = Buffer.from('Hello from drop!').toString('base64');
    await page.evaluate(
      async ({ name, base64, mimeType }) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], name, { type: mimeType });
        const dt = new DataTransfer();
        dt.items.add(file);
        const area = document.querySelector('.messages-area') as HTMLElement;
        area.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      },
      { name: 'notes.txt', base64: textB64, mimeType: 'text/plain' },
    );
    await page.waitForSelector('.attachment', { timeout: 8000 });
    await expect(page.locator('.attachment-name')).toContainText('notes.txt');
  });

  // ─── Paste ──────────────────────────────────────────────────────────────

  test('pasting an image file sends attachment', async ({ page }) => {
    await pasteImageFile(page);
    await expect(page.locator('.attachment')).toBeVisible();
  });

  test('pasted image shows as image attachment', async ({ page }) => {
    await pasteImageFile(page);
    // Should have a thumbnail since it's an image
    await expect(page.locator('.attachment-thumbnail')).toBeVisible({ timeout: 6000 });
  });

  test('pasting image with thread input focused sends attachment into thread (not main channel)', async ({ page }) => {
    // Create parent message in main channel
    await page.locator('#compose-input').fill('parent message for paste-thread test');
    await page.locator('#compose-input').press('Enter');
    await expect(page.locator('.message-content', { hasText: 'parent message for paste-thread test' }).first()).toBeVisible();

    // Open thread and focus thread input
    await openThreadFor(page, 'parent message for paste-thread test');
    await expect(page.locator('#thread-input')).toBeVisible();

    // Paste image while thread input is active
    await pasteImageFile(page, '#thread-input');

    // Attachment should be in thread panel
    await expect(page.locator('#thread-messages .attachment-name', { hasText: 'pasted-image.png' })).toBeVisible({ timeout: 8000 });

    // Main channel should NOT contain pasted attachment message
    await expect(page.locator('#messages-list .attachment-name', { hasText: 'pasted-image.png' })).toHaveCount(0);
  });

  // ─── Persistence ────────────────────────────────────────────────────────

  test('attachment message survives page refresh', async ({ page }) => {
    await sendFileViaInput(page, [{ name: 'persist-test.png', mimeType: 'image/png', buffer: TINY_PNG }]);
    await expect(page.locator('.attachment-name')).toContainText('persist-test.png');

    // Allow IndexedDB to flush
    await page.waitForTimeout(2000);
    await page.reload();
    await waitForApp(page);
    await page.waitForTimeout(2000);

    await expect(page.locator('.attachment-name')).toContainText('persist-test.png', { timeout: 5000 });
  });
});
