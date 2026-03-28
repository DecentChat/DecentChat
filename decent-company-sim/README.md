# @decentchat/company-sim

Multi-agent company simulation subsystem for the [DecentChat](https://github.com/DecentChat/DecentChat) OpenClaw plugin. Lets you define a company of AI employees in a YAML manifest and run them as a coordinated team inside DecentChat workspaces.

## What it does

You write a manifest describing a company: teams, employees, roles, routing rules. This package parses that manifest, scaffolds the matching DecentChat workspaces and channels, loads context documents per employee, and routes incoming messages to the right agent based on participation rules.

The main building blocks:

- **Manifest parsing** -- YAML company definitions validated with Zod (`parseCompanyManifestFile`, `getCompanyEmployeeById`, `getCompanyTeamById`)
- **Bootstrap** -- Installs agents and sets up the runtime for a company (`ensureCompanyBootstrapRuntime`, `buildCompanyBootstrapPlan`)
- **Workspace scaffolding** -- Creates DecentChat workspaces/channels matching the manifest topology (`scaffoldCompanyAgentWorkspaces`)
- **Agent topology** -- Plans which agents need to exist and how they connect (`planCompanyAgentTopology`)
- **Context loading** -- Reads company-specific prompt context and documents per employee (`loadCompanyContextForAccount`, `resolveCompanyPromptContextForAccount`)
- **Routing** -- Decides which employee should respond to a given message (`decideCompanyParticipation`, `resolveThreadRoutingStateUpdate`)
- **Control plane** -- Runtime inspection and management (`getCompanySimControlState`, `previewCompanySimRouting`)
- **Templates** -- Pre-built company configurations you can install and customize (`listCompanySimTemplates`, `installCompanyTemplate`, `compileCompanyTemplateToManifest`)
- **Benchmarks** -- Evaluate communication routing quality (`evaluateCompanyCommunicationSuite`, `getBuiltInCommunicationBenchmarkSuite`)

## Install

```
npm install @decentchat/company-sim
```

Depends on `@decentchat/protocol`, `yaml`, and `zod`.

## Usage

This package is consumed by [`@decentchat/decentchat-plugin`](https://npmjs.com/package/@decentchat/decentchat-plugin) (the OpenClaw plugin). You normally don't use it directly -- the plugin handles manifest loading, bootstrap, and routing for you. See the [plugin README](https://npmjs.com/package/@decentchat/decentchat-plugin) for configuration.

If you want to use it programmatically:

```ts
import { parseCompanyManifestFile, planCompanyAgentTopology } from '@decentchat/company-sim';

const manifest = await parseCompanyManifestFile('./company-manifest.yaml');
const topology = planCompanyAgentTopology(manifest);
```

## Package format

This package ships raw TypeScript (no compiled JS). It's loaded via [jiti](https://github.com/unjs/jiti) at runtime by OpenClaw, which handles TypeScript natively.

## Repository

This package lives in the `decent-company-sim/` directory of the [DecentChat monorepo](https://github.com/DecentChat/DecentChat).

## License

MIT
