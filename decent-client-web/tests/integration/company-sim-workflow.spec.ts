import { test, expect } from '@playwright/test';
import {
  startRelay,
  createUser,
  closeUser,
  createWorkspace,
  seedCompanyFixtureMembers,
  postFixtureMessage,
  openThreadForMessage,
  type CompanyFixtureMember,
} from './helpers';

test.beforeAll(async () => {
  await startRelay();
});

test.describe('company sim workflow', () => {
  test.setTimeout(120_000);

  test('routes specialist work into thread and posts manager summary back in #general', async ({ browser }) => {
    const ceoUser = await createUser(browser, 'CEO');

    try {
      await createWorkspace(ceoUser.page, 'Company Sim Workflow', 'Alex CEO');

      const fixtures: CompanyFixtureMember[] = [
        {
          peerId: 'human-ceo',
          alias: 'Alex CEO',
          role: 'owner',
          companySim: { automationKind: 'human', roleTitle: 'CEO' },
        },
        {
          peerId: 'team-manager',
          alias: 'Mira PM',
          companySim: {
            automationKind: 'openclaw-agent',
            roleTitle: 'Team Manager',
            teamId: 'engineering',
          },
        },
        {
          peerId: 'backend-dev',
          alias: 'Rian Backend',
          companySim: {
            automationKind: 'openclaw-agent',
            roleTitle: 'Backend Engineer',
            teamId: 'engineering',
            managerPeerId: 'team-manager',
          },
        },
        {
          peerId: 'tester',
          alias: 'Iva QA',
          companySim: {
            automationKind: 'openclaw-agent',
            roleTitle: 'QA Engineer',
            teamId: 'qa',
            managerPeerId: 'team-manager',
          },
        },
      ];

      const seeded = await seedCompanyFixtureMembers(ceoUser.page, fixtures, 'general');

      const ceoRequest = await postFixtureMessage(ceoUser.page, {
        channelId: seeded.channelId,
        senderId: 'human-ceo',
        content: 'Need enterprise CSV export with audit events by Friday.',
      });

      const managerChannelReply = await postFixtureMessage(ceoUser.page, {
        channelId: seeded.channelId,
        senderId: 'team-manager',
        content: 'Understood — opening a task thread and routing engineering + QA now.',
      });

      const managerThreadKickoff = await postFixtureMessage(ceoUser.page, {
        channelId: seeded.channelId,
        senderId: 'team-manager',
        threadId: ceoRequest.id,
        content: 'Thread kickoff: @backend-dev implement API + logs. @tester verify full regression.',
      });

      await openThreadForMessage(ceoUser.page, ceoRequest.id);

      const backendThreadReply = await postFixtureMessage(ceoUser.page, {
        channelId: seeded.channelId,
        senderId: 'backend-dev',
        threadId: ceoRequest.id,
        content: 'Backend done: endpoint, pagination, and audit logging are merged locally.',
      });

      const testerThreadReply = await postFixtureMessage(ceoUser.page, {
        channelId: seeded.channelId,
        senderId: 'tester',
        threadId: ceoRequest.id,
        content: 'QA verified: export passes happy path + edge cases, no regression found.',
      });

      const managerSummary = await postFixtureMessage(ceoUser.page, {
        channelId: seeded.channelId,
        senderId: 'team-manager',
        content: 'Summary: backend + QA complete, feature is ready for CEO review.',
      });

      const channelMeta = (messageId: string) =>
        ceoUser.page.locator(`[data-testid="message-meta"][data-view="channel"][data-message-id="${messageId}"]`);
      const threadMeta = (messageId: string) =>
        ceoUser.page.locator(`[data-testid="message-meta"][data-view="thread"][data-message-id="${messageId}"]`);

      await expect(channelMeta(ceoRequest.id)).toHaveAttribute('data-sender-id', 'human-ceo');
      await expect(channelMeta(managerChannelReply.id)).toHaveAttribute('data-sender-id', 'team-manager');
      await expect(channelMeta(managerChannelReply.id)).toHaveAttribute('data-role-title', 'Team Manager');

      const threadPanel = ceoUser.page.getByTestId('thread-panel');
      await expect(threadPanel).toBeVisible();
      await expect(threadPanel).toHaveAttribute('data-thread-id', ceoRequest.id);

      await expect(threadMeta(managerThreadKickoff.id)).toHaveAttribute('data-sender-id', 'team-manager');
      await expect(threadMeta(backendThreadReply.id)).toHaveAttribute('data-sender-id', 'backend-dev');
      await expect(threadMeta(testerThreadReply.id)).toHaveAttribute('data-sender-id', 'tester');

      await expect(channelMeta(backendThreadReply.id)).toHaveCount(0);
      await expect(channelMeta(testerThreadReply.id)).toHaveCount(0);

      await expect(channelMeta(managerSummary.id)).toHaveAttribute('data-sender-id', 'team-manager');
      await expect(channelMeta(managerSummary.id)).toHaveAttribute('data-role-title', 'Team Manager');
    } finally {
      await closeUser(ceoUser);
    }
  });
});
