import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resetCompanyPromptContextCacheForTests,
  resolveCompanyPromptContextForAccount,
} from '../../src/company-sim/prompt-context.ts';
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
    agentId: software-studio-backend-dev
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    channels: [engineering]
    participation:
      mode: specialist
  - id: tester
    accountId: tester
    agentId: software-studio-tester
    alias: Iva QA
    teamId: engineering
    title: QA Engineer
    channels: [qa]
    participation:
      mode: specialist
`);

  writeFileSync(join(root, 'COMPANY.md'), '# Company\nCanonical company doc');
  writeFileSync(join(root, 'ORG.md'), '# Org\nCanonical org doc');
  writeFileSync(join(root, 'WORKFLOWS.md'), '# Workflows\nCanonical workflows doc');
  writeFileSync(join(root, 'teams', 'engineering.md'), '# Team\nCanonical engineering team doc');

  writeFileSync(join(root, 'employees', 'backend-dev', 'IDENTITY.md'), '# Identity\nCanonical backend identity');
  writeFileSync(join(root, 'employees', 'backend-dev', 'ROLE.md'), '# Role\nCanonical backend role');
  writeFileSync(join(root, 'employees', 'backend-dev', 'RULES.md'), '# Rules\nCanonical backend rules');
  writeFileSync(join(root, 'employees', 'backend-dev', 'MEMORY.md'), '# Memory\nCanonical backend memory');
  writeFileSync(join(root, 'employees', 'backend-dev', 'PLAYBOOK.md'), '# Playbook\nCanonical backend playbook');

  writeFileSync(join(root, 'employees', 'tester', 'IDENTITY.md'), '# Identity\nCanonical tester identity');
  writeFileSync(join(root, 'employees', 'tester', 'ROLE.md'), '# Role\nCanonical tester role');
  writeFileSync(join(root, 'employees', 'tester', 'RULES.md'), '# Rules\nCanonical tester rules');
  writeFileSync(join(root, 'employees', 'tester', 'MEMORY.md'), '# Memory\nCanonical tester memory');
  writeFileSync(join(root, 'employees', 'tester', 'PLAYBOOK.md'), '# Playbook\nCanonical tester playbook');

  return join(root, 'company.yaml');
}

function writeScaffoldedWorkspace(root: string, marker: string): string {
  mkdirSync(join(root, 'company', 'teams'), { recursive: true });
  mkdirSync(join(root, 'employee'), { recursive: true });

  writeFileSync(join(root, 'company', 'COMPANY.md'), `# Company\n${marker} company doc`);
  writeFileSync(join(root, 'company', 'ORG.md'), `# Org\n${marker} org doc`);
  writeFileSync(join(root, 'company', 'WORKFLOWS.md'), `# Workflows\n${marker} workflows doc`);
  writeFileSync(join(root, 'company', 'teams', 'engineering.md'), `# Team\n${marker} team doc`);

  writeFileSync(join(root, 'employee', 'IDENTITY.md'), `# Identity\n${marker} identity`);
  writeFileSync(join(root, 'employee', 'ROLE.md'), `# Role\n${marker} role v1`);
  writeFileSync(join(root, 'employee', 'RULES.md'), `# Rules\n${marker} rules`);
  writeFileSync(join(root, 'employee', 'MEMORY.md'), `# Memory\n${marker} memory`);
  writeFileSync(join(root, 'employee', 'PLAYBOOK.md'), `# Playbook\n${marker} playbook`);

  return root;
}

function makeAccount(params: {
  manifestPath: string;
  accountId: string;
  employeeId?: string;
}): ResolvedDecentChatAccount {
  return {
    accountId: params.accountId,
    enabled: true,
    dmPolicy: 'open',
    configured: true,
    seedPhrase: 'seed',
    signalingServer: 'https://example.test',
    invites: [],
    alias: params.accountId,
    streamEnabled: true,
    replyToMode: 'all',
    replyToModeByChatType: {},
    thread: { historyScope: 'thread', inheritParent: false, initialHistoryLimit: 20 },
    companySim: {
      enabled: true,
      manifestPath: params.manifestPath,
      companyId: 'software-studio',
      employeeId: params.employeeId,
    },
  };
}

