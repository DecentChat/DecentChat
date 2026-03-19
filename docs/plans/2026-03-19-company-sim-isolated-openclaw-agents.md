# Company Sim with Isolated OpenClaw Agents Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** rework company-sim from “multiple DecentChat accounts inside one OpenClaw agent” into “one real OpenClaw agent per employee, with isolated workspace/auth/session state and explicit routing bindings.”

**Architecture:** Keep DecentChat as the shared company workspace, but stop treating employees as mere account rows. Each employee becomes a true OpenClaw `agentId` with its own workspace, identity files, session store, and DecentChat `accountId`, while a company manifest drives agent scaffolding, routing bindings, workspace file seeding, and shared DecentChat workspace bootstrap. The DecentChat plugin remains the transport/runtime layer, but company-sim bootstrap now produces and validates OpenClaw multi-agent topology instead of assuming one agent hosts every employee brain.

**Tech Stack:** TypeScript, Bun, YAML, Node fs/path, DecentChat OpenClaw plugin (`decent-openclaw`), OpenClaw multi-agent config/bindings model.

---

## Product direction change

Old model:
- one OpenClaw agent
- many DecentChat accounts
- role isolation mostly in plugin config

New model:
- one OpenClaw agent **per employee**
- one DecentChat account per employee (usually same id as agent)
- OpenClaw `agents.list` + `bindings` become first-class company-sim outputs
- each employee gets a real workspace with its own `IDENTITY.md`, `AGENTS.md`, role files, and session history

This plan intentionally treats the previous multi-account work as useful groundwork, but no longer as the target architecture.

---

### Task 1: Upgrade the company manifest to describe real OpenClaw agents

**Files:**
- Modify: `decent-openclaw/src/company-sim/types.ts`
- Modify: `decent-openclaw/src/company-sim/manifest.ts`
- Modify: `decent-openclaw/tests/unit/company-manifest.test.ts`
- Modify: `company-sims/software-studio/company.yaml`
- Modify: `company-sims/software-studio/employees/team-manager/IDENTITY.md`
- Modify: `company-sims/software-studio/employees/backend-dev/IDENTITY.md`
- Modify: `company-sims/software-studio/employees/tester/IDENTITY.md`
- Test: `decent-openclaw/tests/unit/company-manifest.test.ts`

1. Write failing tests for the new manifest shape:
   - employee requires `agentId`
   - employee requires `accountId` (or explicit defaulting rule if chosen)
   - optional `workspaceDir` / `workspaceName` / `bindings`
   - duplicate `agentId` rejected separately from duplicate `accountId`
   - manager/team/channel references still validate
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-manifest.test.ts
   ```
3. Implement the smallest schema/validator change that makes agent topology explicit.
4. Update the software-studio example to use agent-centric fields.
5. Re-run and verify pass.
6. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/types.ts decent-openclaw/src/company-sim/manifest.ts decent-openclaw/tests/unit/company-manifest.test.ts company-sims/software-studio/company.yaml company-sims/software-studio/employees/*/IDENTITY.md
   git commit -m "feat(company-sim): model employees as isolated openclaw agents"
   ```

**Expected outcome:** the manifest stops pretending employees are only accounts and starts describing the real OpenClaw topology we want.

---

### Task 2: Build an OpenClaw agent topology planner from the company manifest

**Files:**
- Create: `decent-openclaw/src/company-sim/openclaw-plan.ts`
- Create: `decent-openclaw/tests/unit/company-openclaw-plan.test.ts`
- Modify: `decent-openclaw/src/company-sim/bootstrap.ts`
- Test: `decent-openclaw/tests/unit/company-openclaw-plan.test.ts`

1. Write failing tests for a pure planner that converts manifest → OpenClaw topology:
   - `agents.list[]` entries with `id`, `workspace`, optional identity metadata
   - `bindings[]` entries routing `channel: "decentchat"` + `accountId` to each `agentId`
   - deterministic workspace paths for employees
   - one designated bootstrap/owner agent for workspace materialization
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-openclaw-plan.test.ts
   ```
3. Implement a planner that produces a serializable artifact without mutating host config yet.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/openclaw-plan.ts decent-openclaw/src/company-sim/bootstrap.ts decent-openclaw/tests/unit/company-openclaw-plan.test.ts
   git commit -m "feat(company-sim): generate openclaw agent and binding plan"
   ```

**Expected outcome:** we can compute the exact OpenClaw multi-agent layout before touching config or workspaces.

---

### Task 3: Scaffold per-agent workspaces with company and role files

**Files:**
- Create: `decent-openclaw/src/company-sim/workspace-scaffold.ts`
- Create: `decent-openclaw/tests/unit/company-workspace-scaffold.test.ts`
- Modify: `company-sims/software-studio/COMPANY.md`
- Modify: `company-sims/software-studio/ORG.md`
- Modify: `company-sims/software-studio/WORKFLOWS.md`
- Test: `decent-openclaw/tests/unit/company-workspace-scaffold.test.ts`

1. Write failing tests for workspace scaffolding:
   - creates one workspace directory per employee agent
   - writes `IDENTITY.md` from employee identity source
   - writes company shared files (`COMPANY.md`, `ORG.md`, `WORKFLOWS.md`)
   - writes employee-local files (`ROLE.md`, `RULES.md`, `MEMORY.md`, `PLAYBOOK.md`)
   - idempotent re-run does not duplicate or corrupt files
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-workspace-scaffold.test.ts
   ```
3. Implement minimal filesystem scaffolder.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/workspace-scaffold.ts decent-openclaw/tests/unit/company-workspace-scaffold.test.ts company-sims/software-studio/COMPANY.md company-sims/software-studio/ORG.md company-sims/software-studio/WORKFLOWS.md
   git commit -m "feat(company-sim): scaffold isolated agent workspaces"
   ```

