import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';
import { getCompanySimControlState } from '@decentchat/company-sim';

const VALID_SEED = 'flame damp wear dust sell puzzle twist family one post hawk weather';

function writeCompanyFixture(root: string) {
  const companyDir = join(root, 'company-sims', 'software-studio');
  mkdirSync(join(companyDir, 'teams'), { recursive: true });
  mkdirSync(join(companyDir, 'employees', 'team-manager'), { recursive: true });
  mkdirSync(join(companyDir, 'employees', 'backend-dev'), { recursive: true });
  mkdirSync(join(companyDir, 'employees', 'tester'), { recursive: true });

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
    alias: Devon API
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
    alias: Iva QA
    teamId: qa
    title: QA Engineer
    managerEmployeeId: team-manager
    channels: [qa, engineering]
    participation:
      mode: specialist
      respondWhenMentioned: true
      replyInThreadsOnly: true
`);

  writeFileSync(join(companyDir, 'COMPANY.md'), '# Software Studio\n\nA product-focused company.\n');
  writeFileSync(join(companyDir, 'COMMUNICATION.md'), '# Communication\n\nUse tags.\n');
  writeFileSync(join(companyDir, 'ORG.md'), '# Org\n\nManager -> Backend -> QA\n');
  writeFileSync(join(companyDir, 'WORKFLOWS.md'), '# Workflows\n\nShip with tests.\n');
  writeFileSync(join(companyDir, 'teams', 'engineering.md'), '# Engineering\n\nOwn implementation.\n');
  writeFileSync(join(companyDir, 'teams', 'qa.md'), '# QA\n\nVerify releases.\n');

  for (const employeeId of ['team-manager', 'backend-dev', 'tester']) {
    const employeeDir = join(companyDir, 'employees', employeeId);
    writeFileSync(join(employeeDir, 'IDENTITY.md'), `# Identity\n\n${employeeId}\n`);
    writeFileSync(join(employeeDir, 'ROLE.md'), `# Role\n\n${employeeId} role\n`);
    writeFileSync(join(employeeDir, 'RULES.md'), `# Rules\n\n${employeeId} rules\n`);
    writeFileSync(join(employeeDir, 'MEMORY.md'), `# Memory\n\n${employeeId} memory\n`);
    writeFileSync(join(employeeDir, 'PLAYBOOK.md'), `# Playbook\n\n${employeeId} playbook\n`);
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
              silentChannelIds: ['leadership'],
            },
          },
          'backend-dev': {
            seedPhrase: VALID_SEED,
            alias: 'Devon API',
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
            alias: 'Iva QA',
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

describe('company sim control plane state', () => {
  test('returns overview, docs, employees, channels, and provisioning summary', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-sim-control-state-'));
    try {
      const { manifestPath, companyDir } = writeCompanyFixture(root);
      const config = makeConfig(root, manifestPath, companyDir);

      const state = getCompanySimControlState({
        workspaceId: 'ws-1',
        workspaceName: 'Studio HQ',
        loadConfig: () => config,
      });

      expect(state.overview.companyId).toBe('software-studio');
      expect(state.overview.companyName).toBe('Software Studio');
      expect(state.overview.counts.employees).toBe(3);
      expect(state.overview.counts.teams).toBe(2);
      expect(state.overview.counts.channels).toBe(4);
      expect(state.overview.counts.docs).toBe(21);
      expect(state.docs.find((doc) => doc.relativePath === 'COMPANY.md')?.usedByEmployeeIds)
        .toEqual(['team-manager', 'backend-dev', 'tester']);
      expect(state.docs.find((doc) => doc.relativePath === 'teams/qa.md')?.usedByEmployeeIds)
        .toEqual(['tester']);
      expect(state.docs.find((doc) => doc.relativePath === 'employees/team-manager/ROLE.md')?.usedByEmployeeIds)
        .toEqual(['team-manager']);
      expect(state.channels.find((channel) => channel.name === 'leadership')?.mutedEmployeeIds)
        .toEqual(['team-manager']);
      expect(state.provisioning.configuredAccountIds).toEqual(['backend-dev', 'team-manager', 'tester']);
      expect(state.provisioning.onlineReadyAccountIds).toEqual(['backend-dev', 'team-manager', 'tester']);
      expect(state.provisioning.targetWorkspaceId).toBe('ws-1');
      expect(state.overview.sourceState).toBe('ready');
      expect(state.overview.generatedState).toBe('ready');
      expect(state.overview.liveState).toBe('ready');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('DecentChatNodePeer responds to company-sim-state-request for workspace admins', async () => {
    const root = mkdtempSync(join(tmpdir(), 'company-sim-control-state-peer-'));
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
          type: 'company-sim-state-request',
          requestId: 'req-state-1',
        },
      });

      const response = sent.find((entry) => entry.msg?.sync?.type === 'company-sim-state-response');
      expect(response?.peerId).toBe('owner-peer');
      expect(response?.msg?.sync?.ok).toBeTrue();
      expect(response?.msg?.sync?.result?.overview?.companyName).toBe('Software Studio');
      expect(response?.msg?.sync?.result?.employees?.length).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
