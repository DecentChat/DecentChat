import { evaluateCompanyCommunicationSuite } from './communication-bench.ts';
import { getBuiltInCommunicationBenchmarkSuite } from './benchmark-suites.ts';
import { compileCompanyTemplateToManifest } from './template-compiler.ts';
import type { CompanySimTemplate } from './template-registry.ts';
import type { CompanyTemplateQuestionValue } from './template-types.ts';

export interface CompanyTemplateBenchmarkPolicyScore {
  score: number;
  unexpectedResponders: number;
  missingExpectedResponders: number;
  silentViolations: number;
}

export interface CompanyTemplateBenchmarkRecommendation {
  policy: string;
  reasonCode: 'best-score' | 'default-tie-break' | 'priority-tie-break' | 'lexical-tie-break';
  scoreDeltaVsMinimal: number;
}

export interface CompanyTemplateBenchmarkRankedPolicy {
  policy: string;
  score: number;
  deltaFromRecommended: number;
  deltaFromMinimal: number;
}

export interface CompanyTemplateBenchmarkSuiteSummary {
  templateId: string;
  scenarioIds: string[];
  policyScores: Record<string, CompanyTemplateBenchmarkPolicyScore>;
  recommendedPolicy?: string;
  recommendation?: CompanyTemplateBenchmarkRecommendation;
  rankedPolicies: CompanyTemplateBenchmarkRankedPolicy[];
}

function resolveCommunicationPolicyOptions(template: CompanySimTemplate): string[] {
  const question = template.questions.find((entry) => entry.id === 'communicationPolicy');
  const options = question?.options?.map((option) => option.value.trim()).filter(Boolean) ?? [];
  const fallback = Object.keys(template.policyProfiles ?? {}).map((key) => key.trim()).filter(Boolean);
  return [...new Set([...(options.length > 0 ? options : fallback)])];
}

function resolveSelectedCommunicationPolicy(template: CompanySimTemplate, answers?: Record<string, CompanyTemplateQuestionValue>): string | undefined {
  const answer = answers?.communicationPolicy;
  if (typeof answer === 'string' && answer.trim()) return answer.trim();

  const question = template.questions.find((entry) => entry.id === 'communicationPolicy');
  if (typeof question?.default === 'string' && question.default.trim()) return question.default.trim();

  const fallback = template.defaults.questionAnswers?.communicationPolicy;
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();

  return undefined;
}


function resolveRecommendedPolicy(params: {
  template: CompanySimTemplate;
  policyScores: Record<string, CompanyTemplateBenchmarkPolicyScore>;
}): { policy?: string; reasonCode?: CompanyTemplateBenchmarkRecommendation['reasonCode'] } {
  const entries = Object.entries(params.policyScores);
  if (entries.length === 0) return {};

  const maxScore = Math.max(...entries.map(([, score]) => score.score));
  const topPolicies = entries
    .filter(([, score]) => score.score === maxScore)
    .map(([policy]) => policy);

  if (topPolicies.length === 1) return { policy: topPolicies[0], reasonCode: 'best-score' };

  const preferred = resolveSelectedCommunicationPolicy(params.template);
  if (preferred && topPolicies.includes(preferred)) return { policy: preferred, reasonCode: 'default-tie-break' };

  const priority = ['disciplined', 'strict', 'minimal'];
  for (const policy of priority) {
    if (topPolicies.includes(policy)) return { policy, reasonCode: 'priority-tie-break' };
  }

  return {
    policy: [...topPolicies].sort((a, b) => a.localeCompare(b))[0],
    reasonCode: 'lexical-tie-break',
  };
}

function buildRankedPolicies(params: {
  policyScores: Record<string, CompanyTemplateBenchmarkPolicyScore>;
  recommendedPolicy?: string;
}): CompanyTemplateBenchmarkRankedPolicy[] {
  const minimalScore = params.policyScores.minimal?.score ?? 0;
  const recommendedScore = params.recommendedPolicy
    ? (params.policyScores[params.recommendedPolicy]?.score ?? 0)
    : 0;

  return Object.entries(params.policyScores)
    .sort((a, b) => {
      if (params.recommendedPolicy) {
        if (a[0] === params.recommendedPolicy) return -1;
        if (b[0] === params.recommendedPolicy) return 1;
      }
      if (b[1].score !== a[1].score) return b[1].score - a[1].score;
      const priority = ['disciplined', 'strict', 'minimal'];
      const aPriority = priority.indexOf(a[0]);
      const bPriority = priority.indexOf(b[0]);
      if (aPriority !== -1 || bPriority !== -1) {
        return (aPriority === -1 ? 999 : aPriority) - (bPriority === -1 ? 999 : bPriority);
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([policy, score]) => ({
      policy,
      score: score.score,
      deltaFromRecommended: score.score - recommendedScore,
      deltaFromMinimal: score.score - minimalScore,
    }));
}

export function buildTemplateBenchmarkSuiteSummary(template: CompanySimTemplate, answers?: Record<string, CompanyTemplateQuestionValue>): CompanyTemplateBenchmarkSuiteSummary | undefined {
  let suite;
  try {
    suite = getBuiltInCommunicationBenchmarkSuite(template.id);
  } catch {
    return undefined;
  }

  const policyScores = Object.fromEntries(
    resolveCommunicationPolicyOptions(template).map((policy) => {
      const manifest = compileCompanyTemplateToManifest({
        template,
        answers: { communicationPolicy: policy },
      });
      const report = evaluateCompanyCommunicationSuite({ manifest, scenarios: suite });
      return [policy, {
        score: report.totals.score,
        unexpectedResponders: report.totals.unexpectedResponders,
        missingExpectedResponders: report.totals.missingExpectedResponders,
        silentViolations: report.totals.silentViolations,
      } satisfies CompanyTemplateBenchmarkPolicyScore];
    }),
  );

  const recommendationSelection = resolveRecommendedPolicy({ template, policyScores });
  const rankedPolicies = buildRankedPolicies({
    policyScores,
    recommendedPolicy: recommendationSelection.policy,
  });
  const minimalScore = policyScores.minimal?.score ?? 0;

  return {
    templateId: template.id,
    scenarioIds: suite.map((scenario) => scenario.id),
    policyScores,
    recommendedPolicy: recommendationSelection.policy,
    ...(recommendationSelection.policy && recommendationSelection.reasonCode ? {
      recommendation: {
        policy: recommendationSelection.policy,
        reasonCode: recommendationSelection.reasonCode,
        scoreDeltaVsMinimal: (policyScores[recommendationSelection.policy]?.score ?? 0) - minimalScore,
      },
    } : {}),
    rankedPolicies,
  };
}


export function resolveSelectedCommunicationPolicyForTemplate(template: CompanySimTemplate, answers?: Record<string, CompanyTemplateQuestionValue>): string | undefined {
  return resolveSelectedCommunicationPolicy(template, answers);
}
