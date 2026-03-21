import { describe, expect, test } from 'bun:test';

import { buildPolicyRecommendationViewModel } from '../../src/lib/company-sim/policyPresentation';
import type { CompanyTemplateBenchmarkSuiteSummary } from '../../src/ui/types';

const suite: CompanyTemplateBenchmarkSuiteSummary = {
  templateId: 'software-studio',
  scenarioIds: ['owner-routing', 'handoff-targeting', 'manager-summary-discipline', 'top-level-noise-control'],
  policyScores: {
    minimal: { score: 34, unexpectedResponders: 3, missingExpectedResponders: 0, silentViolations: 2 },
    disciplined: { score: 88, unexpectedResponders: 0, missingExpectedResponders: 0, silentViolations: 0 },
    strict: { score: 88, unexpectedResponders: 0, missingExpectedResponders: 0, silentViolations: 0 },
  },
  recommendedPolicy: 'disciplined',
  recommendation: {
    policy: 'disciplined',
    reasonCode: 'default-tie-break',
    scoreDeltaVsMinimal: 54,
  },
  rankedPolicies: [
    { policy: 'disciplined', score: 88, deltaFromRecommended: 0, deltaFromMinimal: 54 },
    { policy: 'strict', score: 88, deltaFromRecommended: 0, deltaFromMinimal: 54 },
    { policy: 'minimal', score: 34, deltaFromRecommended: -54, deltaFromMinimal: 0 },
  ],
};

describe('company policy presentation', () => {
  test('builds UI-ready copy for selected vs recommended policy', () => {
    const vm = buildPolicyRecommendationViewModel(suite, 'strict');

    expect(vm.recommendedLabel).toBe('Disciplined');
    expect(vm.selectedLabel).toBe('Strict');
    expect(vm.summary).toContain('Recommended: Disciplined');
    expect(vm.summary).toContain('Selected: Strict');
    expect(vm.explainer).toContain('ties for the best benchmark score');
    expect(vm.rankedPolicies[0]).toMatchObject({ label: 'Disciplined', score: 88, isRecommended: true });
    expect(vm.rankedPolicies[1]).toMatchObject({ label: 'Strict', score: 88, isSelected: true });
  });
});
