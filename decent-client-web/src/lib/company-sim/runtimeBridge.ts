import type {
  CompanyTemplateRuntimeBridge,
  CompanyTemplateRuntimeBridgeResult,
} from '../../ui/types';

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
  return resolveInjectedRuntimeBridge();
}

declare global {
  interface Window {
    __DECENT_COMPANY_TEMPLATE_BRIDGE__?: CompanyTemplateRuntimeBridge;
  }
}