describe('company agent-local context resolution', () => {
  beforeEach(() => {
    resetCompanyPromptContextCacheForTests();
  });

  test('employee agent resolves scaffolded workspace context without per-account employee config', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-agent-context-'));
    try {
      const manifestPath = writeCompanyFixture(join(root, 'company-sim'));
      const backendWorkspace = writeScaffoldedWorkspace(join(root, 'workspaces', 'backend-dev'), 'backend workspace');
      const testerWorkspace = writeScaffoldedWorkspace(join(root, 'workspaces', 'tester'), 'tester workspace');

      const backend = resolveCompanyPromptContextForAccount(
        makeAccount({ manifestPath, accountId: 'backend-dev' }),
        { workspaceDir: backendWorkspace },
      );
      const tester = resolveCompanyPromptContextForAccount(
        makeAccount({ manifestPath, accountId: 'tester' }),
        { workspaceDir: testerWorkspace },
      );

      expect(backend).not.toBeNull();
      expect(tester).not.toBeNull();

      expect(backend?.prompt).toContain('backend workspace role v1');
      expect(backend?.prompt).not.toContain('Canonical backend role');
      expect(tester?.prompt).toContain('tester workspace role v1');
      expect(tester?.prompt).not.toContain('Canonical tester role');

      expect(backend?.context.documents.find((doc) => doc.id === 'role')?.path).toBe(join(backendWorkspace, 'employee', 'ROLE.md'));
      expect(tester?.context.documents.find((doc) => doc.id === 'role')?.path).toBe(join(testerWorkspace, 'employee', 'ROLE.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('cache and reload remain isolated per agent workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-agent-context-'));
    try {
      const manifestPath = writeCompanyFixture(join(root, 'company-sim'));
      const backendWorkspace = writeScaffoldedWorkspace(join(root, 'workspaces', 'backend-dev'), 'backend workspace');
      const testerWorkspace = writeScaffoldedWorkspace(join(root, 'workspaces', 'tester'), 'tester workspace');

      const backendAccount = makeAccount({ manifestPath, accountId: 'backend-dev', employeeId: 'backend-dev' });
      const testerAccount = makeAccount({ manifestPath, accountId: 'tester', employeeId: 'tester' });

      const backendFirst = resolveCompanyPromptContextForAccount(backendAccount, { workspaceDir: backendWorkspace });
      const testerFirst = resolveCompanyPromptContextForAccount(testerAccount, { workspaceDir: testerWorkspace });
      expect(backendFirst?.cacheHit).toBe(false);
      expect(testerFirst?.cacheHit).toBe(false);

      const backendRolePath = join(backendWorkspace, 'employee', 'ROLE.md');
      writeFileSync(backendRolePath, '# Role\nbackend workspace role v2');
      const before = statSync(backendRolePath);
      utimesSync(backendRolePath, new Date(before.atimeMs), new Date(before.mtimeMs + 2000));

      const backendAfterEdit = resolveCompanyPromptContextForAccount(backendAccount, { workspaceDir: backendWorkspace });
      const testerAfterEdit = resolveCompanyPromptContextForAccount(testerAccount, { workspaceDir: testerWorkspace });

      expect(backendAfterEdit?.cacheHit).toBe(false);
      expect(backendAfterEdit?.prompt).toContain('backend workspace role v2');

      expect(testerAfterEdit?.cacheHit).toBe(true);
      expect(testerAfterEdit?.prompt).toContain('tester workspace role v1');
      expect(testerAfterEdit?.prompt).not.toContain('backend workspace role v2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('shared default employeeId cannot leak one agent workspace into another', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-agent-context-'));
    try {
      const manifestPath = writeCompanyFixture(join(root, 'company-sim'));
      const backendWorkspace = writeScaffoldedWorkspace(join(root, 'workspaces', 'backend-dev'), 'backend workspace');
      const testerWorkspace = writeScaffoldedWorkspace(join(root, 'workspaces', 'tester'), 'tester workspace');

      const backendAccount = makeAccount({ manifestPath, accountId: 'backend-dev', employeeId: 'backend-dev' });
      const testerAccount = makeAccount({
        manifestPath,
        accountId: 'tester',
        employeeId: 'backend-dev',
      });

      const backend = resolveCompanyPromptContextForAccount(backendAccount, { workspaceDir: backendWorkspace });
      const tester = resolveCompanyPromptContextForAccount(testerAccount, { workspaceDir: testerWorkspace });

      expect(backend?.context.employee.id).toBe('backend-dev');
      expect(tester?.context.employee.id).toBe('tester');
      expect(tester?.prompt).toContain('tester workspace role v1');
      expect(tester?.prompt).not.toContain('backend workspace role v1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
