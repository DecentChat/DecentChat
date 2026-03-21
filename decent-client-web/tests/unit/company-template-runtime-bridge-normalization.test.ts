import { describe, expect, test } from 'bun:test';

import { normalizeRuntimeBridgeInstallResult } from '../../src/lib/company-sim/runtimeBridge';

describe('company template runtime bridge normalization', () => {
  test('preserves communication policy and benchmark recommendation metadata', () => {
    const result = normalizeRuntimeBridgeInstallResult({
      provisioningMode: 'config-provisioned',
      communicationPolicy: 'strict',
      benchmarkSuite: {
        templateId: 'software-studio',
        scenarioIds: ['owner-routing', 'top-level-noise-control'],
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
      },
    });

    expect(result.communicationPolicy).toBe('strict');
    expect(result.benchmarkSuite?.recommendedPolicy).toBe('disciplined');
    expect(result.benchmarkSuite?.recommendation?.reasonCode).toBe('default-tie-break');
    expect(result.benchmarkSuite?.rankedPolicies[0]).toMatchObject({ policy: 'disciplined', score: 88 });
  });
});
