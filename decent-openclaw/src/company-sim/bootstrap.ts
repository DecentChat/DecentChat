import type { ResolvedDecentChatAccount } from '../types.ts';
import { parseCompanyManifestFile } from './manifest.ts';

export interface CompanyBootstrapEmployee {
  employeeId: string;
  accountId: string;
  alias: string;
  title: string;
  teamId?: string;
  channels: string[];
  account: ResolvedDecentChatAccount;
}

export interface CompanyBootstrapPlan {
  companyId: string;
  companyName: string;
  workspaceName: string;
  channels: string[];
  employees: CompanyBootstrapEmployee[];
}

export function buildCompanyBootstrapPlan(params: {
  manifestPath: string;
  resolveAccount: (accountId: string) => ResolvedDecentChatAccount;
}): CompanyBootstrapPlan {
  const manifest = parseCompanyManifestFile(params.manifestPath);

  const employees = manifest.employees.map((employee) => {
    const account = params.resolveAccount(employee.accountId);
    if (!account.configured) {
      throw new Error(`Company bootstrap requires configured account for employee ${employee.id} (${employee.accountId})`);
    }
    return {
      employeeId: employee.id,
      accountId: employee.accountId,
      alias: employee.alias,
      title: employee.title,
      teamId: employee.teamId,
      channels: employee.channels,
      account,
    };
  });

  return {
    companyId: manifest.id,
    companyName: manifest.name,
    workspaceName: manifest.workspace.name,
    channels: manifest.workspace.channels,
    employees,
  };
}
