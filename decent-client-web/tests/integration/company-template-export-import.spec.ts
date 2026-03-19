import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser, createWorkspace } from './helpers';

test.beforeAll(async () => {
  await startRelay();
});

test.describe('company template advanced export/import', () => {
  test('exports wizard setup to JSON and imports edited answers back', async ({ browser }) => {
    const user = await createUser(browser, 'Owner');

    try {
      await createWorkspace(user.page, 'Template Export', 'Alex Owner');

      await user.page.getByRole('button', { name: /add ai team/i }).click();
      await user.page.locator('[data-testid="template-card-software-studio"]')
        .getByRole('button', { name: /choose template/i })
        .click();

      const companyInput = user.page.getByLabel('Company name');
      await companyInput.fill('Acme Original');

      await user.page.getByRole('button', { name: /export setup json/i }).click();

      const jsonEditor = user.page.getByTestId('template-json-editor');
      await expect(jsonEditor).toHaveValue(/Acme Original/);

      await jsonEditor.fill(JSON.stringify({
        templateId: 'software-studio',
        answers: {
          companyName: 'Imported Company',
          workspaceName: 'Imported Workspace',
          managerAlias: 'Imported Manager',
          backendAlias: 'Imported Backend',
          qaAlias: 'Imported QA',
        },
      }, null, 2));

      await user.page.getByRole('button', { name: /import setup json/i }).click();

      await expect(user.page.getByLabel('Company name')).toHaveValue('Imported Company');
      await expect(user.page.getByLabel('Workspace name')).toHaveValue('Imported Workspace');
      await expect(user.page.getByLabel('Manager alias')).toHaveValue('Imported Manager');
    } finally {
      await closeUser(user);
    }
  });
});
