import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planCompanyAgentTopology } from '../../src/company-sim/agent-topology.ts';
import type { CompanyManifest } from '../../src/company-sim/types.ts';

describe('company agent topology planner', () => {
  test('derives per-employee agent topology, bindings, workspace, and local context source paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-topology-'));
    try {
      const companyDir = join(root, 'company-sims', 'software-studio');
      mkdirSync(join(companyDir, 'teams'), { recursive: true });
      mkdirSync(join(companyDir, 'employees', 'backend-dev'), { recursive: true });
      mkdirSync(join(companyDir, 'employees', 'tester'), { recursive: true });

      writeFileSync(join(companyDir, 'COMPANY.md'), '# Company\nStudio');
      writeFileSync(join(companyDir, 'ORG.md'), '# Org\nStructure');
      writeFileSync(join(companyDir, 'WORKFLOWS.md'), '# Workflows\nRules');
      writeFileSync(join(companyDir, 'teams', 'engineering.md'), '# Engineering\nTeam');

      const manifest: CompanyManifest = {
        id: 'software-studio',
        name: 'Software Studio',
        mode: 'company-sim',
        workspace: {
          name: 'Studio HQ',
          channels: ['general', 'engineering'],
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
            workspaceDir: 'agents/backend-dev',
            workspaceName: 'Backend Dev Workspace',
            bindings: [
              { channel: 'decentchat', accountId: 'backend-dev' },
              { channel: 'decentchat', accountId: 'backend-dev-alerts' },
            ],
            channels: ['engineering'],
            participation: { mode: 'specialist' },
          },
          {
            id: 'tester',
            agentId: 'software-studio-tester',
            accountId: 'tester',
            alias: 'Iva QA',
            teamId: 'engineering',
            title: 'QA Engineer',
            channels: ['engineering'],
            participation: { mode: 'specialist' },
          },
        ],
      };

      const manifestPath = join(companyDir, 'company.yaml');
      const topology = planCompanyAgentTopology({
        manifest,
        manifestPath,
        workspaceRootDir: root,
      });

      expect(topology.companyId).toBe('software-studio');
      expect(topology.agents).toHaveLength(2);

      const backend = topology.agents[0]!;
      expect(backend.employeeId).toBe('backend-dev');
      expect(backend.agentId).toBe('software-studio-backend-dev');
      expect(backend.accountId).toBe('backend-dev');
      expect(backend.workspace.name).toBe('Backend Dev Workspace');
      expect(backend.workspace.path).toBe(join(root, 'agents', 'backend-dev'));
      expect(backend.bindings.map((binding) => binding.tuple)).toEqual([
        ['decentchat:backend-dev', 'software-studio-backend-dev'],
        ['decentchat:backend-dev-alerts', 'software-studio-backend-dev'],
      ]);
      expect(backend.contextSources.company.companyMdPath).toBe(join(companyDir, 'COMPANY.md'));
      expect(backend.contextSources.company.orgMdPath).toBe(join(companyDir, 'ORG.md'));
      expect(backend.contextSources.company.workflowsMdPath).toBe(join(companyDir, 'WORKFLOWS.md'));
      expect(backend.contextSources.teamMdPath).toBe(join(companyDir, 'teams', 'engineering.md'));
      expect(backend.contextSources.employeeDirPath).toBe(join(companyDir, 'employees', 'backend-dev'));

      const tester = topology.agents[1]!;
      expect(tester.workspace.name).toBe('software-studio-tester');
      expect(tester.workspace.path).toBe(join(root, '.company-sim', 'workspaces', 'software-studio', 'software-studio-tester'));
      expect(tester.bindings.map((binding) => binding.tuple)).toEqual([
        ['decentchat:tester', 'software-studio-tester'],
      ]);
      expect(tester.contextSources.employeeDirPath).toBe(join(companyDir, 'employees', 'tester'));
      expect(tester.contextSources.teamMdPath).toBe(join(companyDir, 'teams', 'engineering.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
