import { type Browser, type BrowserContext } from '@playwright/test';

const CLIPBOARD_PERMISSIONS = ['clipboard-read', 'clipboard-write'] as const;

/**
 * Firefox in Playwright does not support `clipboard-read` permission.
 * Keep clipboard permissions for browsers that support them, then gracefully
 * fall back for engines with narrower permission support.
 */
export async function createBrowserContext(browser: Browser): Promise<BrowserContext> {
  try {
    return await browser.newContext({ permissions: [...CLIPBOARD_PERMISSIONS] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Unknown permission')) throw error;
  }

  try {
    return await browser.newContext({ permissions: ['clipboard-write'] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Unknown permission')) throw error;
  }

  return browser.newContext();
}
