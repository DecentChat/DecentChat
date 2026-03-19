# Company Sim OpenClaw Agents Rework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** rework company simulation so each employee is a real isolated OpenClaw agent (workspace + auth + routing + sessions), not just another DecentChat account inside one agent.

**Architecture:** Keep the existing DecentChat company-sim product layer, but change the runtime substrate from “multi-account in one agent” to “one OpenClaw agent per employee”. The manifest becomes agent-aware (`agentId`, `accountId`, workspace/binding hints); a topology planner derives `agents.list`, `bindings`, per-agent workspace scaffolds, and the DecentChat workspace bootstrap plan. Runtime bootstrap remains responsible for creating/joining the shared DecentChat workspace, but only after the required OpenClaw agents and bindings exist.

**Tech Stack:** TypeScript, Bun, YAML/Zod validation, OpenClaw multi-agent routing model, DecentChat protocol/client/openclaw packages.

---

## Product / architecture reset

### Old model
- one OpenClaw agent
- multiple DecentChat accounts
- employee isolation mostly via accountId + prompt context

### New model
- one OpenClaw agent per employee
- one workspace per employee agent
- one DecentChat account per employee agent (explicit `accountId`)
- OpenClaw `bindings` route inbound channel traffic to the correct employee agent
- DecentChat company workspace remains shared across the simulated org

### Non-goals for this rework
- do not invent new OpenClaw core agent primitives inside this repo
- do not try to spawn gateway child processes per employee
- do not store channel secrets (seed phrases/tokens) inside company manifests

---

### Task 1: Make the company manifest agent-centric

**Files:**
- Modify: `decent-openclaw/src/company-sim/types.ts`
- Modify: `decent-openclaw/src/company-sim/manifest.ts`
- Modify: `decent-openclaw/tests/unit/company-manifest.test.ts`
- Modify: `company-sims/software-studio/company.yaml`
- Modify: `company-sims/software-studio/employees/team-manager/IDENTITY.md`
- Modify: `company-sims/software-studio/employees/backend-dev/IDENTITY.md`
- Modify: `company-sims/software-studio/employees/tester/IDENTITY.md`
- Test: `decent-openclaw/tests/unit/company-manifest.test.ts`

1. Write failing manifest tests for:
   - required `agentId`
   - distinct duplicate validation for `agentId` vs `accountId`
   - optional workspace/binding hints preserved by parse/validate
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-manifest.test.ts
   ```
3. Implement minimal schema/validator/template changes.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/types.ts decent-openclaw/src/company-sim/manifest.ts decent-openclaw/tests/unit/company-manifest.test.ts company-sims/software-studio/company.yaml company-sims/software-studio/employees/*/IDENTITY.md
   git commit -m "feat(company-sim): model employees as isolated openclaw agents"
   ```

**Status:** in progress / first implementation slice.

---

### Task 2: Add an agent-topology planner and per-agent workspace scaffold

**Files:**
- Create: `decent-openclaw/src/company-sim/agent-topology.ts`
- Create: `decent-openclaw/src/company-sim/workspace-scaffold.ts`
- Create: `decent-openclaw/tests/unit/company-agent-topology.test.ts`
- Create: `decent-openclaw/tests/unit/company-workspace-scaffold.test.ts`
- Modify: `company-sims/software-studio/COMPANY.md`
- Modify: `company-sims/software-studio/ORG.md`
- Modify: `company-sims/software-studio/WORKFLOWS.md`
- Test: `decent-openclaw/tests/unit/company-agent-topology.test.ts`
- Test: `decent-openclaw/tests/unit/company-workspace-scaffold.test.ts`

1. Write failing tests for a topology planner that derives, per employee:
   - `agentId`
   - `accountId`
   - workspace path/name
   - DecentChat binding tuple(s)
   - local company-sim context source paths
2. Add failing scaffold tests that assert generated per-agent workspace files include at least:
   - `IDENTITY.md`
   - `AGENTS.md`
   - `SOUL.md`
   - `USER.md`
   - company/employee markdown copied or materialized into a stable workspace layout
3. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-agent-topology.test.ts tests/unit/company-workspace-scaffold.test.ts
   ```
4. Implement minimal planner + scaffold writer.
5. Re-run and verify pass.
6. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/agent-topology.ts decent-openclaw/src/company-sim/workspace-scaffold.ts decent-openclaw/tests/unit/company-agent-topology.test.ts decent-openclaw/tests/unit/company-workspace-scaffold.test.ts company-sims/software-studio/COMPANY.md company-sims/software-studio/ORG.md company-sims/software-studio/WORKFLOWS.md
   git commit -m "feat(company-sim): plan isolated agent topology and scaffold workspaces"
   ```

---

### Task 3: Add OpenClaw config/binding materializer for company agents

**Files:**
- Create: `decent-openclaw/src/company-sim/openclaw-config.ts`
- Create: `decent-openclaw/tests/unit/company-openclaw-config.test.ts`
- Modify: `decent-openclaw/src/company-sim/types.ts`
- Test: `decent-openclaw/tests/unit/company-openclaw-config.test.ts`

