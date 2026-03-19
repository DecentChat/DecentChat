import type {
  CompanyTemplateDefinition,
  CompanyTemplateInstallRequest,
  CompanyTemplateRuntimeBridge,
  CompanyTemplateRuntimeBridgeResult,
} from '../../ui/types';

export const COMPANY_TEMPLATE_BRIDGE_HTTP_PATH = '/api/channels/decentchat/company-template';


export class CompanyTemplateRuntimeBridgeHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CompanyTemplateRuntimeBridgeHttpError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueSorted(
    value
      .map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')))
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function parseBridgeErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed || null;
  }

  if (isRecord(payload)) {
    const error = payload.error;
    if (typeof error === 'string' && error.trim()) {
      return error.trim();
    }
    if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }
  }

  return null;
}

async function parseBridgeJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = null;

  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = parseBridgeErrorMessage(payload)
      ?? `Company template runtime bridge request failed (${response.status})`;
    throw new CompanyTemplateRuntimeBridgeHttpError(response.status, message);
  }

  return payload;
}

async function fetchBridgeJson(params: {
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
}): Promise<unknown> {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch API unavailable for runtime bridge');
  }

  const response = await fetch(COMPANY_TEMPLATE_BRIDGE_HTTP_PATH, {
    method: params.method,
    credentials: 'same-origin',
    headers: params.method === 'POST'
      ? {
        accept: 'application/json',
        'content-type': 'application/json',
      }
      : {
        accept: 'application/json',
      },
    ...(params.body ? { body: JSON.stringify(params.body) } : {}),
  });

  return await parseBridgeJsonResponse(response);
}

function parseTemplateListPayload(payload: unknown): CompanyTemplateDefinition[] {
  if (Array.isArray(payload)) {
    return payload as CompanyTemplateDefinition[];
  }

  if (isRecord(payload) && Array.isArray(payload.templates)) {
    return payload.templates as CompanyTemplateDefinition[];
  }

  return [];
}

function parseInstallPayload(payload: unknown): CompanyTemplateRuntimeBridgeResult {
  if (isRecord(payload) && isRecord(payload.result)) {
    return payload.result as CompanyTemplateRuntimeBridgeResult;
  }
  if (isRecord(payload)) {
    return payload as CompanyTemplateRuntimeBridgeResult;
  }
  return {};
}

function createBuiltInHttpRuntimeBridge(): CompanyTemplateRuntimeBridge {
  return {
    listTemplates: async () => {
      const payload = await fetchBridgeJson({ method: 'GET' });
      return parseTemplateListPayload(payload);
    },
    installTemplate: async (request: CompanyTemplateInstallRequest) => {
      const payload = await fetchBridgeJson({
        method: 'POST',
        body: {
          templateId: request.templateId,
          workspaceId: request.workspaceId,
          answers: request.answers,
        },
      });
      return parseInstallPayload(payload);
    },
  };
}

export interface NormalizedRuntimeBridgeInstallResult {
  provisioningMode: 'runtime-provisioned' | 'config-provisioned';
  createdAccountIds: string[];
  provisionedAccountIds: string[];
  onlineReadyAccountIds: string[];
  manualActionRequiredAccountIds: string[];
  manualActionItems: string[];
}

export function normalizeRuntimeBridgeInstallResult(
  value: CompanyTemplateRuntimeBridgeResult | null | undefined,
): NormalizedRuntimeBridgeInstallResult {
  const payload = isRecord(value) ? value : {};
  const provisioningMode = payload.provisioningMode === 'runtime-provisioned'
    ? 'runtime-provisioned'
    : 'config-provisioned';

  return {
    provisioningMode,
    createdAccountIds: readStringArray(payload.createdAccountIds),
    provisionedAccountIds: readStringArray(payload.provisionedAccountIds),
    onlineReadyAccountIds: readStringArray(payload.onlineReadyAccountIds),
    manualActionRequiredAccountIds: readStringArray(payload.manualActionRequiredAccountIds),
    manualActionItems: readStringArray(payload.manualActionItems),
  };
}

function resolveInjectedRuntimeBridge(): CompanyTemplateRuntimeBridge | null {
  const raw = (window as any).__DECENT_COMPANY_TEMPLATE_BRIDGE__;
  if (!isRecord(raw)) return null;

  const bridge: CompanyTemplateRuntimeBridge = {};
  if (typeof raw.listTemplates === 'function') {
    bridge.listTemplates = raw.listTemplates as CompanyTemplateRuntimeBridge['listTemplates'];
  }
  if (typeof raw.installTemplate === 'function') {
    bridge.installTemplate = raw.installTemplate as CompanyTemplateRuntimeBridge['installTemplate'];
  }

  if (!bridge.listTemplates && !bridge.installTemplate) return null;
  return bridge;
}

export function resolveCompanyTemplateRuntimeBridge(): CompanyTemplateRuntimeBridge | null {
  if (typeof window === 'undefined') return null;

  const injectedBridge = resolveInjectedRuntimeBridge();
  if (injectedBridge) {
    return injectedBridge;
  }

  return createBuiltInHttpRuntimeBridge();
}

declare global {
  interface Window {
    __DECENT_COMPANY_TEMPLATE_BRIDGE__?: CompanyTemplateRuntimeBridge;
  }
}
