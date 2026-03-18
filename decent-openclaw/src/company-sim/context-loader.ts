import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ResolvedDecentChatAccount } from '../types.ts';
import { getCompanyEmployeeById, getCompanyTeamById, parseCompanyManifestFile } from './manifest.ts';
import type { CompanyEmployeeConfig, CompanyManifest, CompanyTeamConfig } from './types.ts';

export type CompanyContextDocumentId =
  | 'company'
  | 'org'
  | 'workflows'
  | 'team'
  | 'identity'
  | 'role'
  | 'rules'
  | 'memory'
  | 'playbook';

export interface CompanyContextDocument {
  id: CompanyContextDocumentId;
  path: string;
  content: string;
}

export interface LoadedCompanyContext {
  manifestPath: string;
  companyDir: string;
  manifest: CompanyManifest;
  employee: CompanyEmployeeConfig;
  team?: CompanyTeamConfig;
  documents: CompanyContextDocument[];
}

function readRequiredFile(filePath: string): string {
  return readFileSync(filePath, 'utf8').trim();
}

function readOptionalFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  const content = readFileSync(filePath, 'utf8').trim();
  return content || undefined;
}

export function loadCompanyContextForAccount(account: ResolvedDecentChatAccount): LoadedCompanyContext | null {
  const sim = account.companySim;
  if (!sim?.enabled) return null;
  if (!sim.manifestPath) {
    throw new Error(`Company sim is enabled for account ${account.accountId} but companySim.manifestPath is missing`);
  }
  if (!sim.employeeId) {
    throw new Error(`Company sim is enabled for account ${account.accountId} but companySim.employeeId is missing`);
  }

  const manifest = parseCompanyManifestFile(sim.manifestPath);
  if (sim.companyId && manifest.id !== sim.companyId) {
    throw new Error(`Company manifest id mismatch for account ${account.accountId}: expected ${sim.companyId}, got ${manifest.id}`);
  }

  const employee = getCompanyEmployeeById(manifest, sim.employeeId);
  if (!employee) {
    throw new Error(`Unknown employee ${sim.employeeId} for company ${manifest.id}`);
  }

  const team = employee.teamId ? getCompanyTeamById(manifest, employee.teamId) : undefined;
  const companyDir = dirname(sim.manifestPath);
  const employeeDir = sim.roleFilesDir || join(companyDir, 'employees', employee.id);

  const documents: CompanyContextDocument[] = [
    { id: 'company', path: join(companyDir, 'COMPANY.md'), content: readRequiredFile(join(companyDir, 'COMPANY.md')) },
    { id: 'org', path: join(companyDir, 'ORG.md'), content: readRequiredFile(join(companyDir, 'ORG.md')) },
    { id: 'workflows', path: join(companyDir, 'WORKFLOWS.md'), content: readRequiredFile(join(companyDir, 'WORKFLOWS.md')) },
  ];

  if (team?.id) {
    const teamPath = join(companyDir, 'teams', `${team.id}.md`);
    const teamContent = readOptionalFile(teamPath);
    if (teamContent) {
      documents.push({ id: 'team', path: teamPath, content: teamContent });
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
    documents.push({ id, path: filePath, content: readRequiredFile(filePath) });
  }

  return {
    manifestPath: sim.manifestPath,
    companyDir,
    manifest,
    employee,
    team,
    documents,
  };
}
