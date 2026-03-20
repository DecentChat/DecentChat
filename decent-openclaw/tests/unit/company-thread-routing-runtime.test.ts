import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { relayInboundMessageToPeer } from '../../src/monitor.ts';

function writeEmployeeDocs(root: string, employeeId: string): void {
  const dir = join(root, 'employees', employeeId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'IDENTITY.md'), `# Identity\n${employeeId}`);
  writeFileSync(join(dir, 'ROLE.md'), `# Role\n${employeeId}`);
  writeFileSync(join(dir, 'RULES.md'), `# Rules\n${employeeId}`);
  writeFileSync(join(dir, 'MEMORY.md'), `# Memory\n${employeeId}`);
  writeFileSync(join(dir, 'PLAYBOOK.md'), `# Playbook\n${employeeId}`);
}

function createCompanyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'decentchat-company-thread-routing-'));
  writeFileSync(join(root, 'COMPANY.md'), '# Company\nSoftware Studio');
  writeFileSync(join(root, 'ORG.md'), '# Org\nEngineering reports to manager');
  writeFileSync(join(root, 'COMMUNICATION.md'), '# Communication\nUse [TASK], [HANDOFF], [DONE].');
  writeFileSync(join(root, 'WORKFLOWS.md'), '# Workflows\nKeep threads disciplined.');
  writeEmployeeDocs(root, 'manager');
  writeEmployeeDocs(root, 'backend-dev');
  writeEmployeeDocs(root, 'tester');
  writeFileSync(join(root, 'company.yaml'), `id: software-studio\nname: Software Studio\nmode: company-sim\nworkspace:\n  name: Studio HQ\n  channels:\n    - general\n    - engineering\n    - qa\nteams:\n  - id: engineering\n    name: Engineering\n    managerEmployeeId: manager\nemployees:\n  - id: manager\n    agentId: software-studio-manager\n    accountId: manager\n    alias: Mira PM\n    teamId: engineering\n    title: Team Manager\n    channels:\n      - general\n      - engineering\n    participation:\n      mode: summary-first\n      respondWhenMentioned: true\n      respondToChannelTopics:\n        - planning\n        - status\n        - blockers\n  - id: backend-dev\n    agentId: software-studio-backend\n    accountId: backend-dev\n    alias: Rian Backend\n    teamId: engineering\n    title: Backend Engineer\n    managerEmployeeId: manager\n    channels:\n      - engineering\n    participation:\n      mode: specialist\n      respondWhenMentioned: true\n      replyInThreadsOnly: true\n  - id: tester\n    agentId: software-studio-qa\n    accountId: tester\n    alias: Iva QA\n    teamId: engineering\n    title: QA Engineer\n    managerEmployeeId: manager\n    channels:\n      - engineering\n      - qa\n    participation:\n      mode: specialist\n      respondWhenMentioned: true\n      replyInThreadsOnly: true\n`);
  return join(root, 'company.yaml');
}

function makeCore(recorded: Array<{ accountId: string; sessionKey: string; ctx: any }>): any {
  return {
    config: {
      loadConfig: () => ({
        channels: {
          decentchat: {
            replyToMode: 'all',
            thread: { historyScope: 'thread', inheritParent: false, initialHistoryLimit: 20 },
          },
        },
      }),
    },
    channel: {
      routing: {
        resolveAgentRoute: ({ accountId }: any) => ({
          sessionKey: `session:group:ws:chan:${accountId}`,
          agentId: accountId === 'tester' ? 'software-studio-qa' : accountId === 'manager' ? 'software-studio-manager' : 'software-studio-backend',
          accountId,
        }),
      },
      session: {
        resolveStorePath: () => '/tmp/decent-openclaw-company-thread-routing-store',
        readSessionUpdatedAt: () => undefined,
        recordInboundSession: async (args: any) => recorded.push(args),
      },
      reply: {
        resolveEnvelopeFormatOptions: () => ({}),
        formatAgentEnvelope: (args: { body: string }) => args.body,
        finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
        dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
          await dispatcherOptions.deliver({ text: 'ok' });
        },
      },
    },
  };
}

