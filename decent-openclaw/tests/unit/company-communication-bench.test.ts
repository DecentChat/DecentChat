import { describe, expect, test } from 'bun:test';

import {
  evaluateCompanyCommunicationScenario,
  evaluateCompanyCommunicationSuite,
  type CompanyCommunicationScenario,
} from '../../src/company-sim/communication-bench.ts';
import type { CompanyEmployeeConfig, CompanyManifest } from '../../src/company-sim/types.ts';

function makeEmployee(overrides: Partial<CompanyEmployeeConfig>): CompanyEmployeeConfig {
  return {
    id: 'employee',
    agentId: 'employee-agent',
    accountId: 'employee-account',
    alias: 'Employee',
    title: 'Employee',
    channels: ['general'],
    participation: { mode: 'specialist', respondWhenMentioned: true, replyInThreadsOnly: true },
    ...overrides,
  };
}

function makeManifest(overrides: Partial<CompanyManifest> = {}): CompanyManifest {
  return {
    id: 'software-studio',
    name: 'Software Studio',
    mode: 'company-sim',
    workspace: { name: 'Studio HQ', channels: ['general', 'engineering', 'qa'] },
    teams: [{ id: 'engineering', name: 'Engineering', managerEmployeeId: 'manager' }],
    employees: [
      makeEmployee({
        id: 'manager',
        agentId: 'software-studio-manager',
        accountId: 'manager',
        alias: 'Mira PM',
        title: 'Team Manager',
        teamId: 'engineering',
        channels: ['general', 'engineering'],
        participation: {
          mode: 'summary-first',
          respondWhenMentioned: true,
          respondToChannelTopics: ['planning', 'status', 'blockers'],
        },
      }),
      makeEmployee({
        id: 'backend-dev',
        agentId: 'software-studio-backend',
        accountId: 'backend-dev',
        alias: 'Rian Backend',
        title: 'Backend Engineer',
        teamId: 'engineering',
        managerEmployeeId: 'manager',
        channels: ['engineering'],
      }),
      makeEmployee({
        id: 'tester',
        agentId: 'software-studio-qa',
        accountId: 'tester',
        alias: 'Iva QA',
        title: 'QA Engineer',
        teamId: 'engineering',
        managerEmployeeId: 'manager',
        channels: ['qa', 'engineering'],
      }),
    ],
    ...overrides,
  };
}

const scenarios: CompanyCommunicationScenario[] = [
  {
    id: 'owner-routing',
    title: 'Explicit task ownership pulls in only the intended specialist',
    steps: [
      {
        id: 'assign-backend',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-owner',
        text: '[TASK pricing-api] Owner=Backend Engineer; Draft first endpoint',
        expectedResponders: ['backend-dev'],
        expectedSilent: ['manager', 'tester'],
      },
      {
        id: 'followup-backend-thread',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-owner',
        text: 'Can you also cover retry logic?',
        expectedResponders: ['backend-dev'],
        expectedSilent: ['manager', 'tester'],
      },
    ],
  },
  {
    id: 'handoff-targeting',
    title: 'Explicit handoff wakes the intended next role only',
    steps: [
      {
        id: 'handoff-to-qa',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-2',
        text: '[HANDOFF pricing-api] Target=QA Engineer; Ready for verification',
        expectedResponders: ['manager', 'tester'],
        expectedSilent: ['backend-dev'],
      },
      {
        id: 'followup-qa-thread',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-2',
        text: 'Please verify downgrade flow too',
        expectedResponders: ['tester'],
        expectedSilent: ['manager', 'backend-dev'],
      },
    ],
  },
  {
    id: 'manager-summary-discipline',
    title: 'Manager waits for state change signals',
    steps: [
      {
        id: 'routine-thread-chatter',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-1',
        text: 'Still checking one edge case before push',
        expectedResponders: ['backend-dev'],
        expectedSilent: ['manager', 'tester'],
      },
      {
        id: 'thread-done-signal',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-1',
        text: '[DONE pricing-api] Implementation done, tests passing',
        expectedResponders: ['backend-dev', 'manager'],
      },
    ],
  },
];

describe('company communication benchmark', () => {
  test('scenario report shows missing and unexpected responders clearly', () => {
    const manifest = makeManifest({
      employees: [
        ...makeManifest().employees.slice(0, 2),
        makeEmployee({
          id: 'tester',
          agentId: 'software-studio-qa',
          accountId: 'tester',
          alias: 'Iva QA',
          title: 'QA Engineer',
          teamId: 'engineering',
          managerEmployeeId: 'manager',
          channels: ['qa', 'engineering'],
          participation: { mode: 'proactive-on-owned-channel', respondWhenMentioned: true },
        }),
      ],
    });

    const report = evaluateCompanyCommunicationScenario({
      manifest,
      scenario: scenarios[0]!,
    });

    expect(report.totals.unexpectedResponders).toBe(2);
    expect(report.totals.missingExpectedResponders).toBe(0);
    expect(report.steps[0]?.unexpectedResponders).toEqual(['tester']);
    expect(report.steps[0]?.actualResponders).toEqual(['backend-dev', 'tester']);
  });

  test('suite scoring prefers quiet owner-routed policy over noisy policy', () => {
    const goodManifest = makeManifest();
    const noisyManifest = makeManifest({
      employees: makeManifest().employees.map((employee) => {
        if (employee.id === 'manager') {
          return {
            ...employee,
            participation: { mode: 'proactive-on-owned-channel', respondWhenMentioned: true },
          };
        }
        if (employee.id === 'tester') {
          return {
            ...employee,
            participation: { mode: 'proactive-on-owned-channel', respondWhenMentioned: true },
          };
        }
        return employee;
      }),
    });

    const goodReport = evaluateCompanyCommunicationSuite({ manifest: goodManifest, scenarios });
    const noisyReport = evaluateCompanyCommunicationSuite({ manifest: noisyManifest, scenarios });

    expect(goodReport.totals.score).toBeGreaterThan(noisyReport.totals.score);
    expect(goodReport.totals.unexpectedResponders).toBeLessThan(noisyReport.totals.unexpectedResponders);
    expect(goodReport.totals.silentViolations).toBeLessThan(noisyReport.totals.silentViolations);
  });
});
