import { describe, expect, test } from 'bun:test';
import type { LoadedCompanyContext } from '../../src/company-sim/context-loader.ts';
import { decideCompanyParticipation } from '../../src/company-sim/router.ts';

function makeContext(overrides: Partial<LoadedCompanyContext['employee']> = {}): LoadedCompanyContext {
  return {
    manifestPath: '/tmp/company.yaml',
    companyDir: '/tmp/company',
    manifest: {
      id: 'software-studio',
      name: 'Software Studio',
      mode: 'company-sim',
      workspace: { name: 'Studio HQ', channels: ['general', 'engineering', 'qa'] },
      teams: [{ id: 'engineering', name: 'Engineering', managerEmployeeId: 'team-manager' }],
      employees: [],
    },
    employee: {
      id: 'backend-dev',
      accountId: 'backend-dev',
      alias: 'Rian Backend',
      teamId: 'engineering',
      title: 'Backend Engineer',
      managerEmployeeId: 'team-manager',
      channels: ['engineering'],
      participation: { mode: 'specialist', respondWhenMentioned: true, replyInThreadsOnly: true },
      ...overrides,
    },
    team: { id: 'engineering', name: 'Engineering', managerEmployeeId: 'team-manager' },
    documents: [],
  };
}

describe('company routing', () => {
  test('mention of specialist routes to that specialist', () => {
    const decision = decideCompanyParticipation({
      context: makeContext(),
      chatType: 'channel',
      channelNameOrId: 'general',
      text: '@Rian can you handle the API layer?',
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe('mentioned');
    expect(decision.preferredReply).toBe('thread');
  });

  test('channel topic maps to manager on owned channel', () => {
    const decision = decideCompanyParticipation({
      context: makeContext({
        id: 'team-manager',
        accountId: 'team-manager',
        alias: 'Mira PM',
        title: 'Team Manager',
        channels: ['general', 'engineering'],
        participation: {
          mode: 'summary-first',
          respondWhenMentioned: true,
          respondToChannelTopics: ['planning', 'blockers', 'status'],
        },
      }),
      chatType: 'channel',
      channelNameOrId: 'general',
      text: 'Need planning help for the next release',
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe('summary-topic');
    expect(decision.preferredReply).toBe('channel');
  });

  test('unmentioned irrelevant employees stay silent', () => {
    const decision = decideCompanyParticipation({
      context: makeContext({
        id: 'tester',
        accountId: 'tester',
        alias: 'Iva QA',
        title: 'QA Engineer',
        channels: ['qa'],
        participation: { mode: 'specialist', respondWhenMentioned: true, replyInThreadsOnly: true },
      }),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: 'Backend deploy issue needs investigation',
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe('not-owned-channel');
  });

  test('manager can summarize when specialists talk in owned threads', () => {
    const decision = decideCompanyParticipation({
      context: makeContext({
        id: 'team-manager',
        accountId: 'team-manager',
        alias: 'Mira PM',
        title: 'Team Manager',
        channels: ['engineering', 'general'],
        participation: {
          mode: 'summary-first',
          respondWhenMentioned: true,
          respondToChannelTopics: ['status'],
        },
      }),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: 'Implementation done, tests passing',
      threadId: 'thread-1',
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe('summary-thread');
    expect(decision.preferredReply).toBe('thread');
  });
});
