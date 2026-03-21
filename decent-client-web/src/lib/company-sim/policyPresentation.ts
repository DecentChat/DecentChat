import type { CompanyTemplateBenchmarkRankedPolicy, CompanyTemplateBenchmarkSuiteSummary } from '../../ui/types';

export interface PolicyRecommendationRow extends CompanyTemplateBenchmarkRankedPolicy {
  label: string;
  isRecommended: boolean;
  isSelected: boolean;
}

export interface PolicyRecommendationViewModel {
  recommendedLabel: string;
  selectedLabel: string | null;
  summary: string;
  explainer: string;
  rankedPolicies: PolicyRecommendationRow[];
}

export function policyLabel(policy: string | undefined | null): string {
  const normalized = typeof policy === 'string' ? policy.trim() : '';
  if (!normalized) return 'Unknown';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function recommendationReasonText(summary: CompanyTemplateBenchmarkSuiteSummary): string {
  switch (summary.recommendation?.reasonCode) {
    case 'best-score':
      return `${policyLabel(summary.recommendedPolicy)} leads the built-in benchmark on pure score.`;
    case 'default-tie-break':
      return `${policyLabel(summary.recommendedPolicy)} ties for the best benchmark score and wins as the template default.`;
    case 'priority-tie-break':
      return `${policyLabel(summary.recommendedPolicy)} ties for the best score and wins on template priority.`;
    case 'lexical-tie-break':
      return `${policyLabel(summary.recommendedPolicy)} ties for the best score and wins on stable name ordering.`;
    default:
      return `${policyLabel(summary.recommendedPolicy)} is the current recommended policy.`;
  }
}

export function buildPolicyRecommendationViewModel(summary: CompanyTemplateBenchmarkSuiteSummary | undefined, selectedPolicy?: string | null): PolicyRecommendationViewModel | null {
  if (!summary?.recommendedPolicy) return null;

  const recommendedLabel = policyLabel(summary.recommendedPolicy);
  const selectedLabel = selectedPolicy ? policyLabel(selectedPolicy) : null;
  const rankedPolicies = summary.rankedPolicies.map((entry) => ({
    ...entry,
    label: policyLabel(entry.policy),
    isRecommended: entry.policy === summary.recommendedPolicy,
    isSelected: Boolean(selectedPolicy && entry.policy === selectedPolicy),
  }));

  const selectedCopy = selectedLabel ? ` Selected: ${selectedLabel}.` : '';
  const scoreDelta = summary.recommendation?.scoreDeltaVsMinimal ?? 0;

  return {
    recommendedLabel,
    selectedLabel,
    summary: `Recommended: ${recommendedLabel}.${selectedCopy} ${summary.scenarioIds.length} benchmark scenarios.`,
    explainer: `${recommendationReasonText(summary)} ${scoreDelta > 0 ? `It scores ${scoreDelta} points above Minimal.` : ''}`.trim(),
    rankedPolicies,
  };
}