function makeCtx(accountId: 'backend-dev' | 'tester', manifestPath: string): any {
  return {
    accountId,
    account: {
      accountId,
      enabled: true,
      dmPolicy: 'open',
      configured: true,
      alias: accountId === 'tester' ? 'Iva QA' : 'Rian Backend',
      invites: [],
      streamEnabled: false,
      replyToMode: 'all',
      replyToModeByChatType: {},
      thread: { historyScope: 'thread', inheritParent: false, initialHistoryLimit: 20 },
      companySim: {
        enabled: true,
        manifestPath,
        companyId: 'software-studio',
        employeeId: accountId,
      },
    },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

function makePeer(readReceipts: string[]): any {
  return {
    startStream: async () => {},
    startDirectStream: async () => {},
    sendStreamDelta: async () => {},
    sendDirectStreamDelta: async () => {},
    sendStreamDone: async () => {},
    sendDirectStreamDone: async () => {},
    sendDirectToPeer: async () => {},
    sendToChannel: async () => {},
    sendReadReceipt: async (_peerId: string, channelId: string, messageId: string) => {
      readReceipts.push(`${channelId}:${messageId}`);
    },
    requestFullImage: async () => null,
    resolveChannelNameById: () => 'engineering',
  };
}

describe('company thread routing continuity runtime', () => {
  test('plain follow-up thread messages stay with the previously assigned owner', async () => {
    const manifestPath = createCompanyFixture();
    const recorded: Array<{ accountId: string; sessionKey: string; ctx: any }> = [];
    const readReceipts: string[] = [];
    const core = makeCore(recorded);
    const xenaPeer = makePeer(readReceipts);

    await relayInboundMessageToPeer({
      incoming: {
        channelId: 'chan-1',
        workspaceId: 'ws-1',
        content: '[TASK pricing-api] Owner=Backend Engineer; Draft first endpoint',
        senderId: 'peer-1',
        senderName: 'Alino',
        messageId: 'msg-1',
        replyToId: 'thread-owner',
        chatType: 'channel',
        timestamp: Date.now(),
      },
      ctx: makeCtx('backend-dev', manifestPath),
      core,
      xenaPeer,
    });

    await relayInboundMessageToPeer({
      incoming: {
        channelId: 'chan-1',
        workspaceId: 'ws-1',
        content: 'Can you also cover retry logic?',
        senderId: 'peer-1',
        senderName: 'Alino',
        messageId: 'msg-2',
        replyToId: 'thread-owner',
        chatType: 'channel',
        timestamp: Date.now(),
      },
      ctx: makeCtx('tester', manifestPath),
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(readReceipts).toContain('chan-1:msg-2');
  });

  test('plain follow-up thread messages switch to QA after an explicit handoff', async () => {
    const manifestPath = createCompanyFixture();
    const recorded: Array<{ accountId: string; sessionKey: string; ctx: any }> = [];
    const readReceipts: string[] = [];
    const core = makeCore(recorded);
    const xenaPeer = makePeer(readReceipts);

    await relayInboundMessageToPeer({
      incoming: {
        channelId: 'chan-1',
        workspaceId: 'ws-1',
        content: '[HANDOFF pricing-api] Target=QA Engineer; Ready for verification',
        senderId: 'peer-1',
        senderName: 'Alino',
        messageId: 'msg-10',
        replyToId: 'thread-handoff',
        chatType: 'channel',
        timestamp: Date.now(),
      },
      ctx: makeCtx('tester', manifestPath),
      core,
      xenaPeer,
    });

    await relayInboundMessageToPeer({
      incoming: {
        channelId: 'chan-1',
        workspaceId: 'ws-1',
        content: 'Please verify downgrade flow too',
        senderId: 'peer-1',
        senderName: 'Alino',
        messageId: 'msg-11',
        replyToId: 'thread-handoff',
        chatType: 'channel',
        timestamp: Date.now(),
      },
      ctx: makeCtx('backend-dev', manifestPath),
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(readReceipts).toContain('chan-1:msg-11');
  });
});
