import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import { evaluateCompanyCommunicationSuite } from '../../src/company-sim/communication-bench.ts';
import { getBuiltInCommunicationBenchmarkSuite } from '../../src/company-sim/benchmark-suites.ts';
import { buildTemplateBenchmarkSuiteSummary } from '../../src/company-sim/template-benchmark-summary.ts';
import { compileCompanyTemplateToManifest } from '../../src/company-sim/template-compiler.ts';
import { getCompanySimTemplate } from '../../src/company-sim/template-registry.ts';

const bundledTemplatesRoot = fileURLToPath(new URL('../../../company-sims/templates', import.meta.url));

describe('company policy benchmark suites', () => {
  test('software-studio exposes a built-in benchmark suite with core coordination scenarios', () => {
    const suite = getBuiltInCommunicationBenchmarkSuite('software-studio');

    expect(suite.map((scenario) => scenario.id)).toEqual([
      'owner-routing',
      'handoff-targeting',
      'manager-summary-discipline',
      'top-level-noise-control',
    ]);
  });

  test('benchmark summary recommends the default disciplined policy when it ties for best score', () => {
    const template = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });
    const summary = buildTemplateBenchmarkSuiteSummary(template);

    expect(summary?.recommendedPolicy).toBe('disciplined');
    expect(summary?.recommendation.policy).toBe('disciplined');
    expect(summary?.recommendation.reasonCode).toBe('default-tie-break');
    expect(summary?.recommendation.scoreDeltaVsMinimal).toBeGreaterThan(0);
    expect(summary?.rankedPolicies[0]).toMatchObject({ policy: 'disciplined' });
    expect(summary?.rankedPolicies.find((entry) => entry.policy === 'minimal')?.deltaFromRecommended).toBeLessThan(0);
    expect(summary?.policyScores.disciplined.score).toBeGreaterThan(summary?.policyScores.minimal.score ?? 0);
  });

  test('disciplined and strict communication profiles outperform minimal on the built-in suite', () => {
    const template = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });
    const suite = getBuiltInCommunicationBenchmarkSuite('software-studio');

    const minimalManifest = compileCompanyTemplateToManifest({
      template,
      answers: { communicationPolicy: 'minimal' },
    });
    const disciplinedManifest = compileCompanyTemplateToManifest({
      template,
      answers: { communicationPolicy: 'disciplined' },
    });
    const strictManifest = compileCompanyTemplateToManifest({
      template,
      answers: { communicationPolicy: 'strict' },
    });

    const minimalReport = evaluateCompanyCommunicationSuite({ manifest: minimalManifest, scenarios: suite });
    const disciplinedReport = evaluateCompanyCommunicationSuite({ manifest: disciplinedManifest, scenarios: suite });
    const strictReport = evaluateCompanyCommunicationSuite({ manifest: strictManifest, scenarios: suite });

    expect(disciplinedReport.totals.score).toBeGreaterThan(minimalReport.totals.score);
    expect(strictReport.totals.score).toBeGreaterThan(minimalReport.totals.score);
    expect(disciplinedReport.totals.unexpectedResponders).toBeLessThan(minimalReport.totals.unexpectedResponders);
    expect(strictReport.totals.unexpectedResponders).toBeLessThan(minimalReport.totals.unexpectedResponders);
  });
});
