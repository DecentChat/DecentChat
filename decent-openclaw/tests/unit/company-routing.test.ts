import { describe, expect, test } from 'bun:test';
import { decideCompanyParticipation } from '@decentchat/company-sim';
import type { LoadedCompanyContext } from '@decentchat/company-sim';

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
      employees: [
        {
          id: 'team-manager', agentId: 'software-studio-manager', accountId: 'team-manager', alias: 'Mira PM',
          teamId: 'engineering', title: 'Team Manager', channels: ['general', 'engineering'],
          participation: { mode: 'summary-first', respondWhenMentioned: true, respondToChannelTopics: ['planning', 'blockers', 'status'] },
        },
        {
          id: 'backend-dev', agentId: 'software-studio-backend', accountId: 'backend-dev', alias: 'Rian Backend',
          teamId: 'engineering', title: 'Backend Engineer', managerEmployeeId: 'team-manager', channels: ['engineering'],
          participation: { mode: 'specialist', respondWhenMentioned: true, replyInThreadsOnly: true },
        },
        {
          id: 'tester', agentId: 'software-studio-qa', accountId: 'tester', alias: 'Iva QA',
          teamId: 'qa', title: 'QA Engineer', managerEmployeeId: 'team-manager', channels: ['qa', 'engineering'],
          participation: { mode: 'specialist', respondWhenMentioned: true, replyInThreadsOnly: true },
        },
      ],
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


  test('explicit task owner routing pulls in the intended specialist', () => {
    const decision = decideCompanyParticipation({
      context: makeContext(),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: '[TASK pricing-api] Owner=Backend Engineer; Draft first endpoint',
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe('task-owner');
    expect(decision.preferredReply).toBe('thread');
  });

  test('non-owner specialist stays silent on explicitly assigned task', () => {
    const decision = decideCompanyParticipation({
      context: makeContext({
        id: 'tester',
        accountId: 'tester',
        alias: 'Iva QA',
        title: 'QA Engineer',
        teamId: 'qa',
        channels: ['qa', 'engineering'],
        participation: { mode: 'specialist', respondWhenMentioned: true, replyInThreadsOnly: true },
      }),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: '[TASK pricing-api] Owner=Backend Engineer; Draft first endpoint',
      threadId: 'thread-1',
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe('not-task-owner');
    expect(decision.preferredReply).toBe('thread');
  });

  test('explicit handoff target routing pulls in the intended next specialist', () => {
    const decision = decideCompanyParticipation({
      context: makeContext({
        id: 'tester',
        agentId: 'software-studio-qa',
        accountId: 'tester',
        alias: 'Iva QA',
        title: 'QA Engineer',
        teamId: 'qa',
        channels: ['qa', 'engineering'],
        participation: { mode: 'specialist', respondWhenMentioned: true, replyInThreadsOnly: true },
      }),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: '[HANDOFF pricing-api] Target=QA Engineer; Ready for verification',
      threadId: 'thread-1',
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe('handoff-target');
    expect(decision.preferredReply).toBe('thread');
  });

  test('thread continuity keeps routing plain follow-up messages to the assigned specialist', () => {
    const decision = decideCompanyParticipation({
      context: makeContext(),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: 'Can you also cover retry logic?',
      threadId: 'thread-1',
      threadAssignedEmployeeId: 'backend-dev',
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe('thread-assignee');
    expect(decision.preferredReply).toBe('thread');
  });

  test('thread continuity keeps non-assigned specialists silent on plain follow-up messages', () => {
    const decision = decideCompanyParticipation({
      context: makeContext({
        id: 'tester',
        agentId: 'software-studio-qa',
        accountId: 'tester',
        alias: 'Iva QA',
        title: 'QA Engineer',
        teamId: 'qa',
        channels: ['qa', 'engineering'],
        participation: { mode: 'specialist', respondWhenMentioned: true, replyInThreadsOnly: true },
      }),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: 'Can you also cover retry logic?',
      threadId: 'thread-1',
      threadAssignedEmployeeId: 'backend-dev',
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe('not-thread-assignee');
    expect(decision.preferredReply).toBe('thread');
  });

  test('non-target specialist stays silent on explicit handoff', () => {
    const decision = decideCompanyParticipation({
      context: makeContext(),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: '[HANDOFF pricing-api] Target=QA Engineer; Ready for verification',
      threadId: 'thread-1',
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe('not-handoff-target');
    expect(decision.preferredReply).toBe('thread');
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

  test('duplicate specialist responders are deterministically suppressed to one winner', () => {
    const backendDecision = decideCompanyParticipation({
      context: makeContext(),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: 'Can someone check retry logic?',
      threadId: 'thread-free',
    });
    const qaDecision = decideCompanyParticipation({
      context: makeContext({
        id: 'tester',
        agentId: 'software-studio-qa',
        accountId: 'tester',
        alias: 'Iva QA',
        title: 'QA Engineer',
        teamId: 'qa',
        channels: ['qa', 'engineering'],
        participation: { mode: 'specialist', respondWhenMentioned: true, replyInThreadsOnly: true },
      }),
      chatType: 'channel',
      channelNameOrId: 'engineering',
      text: 'Can someone check retry logic?',
      threadId: 'thread-free',
    });

    expect(backendDecision.shouldRespond).toBe(true);
    expect(backendDecision.reason).toBe('specialist-thread');
    expect(qaDecision.shouldRespond).toBe(false);
    expect(qaDecision.reason).toBe('suppressed-by-peer');
  });

  test('manager can summarize when specialists emit state-change tags in owned threads', () => {
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
      text: '[DONE pricing-api] Implementation done, tests passing',
      threadId: 'thread-1',
    });

    expect(decision.shouldRespond).toBe(true);
    expect(decision.reason).toBe('summary-thread');
    expect(decision.preferredReply).toBe('thread');
  });

  test('manager stays silent on routine specialist chatter inside owned threads', () => {
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
      text: 'I am still checking one edge case before I push',
      threadId: 'thread-1',
    });

    expect(decision.shouldRespond).toBe(false);
    expect(decision.reason).toBe('awaiting-summary-signal');
    expect(decision.preferredReply).toBe('thread');
  });
});
