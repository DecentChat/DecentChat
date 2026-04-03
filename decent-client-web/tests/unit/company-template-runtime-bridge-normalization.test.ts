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
      },
    });

    expect(result.communicationPolicy).toBe('strict');
    expect(result.benchmarkSuite?.recommendedPolicy).toBe('disciplined');
    expect(result.benchmarkSuite?.recommendation?.reasonCode).toBe('default-tie-break');
    expect(result.benchmarkSuite?.rankedPolicies[0]).toMatchObject({ policy: 'disciplined', score: 100 });
  });
});
