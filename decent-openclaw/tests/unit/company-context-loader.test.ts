import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadCompanyContextForAccount } from '../../src/company-sim/context-loader.ts';
import type { ResolvedDecentChatAccount } from '../../src/types.ts';

function writeCompanyFixture(root: string): string {
  mkdirSync(join(root, 'teams'), { recursive: true });
  mkdirSync(join(root, 'employees', 'backend-dev'), { recursive: true });
  mkdirSync(join(root, 'employees', 'tester'), { recursive: true });

  writeFileSync(join(root, 'company.yaml'), `
id: software-studio
name: Software Studio
mode: company-sim
workspace:
  name: Studio HQ
  channels: [general, engineering, qa]
teams:
  - id: engineering
    name: Engineering
employees:
  - id: backend-dev
    accountId: backend-dev
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    channels: [engineering]
    participation:
      mode: specialist
  - id: tester
    accountId: tester
    alias: Iva QA
    teamId: engineering
    title: QA Engineer
    channels: [qa]
    participation:
      mode: specialist
`);
  writeFileSync(join(root, 'COMPANY.md'), '# Company\nCompany doc');
  writeFileSync(join(root, 'ORG.md'), '# Org\nOrg doc');
  writeFileSync(join(root, 'WORKFLOWS.md'), '# Workflows\nWorkflow doc');
  writeFileSync(join(root, 'teams', 'engineering.md'), '# Engineering\nTeam doc');

  for (const employee of ['backend-dev', 'tester']) {
    writeFileSync(join(root, 'employees', employee, 'IDENTITY.md'), `# Identity\n${employee} identity`);
    writeFileSync(join(root, 'employees', employee, 'ROLE.md'), `# Role\n${employee} role`);
    writeFileSync(join(root, 'employees', employee, 'RULES.md'), `# Rules\n${employee} rules`);
    writeFileSync(join(root, 'employees', employee, 'MEMORY.md'), `# Memory\n${employee} memory`);
    writeFileSync(join(root, 'employees', employee, 'PLAYBOOK.md'), `# Playbook\n${employee} playbook`);
  }

  return join(root, 'company.yaml');
}

function makeAccount(manifestPath: string, employeeId: string): ResolvedDecentChatAccount {
  return {
    accountId: employeeId,
    enabled: true,
    dmPolicy: 'open',
    configured: true,
    seedPhrase: 'seed',
    signalingServer: 'https://example.test',
    invites: [],
    alias: employeeId,
    streamEnabled: true,
    replyToMode: 'all',
    replyToModeByChatType: {},
    thread: { historyScope: 'thread', inheritParent: false, initialHistoryLimit: 20 },
    companySim: {
      enabled: true,
      manifestPath,
      companyId: 'software-studio',
      employeeId,
    },
  };
}

describe('company context loader', () => {
  test('loads markdown files in the expected order', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-loader-'));
    try {
      const manifestPath = writeCompanyFixture(root);
      const context = loadCompanyContextForAccount(makeAccount(manifestPath, 'backend-dev'));
      expect(context?.documents.map((doc) => doc.id)).toEqual([
        'company',
        'org',
        'workflows',
        'team',
        'identity',
        'role',
        'rules',
        'memory',
        'playbook',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('loads employee-specific files without leaking another employee context', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-loader-'));
    try {
      const manifestPath = writeCompanyFixture(root);
      const backend = loadCompanyContextForAccount(makeAccount(manifestPath, 'backend-dev'));
      const tester = loadCompanyContextForAccount(makeAccount(manifestPath, 'tester'));

      expect(backend?.employee.alias).toBe('Rian Backend');
      expect(tester?.employee.alias).toBe('Iva QA');
      expect(backend?.documents.find((doc) => doc.id === 'role')?.content).toContain('backend-dev role');
      expect(backend?.documents.find((doc) => doc.id === 'role')?.content).not.toContain('tester role');
      expect(tester?.documents.find((doc) => doc.id === 'role')?.content).toContain('tester role');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
