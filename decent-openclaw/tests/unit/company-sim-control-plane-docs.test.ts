import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';
import { readCompanySimControlDocument, writeCompanySimControlDocument } from '@decentchat/company-sim';

const VALID_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function writeCompanyFixture(root: string) {
  const companyDir = join(root, 'company-sims', 'software-studio');
  mkdirSync(join(companyDir, 'teams'), { recursive: true });
  mkdirSync(join(companyDir, 'employees', 'team-manager'), { recursive: true });

  writeFileSync(join(companyDir, 'company.yaml'), `id: software-studio
name: Software Studio
mode: company-sim
workspace:
  name: Studio HQ
  channels:
    - general
teams:
  - id: engineering
    name: Engineering
    managerEmployeeId: team-manager
employees:
  - id: team-manager
    agentId: software-studio-team-manager
    accountId: team-manager
    alias: Mira PM
    teamId: engineering
    title: Team Manager
    channels: [general]
    participation:
      mode: summary-first
      respondWhenMentioned: true
`);

  writeFileSync(join(companyDir, 'COMPANY.md'), '# Software Studio\n');
  writeFileSync(join(companyDir, 'COMMUNICATION.md'), '# Communication\n');
  writeFileSync(join(companyDir, 'ORG.md'), '# Org\n');
  writeFileSync(join(companyDir, 'WORKFLOWS.md'), '# Workflows\n');
  writeFileSync(join(companyDir, 'teams', 'engineering.md'), '# Engineering\n');
  for (const file of ['IDENTITY.md', 'ROLE.md', 'RULES.md', 'MEMORY.md', 'PLAYBOOK.md']) {
    writeFileSync(join(companyDir, 'employees', 'team-manager', file), `# ${file}\n`);
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

describe('company sim control plane docs', () => {
  test('reads and writes approved markdown docs only', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-sim-control-docs-'));
    try {
      const { manifestPath, companyDir } = writeCompanyFixture(root);
      const config = makeConfig(root, manifestPath, companyDir);

      const doc = readCompanySimControlDocument({
        workspaceId: 'ws-1',
        relativePath: 'COMPANY.md',
        loadConfig: () => config,
      });
      expect(doc.content).toContain('Software Studio');

      const updated = writeCompanySimControlDocument({
        workspaceId: 'ws-1',
        relativePath: 'teams/engineering.md',
        content: '# Engineering\n\nUpdated from control plane.\n',
        loadConfig: () => config,
      });
      expect(updated.content).toContain('Updated from control plane');
      expect(readFileSync(join(companyDir, 'teams', 'engineering.md'), 'utf8')).toContain('Updated from control plane');

      expect(() => writeCompanySimControlDocument({
        workspaceId: 'ws-1',
        relativePath: '../escape.md',
        content: 'nope',
        loadConfig: () => config,
      })).toThrow(/unknown company sim doc/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('DecentChatNodePeer proxies doc read/write requests and rejects unknown paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'company-sim-control-docs-peer-'));
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
          type: 'company-sim-doc-read-request',
          requestId: 'read-1',
          relativePath: 'COMPANY.md',
        },
      });

      await (peer as any).handlePeerMessage('owner-peer', {
        type: 'workspace-sync',
        workspaceId: 'ws-1',
        sync: {
          type: 'company-sim-doc-write-request',
          requestId: 'write-1',
          relativePath: 'COMPANY.md',
          content: '# Software Studio\n\nEdited.\n',
        },
      });

      await (peer as any).handlePeerMessage('owner-peer', {
        type: 'workspace-sync',
        workspaceId: 'ws-1',
        sync: {
          type: 'company-sim-doc-read-request',
          requestId: 'read-escape',
          relativePath: '../escape.md',
        },
      });

      const readResponse = sent.find((entry) => entry.msg?.sync?.type === 'company-sim-doc-read-response' && entry.msg?.sync?.requestId === 'read-1');
      const writeResponse = sent.find((entry) => entry.msg?.sync?.type === 'company-sim-doc-write-response' && entry.msg?.sync?.requestId === 'write-1');
      const badReadResponse = sent.find((entry) => entry.msg?.sync?.type === 'company-sim-doc-read-response' && entry.msg?.sync?.requestId === 'read-escape');

      expect(readResponse?.msg?.sync?.ok).toBeTrue();
      expect(readResponse?.msg?.sync?.result?.content).toContain('Software Studio');
      expect(writeResponse?.msg?.sync?.ok).toBeTrue();
      expect(readFileSync(join(companyDir, 'COMPANY.md'), 'utf8')).toContain('Edited.');
      expect(badReadResponse?.msg?.sync?.ok).toBeFalse();
      expect(badReadResponse?.msg?.sync?.error?.code).toBe('bad_request');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
