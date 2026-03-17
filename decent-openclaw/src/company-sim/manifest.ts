import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type {
  CompanyEmployeeConfig,
  CompanyManifest,
  CompanyParticipationConfig,
  CompanyTeamConfig,
} from './types.ts';

const CompanyParticipationSchema = z.object({
  mode: z.enum([
    'summary-first',
    'specialist',
    'mention-only',
    'silent-unless-routed',
    'proactive-on-owned-channel',
  ]),
  respondWhenMentioned: z.boolean().optional(),
  replyInThreadsOnly: z.boolean().optional(),
  respondToChannelTopics: z.array(z.string().min(1)).optional(),
}) satisfies z.ZodType<CompanyParticipationConfig>;

const CompanyWorkspaceSchema = z.object({
  name: z.string().min(1),
  channels: z.array(z.string().min(1)).min(1),
});

const CompanyTeamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  managerEmployeeId: z.string().min(1).optional(),
}) satisfies z.ZodType<CompanyTeamConfig>;

const CompanyEmployeeSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  alias: z.string().min(1),
  teamId: z.string().min(1).optional(),
  title: z.string().min(1),
  managerEmployeeId: z.string().min(1).optional(),
  reportsToHumanRole: z.string().min(1).optional(),
  channels: z.array(z.string().min(1)).min(1),
  participation: CompanyParticipationSchema,
}) satisfies z.ZodType<CompanyEmployeeConfig>;

const CompanyManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mode: z.literal('company-sim'),
  workspace: CompanyWorkspaceSchema,
  teams: z.array(CompanyTeamSchema),
  employees: z.array(CompanyEmployeeSchema),
}) satisfies z.ZodType<CompanyManifest>;

function assertUniqueIds(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label} id: ${value}`);
    }
    seen.add(value);
  }
}

function validateManifestReferences(manifest: CompanyManifest): CompanyManifest {
  assertUniqueIds(manifest.teams.map((team) => team.id), 'team');
  assertUniqueIds(manifest.employees.map((employee) => employee.id), 'employee');
  assertUniqueIds(manifest.employees.map((employee) => employee.accountId), 'employee account');

  const teamIds = new Set(manifest.teams.map((team) => team.id));
  const employeeIds = new Set(manifest.employees.map((employee) => employee.id));
  const workspaceChannels = new Set(manifest.workspace.channels);

  for (const team of manifest.teams) {
    if (team.managerEmployeeId && !employeeIds.has(team.managerEmployeeId)) {
      throw new Error(`Unknown manager employee reference in team ${team.id}: ${team.managerEmployeeId}`);
    }
  }

  for (const employee of manifest.employees) {
    if (employee.teamId && !teamIds.has(employee.teamId)) {
      throw new Error(`Unknown team reference in employee ${employee.id}: ${employee.teamId}`);
    }
    if (employee.managerEmployeeId && !employeeIds.has(employee.managerEmployeeId)) {
      throw new Error(`Unknown manager employee reference in employee ${employee.id}: ${employee.managerEmployeeId}`);
    }
    for (const channel of employee.channels) {
      if (!workspaceChannels.has(channel)) {
        throw new Error(`Unknown workspace channel reference in employee ${employee.id}: ${channel}`);
      }
    }
  }

  return manifest;
}

export function parseCompanyManifestText(text: string): CompanyManifest {
  const raw = parseYaml(text);
  const manifest = CompanyManifestSchema.parse(raw);
  return validateManifestReferences(manifest);
}

export function parseCompanyManifestFile(filePath: string): CompanyManifest {
  return parseCompanyManifestText(readFileSync(filePath, 'utf8'));
}

export function getCompanyTeamById(manifest: CompanyManifest, teamId: string): CompanyTeamConfig | undefined {
  return manifest.teams.find((team) => team.id === teamId);
}

export function getCompanyEmployeeById(manifest: CompanyManifest, employeeId: string): CompanyEmployeeConfig | undefined {
  return manifest.employees.find((employee) => employee.id === employeeId);
}