1. Write failing tests for config materialization/merge:
   - generates `agents.list` entries for each employee agent
   - generates `bindings` that route `decentchat:<accountId>` to the correct `agentId`
   - preserves unrelated existing agents/bindings
   - idempotent re-apply does not duplicate entries
   - errors clearly when manifest references accountIds not configured under `channels.decentchat.accounts`
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-openclaw-config.test.ts
   ```
3. Implement minimal config merger/materializer.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/openclaw-config.ts decent-openclaw/src/company-sim/types.ts decent-openclaw/tests/unit/company-openclaw-config.test.ts
   git commit -m "feat(company-sim): generate openclaw agents and bindings from manifest"
   ```

---

### Task 4: Rework bootstrap/runtime from account-fanout to agent-aware installation + validation

**Files:**
- Modify: `decent-openclaw/src/company-sim/bootstrap.ts`
- Modify: `decent-openclaw/src/channel.ts`
- Modify: `decent-openclaw/src/runtime.ts`
- Modify: `decent-openclaw/src/types.ts`
- Create: `decent-openclaw/tests/integration/company-agent-bootstrap-runtime.test.ts`
- Modify: `decent-openclaw/tests/integration/company-bootstrap-runtime.test.ts`
- Test: `decent-openclaw/tests/integration/company-agent-bootstrap-runtime.test.ts`

1. Write failing integration tests for startup flow:
   - runtime bootstrap refuses agent-mode manifest if required agents/bindings are absent
   - once topology/config is installed, startup materializes the shared DecentChat workspace/channels deterministically
   - employee accounts join that workspace without duplicate memberships on restart
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/integration/company-agent-bootstrap-runtime.test.ts
   ```
3. Implement minimal runtime validation + bootstrap path.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/bootstrap.ts decent-openclaw/src/channel.ts decent-openclaw/src/runtime.ts decent-openclaw/src/types.ts decent-openclaw/tests/integration/company-agent-bootstrap-runtime.test.ts decent-openclaw/tests/integration/company-bootstrap-runtime.test.ts
   git commit -m "feat(company-sim): bootstrap shared workspace for isolated employee agents"
   ```

---

### Task 5: Make company context resolution agent-local first

**Files:**
- Modify: `decent-openclaw/src/company-sim/context-loader.ts`
- Modify: `decent-openclaw/src/company-sim/prompt-context.ts`
- Modify: `decent-openclaw/src/monitor.ts`
- Create: `decent-openclaw/tests/unit/company-agent-context-resolution.test.ts`
- Test: `decent-openclaw/tests/unit/company-agent-context-resolution.test.ts`

1. Write failing tests for agent-local context rules:
   - employee agent resolves its own scaffolded workspace files without needing shared mutable global config
   - cache/reload stays isolated per agent workspace
   - one agent cannot accidentally read another employee workspace context through shared defaults
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-agent-context-resolution.test.ts
   ```
3. Implement minimal agent-local resolution path.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/context-loader.ts decent-openclaw/src/company-sim/prompt-context.ts decent-openclaw/src/monitor.ts decent-openclaw/tests/unit/company-agent-context-resolution.test.ts
   git commit -m "feat(company-sim): resolve employee context from agent-local workspaces"
   ```

---

### Task 6: Add end-to-end operator workflow coverage and docs

**Files:**
- Create: `docs/openclaw/company-sim-multi-agent.md`
- Create: `decent-openclaw/tests/integration/company-agent-install-flow.test.ts`
- Modify: `docs/openclaw/configuration.md`
- Modify: `docs/openclaw/operations.md`
- Test: `decent-openclaw/tests/integration/company-agent-install-flow.test.ts`

1. Write failing integration/docs-backed test for the operator flow:
   - parse manifest
   - generate agent workspaces
   - generate/merge OpenClaw config topology
   - run bootstrap validation successfully
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/integration/company-agent-install-flow.test.ts
   ```
3. Implement missing glue and document exact operator steps (`openclaw agents list`, bindings expectations, restart/verify).
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add docs/openclaw/company-sim-multi-agent.md docs/openclaw/configuration.md docs/openclaw/operations.md decent-openclaw/tests/integration/company-agent-install-flow.test.ts
   git commit -m "docs(company-sim): document isolated openclaw agent workflow"
   ```

---

## Recommended execution order

1. Task 1 — manifest rework
2. Task 2 — topology planner + workspace scaffold
3. Task 3 — OpenClaw config/bindings materializer
4. Task 4 — runtime/bootstrap validation
5. Task 5 — agent-local context resolution
6. Task 6 — operator docs + install-flow coverage

## Verification sweep after Tasks 1–5

```bash
cd /Users/claw/Projects/decent-chat/decent-openclaw && bun test
cd /Users/claw/Projects/decent-chat/decent-client-web && bun run test:unit && PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-*.spec.ts --project=chromium
cd /Users/claw/Projects/decent-chat/decent-protocol && bun test
cd /Users/claw/Projects/decent-chat && bun run typecheck
```

## Handoff

Options:
1. Subagent-Driven — implement the next task in this session.
2. Parallel Session — open a separate implementation session for each task.
