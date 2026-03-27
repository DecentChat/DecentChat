/**
 * @decentchat/company-sim — Company simulation subsystem
 *
 * Multi-agent company simulation for the DecentChat OpenClaw plugin.
 * Handles agent topology, manifest parsing, workspace scaffolding,
 * template management, and context loading for company-sim accounts.
 *
 * @packageDocumentation
 */

// ─── Bootstrap ─────────────────────────────────────────────────────────────
export {
  assertCompanyBootstrapAgentInstallation,
  ensureCompanyBootstrapRuntime,
  resolveCompanyManifestPath,
  buildCompanyBootstrapPlan,
} from './bootstrap.ts';
export type { CompanyBootstrapEmployee, CompanyBootstrapRuntimeResult } from './bootstrap.ts';

// ─── Context ───────────────────────────────────────────────────────────────
export {
  loadCompanyContextForAccount,
  buildCompanyContextTrackedPaths,
  createCompanyContextVersionToken,
  readCompanyContextFileSnapshots,
} from './context-loader.ts';
export type { LoadedCompanyContext, CompanyContextDocumentId } from './context-loader.ts';

export {
  resolveCompanyPromptContextForAccount,
  titleForCompanyContextDocument,
  buildCompanyPromptContext,
  resetCompanyPromptContextCacheForTests,
} from './prompt-context.ts';

// ─── Agent topology ────────────────────────────────────────────────────────
export { planCompanyAgentTopology } from './agent-topology.ts';

// ─── Workspace scaffold ───────────────────────────────────────────────────
export { scaffoldCompanyAgentWorkspaces } from './workspace-scaffold.ts';

// ─── Routing ───────────────────────────────────────────────────────────────
export { decideCompanyParticipation } from './router.ts';
export {
  resolveThreadRoutingStateUpdate,
} from './thread-routing-state.ts';
export type { CompanyThreadRoutingState } from './thread-routing-state.ts';

// ─── Control plane ─────────────────────────────────────────────────────────
export {
  getCompanySimControlState,
  readCompanySimControlDocument,
  writeCompanySimControlDocument,
  previewCompanySimRouting,
  getCompanySimEmployeeContext,
} from './control-plane.ts';

// ─── Templates ─────────────────────────────────────────────────────────────
export { getCompanySimTemplate, listCompanySimTemplates } from './template-registry.ts';
export { installCompanyTemplate } from './template-installer.ts';
export { compileCompanyTemplateToManifest } from './template-compiler.ts';
export type { CompanyTemplateQuestionValue, CompanyTemplateMetadata } from './template-types.ts';

// ─── Template runtime bridge ──────────────────────────────────────────────
export {
  COMPANY_TEMPLATE_BRIDGE_HTTP_PATH,
  createCompanyTemplateBridgeHttpHandler,
} from './template-runtime-bridge-http.ts';

// ─── Benchmarks ────────────────────────────────────────────────────────────
export {
  evaluateCompanyCommunicationScenario,
  evaluateCompanyCommunicationSuite,
} from './communication-bench.ts';
export type { CompanyCommunicationScenario } from './communication-bench.ts';
export { getBuiltInCommunicationBenchmarkSuite } from './benchmark-suites.ts';
export { buildTemplateBenchmarkSuiteSummary } from './template-benchmark-summary.ts';

// ─── OpenClaw config ──────────────────────────────────────────────────────
export { materializeCompanyOpenClawConfig } from './openclaw-config.ts';

// ─── Manifest ──────────────────────────────────────────────────────────────
export {
  parseCompanyManifestText,
  parseCompanyManifestFile,
  getCompanyEmployeeById,
  getCompanyTeamById,
} from './manifest.ts';

// ─── Types ─────────────────────────────────────────────────────────────────
export type {
  CompanySimMode,
  CompanyParticipationMode,
  CompanyParticipationConfig,
  CompanyWorkspaceConfig,
  CompanyTeamConfig,
  CompanyEmployeeBindingConfig,
  CompanyEmployeeConfig,
  CompanyManifest,
  ResolvedDecentChatAccount,
  OpenClawConfigShape,
  OpenClawAgentListEntryConfig,
  OpenClawRouteBindingConfig,
} from './types.ts';
