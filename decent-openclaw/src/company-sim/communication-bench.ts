import type { LoadedCompanyContext } from './context-loader.ts';
import { decideCompanyParticipation, type CompanyRoutingDecision } from './router.ts';
import { resolveThreadRoutingStateUpdate, type CompanyThreadRoutingState } from './thread-routing-state.ts';
import type { CompanyEmployeeConfig, CompanyManifest } from './types.ts';

export interface CompanyCommunicationScenarioStep {
  id: string;
  chatType: 'direct' | 'channel';
  channelNameOrId?: string;
  threadId?: string;
  text: string;
  expectedResponders?: string[];
  expectedSilent?: string[];
}

export interface CompanyCommunicationScenario {
  id: string;
  title: string;
  steps: CompanyCommunicationScenarioStep[];
}

export interface CompanyCommunicationScenarioStepReport {
  id: string;
  text: string;
  actualResponders: string[];
  expectedResponders: string[];
  expectedSilent: string[];
  missingExpectedResponders: string[];
  unexpectedResponders: string[];
  silentViolations: string[];
  decisions: Record<string, CompanyRoutingDecision>;
}

export interface CompanyCommunicationScenarioReport {
  scenarioId: string;
  title: string;
  steps: CompanyCommunicationScenarioStepReport[];
  totals: {
    score: number;
    expectedResponses: number;
    actualResponses: number;
    missingExpectedResponders: number;
    unexpectedResponders: number;
    silentViolations: number;
  };
}

export interface CompanyCommunicationSuiteReport {
  scenarios: CompanyCommunicationScenarioReport[];
  totals: CompanyCommunicationScenarioReport['totals'] & {
    scenarioCount: number;
  };
}

function createLoadedCompanyContext(manifest: CompanyManifest, employee: CompanyEmployeeConfig): LoadedCompanyContext {
  return {
    manifestPath: '/bench/company.yaml',
    companyDir: '/bench/company',
    manifest,
    employee,
    team: employee.teamId ? manifest.teams.find((team) => team.id === employee.teamId) : undefined,
    documents: [],
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function scoreScenario(params: {
  expectedResponses: number;
  missingExpectedResponders: number;
  unexpectedResponders: number;
  silentViolations: number;
}): number {
  const base = 100;
  const penalties =
    (params.missingExpectedResponders * 30)
    + (params.unexpectedResponders * 12)
    + (params.silentViolations * 18);
  return Math.max(0, base - penalties);
}

export function evaluateCompanyCommunicationScenario(params: {
  manifest: CompanyManifest;
  scenario: CompanyCommunicationScenario;
}): CompanyCommunicationScenarioReport {
  const threadState = new Map<string, CompanyThreadRoutingState>();

  const steps = params.scenario.steps.map((step) => {
    const currentThreadState = step.threadId ? threadState.get(step.threadId) : undefined;
    const decisions = Object.fromEntries(
      params.manifest.employees.map((employee) => {
        const context = createLoadedCompanyContext(params.manifest, employee);
        const decision = decideCompanyParticipation({
          context,
          chatType: step.chatType,
          channelNameOrId: step.channelNameOrId,
          threadId: step.threadId,
          text: step.text,
          threadAssignedEmployeeId: currentThreadState?.assignedEmployeeId,
        });
        return [employee.id, decision] satisfies [string, CompanyRoutingDecision];
      }),
    );

    if (step.threadId) {
      const update = resolveThreadRoutingStateUpdate({ manifest: params.manifest, text: step.text });
      if (update) threadState.set(step.threadId, update);
    }

    const actualResponders = uniqueSorted(
      Object.entries(decisions)
        .filter(([, decision]) => decision.shouldRespond)
        .map(([employeeId]) => employeeId),
    );
    const expectedResponders = uniqueSorted([...(step.expectedResponders ?? [])]);
    const expectedSilent = uniqueSorted([...(step.expectedSilent ?? [])]);
    const missingExpectedResponders = expectedResponders.filter((employeeId) => !actualResponders.includes(employeeId));
    const unexpectedResponders = actualResponders.filter((employeeId) => !expectedResponders.includes(employeeId));
    const silentViolations = expectedSilent.filter((employeeId) => actualResponders.includes(employeeId));

    return {
      id: step.id,
      text: step.text,
      actualResponders,
      expectedResponders,
      expectedSilent,
      missingExpectedResponders,
      unexpectedResponders,
      silentViolations,
      decisions,
    } satisfies CompanyCommunicationScenarioStepReport;
  });

  const totals = {
    expectedResponses: steps.reduce((sum, step) => sum + step.expectedResponders.length, 0),
    actualResponses: steps.reduce((sum, step) => sum + step.actualResponders.length, 0),
    missingExpectedResponders: steps.reduce((sum, step) => sum + step.missingExpectedResponders.length, 0),
    unexpectedResponders: steps.reduce((sum, step) => sum + step.unexpectedResponders.length, 0),
    silentViolations: steps.reduce((sum, step) => sum + step.silentViolations.length, 0),
    score: 0,
  };
  totals.score = scoreScenario(totals);

  return {
    scenarioId: params.scenario.id,
    title: params.scenario.title,
    steps,
    totals,
  };
}

export function evaluateCompanyCommunicationSuite(params: {
  manifest: CompanyManifest;
  scenarios: CompanyCommunicationScenario[];
}): CompanyCommunicationSuiteReport {
  const scenarios = params.scenarios.map((scenario) => evaluateCompanyCommunicationScenario({
    manifest: params.manifest,
    scenario,
  }));

  const totals = {
    scenarioCount: scenarios.length,
    expectedResponses: scenarios.reduce((sum, scenario) => sum + scenario.totals.expectedResponses, 0),
    actualResponses: scenarios.reduce((sum, scenario) => sum + scenario.totals.actualResponses, 0),
    missingExpectedResponders: scenarios.reduce((sum, scenario) => sum + scenario.totals.missingExpectedResponders, 0),
    unexpectedResponders: scenarios.reduce((sum, scenario) => sum + scenario.totals.unexpectedResponders, 0),
    silentViolations: scenarios.reduce((sum, scenario) => sum + scenario.totals.silentViolations, 0),
    score: 0,
  };
  totals.score = scoreScenario(totals);

  return { scenarios, totals };
}
