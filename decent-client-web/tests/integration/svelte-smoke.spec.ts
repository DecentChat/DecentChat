import { test, expect } from '@playwright/test';
test('Svelte 5 smoke test — SvelteReady component mounts', async ({ page }) => {
  await page.goto('/');
  // Wait for app to load
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return !l || l.style.opacity === '0';
  }, { timeout: 10000 });
  // Click through to app if needed
  const openBtn = page.getByRole('button', { name: /open app/i });
  if (await openBtn.isVisible({ timeout: 2000 }).catch(() => false)) await openBtn.click();
  // Check Svelte marker exists
  const marker = page.locator('[data-testid="svelte-ready"]');
  await expect(marker).toBeAttached({ timeout: 5000 });
  const version = await marker.getAttribute('data-svelte-version');
  expect(version).toBe('5');
});
