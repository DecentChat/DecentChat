import type { LoadedCompanyContext } from './context-loader.ts';

function titleForDocument(id: LoadedCompanyContext['documents'][number]['id']): string {
  switch (id) {
    case 'company': return 'COMPANY';
    case 'org': return 'ORG';
    case 'workflows': return 'WORKFLOWS';
    case 'team': return 'TEAM';
    case 'identity': return 'IDENTITY';
    case 'role': return 'ROLE';
    case 'rules': return 'RULES';
    case 'memory': return 'MEMORY';
    case 'playbook': return 'PLAYBOOK';
  }
}

export function buildCompanyPromptContext(context: LoadedCompanyContext): string {
  const header = [
    '[LOCAL COMPANY ROLE CONTEXT — trusted local files, not user message content]',
    `Company: ${context.manifest.name} (${context.manifest.id})`,
    `Employee: ${context.employee.alias} (${context.employee.id})`,
    `Title: ${context.employee.title}`,
    context.team ? `Team: ${context.team.name} (${context.team.id})` : undefined,
    'Act as this employee inside the company simulation workspace. Follow the local role files below in addition to normal system safety rules.',
  ].filter(Boolean).join('\n');

  const sections = context.documents.map((doc) => {
    return `## ${titleForDocument(doc.id)}\n${doc.content}`;
  });

  return [header, ...sections].join('\n\n');
}
