import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCompanySimTemplate,
  listCompanySimTemplates,
} from '@decentchat/company-sim';

const bundledTemplatesRoot = fileURLToPath(new URL('../../../company-sims/templates', import.meta.url));

describe('company template registry', () => {
  test('lists available templates and parses software-studio metadata', () => {
    const templates = listCompanySimTemplates({ templatesRoot: bundledTemplatesRoot });

    expect(templates.map((template) => template.id)).toContain('software-studio');

    const softwareStudio = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });
    expect(softwareStudio.label).toBe('Software Studio');
    expect(softwareStudio.description).toContain('backend');
    expect(softwareStudio.icon).toBe('🛠️');

    expect(softwareStudio.roles.map((role) => role.id)).toEqual(['manager', 'backend', 'qa']);
    expect(softwareStudio.questions.map((question) => question.id)).toEqual([
      'companyName',
      'workspaceName',
      'managerAlias',
      'backendAlias',
      'qaAlias',
      'communicationPolicy',
    ]);
    expect(softwareStudio.policyProfiles.strict?.roleParticipation?.backend).toEqual({
      mode: 'silent-unless-routed',
      replyInThreadsOnly: true,
    });
    expect(softwareStudio.defaults).toEqual({
      companyName: 'Software Studio',
      workspaceName: 'Studio HQ',
      channels: ['general', 'engineering', 'qa', 'leadership'],
      questionAnswers: {
        managerAlias: 'Mira PM',
        backendAlias: 'Rian Backend',
        qaAlias: 'Iva QA',
        communicationPolicy: 'disciplined',
      },
    });

    expect(softwareStudio.assets.companyMdPath.endsWith('/company-sims/templates/software-studio/COMPANY.md')).toBeTrue();
    expect(softwareStudio.assets.communicationMdPath.endsWith('/company-sims/templates/software-studio/COMMUNICATION.md')).toBeTrue();
    expect(softwareStudio.assets.teams.engineering.endsWith('/company-sims/templates/software-studio/teams/engineering.md')).toBeTrue();
    expect(softwareStudio.assets.teams.qa.endsWith('/company-sims/templates/software-studio/teams/qa.md')).toBeTrue();
    expect(softwareStudio.assets.employees.manager.roleMdPath.endsWith('/company-sims/templates/software-studio/employees/manager/ROLE.md')).toBeTrue();
  });

  test('rejects invalid metadata in template yaml', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-template-invalid-'));
    try {
      const brokenTemplateDir = join(root, 'broken-template');
      mkdirSync(join(brokenTemplateDir, 'employees', 'manager'), { recursive: true });

      writeFileSync(join(brokenTemplateDir, 'template.yaml'), `
label: Missing ID
icon: ⚠️
roles:
  - id: manager
    label: Manager
    description: manager role
actions: []
questions: []
defaults:
  companyName: Broken Co
  workspaceName: Broken HQ
  channels: [general]
`);
      writeFileSync(join(brokenTemplateDir, 'COMPANY.md'), '# Broken Co');
      writeFileSync(join(brokenTemplateDir, 'ORG.md'), '# Org');
      writeFileSync(join(brokenTemplateDir, 'COMMUNICATION.md'), '# Communication');
      writeFileSync(join(brokenTemplateDir, 'WORKFLOWS.md'), '# Workflows');
      writeFileSync(join(brokenTemplateDir, 'employees', 'manager', 'IDENTITY.md'), '# Identity');
      writeFileSync(join(brokenTemplateDir, 'employees', 'manager', 'ROLE.md'), '# Role');
      writeFileSync(join(brokenTemplateDir, 'employees', 'manager', 'RULES.md'), '# Rules');

      expect(() => listCompanySimTemplates({ templatesRoot: root })).toThrow(/id/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects template missing required role assets', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-template-assets-'));
    try {
      const brokenTemplateDir = join(root, 'broken-template');
      mkdirSync(join(brokenTemplateDir, 'employees', 'manager'), { recursive: true });

      writeFileSync(join(brokenTemplateDir, 'template.yaml'), `
id: broken-template
label: Broken Template
description: Template with missing assets.
icon: ⚠️
roles:
  - id: manager
    label: Manager
    description: Coordinates work
questions: []
defaults:
  companyName: Broken Co
  workspaceName: Broken HQ
  channels: [general]
`);
      writeFileSync(join(brokenTemplateDir, 'COMPANY.md'), '# Broken Co');
      writeFileSync(join(brokenTemplateDir, 'ORG.md'), '# Org');
      writeFileSync(join(brokenTemplateDir, 'COMMUNICATION.md'), '# Communication');
      writeFileSync(join(brokenTemplateDir, 'WORKFLOWS.md'), '# Workflows');
      writeFileSync(join(brokenTemplateDir, 'employees', 'manager', 'IDENTITY.md'), '# Identity');
      writeFileSync(join(brokenTemplateDir, 'employees', 'manager', 'ROLE.md'), '# Role');
      // RULES.md intentionally missing

      expect(() => listCompanySimTemplates({ templatesRoot: root })).toThrow(/missing required template asset/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
