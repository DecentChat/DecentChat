import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ResolvedDecentChatAccount } from '../types.ts';
import { getCompanyEmployeeById, getCompanyTeamById, parseCompanyManifestFile } from './manifest.ts';
import type { CompanyEmployeeConfig, CompanyManifest, CompanyTeamConfig } from './types.ts';

export type CompanyContextDocumentId =
  | 'company'
  | 'org'
  | 'communication'
  | 'workflows'
  | 'team'
  | 'identity'
  | 'role'
  | 'rules'
  | 'memory'
  | 'playbook';

export interface CompanyContextFileSnapshot {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface CompanyContextDocument {
  id: CompanyContextDocumentId;
  path: string;
  content: string;
  snapshot?: CompanyContextFileSnapshot;
}

export interface LoadedCompanyContext {
  manifestPath: string;
  companyDir: string;
  manifest: CompanyManifest;
  employee: CompanyEmployeeConfig;
  team?: CompanyTeamConfig;
  documents: CompanyContextDocument[];
  trackedFiles?: CompanyContextFileSnapshot[];
  versionToken?: string;
}

export interface LoadCompanyContextForAccountOptions {
  workspaceDir?: string;
}

function snapshotFile(filePath: string): CompanyContextFileSnapshot {
  const stats = statSync(filePath);
  return {
    path: filePath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

function readRequiredFile(filePath: string): { content: string; snapshot: CompanyContextFileSnapshot } {
  return {
    content: readFileSync(filePath, 'utf8').trim(),
    snapshot: snapshotFile(filePath),
  };
}

function readOptionalFile(filePath: string): { content: string; snapshot: CompanyContextFileSnapshot } | undefined {
  if (!existsSync(filePath)) return undefined;
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return undefined;
  return {
    content,
    snapshot: snapshotFile(filePath),
  };
}

function getCompanyEmployeeByAccountId(manifest: CompanyManifest, accountId: string): CompanyEmployeeConfig | undefined {
  return manifest.employees.find((employee) => employee.accountId === accountId);
}

function hasScaffoldedWorkspaceContext(workspaceDir: string): boolean {
  const requiredPaths = [
    join(workspaceDir, 'company', 'COMPANY.md'),
    join(workspaceDir, 'company', 'ORG.md'),
    join(workspaceDir, 'company', 'COMMUNICATION.md'),
    join(workspaceDir, 'company', 'WORKFLOWS.md'),
    join(workspaceDir, 'employee', 'IDENTITY.md'),
    join(workspaceDir, 'employee', 'ROLE.md'),
    join(workspaceDir, 'employee', 'RULES.md'),
    join(workspaceDir, 'employee', 'MEMORY.md'),
    join(workspaceDir, 'employee', 'PLAYBOOK.md'),
  ];
  return requiredPaths.every((filePath) => existsSync(filePath));
}

function resolveContextDirs(params: {
  manifestPath: string;
  employeeId: string;
  roleFilesDir?: string;
  workspaceDir?: string;
}): { companyDir: string; employeeDir: string } {
  const workspaceDir = params.workspaceDir?.trim();
  if (workspaceDir && hasScaffoldedWorkspaceContext(workspaceDir)) {
    return {
      companyDir: join(workspaceDir, 'company'),
      employeeDir: join(workspaceDir, 'employee'),
    };
  }

  const companyDir = dirname(params.manifestPath);
  return {
    companyDir,
    employeeDir: params.roleFilesDir || join(companyDir, 'employees', params.employeeId),
  };
}

export function createCompanyContextVersionToken(files: CompanyContextFileSnapshot[]): string {
  return files
    .map((file) => `${file.path}:${file.mtimeMs}:${file.size}`)
    .join('|');
}

export function readCompanyContextFileSnapshots(paths: string[]): CompanyContextFileSnapshot[] {
  return paths.map((filePath) => snapshotFile(filePath));
}

export function buildCompanyContextTrackedPaths(context: Pick<LoadedCompanyContext, 'manifestPath' | 'documents'>): string[] {
  return [context.manifestPath, ...context.documents.map((doc) => doc.path)];
}

export function loadCompanyContextForAccount(
  account: ResolvedDecentChatAccount,
  options?: LoadCompanyContextForAccountOptions,
): LoadedCompanyContext | null {
  const sim = account.companySim;
  if (!sim?.enabled) return null;
  if (!sim.manifestPath) {
    throw new Error(`Company sim is enabled for account ${account.accountId} but companySim.manifestPath is missing`);
  }

  const manifest = parseCompanyManifestFile(sim.manifestPath);
  if (sim.companyId && manifest.id !== sim.companyId) {
    throw new Error(`Company manifest id mismatch for account ${account.accountId}: expected ${sim.companyId}, got ${manifest.id}`);
  }

  const employeeFromAccount = getCompanyEmployeeByAccountId(manifest, account.accountId);
  const employeeFromConfig = sim.employeeId ? getCompanyEmployeeById(manifest, sim.employeeId) : undefined;
  const employee = employeeFromAccount ?? employeeFromConfig;
  if (!employee) {
    throw new Error(
      `Unknown employee for account ${account.accountId} in company ${manifest.id}`
      + (sim.employeeId ? ` (configured employeeId=${sim.employeeId})` : ''),
    );
  }

  const team = employee.teamId ? getCompanyTeamById(manifest, employee.teamId) : undefined;
  const { companyDir, employeeDir } = resolveContextDirs({
    manifestPath: sim.manifestPath,
    employeeId: employee.id,
    roleFilesDir: sim.roleFilesDir,
    workspaceDir: options?.workspaceDir,
  });

  const companyDoc = readRequiredFile(join(companyDir, 'COMPANY.md'));
  const orgDoc = readRequiredFile(join(companyDir, 'ORG.md'));
  const communicationDoc = readRequiredFile(join(companyDir, 'COMMUNICATION.md'));
  const workflowsDoc = readRequiredFile(join(companyDir, 'WORKFLOWS.md'));

  const documents: CompanyContextDocument[] = [
    { id: 'company', path: join(companyDir, 'COMPANY.md'), content: companyDoc.content, snapshot: companyDoc.snapshot },
    { id: 'org', path: join(companyDir, 'ORG.md'), content: orgDoc.content, snapshot: orgDoc.snapshot },
    { id: 'communication', path: join(companyDir, 'COMMUNICATION.md'), content: communicationDoc.content, snapshot: communicationDoc.snapshot },
    { id: 'workflows', path: join(companyDir, 'WORKFLOWS.md'), content: workflowsDoc.content, snapshot: workflowsDoc.snapshot },
  ];

  if (team?.id) {
    const teamPath = join(companyDir, 'teams', `${team.id}.md`);
    const teamDoc = readOptionalFile(teamPath);
    if (teamDoc) {
      documents.push({ id: 'team', path: teamPath, content: teamDoc.content, snapshot: teamDoc.snapshot });
    }
  }

  const employeeDocs: Array<[CompanyContextDocumentId, string]> = [
    ['identity', join(employeeDir, 'IDENTITY.md')],
    ['role', join(employeeDir, 'ROLE.md')],
    ['rules', join(employeeDir, 'RULES.md')],
    ['memory', join(employeeDir, 'MEMORY.md')],
    ['playbook', join(employeeDir, 'PLAYBOOK.md')],
  ];

  for (const [id, filePath] of employeeDocs) {
    const doc = readRequiredFile(filePath);
    documents.push({ id, path: filePath, content: doc.content, snapshot: doc.snapshot });
  }

  const trackedFiles = [
    snapshotFile(sim.manifestPath),
    ...documents.map((doc) => doc.snapshot).filter((snapshot): snapshot is CompanyContextFileSnapshot => Boolean(snapshot)),
  ];

  return {
    manifestPath: sim.manifestPath,
    companyDir,
    manifest,
    employee,
    team,
    documents,
    trackedFiles,
    versionToken: createCompanyContextVersionToken(trackedFiles),
  };
}
