import type {
  CompanyTemplateDefinition,
  CompanyTemplateInstallPreview,
  CompanyTemplateRoleDefinition,
} from '../../ui/types';

const softwareStudioRoles: CompanyTemplateRoleDefinition[] = [
  {
    id: 'manager',
    title: 'Team Manager',
    teamId: 'engineering',
    defaultAlias: 'Mira PM',
    aliasQuestionId: 'managerAlias',
  },
  {
    id: 'backend',
    title: 'Backend Engineer',
    teamId: 'engineering',
    defaultAlias: 'Devon API',
    aliasQuestionId: 'backendAlias',
    managerRoleId: 'manager',
  },
  {
    id: 'qa',
    title: 'QA Specialist',
    teamId: 'qa',
    defaultAlias: 'Iva QA',
    aliasQuestionId: 'qaAlias',
    managerRoleId: 'manager',
  },
];

export const SOFTWARE_STUDIO_TEMPLATE: CompanyTemplateDefinition = {
  id: 'software-studio',
  label: 'Software Studio',
  description: 'A focused product delivery pod with manager, backend engineer, and QA specialist.',
  icon: '🧪',
  channels: ['general', 'engineering', 'qa', 'leadership'],
  roles: softwareStudioRoles,
  questions: [
    {
      id: 'companyName',
      label: 'Company name',
      required: true,
      placeholder: 'Acme Platform',
      defaultValue: 'Acme Platform',
      description: 'Displayed in installer summaries and generated company metadata.',
    },
    {
      id: 'workspaceName',
      label: 'Workspace name',
      required: true,
      placeholder: 'Acme HQ',
      defaultValue: 'Acme HQ',
      description: 'Workspace label visible to all team members in DecentChat.',
    },
    {
      id: 'managerAlias',
      label: 'Manager alias',
      required: true,
      placeholder: 'Mira PM',
      defaultValue: 'Mira PM',
    },
    {
      id: 'backendAlias',
      label: 'Backend alias',
      required: true,
      placeholder: 'Devon API',
      defaultValue: 'Devon API',
    },
    {
      id: 'qaAlias',
      label: 'QA alias',
      required: true,
      placeholder: 'Iva QA',
      defaultValue: 'Iva QA',
    },
  ],
};

const COMPANY_TEMPLATE_CATALOG: CompanyTemplateDefinition[] = [SOFTWARE_STUDIO_TEMPLATE];

export function listLocalCompanyTemplates(): CompanyTemplateDefinition[] {
  return COMPANY_TEMPLATE_CATALOG.map((template) => ({
    ...template,
    roles: template.roles.map((role) => ({ ...role })),
    channels: [...template.channels],
    questions: template.questions.map((question) => ({ ...question })),
  }));
}

export function getLocalCompanyTemplate(templateId: string): CompanyTemplateDefinition | null {
  const found = COMPANY_TEMPLATE_CATALOG.find((template) => template.id === templateId);
  if (!found) return null;
  return {
    ...found,
    roles: found.roles.map((role) => ({ ...role })),
    channels: [...found.channels],
    questions: found.questions.map((question) => ({ ...question })),
  };
}

function readAnswer(answers: Record<string, string>, questionId: string, fallback = ''): string {
  const raw = answers[questionId];
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  return trimmed || fallback;
}

export function buildCompanyTemplatePreview(
  template: CompanyTemplateDefinition,
  answers: Record<string, string>,
): CompanyTemplateInstallPreview {
  const companyName = readAnswer(
    answers,
    'companyName',
    template.questions.find((question) => question.id === 'companyName')?.defaultValue ?? 'Company',
  );

  const workspaceName = readAnswer(
    answers,
    'workspaceName',
    template.questions.find((question) => question.id === 'workspaceName')?.defaultValue ?? 'Workspace',
  );

  const members = template.roles.map((role) => {
    const alias = role.aliasQuestionId
      ? readAnswer(
        answers,
        role.aliasQuestionId,
        template.questions.find((question) => question.id === role.aliasQuestionId)?.defaultValue ?? role.defaultAlias,
      )
      : role.defaultAlias;

    const peerIdBase = `${companyName}-${role.id}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');

    return {
      roleId: role.id,
      roleTitle: role.title,
      teamId: role.teamId,
      alias,
      peerId: peerIdBase || role.id,
      managerRoleId: role.managerRoleId,
    };
  });

  return {
    templateId: template.id,
    templateLabel: template.label,
    companyName,
    workspaceName,
    channelNames: [...template.channels],
    members,
  };
}
