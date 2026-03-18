import { describe, expect, test } from 'bun:test';

import { buildCompanyPromptContext } from '../../src/company-sim/prompt-context.ts';
import type { LoadedCompanyContext } from '../../src/company-sim/context-loader.ts';

const context: LoadedCompanyContext = {
  manifestPath: '/tmp/company.yaml',
  companyDir: '/tmp/company',
  manifest: {
    id: 'software-studio',
    name: 'Software Studio',
    mode: 'company-sim',
    workspace: { name: 'Studio HQ', channels: ['general'] },
    teams: [{ id: 'engineering', name: 'Engineering', managerEmployeeId: 'team-manager' }],
    employees: [],
  },
  employee: {
    id: 'backend-dev',
    accountId: 'backend-dev',
    alias: 'Rian Backend',
    teamId: 'engineering',
    title: 'Backend Engineer',
    channels: ['engineering'],
    participation: { mode: 'specialist' },
  },
  team: {
    id: 'engineering',
    name: 'Engineering',
    managerEmployeeId: 'team-manager',
  },
  documents: [
    { id: 'company', path: '/tmp/company/COMPANY.md', content: 'Company doc' },
    { id: 'org', path: '/tmp/company/ORG.md', content: 'Org doc' },
    { id: 'workflows', path: '/tmp/company/WORKFLOWS.md', content: 'Workflow doc' },
    { id: 'identity', path: '/tmp/company/employees/backend-dev/IDENTITY.md', content: 'Identity doc' },
    { id: 'role', path: '/tmp/company/employees/backend-dev/ROLE.md', content: 'Role doc' },
  ],
};

describe('company prompt context', () => {
  test('builds trusted prompt context with employee/company metadata and ordered docs', () => {
    const prompt = buildCompanyPromptContext(context);

    expect(prompt).toContain('[LOCAL COMPANY ROLE CONTEXT');
    expect(prompt).toContain('Company: Software Studio (software-studio)');
    expect(prompt).toContain('Employee: Rian Backend (backend-dev)');
    expect(prompt).toContain('Title: Backend Engineer');
    expect(prompt).toContain('Team: Engineering (engineering)');

    const companyIdx = prompt.indexOf('## COMPANY');
    const orgIdx = prompt.indexOf('## ORG');
    const workflowsIdx = prompt.indexOf('## WORKFLOWS');
    const identityIdx = prompt.indexOf('## IDENTITY');
    const roleIdx = prompt.indexOf('## ROLE');

    expect(companyIdx).toBeGreaterThan(-1);
    expect(companyIdx).toBeLessThan(orgIdx);
    expect(orgIdx).toBeLessThan(workflowsIdx);
    expect(workflowsIdx).toBeLessThan(identityIdx);
    expect(identityIdx).toBeLessThan(roleIdx);
  });
});
