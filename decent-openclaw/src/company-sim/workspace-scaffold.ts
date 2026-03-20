import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { CompanyAgentTopologyPlan, CompanyAgentWorkspacePlan } from './agent-topology.ts';

export interface CompanyAgentWorkspaceScaffoldResult {
  agentId: string;
  workspacePath: string;
  files: string[];
}

function writeFileTracked(filePath: string, content: string, written: string[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  written.push(filePath);
}

function copyFileTracked(sourcePath: string, targetPath: string, written: string[]): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  written.push(targetPath);
}

function buildAgentsMd(plan: CompanyAgentWorkspacePlan): string {
  return [
    '# AGENTS.md',
    '',
    `- Agent ID: ${plan.agentId}`,
    `- Employee ID: ${plan.employeeId}`,
    `- DecentChat account: ${plan.accountId}`,
    '',
    'Load these local context files first:',
    '- company/COMPANY.md',
    '- company/ORG.md',
    '- company/COMMUNICATION.md',
    '- company/WORKFLOWS.md',
    '- employee/IDENTITY.md',
    '- employee/ROLE.md',
    '- employee/RULES.md',
    '- employee/MEMORY.md',
    '- employee/PLAYBOOK.md',
  ].join('\n');
}

function buildSoulMd(plan: CompanyAgentWorkspacePlan): string {
  return [
    '# SOUL.md',
    '',
    `You are ${plan.alias}.`,
    `Title: ${plan.title}`,
    'Stay in-role and collaborate as part of the company simulation.',
  ].join('\n');
}

function buildUserMd(plan: CompanyAgentWorkspacePlan): string {
  const manager = plan.managerEmployeeId ?? 'unassigned';
  const reportsTo = plan.reportsToHumanRole ?? manager;
  return [
    '# USER.md',
    '',
    `- Employee: ${plan.alias}`,
    `- Role: ${plan.title}`,
    `- Reports to: ${reportsTo}`,
    `- Account: ${plan.accountId}`,
  ].join('\n');
}

function readRequired(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

export function scaffoldCompanyAgentWorkspace(plan: CompanyAgentWorkspacePlan): CompanyAgentWorkspaceScaffoldResult {
  const written: string[] = [];
  const workspacePath = plan.workspace.path;
  mkdirSync(workspacePath, { recursive: true });

  const identity = readRequired(plan.contextSources.employee.identityMdPath);
  writeFileTracked(join(workspacePath, 'IDENTITY.md'), identity, written);
  writeFileTracked(join(workspacePath, 'AGENTS.md'), buildAgentsMd(plan), written);
  writeFileTracked(join(workspacePath, 'SOUL.md'), buildSoulMd(plan), written);
  writeFileTracked(join(workspacePath, 'USER.md'), buildUserMd(plan), written);

  copyFileTracked(plan.contextSources.company.companyMdPath, join(workspacePath, 'company', 'COMPANY.md'), written);
  copyFileTracked(plan.contextSources.company.orgMdPath, join(workspacePath, 'company', 'ORG.md'), written);
  copyFileTracked(plan.contextSources.company.communicationMdPath, join(workspacePath, 'company', 'COMMUNICATION.md'), written);
  copyFileTracked(plan.contextSources.company.workflowsMdPath, join(workspacePath, 'company', 'WORKFLOWS.md'), written);

  if (plan.contextSources.teamMdPath && existsSync(plan.contextSources.teamMdPath)) {
    copyFileTracked(
      plan.contextSources.teamMdPath,
      join(workspacePath, 'company', 'teams', basename(plan.contextSources.teamMdPath)),
      written,
    );
  }

  copyFileTracked(plan.contextSources.employee.identityMdPath, join(workspacePath, 'employee', 'IDENTITY.md'), written);
  copyFileTracked(plan.contextSources.employee.roleMdPath, join(workspacePath, 'employee', 'ROLE.md'), written);
  copyFileTracked(plan.contextSources.employee.rulesMdPath, join(workspacePath, 'employee', 'RULES.md'), written);
  copyFileTracked(plan.contextSources.employee.memoryMdPath, join(workspacePath, 'employee', 'MEMORY.md'), written);
  copyFileTracked(plan.contextSources.employee.playbookMdPath, join(workspacePath, 'employee', 'PLAYBOOK.md'), written);

  return {
    agentId: plan.agentId,
    workspacePath,
    files: written,
  };
}

export function scaffoldCompanyAgentWorkspaces(topology: CompanyAgentTopologyPlan): CompanyAgentWorkspaceScaffoldResult[] {
  return topology.agents.map((agent) => scaffoldCompanyAgentWorkspace(agent));
}
