import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planCompanyAgentTopology } from '../../src/company-sim/agent-topology.ts';
import { scaffoldCompanyAgentWorkspaces } from '../../src/company-sim/workspace-scaffold.ts';
import type { CompanyManifest } from '../../src/company-sim/types.ts';

describe('company workspace scaffold', () => {
  test('materializes per-agent workspace with identity/core files and copied company + employee markdown', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-scaffold-'));
    try {
      const companyDir = join(root, 'company-sims', 'software-studio');
      const employeeDir = join(companyDir, 'employees', 'backend-dev');
      mkdirSync(join(companyDir, 'teams'), { recursive: true });
      mkdirSync(employeeDir, { recursive: true });

      writeFileSync(join(companyDir, 'COMPANY.md'), '# Company\nSoftware Studio mission.');
      writeFileSync(join(companyDir, 'ORG.md'), '# Org\nEngineering org chart.');
      writeFileSync(join(companyDir, 'COMMUNICATION.md'), '# Communication\nUse concise task-state tags.');
      writeFileSync(join(companyDir, 'WORKFLOWS.md'), '# Workflows\nDaily standup + sprint.');
      writeFileSync(join(companyDir, 'teams', 'engineering.md'), '# Engineering Team\nOwn backend APIs.');

      writeFileSync(join(employeeDir, 'IDENTITY.md'), '# Identity\nRian Backend');
      writeFileSync(join(employeeDir, 'ROLE.md'), '# Role\nBackend Engineer');
      writeFileSync(join(employeeDir, 'RULES.md'), '# Rules\nNo breaking changes.');
      writeFileSync(join(employeeDir, 'MEMORY.md'), '# Memory\nRecent release notes.');
      writeFileSync(join(employeeDir, 'PLAYBOOK.md'), '# Playbook\nIncident response checklist.');

      const manifest: CompanyManifest = {
        id: 'software-studio',
        name: 'Software Studio',
        mode: 'company-sim',
        workspace: {
          name: 'Studio HQ',
          channels: ['engineering'],
        },
        teams: [
          { id: 'engineering', name: 'Engineering', managerEmployeeId: 'team-manager' },
        ],
        employees: [
          {
            id: 'backend-dev',
            agentId: 'software-studio-backend-dev',
            accountId: 'backend-dev',
            alias: 'Rian Backend',
            teamId: 'engineering',
            title: 'Backend Engineer',
            managerEmployeeId: 'team-manager',
            channels: ['engineering'],
            participation: { mode: 'specialist' },
          },
        ],
      };

      const topology = planCompanyAgentTopology({
        manifest,
        manifestPath: join(companyDir, 'company.yaml'),
        workspaceRootDir: root,
      });

      const scaffoldResult = scaffoldCompanyAgentWorkspaces(topology);
      expect(scaffoldResult).toHaveLength(1);

      const workspacePath = topology.agents[0]!.workspace.path;
      expect(existsSync(join(workspacePath, 'IDENTITY.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'AGENTS.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'SOUL.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'USER.md'))).toBeTrue();

      expect(existsSync(join(workspacePath, 'company', 'COMPANY.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'company', 'ORG.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'company', 'COMMUNICATION.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'company', 'WORKFLOWS.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'company', 'teams', 'engineering.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'employee', 'ROLE.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'employee', 'RULES.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'employee', 'MEMORY.md'))).toBeTrue();
      expect(existsSync(join(workspacePath, 'employee', 'PLAYBOOK.md'))).toBeTrue();

      expect(readFileSync(join(workspacePath, 'IDENTITY.md'), 'utf8')).toContain('Rian Backend');
      expect(readFileSync(join(workspacePath, 'company', 'COMPANY.md'), 'utf8')).toContain('Software Studio mission');
      expect(readFileSync(join(workspacePath, 'employee', 'ROLE.md'), 'utf8')).toContain('Backend Engineer');
      expect(readFileSync(join(workspacePath, 'AGENTS.md'), 'utf8')).toContain('company/COMPANY.md');
      expect(readFileSync(join(workspacePath, 'AGENTS.md'), 'utf8')).toContain('company/COMMUNICATION.md');
      expect(readFileSync(join(workspacePath, 'SOUL.md'), 'utf8')).toContain('Backend Engineer');
      expect(readFileSync(join(workspacePath, 'USER.md'), 'utf8')).toContain('team-manager');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