**Expected outcome:** each employee can become a real OpenClaw workspace, not just a manifest row.

---

### Task 4: Install/update OpenClaw config for the company agent topology

**Files:**
- Create: `decent-openclaw/src/company-sim/install.ts`
- Create: `decent-openclaw/tests/integration/company-openclaw-install.test.ts`
- Modify: `decent-openclaw/src/types.ts`
- Modify: `decent-openclaw/src/channel.ts`
- Test: `decent-openclaw/tests/integration/company-openclaw-install.test.ts`

1. Write failing integration tests for config installation:
   - updates `agents.list` with employee agents
   - updates `bindings` for DecentChat `accountId -> agentId`
   - preserves unrelated existing agents/bindings
   - remains idempotent on rerun
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/integration/company-openclaw-install.test.ts
   ```
3. Implement installer logic:
   - read OpenClaw config JSON/JSON5
   - merge agent topology safely
   - do not clobber unrelated config
   - expose dry-run / plan output support if cheap
4. Add startup/config guard in `channel.ts` so old single-agent bootstrap does not silently pretend to satisfy isolated-agent mode.
5. Re-run and verify pass.
6. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/install.ts decent-openclaw/tests/integration/company-openclaw-install.test.ts decent-openclaw/src/types.ts decent-openclaw/src/channel.ts
   git commit -m "feat(company-sim): install openclaw agents and routing bindings"
   ```

**Expected outcome:** company-sim can materialize real OpenClaw agent configuration, not just DecentChat runtime state.

---

### Task 5: Make company runtime agent-local instead of “one process knows everyone”

**Files:**
- Modify: `decent-openclaw/src/company-sim/context-loader.ts`
- Modify: `decent-openclaw/src/company-sim/prompt-context.ts`
- Modify: `decent-openclaw/src/monitor.ts`
- Create: `decent-openclaw/tests/unit/company-agent-runtime.test.ts`
- Test: `decent-openclaw/tests/unit/company-agent-runtime.test.ts`

1. Write failing tests for agent-local runtime behavior:
   - current agent resolves its own employee identity from local config/workspace
   - prompt context is assembled from that agent’s workspace files
   - another employee’s files are not required to answer
   - missing agent-local setup yields a clear operator error
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-agent-runtime.test.ts
   ```
3. Implement minimal runtime refactor so the plugin behaves correctly when each employee is a separate OpenClaw agent.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/context-loader.ts decent-openclaw/src/company-sim/prompt-context.ts decent-openclaw/src/monitor.ts decent-openclaw/tests/unit/company-agent-runtime.test.ts
   git commit -m "refactor(company-sim): run employee behavior from isolated agent workspaces"
   ```

**Expected outcome:** the runtime model finally matches the architecture: each employee thinks from its own workspace.

---

### Task 6: End-to-end installation + workspace bootstrap smoke coverage

**Files:**
- Create: `decent-openclaw/tests/integration/company-multi-agent-bootstrap.test.ts`
- Modify: `decent-openclaw/src/company-sim/bootstrap.ts`
- Test: `decent-openclaw/tests/integration/company-multi-agent-bootstrap.test.ts`

1. Write failing end-to-end integration coverage for the whole flow:
   - manifest parsed
   - agent topology planned
   - workspaces scaffolded
   - OpenClaw config merged with agents/bindings
   - DecentChat workspace/channels/members materialized for employee accounts
   - rerun stays idempotent
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/integration/company-multi-agent-bootstrap.test.ts
   ```
3. Implement any missing glue with smallest surface area.
4. Re-run and verify pass.
5. Broader verification:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw && bun test
   cd /Users/claw/Projects/decent-chat/decent-client-web && bun run test:unit && PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-*.spec.ts --project=chromium
   cd /Users/claw/Projects/decent-chat/decent-protocol && bun test
   cd /Users/claw/Projects/decent-chat && bun run typecheck
   ```
6. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/bootstrap.ts decent-openclaw/tests/integration/company-multi-agent-bootstrap.test.ts
   git commit -m "test(company-sim): cover isolated openclaw agent bootstrap flow"
   ```

**Expected outcome:** the new architecture is no longer hand-wavy; it is installable, testable, and restart-safe.

---

## Rollout order

1. Agent-aware manifest
2. OpenClaw topology planner
3. Per-agent workspace scaffolding
4. Config installer + routing bindings
5. Agent-local runtime behavior
6. End-to-end smoke coverage

## Important guardrails

- Do **not** keep the old multi-account-only path as the silent default for company-sim once isolated-agent mode is enabled.
- Preserve unrelated `agents.list` and `bindings` entries when installing/updating company topology.
- Prefer deterministic IDs/paths and idempotent writes everywhere.
- Employee identity isolation must come from real OpenClaw agent boundaries: workspace, auth, sessions, and routing.

## Handoff

Options:
1. Subagent-Driven — start Task 1 immediately and work through the rework in order.
2. Parallel Session — run the implementation in a separate execution session while keeping chat here for design checkpoints.
