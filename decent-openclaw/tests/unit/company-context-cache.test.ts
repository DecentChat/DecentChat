import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  writeFileSync(join(root, 'COMPANY.md'), '# Company\nCompany doc');
  writeFileSync(join(root, 'ORG.md'), '# Org\nOrg doc');
  writeFileSync(join(root, 'COMMUNICATION.md'), '# Communication\nUse [TASK], [QUESTION], [BLOCKED], [HANDOFF], [DONE].');
  writeFileSync(join(root, 'WORKFLOWS.md'), '# Workflows\nWorkflow doc');
  writeFileSync(join(root, 'teams', 'engineering.md'), '# Team\nEngineering team doc');

  writeFileSync(join(root, 'employees', 'backend-dev', 'IDENTITY.md'), '# Identity\nbackend identity');
  writeFileSync(join(root, 'employees', 'backend-dev', 'ROLE.md'), '# Role\nbackend v1 role');
  writeFileSync(join(root, 'employees', 'backend-dev', 'RULES.md'), '# Rules\nbackend rules');
  writeFileSync(join(root, 'employees', 'backend-dev', 'MEMORY.md'), '# Memory\nbackend memory');
  writeFileSync(join(root, 'employees', 'backend-dev', 'PLAYBOOK.md'), '# Playbook\nbackend playbook');

  writeFileSync(join(root, 'employees', 'tester', 'IDENTITY.md'), '# Identity\ntester identity');
  writeFileSync(join(root, 'employees', 'tester', 'ROLE.md'), '# Role\ntester v1 role');
  writeFileSync(join(root, 'employees', 'tester', 'RULES.md'), '# Rules\ntester rules');
  writeFileSync(join(root, 'employees', 'tester', 'MEMORY.md'), '# Memory\ntester memory');
  writeFileSync(join(root, 'employees', 'tester', 'PLAYBOOK.md'), '# Playbook\ntester playbook');

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

describe('company context cache', () => {
  beforeEach(() => {
    resetCompanyPromptContextCacheForTests();
  });

  test('reuses cached context on subsequent messages when files are unchanged', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-context-cache-'));
    try {
      const manifestPath = writeCompanyFixture(root);
      const account = makeAccount(manifestPath, 'backend-dev');

      const first = resolveCompanyPromptContextForAccount(account);
      const second = resolveCompanyPromptContextForAccount(account);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first?.cacheHit).toBe(false);
      expect(second?.cacheHit).toBe(true);
      expect(second?.context).toBe(first?.context);
      expect(second?.prompt).toBe(first?.prompt);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('employee A reload does not contaminate employee B cache entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-context-cache-'));
    try {
      const manifestPath = writeCompanyFixture(root);
      const backendAccount = makeAccount(manifestPath, 'backend-dev');
      const testerAccount = makeAccount(manifestPath, 'tester');

      const backendFirst = resolveCompanyPromptContextForAccount(backendAccount);
      const testerFirst = resolveCompanyPromptContextForAccount(testerAccount);

      expect(backendFirst?.prompt).toContain('backend v1 role');
      expect(testerFirst?.prompt).toContain('tester v1 role');

      writeFileSync(join(root, 'employees', 'backend-dev', 'ROLE.md'), '# Role\nbackend v2 role');

      const backendAfterEdit = resolveCompanyPromptContextForAccount(backendAccount);
      const testerAfterEdit = resolveCompanyPromptContextForAccount(testerAccount);

      expect(backendAfterEdit?.cacheHit).toBe(false);
      expect(backendAfterEdit?.prompt).toContain('backend v2 role');

      expect(testerAfterEdit?.cacheHit).toBe(true);
      expect(testerAfterEdit?.prompt).toContain('tester v1 role');
      expect(testerAfterEdit?.prompt).not.toContain('backend v2 role');
      expect(testerAfterEdit?.context).toBe(testerFirst?.context);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
