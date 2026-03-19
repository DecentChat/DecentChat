import type { CompanyManifest, CompanyParticipationConfig } from './types.ts';
import type {
  CompanyTemplateMetadata,
  CompanyTemplateQuestionValue,
  CompanyTemplateRoleDefinition,
} from './template-types.ts';

export interface CompanyTemplateRoleSelection {
  addRoleIds?: string[];
  removeRoleIds?: string[];
}

export interface CompanyTemplateRoleOverrides {
  alias?: string;
  title?: string;
  teamId?: string;
  managerRoleId?: string;
  channels?: string[];
  participation?: Partial<CompanyParticipationConfig>;
}

export interface CompileCompanyTemplateParams {
  template: CompanyTemplateMetadata;
  answers?: Record<string, CompanyTemplateQuestionValue>;
  roleSelection?: CompanyTemplateRoleSelection;
  roleOverrides?: Record<string, CompanyTemplateRoleOverrides>;
  companyId?: string;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function humanizeId(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => {
      if (segment.length <= 3) {
        return segment.toUpperCase();
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

function resolveAnswers(params: CompileCompanyTemplateParams): Record<string, CompanyTemplateQuestionValue> {
  const resolved: Record<string, CompanyTemplateQuestionValue> = {};

  for (const question of params.template.questions) {
    if (question.default !== undefined) {
      resolved[question.id] = question.default;
    }
  }

  Object.assign(resolved, params.template.defaults.questionAnswers);

  if (params.answers) {
    Object.assign(resolved, params.answers);
  }

  return resolved;
}

function stringAnswer(
  answers: Record<string, CompanyTemplateQuestionValue>,
  key: string,
): string | undefined {
  const value = answers[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function assertKnownRoles(params: {
  roleIds: string[];
  knownRoleIds: Set<string>;
  action: 'add' | 'remove';
}): void {
  const unknownRoleIds = uniqueStrings(params.roleIds).filter((roleId) => !params.knownRoleIds.has(roleId));
  if (unknownRoleIds.length > 0) {
    throw new Error(`Cannot ${params.action} unknown role ids: ${unknownRoleIds.join(', ')}`);
  }
}

function selectRoles(params: CompileCompanyTemplateParams): CompanyTemplateRoleDefinition[] {
  const knownRoleIds = new Set(params.template.roles.map((role) => role.id));
  const selectedRoleIds = new Set(
    params.template.roles
      .filter((role) => role.defaultEnabled !== false)
      .map((role) => role.id),
  );

  const removeRoleIds = uniqueStrings(params.roleSelection?.removeRoleIds ?? []);
  const addRoleIds = uniqueStrings(params.roleSelection?.addRoleIds ?? []);

  assertKnownRoles({ roleIds: removeRoleIds, knownRoleIds, action: 'remove' });
  assertKnownRoles({ roleIds: addRoleIds, knownRoleIds, action: 'add' });

  for (const roleId of removeRoleIds) {
    selectedRoleIds.delete(roleId);
  }
  for (const roleId of addRoleIds) {
    selectedRoleIds.add(roleId);
  }

  const selectedRoles = params.template.roles.filter((role) => selectedRoleIds.has(role.id));
  if (selectedRoles.length === 0) {
    throw new Error(`Template ${params.template.id} must enable at least one role`);
  }
  return selectedRoles;
}

function resolveParticipation(params: {
  role: CompanyTemplateRoleDefinition;
  override?: CompanyTemplateRoleOverrides;
}): CompanyParticipationConfig {
  const baseParticipation: CompanyParticipationConfig = params.role.participation ?? { mode: 'mention-only' };
  if (!params.override?.participation) {
    return baseParticipation;
  }

  return {
    ...baseParticipation,
    ...params.override.participation,
  } as CompanyParticipationConfig;
}

export function compileCompanyTemplateToManifest(params: CompileCompanyTemplateParams): CompanyManifest {
  const answers = resolveAnswers(params);
  const selectedRoles = selectRoles(params);

  const manifestId = slugify(params.companyId?.trim() || params.template.id);
  if (!manifestId) {
    throw new Error('Company manifest id is required');
  }

  const companyName =
    stringAnswer(answers, 'companyName')
    ?? params.template.defaults.companyName;
  const workspaceName =
    stringAnswer(answers, 'workspaceName')
    ?? params.template.defaults.workspaceName;

  const roleToEmployeeId = new Map<string, string>();
  for (const role of selectedRoles) {
    roleToEmployeeId.set(role.id, slugify(role.id));
  }

  const employees = selectedRoles.map((role) => {
    const override = params.roleOverrides?.[role.id];
    const employeeId = roleToEmployeeId.get(role.id)!;
    const channels = uniqueStrings((override?.channels ?? role.channels ?? params.template.defaults.channels) as string[]);

    const alias =
      override?.alias?.trim()
      || stringAnswer(answers, `${role.id}Alias`)
      || role.defaultAlias
      || role.label;

    return {
      roleId: role.id,
      role,
      managerRoleId: (override?.managerRoleId ?? role.managerRoleId)?.trim(),
      teamId: (override?.teamId ?? role.teamId)?.trim(),
      employee: {
        id: employeeId,
        agentId: `${manifestId}-${employeeId}`,
        accountId: employeeId,
        alias,
        teamId: (override?.teamId ?? role.teamId)?.trim() || undefined,
        title: override?.title?.trim() || role.title || role.label,
        channels,
        participation: resolveParticipation({ role, override }),
      },
    };
  });

  const allEmployeeIds = new Set(employees.map((entry) => entry.employee.id));
  const workspaceChannels = uniqueStrings([
    ...params.template.defaults.channels,
    ...employees.flatMap((entry) => entry.employee.channels),
  ]);

  const employeeRecords = employees.map((entry) => {
    const managerRoleId = entry.managerRoleId;
    if (!managerRoleId) {
      return entry.employee;
    }

    const managerEmployeeId = roleToEmployeeId.get(managerRoleId);
    if (!managerEmployeeId || !allEmployeeIds.has(managerEmployeeId)) {
      throw new Error(`Selected roles for template ${params.template.id} do not include manager role: ${managerRoleId}`);
    }

    return {
      ...entry.employee,
      managerEmployeeId,
    };
  });

  const teamOrder = uniqueStrings(
    employeeRecords
      .map((employee) => employee.teamId)
      .filter((teamId): teamId is string => !!teamId),
  );

  const teams = teamOrder.map((teamId) => {
    const teamEmployees = employeeRecords.filter((employee) => employee.teamId === teamId);
    const teamEmployeeIds = new Set(teamEmployees.map((employee) => employee.id));

    const managerEmployee = teamEmployees.find((employee) => {
      if (!employee.managerEmployeeId) return true;
      return !teamEmployeeIds.has(employee.managerEmployeeId);
    }) ?? teamEmployees[0];

    return {
      id: teamId,
      name: humanizeId(teamId),
      managerEmployeeId: managerEmployee?.id,
    };
  });

  return {
    id: manifestId,
    name: companyName,
    mode: 'company-sim',
    workspace: {
      name: workspaceName,
      channels: workspaceChannels,
    },
    teams,
    employees: employeeRecords,
  };
}
