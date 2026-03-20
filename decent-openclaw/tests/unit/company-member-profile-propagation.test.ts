import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeXenaPeer } from '../../src/peer/NodeXenaPeer.ts';
import type { ResolvedDecentChatAccount } from '../../src/types.ts';

function makeAccount(root: string): ResolvedDecentChatAccount {
  const manifestPath = join(root, 'company.yaml');
  mkdirSync(join(root, 'employees', 'backend-dev'), { recursive: true });
  writeFileSync(manifestPath, `
id: software-studio
name: Software Studio
mode: company-sim
workspace:
  name: Studio HQ
  channels: [general, engineering]
teams:
  - id: engineering
    name: Engineering
employees:
  - id: backend-dev
    accountId: backend-dev
    agentId: software-studio-backend-dev
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    channels: [engineering]
    participation:
      mode: specialist
`);
  writeFileSync(join(root, 'COMPANY.md'), 'company');
  writeFileSync(join(root, 'ORG.md'), 'org');
  writeFileSync(join(root, 'COMMUNICATION.md'), 'communication');
  writeFileSync(join(root, 'WORKFLOWS.md'), 'workflows');
  for (const name of ['IDENTITY.md', 'ROLE.md', 'RULES.md', 'MEMORY.md', 'PLAYBOOK.md']) {
    writeFileSync(join(root, 'employees', 'backend-dev', name), name);
  }

  return {
    accountId: 'backend-dev',
    enabled: true,
    dmPolicy: 'open',
    configured: true,
    seedPhrase: 'seed seed seed seed seed seed seed seed seed seed seed seed',
    signalingServer: 'https://example.test',
    invites: [],
    alias: 'Rian Backend',
    streamEnabled: true,
    replyToMode: 'all',
    replyToModeByChatType: {},
    thread: { historyScope: 'thread', inheritParent: false, initialHistoryLimit: 20 },
    companySim: {
      enabled: true,
      manifestPath,
      companyId: 'software-studio',
      employeeId: 'backend-dev',
    },
  };
}

describe('company member profile propagation', () => {
  test('peer derives its own company profile from manifest-backed account context', () => {
    const root = join(tmpdir(), `company-peer-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    try {
      const peer = Object.create(NodeXenaPeer.prototype) as any;
      peer.opts = { account: makeAccount(root), log: { warn() {} } };
      const profile = NodeXenaPeer.prototype['getMyCompanySimProfile'].call(peer);
      expect(profile).toEqual({
        automationKind: 'openclaw-agent',
        roleTitle: 'Backend Engineer',
        teamId: 'engineering',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
