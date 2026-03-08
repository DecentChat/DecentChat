import { test, expect } from '@playwright/test';

test('Svelte app smoke test — landing or app shell renders without init errors', async ({ page }) => {
  await page.goto('/');

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    const loadingDone = !loading || loading.style.opacity === '0' || loading.style.display === 'none';
    const initFailed = Array.from(document.querySelectorAll('h1')).some((el) =>
      el.textContent?.includes('Failed to initialize')
    );
    return loadingDone || initFailed;
  }, { timeout: 10000 });

  await expect(page.getByRole('heading', { name: /failed to initialize/i })).toHaveCount(0);
  await expect(page.locator('#create-ws-btn, .sidebar-header')).toBeVisible({ timeout: 10000 });
});
