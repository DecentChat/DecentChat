import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser, createWorkspace } from './helpers';

test.beforeAll(async () => {
  await startRelay();
});

test.describe('company template installation', () => {
  test('installs Software Studio team and shows install summary', async ({ browser }) => {
    const user = await createUser(browser, 'Owner');

    try {
      await createWorkspace(user.page, 'Template Install', 'Alex Owner');

      await user.page.getByRole('button', { name: /add ai team/i }).click();
      await user.page.locator('[data-testid="template-card-software-studio"]')
        .getByRole('button', { name: /choose template/i })
        .click();

      await user.page.getByLabel('Company name').fill('Acme Platform');
      await user.page.getByLabel('Manager alias').fill('Mira PM');
      await user.page.getByLabel('Backend alias').fill('Devon API');
      await user.page.getByLabel('QA alias').fill('Iva QA');

      await user.page.getByRole('button', { name: /install team/i }).click();

      const result = user.page.getByTestId('template-install-result');
      await expect(result).toBeVisible();
      await expect(result).toContainText('Acme Platform');
      await expect(result).toContainText('Template Install');
      await expect(result).toContainText('Runtime provisioning pending');
      await expect(result).toContainText('Created channels in this workspace: 3');
      await expect(result).toContainText('Provisioned accounts: 0');

      const manualActions = user.page.getByTestId('template-install-manual-actions');
      await expect(manualActions).toContainText('Run the decent-openclaw company template installer to provision real accounts/agents.');

      await user.page.getByRole('button', { name: /done/i }).click();
      await expect(user.page.locator('.modal-overlay')).toHaveCount(0);

      await expect(user.page.locator('#sidebar-nav')).toContainText('engineering');
      await expect(user.page.locator('#sidebar-nav')).toContainText('qa');
      await expect(user.page.locator('#sidebar-nav')).toContainText('leadership');
    } finally {
      await closeUser(user);
    }
  });
});
