import { dirname, join, resolve } from 'node:path';
import type { CompanyEmployeeConfig, CompanyManifest } from './types.ts';

export interface CompanyAgentBindingPlan {
  channel: string;
  accountId: string;
  routeKey: string;
  tuple: [string, string];
}

export interface CompanyAgentContextSourcePaths {
  manifestPath: string;
  companyDirPath: string;
  company: {
    companyMdPath: string;
    orgMdPath: string;
    workflowsMdPath: string;
  };
  teamMdPath?: string;
  employeeDirPath: string;
  employee: {
    identityMdPath: string;
    roleMdPath: string;
    rulesMdPath: string;
    memoryMdPath: string;
    playbookMdPath: string;
  };
}

export interface CompanyAgentWorkspacePlan {
  employeeId: string;
  agentId: string;
  accountId: string;
  alias: string;
  title: string;
  managerEmployeeId?: string;
  reportsToHumanRole?: string;
  workspace: {
    name: string;
    path: string;
  };
  bindings: CompanyAgentBindingPlan[];
  contextSources: CompanyAgentContextSourcePaths;
}

export interface CompanyAgentTopologyPlan {
  companyId: string;
  manifestPath: string;
  companyDirPath: string;
  agents: CompanyAgentWorkspacePlan[];
}

export interface PlanCompanyAgentTopologyParams {
  manifest: CompanyManifest;
  manifestPath: string;
  workspaceRootDir?: string;
}

function toBindingPlans(employee: CompanyEmployeeConfig): CompanyAgentBindingPlan[] {
  const bindings = employee.bindings?.length
    ? employee.bindings
    : [{ channel: 'decentchat', accountId: employee.accountId }];

  return bindings.map((binding) => {
    const accountId = binding.accountId ?? employee.accountId;
    const routeKey = `${binding.channel}:${accountId}`;
    return {
      channel: binding.channel,
      accountId,
      routeKey,
      tuple: [routeKey, employee.agentId],
    };
  });
}

function resolveWorkspacePath(params: {
  employee: CompanyEmployeeConfig;
  workspaceRootDir: string;
  companyId: string;
}): string {
  const { employee, workspaceRootDir, companyId } = params;
  if (employee.workspaceDir) {
    return resolve(workspaceRootDir, employee.workspaceDir);
  }
  return resolve(workspaceRootDir, '.company-sim', 'workspaces', companyId, employee.agentId);
}

function buildContextSources(params: {
  employee: CompanyEmployeeConfig;
  manifestPath: string;
  companyDirPath: string;
}): CompanyAgentContextSourcePaths {
  const { employee, manifestPath, companyDirPath } = params;
  const employeeDirPath = join(companyDirPath, 'employees', employee.id);
  return {
    manifestPath,
    companyDirPath,
    company: {
      companyMdPath: join(companyDirPath, 'COMPANY.md'),
      orgMdPath: join(companyDirPath, 'ORG.md'),
      workflowsMdPath: join(companyDirPath, 'WORKFLOWS.md'),
    },
    teamMdPath: employee.teamId ? join(companyDirPath, 'teams', `${employee.teamId}.md`) : undefined,
    employeeDirPath,
    employee: {
      identityMdPath: join(employeeDirPath, 'IDENTITY.md'),
      roleMdPath: join(employeeDirPath, 'ROLE.md'),
      rulesMdPath: join(employeeDirPath, 'RULES.md'),
      memoryMdPath: join(employeeDirPath, 'MEMORY.md'),
      playbookMdPath: join(employeeDirPath, 'PLAYBOOK.md'),
    },
  };
}

export function planCompanyAgentTopology(params: PlanCompanyAgentTopologyParams): CompanyAgentTopologyPlan {
  const manifestPath = resolve(params.manifestPath);
  const companyDirPath = dirname(manifestPath);
  const workspaceRootDir = params.workspaceRootDir ? resolve(params.workspaceRootDir) : process.cwd();

  const agents: CompanyAgentWorkspacePlan[] = params.manifest.employees.map((employee) => ({
    employeeId: employee.id,
    agentId: employee.agentId,
    accountId: employee.accountId,
    alias: employee.alias,
    title: employee.title,
    managerEmployeeId: employee.managerEmployeeId,
    reportsToHumanRole: employee.reportsToHumanRole,
    workspace: {
      name: employee.workspaceName ?? employee.agentId,
      path: resolveWorkspacePath({
        employee,
        workspaceRootDir,
        companyId: params.manifest.id,
      }),
    },
    bindings: toBindingPlans(employee),
    contextSources: buildContextSources({
      employee,
      manifestPath,
      companyDirPath,
    }),
  }));

  return {
    companyId: params.manifest.id,
    manifestPath,
    companyDirPath,
    agents,
  };
}
