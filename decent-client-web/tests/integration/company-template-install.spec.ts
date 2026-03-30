import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser, createWorkspace } from './helpers';

test.beforeAll(async () => {
  await startRelay();
});

test.describe('company template installation', () => {
  test('shows host-control requirement when no host bridge is online', async ({ browser }) => {
    test.setTimeout(60000);
    const user = await createUser(browser, 'Owner');

    try {
      await user.page.setViewportSize({ width: 1600, height: 1800 });
      await createWorkspace(user.page, 'Template Install', 'Alex Owner');

      await user.page.getByRole('button', { name: /add ai team/i }).click();
      await user.page.locator('[data-testid="template-card-software-studio"]')
        .getByRole('button', { name: /choose template/i })
        .click();

      await user.page.getByLabel('Company name').fill('Acme Platform');
      await user.page.getByLabel('Manager alias').fill('Mira PM');
      await user.page.getByLabel('Backend alias').fill('Devon API');
      await user.page.getByLabel('QA alias').fill('Iva QA');

      const installBtn = user.page.locator('.wizard-actions .btn-primary');
      await expect(installBtn).toBeVisible();
      await installBtn.click();

      await expect(user.page.locator('.wizard-error')).toContainText('host control bridge', { timeout: 10000 });
      await expect(user.page.locator('.wizard-error')).toContainText('No online host control peer', { timeout: 10000 });
      await expect(user.page.getByTestId('template-install-result')).toHaveCount(0);
      await expect(user.page.getByRole('heading', { name: /install ai team/i })).toBeVisible();
    } finally {
      await closeUser(user);
    }
  });
});
