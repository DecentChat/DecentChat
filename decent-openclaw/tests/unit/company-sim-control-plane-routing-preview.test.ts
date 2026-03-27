import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';
import { previewCompanySimRouting } from '@decentchat/company-sim';

const VALID_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function writeCompanyFixture(root: string) {
  const companyDir = join(root, 'company-sims', 'software-studio');
  mkdirSync(join(companyDir, 'teams'), { recursive: true });
  for (const employeeId of ['team-manager', 'backend-dev', 'tester']) {
    mkdirSync(join(companyDir, 'employees', employeeId), { recursive: true });
  }

  writeFileSync(join(companyDir, 'company.yaml'), `id: software-studio
name: Software Studio
mode: company-sim
workspace:
  name: Studio HQ
  channels:
    - general
    - engineering
    - qa
    - leadership
teams:
  - id: engineering
    name: Engineering
    managerEmployeeId: team-manager
  - id: qa
    name: QA
    managerEmployeeId: tester
employees:
  - id: team-manager
    agentId: software-studio-team-manager
    accountId: team-manager
    alias: Mira PM
    teamId: engineering
    title: Team Manager
    channels: [general, engineering, leadership]
    participation:
      mode: summary-first
      respondWhenMentioned: true
      respondToChannelTopics: [planning, blockers, status]
  - id: backend-dev
    agentId: software-studio-backend-dev
    accountId: backend-dev
    alias: Backend Engineer
    teamId: engineering
    title: Backend Engineer
    managerEmployeeId: team-manager
    channels: [engineering]
    participation:
      mode: specialist
      respondWhenMentioned: true
      replyInThreadsOnly: true
  - id: tester
    agentId: software-studio-tester
    accountId: tester
    alias: QA Engineer
    teamId: qa
    title: QA Engineer
    managerEmployeeId: team-manager
    channels: [qa, engineering]
    participation:
      mode: specialist
      respondWhenMentioned: true
      replyInThreadsOnly: true
`);

  for (const file of ['COMPANY.md', 'COMMUNICATION.md', 'ORG.md', 'WORKFLOWS.md']) {
    writeFileSync(join(companyDir, file), `# ${file}\n`);
  }
  writeFileSync(join(companyDir, 'teams', 'engineering.md'), '# Engineering\n');
  writeFileSync(join(companyDir, 'teams', 'qa.md'), '# QA\n');
  for (const employeeId of ['team-manager', 'backend-dev', 'tester']) {
    for (const file of ['IDENTITY.md', 'ROLE.md', 'RULES.md', 'MEMORY.md', 'PLAYBOOK.md']) {
      writeFileSync(join(companyDir, 'employees', employeeId, file), `# ${file}\n`);
    }
  }

  return {
    companyDir,
    manifestPath: join(companyDir, 'company.yaml'),
  };
}

function makeConfig(root: string, manifestPath: string, companyDir: string) {
  return {
    channels: {
      decentchat: {
        companySimBootstrap: {
          enabled: true,
          mode: 'runtime',
          manifestPath,
          targetWorkspaceId: 'ws-1',
        },
        accounts: {
          'team-manager': {
            seedPhrase: VALID_SEED,
            alias: 'Mira PM',
            dataDir: join(root, 'data', 'team-manager'),
            companySim: {
              enabled: true,
              manifestPath,
              companyId: 'software-studio',
              employeeId: 'team-manager',
              roleFilesDir: join(companyDir, 'employees', 'team-manager'),
            },
          },
          'backend-dev': {
            seedPhrase: VALID_SEED,
            alias: 'Backend Engineer',
            dataDir: join(root, 'data', 'backend-dev'),
            companySim: {
              enabled: true,
              manifestPath,
              companyId: 'software-studio',
              employeeId: 'backend-dev',
              roleFilesDir: join(companyDir, 'employees', 'backend-dev'),
            },
          },
          tester: {
            seedPhrase: VALID_SEED,
            alias: 'QA Engineer',
            dataDir: join(root, 'data', 'tester'),
            companySim: {
              enabled: true,
              manifestPath,
              companyId: 'software-studio',
              employeeId: 'tester',
              roleFilesDir: join(companyDir, 'employees', 'tester'),
            },
          },
        },
      },
    },
  };
}

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'host-account',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://decentchat.app/peerjs',
    invites: [],
    alias: 'Host',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-company-control-account-')),
    ...overrides,
  };
}

