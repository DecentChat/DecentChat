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
  writeFileSync(join(root, 'COMPANY.md'), '# Company\nCompany doc');
  writeFileSync(join(root, 'ORG.md'), '# Org\nOrg doc');
  writeFileSync(join(root, 'COMMUNICATION.md'), '# Communication\nUse [TASK], [QUESTION], [BLOCKED], [HANDOFF], [DONE].');
  writeFileSync(join(root, 'WORKFLOWS.md'), '# Workflows\nWorkflow doc');
  writeFileSync(join(root, 'teams', 'engineering.md'), '# Team\nEngineering team doc');

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

describe('company context reload', () => {
  beforeEach(() => {
    resetCompanyPromptContextCacheForTests();
  });

  test('first message loads company + employee markdown in defined order', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-context-reload-'));
    try {
      const manifestPath = writeCompanyFixture(root);
      const resolved = resolveCompanyPromptContextForAccount(makeAccount(manifestPath, 'backend-dev'));

      expect(resolved).not.toBeNull();
      expect(resolved?.cacheHit).toBe(false);
      expect(resolved?.context.documents.map((doc) => doc.id)).toEqual([
        'company',
        'org',
        'communication',
        'workflows',
        'team',
        'identity',
        'role',
        'rules',
        'memory',
        'playbook',
      ]);

      const prompt = resolved?.prompt ?? '';
      expect(prompt.indexOf('## COMPANY')).toBeLessThan(prompt.indexOf('## ORG'));
      expect(prompt.indexOf('## ORG')).toBeLessThan(prompt.indexOf('## COMMUNICATION'));
      expect(prompt.indexOf('## COMMUNICATION')).toBeLessThan(prompt.indexOf('## WORKFLOWS'));
      expect(prompt.indexOf('## WORKFLOWS')).toBeLessThan(prompt.indexOf('## TEAM'));
      expect(prompt.indexOf('## TEAM')).toBeLessThan(prompt.indexOf('## IDENTITY'));
      expect(prompt.indexOf('## IDENTITY')).toBeLessThan(prompt.indexOf('## ROLE'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('touching one employee markdown file refreshes only that employee prompt context', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-context-reload-'));
    try {
      const manifestPath = writeCompanyFixture(root);
      const backendAccount = makeAccount(manifestPath, 'backend-dev');
      const testerAccount = makeAccount(manifestPath, 'tester');

      const backendFirst = resolveCompanyPromptContextForAccount(backendAccount);
      const testerFirst = resolveCompanyPromptContextForAccount(testerAccount);

      expect(backendFirst?.cacheHit).toBe(false);
      expect(testerFirst?.cacheHit).toBe(false);

      const backendRolePath = join(root, 'employees', 'backend-dev', 'ROLE.md');
      const backendRoleBefore = statSync(backendRolePath);
      utimesSync(
        backendRolePath,
        new Date(backendRoleBefore.atimeMs),
        new Date(backendRoleBefore.mtimeMs + 2000),
      );

      const backendAfterTouch = resolveCompanyPromptContextForAccount(backendAccount);
      const testerAfterTouch = resolveCompanyPromptContextForAccount(testerAccount);

      expect(backendAfterTouch?.cacheHit).toBe(false);
      expect(backendAfterTouch?.context).not.toBe(backendFirst?.context);
      expect(testerAfterTouch?.cacheHit).toBe(true);
      expect(testerAfterTouch?.context).toBe(testerFirst?.context);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
