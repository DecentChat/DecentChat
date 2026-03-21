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

function normalizeBenchmarkSuite(value: unknown): CompanyTemplateRuntimeBridgeResult['benchmarkSuite'] | undefined {
  if (!isRecord(value)) return undefined;
  const templateId = typeof value.templateId === 'string' ? value.templateId.trim() : '';
  if (!templateId) return undefined;

  const scenarioIds = readStringArray(value.scenarioIds);
  const rawPolicyScores = isRecord(value.policyScores) ? value.policyScores : {};
  const policyScores = Object.fromEntries(
    Object.entries(rawPolicyScores).flatMap(([policy, entry]) => {
      if (!isRecord(entry)) return [];
      return [[policy, {
        score: typeof entry.score === 'number' ? entry.score : Number(entry.score ?? 0) || 0,
        ...(typeof entry.unexpectedResponders === 'number' ? { unexpectedResponders: entry.unexpectedResponders } : {}),
        ...(typeof entry.missingExpectedResponders === 'number' ? { missingExpectedResponders: entry.missingExpectedResponders } : {}),
        ...(typeof entry.silentViolations === 'number' ? { silentViolations: entry.silentViolations } : {}),
      }]];
    }),
  );
  const rankedPolicies = Array.isArray(value.rankedPolicies)
    ? value.rankedPolicies
      .filter((entry) => isRecord(entry) && typeof entry.policy === 'string')
      .map((entry) => ({
        policy: String(entry.policy),
        score: typeof entry.score === 'number' ? entry.score : Number(entry.score ?? 0) || 0,
        deltaFromRecommended: typeof entry.deltaFromRecommended === 'number' ? entry.deltaFromRecommended : Number(entry.deltaFromRecommended ?? 0) || 0,
        deltaFromMinimal: typeof entry.deltaFromMinimal === 'number' ? entry.deltaFromMinimal : Number(entry.deltaFromMinimal ?? 0) || 0,
      }))
    : [];
  const recommendation = isRecord(value.recommendation) && typeof value.recommendation.policy === 'string'
    ? {
        policy: String(value.recommendation.policy),
        reasonCode: String(value.recommendation.reasonCode ?? 'best-score') as any,
        scoreDeltaVsMinimal: typeof value.recommendation.scoreDeltaVsMinimal === 'number'
          ? value.recommendation.scoreDeltaVsMinimal
          : Number(value.recommendation.scoreDeltaVsMinimal ?? 0) || 0,
      }
    : undefined;
  const recommendedPolicy = typeof value.recommendedPolicy === 'string' ? value.recommendedPolicy.trim() : undefined;

  return {
    templateId,
    scenarioIds,
    policyScores,
    ...(recommendedPolicy ? { recommendedPolicy } : {}),
    ...(recommendation ? { recommendation } : {}),
    rankedPolicies,
  };
}

export interface NormalizedRuntimeBridgeInstallResult {
  provisioningMode: 'runtime-provisioned' | 'config-provisioned';
  createdAccountIds: string[];
  provisionedAccountIds: string[];
  onlineReadyAccountIds: string[];
  manualActionRequiredAccountIds: string[];
  manualActionItems: string[];
  communicationPolicy?: string;
  benchmarkSuite?: CompanyTemplateRuntimeBridgeResult['benchmarkSuite'];
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
    ...(typeof payload.communicationPolicy === 'string' && payload.communicationPolicy.trim() ? { communicationPolicy: payload.communicationPolicy.trim() } : {}),
    ...(normalizeBenchmarkSuite(payload.benchmarkSuite) ? { benchmarkSuite: normalizeBenchmarkSuite(payload.benchmarkSuite) } : {}),
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
