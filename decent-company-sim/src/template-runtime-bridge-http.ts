import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  getCompanySimTemplate,
  listCompanySimTemplates,
  type CompanySimTemplate,
} from './template-registry.ts';
import { installCompanyTemplate } from './template-installer.ts';
import type { CompanyTemplateQuestionValue } from './template-types.ts';
import { buildTemplateBenchmarkSuiteSummary } from './template-benchmark-summary.ts';

export const COMPANY_TEMPLATE_BRIDGE_HTTP_PATH = '/api/channels/decentchat/company-template';

export interface CompanyTemplateBridgeRuntimeConfig {
  loadConfig: () => Record<string, unknown>;
  writeConfigFile: (config: Record<string, unknown>) => Promise<void>;
}

export interface CompanyTemplateBridgeLogger {
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface CompanyTemplateBridgeHttpHandlerParams {
  runtimeConfig: CompanyTemplateBridgeRuntimeConfig;
  logger?: CompanyTemplateBridgeLogger;
  templatesRoot?: string;
  workspaceRootDir?: string;
  companySimsRootDir?: string;
}

interface CompanyTemplateBridgeTemplateQuestion {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

interface CompanyTemplateBridgeTemplateRole {
  id: string;
  title: string;
  teamId: string;
  defaultAlias: string;
  aliasQuestionId?: string;
  managerRoleId?: string;
}

interface CompanyTemplateBridgeTemplateDefinition {
  id: string;
  label: string;
  description: string;
  icon?: string;
  channels: string[];
  roles: CompanyTemplateBridgeTemplateRole[];
  questions: CompanyTemplateBridgeTemplateQuestion[];
  benchmarkSuite?: ReturnType<typeof buildTemplateBenchmarkSuiteSummary>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function toQuestionDefaultString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const normalized = uniqueSorted(
      value
        .map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')))
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    return normalized.length > 0 ? normalized.join(', ') : undefined;
  }
  return undefined;
}

function toTemplateDefinition(template: CompanySimTemplate): CompanyTemplateBridgeTemplateDefinition {
  const questionIds = new Set(template.questions.map((question) => question.id));

  const channels = uniqueSorted([
    ...template.defaults.channels,
    ...template.roles.flatMap((role) => role.channels ?? []),
  ]);

  const roles: CompanyTemplateBridgeTemplateRole[] = template.roles.map((role) => {
    const aliasQuestionId = `${role.id}Alias`;
    return {
      id: role.id,
      title: role.title || role.label,
      teamId: role.teamId || 'general',
      defaultAlias: role.defaultAlias || role.label,
      ...(questionIds.has(aliasQuestionId) ? { aliasQuestionId } : {}),
      ...(role.managerRoleId ? { managerRoleId: role.managerRoleId } : {}),
    };
  });

  const questions: CompanyTemplateBridgeTemplateQuestion[] = template.questions.map((question) => {
    const defaultValue = toQuestionDefaultString(
      question.default !== undefined
        ? question.default
        : template.defaults.questionAnswers?.[question.id],
    );

    return {
      id: question.id,
      label: question.label,
      ...(question.description ? { description: question.description } : {}),
      ...(question.required ? { required: true } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    };
  });

  const benchmarkSuite = buildTemplateBenchmarkSuiteSummary(template);

  return {
    id: template.id,
    label: template.label,
    description: template.description,
    ...(template.icon ? { icon: template.icon } : {}),
    channels,
    roles,
    questions,
    ...(benchmarkSuite ? { benchmarkSuite } : {}),
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function parseRequestUrl(rawUrl?: string): URL | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl, 'http://127.0.0.1');
  } catch {
    return null;
  }
}


async function readJsonBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`Request body too large (${size} bytes)`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('end', () => {
      try {
        if (chunks.length === 0) {
          resolve({});
          return;
        }

        const text = Buffer.concat(chunks).toString('utf8').trim();
        if (!text) {
          resolve({});
          return;
        }

        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function toQuestionValue(value: unknown): CompanyTemplateQuestionValue | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const normalized = uniqueSorted(
      value
        .map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')))
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

function normalizeAnswers(value: unknown): Record<string, CompanyTemplateQuestionValue> {
  if (!isRecord(value)) {
    return {};
  }

  const answers: Record<string, CompanyTemplateQuestionValue> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key) continue;

    const normalized = toQuestionValue(rawValue);
    if (normalized === undefined) continue;
    answers[key] = normalized;
  }

  return answers;
}

function buildManualActionItems(manualActionRequiredAccountIds: string[]): string[] {
  const actions = [
    'Restart/reload OpenClaw so runtime bootstrap applies the new company manifest.',
  ];

  if (manualActionRequiredAccountIds.length > 0) {
    actions.push(`Fix invalid seed phrases for: ${manualActionRequiredAccountIds.join(', ')}.`);
  }

  return uniqueSorted(actions);
}

function normalizeErrorStatus(error: unknown): number {
  const message = String((error as Error)?.message ?? error ?? '').toLowerCase();
  if (message.includes('unknown company template')) return 404;
  if (message.includes('templateid is required') || message.includes('template id is required')) return 400;
  if (message.includes('request body too large') || message.includes('json') || message.includes('unexpected token')) return 400;
  return 500;
}

export function createCompanyTemplateBridgeHttpHandler(params: CompanyTemplateBridgeHttpHandlerParams) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const parsedUrl = parseRequestUrl(req.url);
    if (!parsedUrl) {
      return false;
    }

    const pathname = parsedUrl.pathname.replace(/\/$/, '');
    if (pathname !== COMPANY_TEMPLATE_BRIDGE_HTTP_PATH) {
      return false;
    }
    // Auth is enforced by OpenClaw's route layer (`auth: 'plugin'` in index.ts).
    // Keep this handler remote-accessible so operator clients can install templates from non-local browsers.
    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      try {
        const templates = listCompanySimTemplates({ templatesRoot: params.templatesRoot })
          .map((template) => toTemplateDefinition(template));

        sendJson(res, 200, { ok: true, templates });
        return true;
      } catch (error) {
        params.logger?.error?.('Failed to list company templates for runtime bridge', {
          error: String(error),
        });
        sendJson(res, 500, {
          ok: false,
          error: (error as Error).message,
        });
        return true;
      }
    }

    if (method !== 'POST') {
      sendJson(res, 405, {
        ok: false,
        error: 'Method not allowed',
      });
      return true;
    }

    try {
      const payload = await readJsonBody(req);
      const body = isRecord(payload) ? payload : {};
      const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';

      if (!templateId) {
        throw new Error('templateId is required');
      }

      const template = getCompanySimTemplate(templateId, { templatesRoot: params.templatesRoot });
      const answers = normalizeAnswers(body.answers);
      const targetWorkspaceId = typeof body.workspaceId === 'string' && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : undefined;
      const targetInviteCode = typeof body.inviteCode === 'string' && body.inviteCode.trim()
        ? body.inviteCode.trim()
        : undefined;

      const existingConfig = params.runtimeConfig.loadConfig();
      if (!isRecord(existingConfig)) {
        throw new Error('OpenClaw config is not an object');
      }

      const install = installCompanyTemplate({
        template,
        config: existingConfig,
        answers,
        targetWorkspaceId,
        targetInviteCode,
        workspaceRootDir: params.workspaceRootDir,
        companySimsRootDir: params.companySimsRootDir,
      });

      await params.runtimeConfig.writeConfigFile(install.config);

      const manualActionItems = buildManualActionItems(
        install.summary.manualActionRequiredAccountIds,
      );

      sendJson(res, 200, {
        ok: true,
        result: {
          provisioningMode: 'config-provisioned',
          createdAccountIds: install.summary.createdAccountIds,
          provisionedAccountIds: install.summary.provisionedAccountIds,
          onlineReadyAccountIds: install.summary.onlineReadyAccountIds,
          manualActionRequiredAccountIds: install.summary.manualActionRequiredAccountIds,
          manualActionItems,
          companyId: install.summary.companyId,
          manifestPath: install.summary.manifestPath,
          companyDirPath: install.summary.companyDirPath,
          ...(install.summary.communicationPolicy ? { communicationPolicy: install.summary.communicationPolicy } : {}),
          ...(install.summary.benchmarkSuite ? { benchmarkSuite: install.summary.benchmarkSuite } : {}),
        },
      });

      return true;
    } catch (error) {
      const statusCode = normalizeErrorStatus(error);
      const message = (error as Error).message || 'Failed to install company template';

      if (statusCode >= 500) {
        params.logger?.error?.('Failed to install company template via runtime bridge', {
          error: String(error),
        });
      } else {
        params.logger?.warn?.('Rejected company template runtime bridge request', {
          error: String(error),
        });
      }

      sendJson(res, statusCode, {
        ok: false,
        error: message,
      });
      return true;
    }
  };
}
