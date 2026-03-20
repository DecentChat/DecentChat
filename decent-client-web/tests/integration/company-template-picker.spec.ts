import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser, createWorkspace } from './helpers';

test.beforeAll(async () => {
  await startRelay();
});

test.describe('company template picker', () => {
  test('opens Add AI Team modal, selects Software Studio, and shows wizard questions + review', async ({ browser }) => {
    const user = await createUser(browser, 'Owner');

    try {
      await createWorkspace(user.page, 'Template Picker', 'Alex Owner');

      await user.page.getByRole('button', { name: /add ai team/i }).click();

      const modal = user.page.locator('.modal-overlay .modal');
      await expect(modal.getByRole('heading', { name: /install ai team/i })).toBeVisible();

      const softwareStudioCard = user.page.locator('[data-testid="template-card-software-studio"]');
      await expect(softwareStudioCard).toBeVisible();
      await expect(softwareStudioCard).toContainText('Software Studio');
      await expect(softwareStudioCard).toContainText('manager, backend engineer, and QA specialist');

      await softwareStudioCard.getByRole('button', { name: /choose template/i }).click();

      await expect(user.page.getByTestId('template-wizard')).toBeVisible();
      await expect(user.page.getByLabel('Company name')).toBeVisible();
      await expect(user.page.getByLabel('Workspace name')).toHaveCount(0);

      await user.page.getByLabel('Company name').fill('Acme Platform');

      const review = user.page.getByTestId('template-review-summary');
      await expect(review).toContainText('Software Studio');
      await expect(review).toContainText('Acme Platform');
      await expect(review).toContainText('3 roles');
      await expect(review).toContainText('4 channels');

      const roster = user.page.getByTestId('template-roster-preview');
      await expect(roster).toBeVisible();

      const managerCard = user.page.getByTestId('template-roster-card-manager');
      await expect(managerCard).toContainText('Team Manager');
      await managerCard.getByLabel(/alias for team manager/i).fill('Astra Lead');
      await expect(user.page.getByTestId('template-roster-focus')).toContainText('Astra Lead');

      const managerAvatar = managerCard.locator('.roster-avatar img');
      const beforeSrc = await managerAvatar.getAttribute('src');
      await managerCard.getByRole('button', { name: /reroll avatar/i }).click();
      const afterSrc = await managerAvatar.getAttribute('src');
      expect(afterSrc).not.toBe(beforeSrc);
    } finally {
      await closeUser(user);
    }
  });
});
