import { describe, expect, test } from 'bun:test';
import { getBuiltInCommunicationBenchmarkSuite } from '../src/benchmark-suites.ts';
import { evaluateCompanyCommunicationSuite } from '../src/communication-bench.ts';
import { getCompanySimTemplate } from '../src/template-registry.ts';
import { compileCompanyTemplateToManifest } from '../src/template-compiler.ts';

function getMinimalPolicyReport() {
  const template = getCompanySimTemplate('software-studio');
  const manifest = compileCompanyTemplateToManifest({
    template,
    answers: { communicationPolicy: 'minimal' },
  });

  return evaluateCompanyCommunicationSuite({
    manifest,
    scenarios: getBuiltInCommunicationBenchmarkSuite('software-studio'),
  });
}

describe('software-studio minimal communication policy', () => {
  test('keeps non-owners silent when a task owner is explicitly assigned', () => {
    const report = getMinimalPolicyReport();
    const scenario = report.scenarios.find((entry) => entry.scenarioId === 'owner-routing');
    const assignStep = scenario?.steps.find((entry) => entry.id === 'assign-backend');

    expect(assignStep?.actualResponders).toEqual(['backend']);
    expect(assignStep?.unexpectedResponders).toEqual([]);
    expect(assignStep?.silentViolations).toEqual([]);
  });

  test('hands thread follow-up to QA after an explicit handoff', () => {
    const report = getMinimalPolicyReport();
    const scenario = report.scenarios.find((entry) => entry.scenarioId === 'handoff-targeting');
    const handoffStep = scenario?.steps.find((entry) => entry.id === 'handoff-to-qa');
    const followupStep = scenario?.steps.find((entry) => entry.id === 'followup-qa-thread');

    expect(handoffStep?.actualResponders).toEqual(['manager', 'qa']);
    expect(followupStep?.actualResponders).toEqual(['qa']);
    expect(followupStep?.missingExpectedResponders).toEqual([]);
    expect(followupStep?.unexpectedResponders).toEqual([]);
  });

  test('still allows one proactive specialist to answer unscoped top-level chatter', () => {
    const report = getMinimalPolicyReport();
    const scenario = report.scenarios.find((entry) => entry.scenarioId === 'top-level-noise-control');
    const step = scenario?.steps.find((entry) => entry.id === 'top-level-generic-request');

    expect(step?.actualResponders).toEqual(['backend']);
  });
});
