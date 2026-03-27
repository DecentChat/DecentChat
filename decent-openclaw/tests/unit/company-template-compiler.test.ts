import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { compileCompanyTemplateToManifest, getCompanySimTemplate } from '@decentchat/company-sim';
import type { CompanyTemplateMetadata } from '@decentchat/company-sim';

const bundledTemplatesRoot = fileURLToPath(new URL('../../../company-sims/templates', import.meta.url));

function assertManifestReferences(manifest: ReturnType<typeof compileCompanyTemplateToManifest>): void {
  const employeeIds = new Set(manifest.employees.map((employee) => employee.id));
  const workspaceChannels = new Set(manifest.workspace.channels);

  for (const team of manifest.teams) {
    if (team.managerEmployeeId) {
      expect(employeeIds.has(team.managerEmployeeId)).toBeTrue();
    }
  }

  for (const employee of manifest.employees) {
    if (employee.managerEmployeeId) {
      expect(employeeIds.has(employee.managerEmployeeId)).toBeTrue();
    }
    for (const channel of employee.channels) {
      expect(workspaceChannels.has(channel)).toBeTrue();
    }
  }
}

describe('company template compiler', () => {
  test('compiles selected template + answers into a valid internal company manifest', () => {
    const template = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });

    const manifest = compileCompanyTemplateToManifest({
      template,
      answers: {
        companyName: 'Acme Platform',
        workspaceName: 'Acme HQ',
        backendAlias: 'Devon API',
      },
    });

    expect(manifest).toMatchObject({
      id: 'software-studio',
      name: 'Acme Platform',
      mode: 'company-sim',
      workspace: {
        name: 'Acme HQ',
        channels: ['general', 'engineering', 'qa', 'leadership'],
      },
    });
    expect(manifest.employees.map((employee) => employee.id)).toEqual(['manager', 'backend', 'qa']);
    assertManifestReferences(manifest);
  });

  test('generates deterministic employee ids, accounts, aliases, and channels', () => {
    const template = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });

    const first = compileCompanyTemplateToManifest({
      template,
      answers: {
        backendAlias: 'Devon API',
      },
    });
    const second = compileCompanyTemplateToManifest({
      template,
      answers: {
        backendAlias: 'Devon API',
      },
    });

    expect(second).toEqual(first);
    expect(first.employees.map((employee) => ({
      id: employee.id,
      agentId: employee.agentId,
      accountId: employee.accountId,
      alias: employee.alias,
      channels: employee.channels,
    }))).toEqual([
      {
        id: 'manager',
        agentId: 'software-studio-manager',
        accountId: 'manager',
        alias: 'Mira PM',
        channels: ['general', 'engineering', 'leadership'],
      },
      {
        id: 'backend',
        agentId: 'software-studio-backend',
        accountId: 'backend',
        alias: 'Devon API',
        channels: ['engineering'],
      },
      {
        id: 'qa',
        agentId: 'software-studio-qa',
        accountId: 'qa',
        alias: 'Iva QA',
        channels: ['qa', 'engineering'],
      },
    ]);
  });

  test('allows optional role removal/addition within template role limits', () => {
    const template: CompanyTemplateMetadata = {
      id: 'custom-team',
      label: 'Custom Team',
      description: 'Custom template for role-selection checks.',
      icon: '🧪',
      roles: [
        {
          id: 'lead',
          label: 'Lead',
          description: 'Leads the team',
          title: 'Team Lead',
          defaultAlias: 'Lena Lead',
          teamId: 'core',
          channels: ['general', 'core'],
          participation: {
            mode: 'summary-first',
            respondWhenMentioned: true,
          },
          defaultEnabled: true,
        },
        {
          id: 'designer',
          label: 'Designer',
          description: 'Design role',
          title: 'Product Designer',
          defaultAlias: 'Dara Design',
          teamId: 'core',
          managerRoleId: 'lead',
          channels: ['core'],
          participation: {
            mode: 'specialist',
            respondWhenMentioned: true,
            replyInThreadsOnly: true,
          },
          defaultEnabled: true,
        },
        {
          id: 'intern',
          label: 'Intern',
          description: 'Optional intern role',
          title: 'Engineering Intern',
          defaultAlias: 'Ivan Intern',
          teamId: 'core',
          managerRoleId: 'lead',
          channels: ['general'],
          participation: {
            mode: 'mention-only',
            respondWhenMentioned: true,
          },
          defaultEnabled: false,
        },
      ],
      questions: [],
      defaults: {
        companyName: 'Custom Team',
        workspaceName: 'Custom HQ',
        channels: ['general', 'core'],
        questionAnswers: {},
      },
    };

    const manifest = compileCompanyTemplateToManifest({
      template,
      roleSelection: {
        removeRoleIds: ['designer'],
        addRoleIds: ['intern'],
      },
    });

    expect(manifest.employees.map((employee) => employee.id)).toEqual(['lead', 'intern']);
    expect(() => compileCompanyTemplateToManifest({
      template,
      roleSelection: {
        addRoleIds: ['ghost-role'],
      },
    })).toThrow(/unknown role/i);
  });

  test('applies selected communication policy profile from the template', () => {
    const template = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });

    const manifest = compileCompanyTemplateToManifest({
      template,
      answers: {
        communicationPolicy: 'strict',
      },
    });

    const manager = manifest.employees.find((employee) => employee.id === 'manager');
    const backend = manifest.employees.find((employee) => employee.id === 'backend');
    const qa = manifest.employees.find((employee) => employee.id === 'qa');

    expect(manager?.participation).toEqual({
      mode: 'summary-first',
      respondWhenMentioned: true,
      respondToChannelTopics: ['planning', 'priorities', 'blockers', 'status'],
    });
    expect(backend?.participation).toEqual({
      mode: 'silent-unless-routed',
      respondWhenMentioned: true,
      replyInThreadsOnly: true,
    });
    expect(qa?.participation).toEqual({
      mode: 'silent-unless-routed',
      respondWhenMentioned: true,
      replyInThreadsOnly: true,
    });
  });

  test('preserves template participation defaults unless explicitly overridden', () => {
    const template = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });

    const manifest = compileCompanyTemplateToManifest({
      template,
      roleOverrides: {
        backend: {
          participation: {
            replyInThreadsOnly: false,
          },
        },
      },
    });

    const manager = manifest.employees.find((employee) => employee.id === 'manager');
    const backend = manifest.employees.find((employee) => employee.id === 'backend');

    expect(manager?.participation).toEqual({
      mode: 'summary-first',
      respondWhenMentioned: true,
      respondToChannelTopics: ['planning', 'priorities', 'blockers', 'status'],
    });
    expect(backend?.participation).toEqual({
      mode: 'specialist',
      respondWhenMentioned: true,
      replyInThreadsOnly: false,
    });
  });
});
