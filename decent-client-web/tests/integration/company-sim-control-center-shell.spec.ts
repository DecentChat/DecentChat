import { test, expect } from '@playwright/test';
import { startRelay, createUser, closeUser, createWorkspace } from './helpers';

test.beforeAll(async () => {
  await startRelay();
});

async function installCompanySimStateMock(page: any): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__ctrl, undefined, { timeout: 15000 });
  await page.evaluate(() => {
    const ctrl = (window as any).__ctrl;
    ctrl.requestCompanySimStateViaControlPlane = async ({ workspaceId }: { workspaceId: string }) => ({
      overview: {
        workspaceId,
        workspaceName: 'Company Control',
        companyId: 'software-studio',
        companyName: 'Software Studio',
        manifestPath: '/tmp/company-sims/software-studio/company.yaml',
        companyDirPath: '/tmp/company-sims/software-studio',
        counts: { employees: 3, teams: 2, channels: 4, docs: 21 },
        sourceState: 'ready',
        generatedState: 'warning',
        liveState: 'ready',
        warnings: ['1 muted channel', '1 pending runtime action'],
      },
      teams: [
        { id: 'engineering', name: 'Engineering', memberEmployeeIds: ['team-manager', 'backend-dev'], docPath: 'teams/engineering.md', docExists: true },
        { id: 'qa', name: 'QA', memberEmployeeIds: ['tester'], docPath: 'teams/qa.md', docExists: true },
      ],
      employees: [
        { id: 'team-manager', accountId: 'team-manager', alias: 'Mira PM', title: 'Team Manager', teamId: 'engineering', channels: ['general', 'engineering', 'leadership'], participation: { mode: 'summary-first' }, silentChannelIds: ['leadership'], effectiveDocPaths: ['COMPANY.md'] },
        { id: 'backend-dev', accountId: 'backend-dev', alias: 'Devon API', title: 'Backend Engineer', teamId: 'engineering', channels: ['engineering'], participation: { mode: 'specialist' }, silentChannelIds: [], effectiveDocPaths: ['COMPANY.md'] },
        { id: 'tester', accountId: 'tester', alias: 'Iva QA', title: 'QA Engineer', teamId: 'qa', channels: ['qa', 'engineering'], participation: { mode: 'specialist' }, silentChannelIds: [], effectiveDocPaths: ['COMPANY.md'] },
      ],
      channels: [
        { name: 'general', memberEmployeeIds: ['team-manager'], mutedEmployeeIds: [] },
        { name: 'engineering', memberEmployeeIds: ['team-manager', 'backend-dev', 'tester'], mutedEmployeeIds: [] },
        { name: 'qa', memberEmployeeIds: ['tester'], mutedEmployeeIds: [] },
        { name: 'leadership', memberEmployeeIds: ['team-manager'], mutedEmployeeIds: ['team-manager'] },
      ],
      docs: [
        { id: 'company', relativePath: 'COMPANY.md', label: 'Company', kind: 'company', required: true, exists: true, usedByEmployeeIds: ['team-manager', 'backend-dev', 'tester'] },
      ],
      provisioning: {
        bootstrapEnabled: true,
        bootstrapMode: 'runtime',
        manifestPath: '/tmp/company-sims/software-studio/company.yaml',
        targetWorkspaceId: workspaceId,
        configuredAccountIds: ['backend-dev', 'team-manager', 'tester'],
        missingAccountIds: [],
        onlineReadyAccountIds: ['backend-dev', 'team-manager'],
        manualActionRequiredAccountIds: ['tester'],
      },
    });
  });
}

test.describe('company sim control center shell', () => {
  test('opens from workspace menu, shows overview, and closes back to chat', async ({ browser }) => {
    const user = await createUser(browser, 'Owner');

    try {
      await createWorkspace(user.page, 'Company Control', 'Alex Owner');
      await installCompanySimStateMock(user.page);

      await user.page.getByRole('button', { name: /workspace menu/i }).click();
      await user.page.getByRole('button', { name: /company sim/i }).click();

      const panel = user.page.getByTestId('company-sim-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('heading', { name: /software studio/i })).toBeVisible();

      for (const item of ['Overview', 'Docs', 'People', 'Channels', 'Provisioning', 'Sandbox']) {
        await expect(panel.getByRole('button', { name: item })).toBeVisible();
      }

      await expect(user.page.getByTestId('company-sim-status-source')).toContainText('Source');
      await expect(user.page.getByTestId('company-sim-status-source')).toContainText('Ready');
      await expect(user.page.getByTestId('company-sim-status-generated')).toContainText('Generated');
      await expect(user.page.getByTestId('company-sim-status-generated')).toContainText('Warning');
      await expect(user.page.getByTestId('company-sim-status-live')).toContainText('Live');
      await expect(user.page.getByTestId('company-sim-status-live')).toContainText('Ready');

      await expect(user.page.getByTestId('company-sim-overview-card-employees')).toContainText('3');
      await expect(user.page.getByTestId('company-sim-overview-card-teams')).toContainText('2');
      await expect(user.page.getByTestId('company-sim-overview-card-channels')).toContainText('4');
      await expect(user.page.getByTestId('company-sim-overview-card-docs')).toContainText('21');
      await expect(user.page.getByTestId('company-sim-overview-card-provisioned')).toContainText('3');
      await expect(user.page.getByTestId('company-sim-overview-card-online-ready')).toContainText('2');
      await expect(user.page.getByTestId('company-sim-warnings')).toContainText('1 muted channel');

      await user.page.getByRole('button', { name: /back to chat/i }).click();
      await expect(panel).toHaveCount(0);
      await expect(user.page.locator('#compose-input')).toBeVisible();
    } finally {
      await closeUser(user);
    }
  });

  test('stays within the viewport on shorter screens', async ({ browser }) => {
    const user = await createUser(browser, 'Owner');

    try {
      await user.page.setViewportSize({ width: 1280, height: 640 });
      await createWorkspace(user.page, 'Company Control', 'Alex Owner');
      await installCompanySimStateMock(user.page);

      await user.page.getByRole('button', { name: /workspace menu/i }).click();
      await user.page.getByRole('button', { name: /company sim/i }).click();

      const panel = user.page.getByTestId('company-sim-panel');
      await expect(panel).toBeVisible();

      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(640);
    } finally {
      await closeUser(user);
    }
  });
});