describe('company sim control plane routing preview', () => {
  test('explains why manager stays silent vs responds on summary-trigger tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-sim-control-routing-'));
    try {
      const { manifestPath, companyDir } = writeCompanyFixture(root);
      const config = makeConfig(root, manifestPath, companyDir);

      const routine = previewCompanySimRouting({
        workspaceId: 'ws-1',
        loadConfig: () => config,
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-1',
        text: '[TASK pricing-api] Owner=Backend Engineer; implement first endpoint',
      });
      const blocked = previewCompanySimRouting({
        workspaceId: 'ws-1',
        loadConfig: () => config,
        chatType: 'channel',
        channelNameOrId: 'engineering',
        threadId: 'thread-1',
        text: '[BLOCKED pricing-api] Owner=Backend Engineer; waiting on product decision',
      });

      expect(routine.responders.map((entry) => entry.employeeId)).toEqual(['backend-dev']);
      expect(routine.suppressed.find((entry) => entry.employeeId === 'team-manager')?.reason)
        .toBe('awaiting-summary-signal');
      expect(routine.suppressed.find((entry) => entry.employeeId === 'team-manager')?.explanation)
        .toMatch(/waiting for a summary trigger/i);

      expect(blocked.responders.map((entry) => entry.employeeId)).toEqual(['backend-dev', 'team-manager']);
      expect(blocked.responders.find((entry) => entry.employeeId === 'team-manager')?.reason)
        .toBe('summary-thread');
      expect(blocked.suppressed.find((entry) => entry.employeeId === 'tester')?.reason)
        .toBe('suppressed-by-peer');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('DecentChatNodePeer responds to company-sim-routing-preview-request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'company-sim-control-routing-peer-'));
    try {
      const { manifestPath, companyDir } = writeCompanyFixture(root);
      const config = makeConfig(root, manifestPath, companyDir);

      const peer = new DecentChatNodePeer({
        account: makeAccount(),
        onIncomingMessage: async () => {},
        onReply: () => {},
        companyTemplateControl: {
          loadConfig: () => config,
          writeConfigFile: async () => {},
          workspaceRootDir: root,
          companySimsRootDir: join(root, 'company-sims'),
        },
      });

      const sent: Array<{ peerId: string; msg: any }> = [];
      (peer as any).transport = {
        send: (peerId: string, msg: any) => {
          sent.push({ peerId, msg });
          return true;
        },
      };
      (peer as any).syncProtocol = { handleMessage: async () => {} };
      (peer as any).messageProtocol = {};
      (peer as any).workspaceManager = {
        getWorkspace: (workspaceId: string) => workspaceId === 'ws-1'
          ? {
            id: 'ws-1',
            name: 'Studio HQ',
            createdBy: 'owner-peer',
            members: [
              { peerId: 'owner-peer', role: 'owner' },
              { peerId: 'host-peer', role: 'member' },
            ],
          }
          : null,
        isBanned: () => false,
      };

      await (peer as any).handlePeerMessage('owner-peer', {
        type: 'workspace-sync',
        workspaceId: 'ws-1',
        sync: {
          type: 'company-sim-routing-preview-request',
          requestId: 'preview-1',
          channelNameOrId: 'engineering',
          chatType: 'channel',
          threadId: 'thread-1',
          text: '[BLOCKED pricing-api] Owner=Backend Engineer; waiting on product decision',
        },
      });

      const response = sent.find((entry) => entry.msg?.sync?.type === 'company-sim-routing-preview-response');
      expect(response?.msg?.sync?.ok).toBeTrue();
      expect(response?.msg?.sync?.result?.responders?.map((entry: any) => entry.employeeId))
        .toEqual(['backend-dev', 'team-manager']);
      expect(response?.msg?.sync?.result?.suppressed?.find((entry: any) => entry.employeeId === 'tester')?.reason)
        .toBe('suppressed-by-peer');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
