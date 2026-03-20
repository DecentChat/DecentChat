import type { CompanyCommunicationScenario } from './communication-bench.ts';

const SOFTWARE_STUDIO_SUITE: CompanyCommunicationScenario[] = [
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
        expectedResponders: ['backend'],
        expectedSilent: ['manager', 'qa'],
      },
      {
        id: 'followup-backend-thread',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-owner',
        text: 'Can you also cover retry logic?',
        expectedResponders: ['backend'],
        expectedSilent: ['manager', 'qa'],
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
        expectedResponders: ['manager', 'qa'],
        expectedSilent: ['backend'],
      },
      {
        id: 'followup-qa-thread',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-2',
        text: 'Please verify downgrade flow too',
        expectedResponders: ['qa'],
        expectedSilent: ['manager', 'backend'],
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
        threadId: 'thread-3',
        text: 'Still checking one edge case before push',
        expectedResponders: ['backend'],
        expectedSilent: ['manager', 'qa'],
      },
      {
        id: 'thread-done-signal',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-3',
        text: '[DONE pricing-api] Implementation done, tests passing',
        expectedResponders: ['backend', 'manager'],
        expectedSilent: ['qa'],
      },
    ],
  },
  {
    id: 'top-level-noise-control',
    title: 'Plain top-level channel chatter should not wake specialists by default',
    steps: [
      {
        id: 'top-level-generic-request',
        chatType: 'channel',
        channelNameOrId: 'engineering',
        text: 'Can someone sanity check retry logic?',
        expectedResponders: [],
        expectedSilent: ['manager', 'backend', 'qa'],
      },
    ],
  },
];

export function getBuiltInCommunicationBenchmarkSuite(templateId: string): CompanyCommunicationScenario[] {
  switch (templateId) {
    case 'software-studio':
      return SOFTWARE_STUDIO_SUITE.map((scenario) => ({
        ...scenario,
        steps: scenario.steps.map((step) => ({
          ...step,
          expectedResponders: step.expectedResponders ? [...step.expectedResponders] : undefined,
          expectedSilent: step.expectedSilent ? [...step.expectedSilent] : undefined,
        })),
      }));
    default:
      throw new Error(`No built-in communication benchmark suite for template: ${templateId}`);
  }
}
