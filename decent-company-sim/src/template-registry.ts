import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { CompanyTemplateMetadataSchema, type CompanyTemplateMetadata } from './template-types.ts';

const DEFAULT_TEMPLATES_ROOT = fileURLToPath(new URL('../../company-sims/templates', import.meta.url));

export interface CompanyTemplateRoleAssets {
  directoryPath: string;
  identityMdPath: string;
  roleMdPath: string;
  rulesMdPath: string;
}

export interface CompanyTemplateAssets {
  templateYamlPath: string;
  companyMdPath: string;
  orgMdPath: string;
  communicationMdPath: string;
  workflowsMdPath: string;
  teams: Record<string, string>;
  employees: Record<string, CompanyTemplateRoleAssets>;
}

export interface CompanySimTemplate extends CompanyTemplateMetadata {
  directoryPath: string;
  assets: CompanyTemplateAssets;
}

export interface CompanyTemplateRegistryOptions {
  templatesRoot?: string;
}

export function resolveCompanySimTemplatesRoot(options?: CompanyTemplateRegistryOptions): string {
  const root = options?.templatesRoot?.trim();
  return root ? resolve(root) : DEFAULT_TEMPLATES_ROOT;
}

function assertRequiredFile(templateId: string, filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required template asset for ${templateId}: ${filePath}`);
  }
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Template asset is not a file for ${templateId}: ${filePath}`);
  }
}

function readTemplateMetadata(templateDir: string): CompanyTemplateMetadata {
  const templateYamlPath = join(templateDir, 'template.yaml');
  assertRequiredFile(basename(templateDir), templateYamlPath);

  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(templateYamlPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse template.yaml in ${templateDir}: ${(error as Error).message}`);
  }

  return CompanyTemplateMetadataSchema.parse(parsed);
}

function buildTeamAssets(templateDir: string): Record<string, string> {
  const teamsDir = join(templateDir, 'teams');
  if (!existsSync(teamsDir) || !statSync(teamsDir).isDirectory()) return {};

  return Object.fromEntries(
    readdirSync(teamsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => [entry.name.replace(/\.md$/, ''), join(teamsDir, entry.name)]),
  );
}

function buildRoleAssets(templateId: string, templateDir: string, roleId: string): CompanyTemplateRoleAssets {
  const directoryPath = join(templateDir, 'employees', roleId);
  const identityMdPath = join(directoryPath, 'IDENTITY.md');
  const roleMdPath = join(directoryPath, 'ROLE.md');
  const rulesMdPath = join(directoryPath, 'RULES.md');

  assertRequiredFile(templateId, identityMdPath);
  assertRequiredFile(templateId, roleMdPath);
  assertRequiredFile(templateId, rulesMdPath);

  return {
    directoryPath,
    identityMdPath,
    roleMdPath,
    rulesMdPath,
  };
}

function loadTemplateFromDirectory(templateDir: string): CompanySimTemplate {
  const metadata = readTemplateMetadata(templateDir);
  const expectedId = basename(templateDir);
  if (metadata.id !== expectedId) {
    throw new Error(`Template directory id mismatch: expected ${expectedId}, got ${metadata.id}`);
  }

  const templateYamlPath = join(templateDir, 'template.yaml');
  const companyMdPath = join(templateDir, 'COMPANY.md');
  const orgMdPath = join(templateDir, 'ORG.md');
  const communicationMdPath = join(templateDir, 'COMMUNICATION.md');
  const workflowsMdPath = join(templateDir, 'WORKFLOWS.md');

  assertRequiredFile(metadata.id, companyMdPath);
  assertRequiredFile(metadata.id, orgMdPath);
  assertRequiredFile(metadata.id, communicationMdPath);
  assertRequiredFile(metadata.id, workflowsMdPath);

  const employees = Object.fromEntries(
    metadata.roles.map((role) => [role.id, buildRoleAssets(metadata.id, templateDir, role.id)]),
  );
  const teams = buildTeamAssets(templateDir);

  return {
    ...metadata,
    directoryPath: templateDir,
    assets: {
      templateYamlPath,
      companyMdPath,
      orgMdPath,
      communicationMdPath,
      workflowsMdPath,
      teams,
      employees,
    },
  };
}

export function listCompanySimTemplates(options?: CompanyTemplateRegistryOptions): CompanySimTemplate[] {
  const templatesRoot = resolveCompanySimTemplatesRoot(options);
  if (!existsSync(templatesRoot)) {
    throw new Error(`Template registry root does not exist: ${templatesRoot}`);
  }

  const directories = readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(templatesRoot, entry.name))
    .sort((a, b) => a.localeCompare(b));

  return directories.map((directoryPath) => loadTemplateFromDirectory(directoryPath));
}

export function getCompanySimTemplate(templateId: string, options?: CompanyTemplateRegistryOptions): CompanySimTemplate {
  const normalizedId = templateId.trim();
  if (!normalizedId) {
    throw new Error('Template id is required');
  }

  const templatesRoot = resolveCompanySimTemplatesRoot(options);
  const templateDir = join(templatesRoot, normalizedId);
  if (!existsSync(templateDir) || !statSync(templateDir).isDirectory()) {
    throw new Error(`Unknown company template: ${normalizedId}`);
  }

  return loadTemplateFromDirectory(templateDir);
}
