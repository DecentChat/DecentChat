import { describe, expect, test } from 'bun:test';

import { buildPolicyRecommendationViewModel } from '../../src/lib/company-sim/policyPresentation';
import type { CompanyTemplateBenchmarkSuiteSummary } from '../../src/ui/types';

const suite: CompanyTemplateBenchmarkSuiteSummary = {
  templateId: 'software-studio',
  scenarioIds: ['owner-routing', 'handoff-targeting', 'manager-summary-discipline', 'top-level-noise-control'],
  policyScores: {
    minimal: { score: 70, unexpectedResponders: 1, missingExpectedResponders: 0, silentViolations: 1 },
    disciplined: { score: 100, unexpectedResponders: 0, missingExpectedResponders: 0, silentViolations: 0 },
    strict: { score: 100, unexpectedResponders: 0, missingExpectedResponders: 0, silentViolations: 0 },
  },
  recommendedPolicy: 'disciplined',
  recommendation: {
    policy: 'disciplined',
    reasonCode: 'default-tie-break',
    scoreDeltaVsMinimal: 30,
  },
  rankedPolicies: [
    { policy: 'disciplined', score: 100, deltaFromRecommended: 0, deltaFromMinimal: 30 },
    { policy: 'strict', score: 100, deltaFromRecommended: 0, deltaFromMinimal: 30 },
    { policy: 'minimal', score: 70, deltaFromRecommended: -30, deltaFromMinimal: 0 },
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
    expect(vm.rankedPolicies[0]).toMatchObject({ label: 'Disciplined', score: 100, isRecommended: true });
    expect(vm.rankedPolicies[1]).toMatchObject({ label: 'Strict', score: 100, isSelected: true });
  });
});
