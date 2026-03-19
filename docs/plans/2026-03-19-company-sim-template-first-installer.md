# Company Sim Template-First Installer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** replace YAML-first company-sim setup with a template-first installer flow where users choose a team preset, answer a small wizard, and the system generates the internal manifest/topology automatically.

**Architecture:** Keep the new isolated-OpenClaw-agent substrate already built (agent-centric manifest, workspace scaffold, config materializer, bootstrap validation, agent-local context), but move the primary UX up one layer. Templates become the user-facing abstraction; an installer compiles template + answers into an internal company manifest, generates employee DecentChat accounts/topology, scaffolds agent workspaces, materializes OpenClaw config/bindings, and bootstraps the shared DecentChat workspace.

**Tech Stack:** TypeScript, Bun, Zod/YAML, Svelte, DecentChat web client, Decent OpenClaw plugin, OpenClaw multi-agent routing.

---

## Product direction

### User-facing mental model
- "Install an AI team"
- choose a template card
- answer 5–10 human-friendly questions
- click install

### Internal model
- template registry
- template instance answers
- compiler → internal manifest/topology
- installer → accounts + agent workspaces + bindings + workspace bootstrap

### Non-goals
- do not expose raw YAML as the default path
- do not require manual hand-editing of `agents.list` or `bindings`
- do not remove advanced import/export; just demote it to power-user mode

---

### Task 1: Add template registry and template metadata schema

**Files:**
- Create: `decent-openclaw/src/company-sim/template-registry.ts`
- Create: `decent-openclaw/src/company-sim/template-types.ts`
- Create: `decent-openclaw/tests/unit/company-template-registry.test.ts`
- Create: `company-sims/templates/software-studio/template.yaml`
- Create: `company-sims/templates/software-studio/COMPANY.md`
- Create: `company-sims/templates/software-studio/ORG.md`
- Create: `company-sims/templates/software-studio/WORKFLOWS.md`
- Create: `company-sims/templates/software-studio/employees/manager/IDENTITY.md`
- Create: `company-sims/templates/software-studio/employees/manager/ROLE.md`
- Create: `company-sims/templates/software-studio/employees/manager/RULES.md`
- Create: `company-sims/templates/software-studio/employees/backend/IDENTITY.md`
- Create: `company-sims/templates/software-studio/employees/backend/ROLE.md`
- Create: `company-sims/templates/software-studio/employees/backend/RULES.md`
- Create: `company-sims/templates/software-studio/employees/qa/IDENTITY.md`
- Create: `company-sims/templates/software-studio/employees/qa/ROLE.md`
- Create: `company-sims/templates/software-studio/employees/qa/RULES.md`
- Test: `decent-openclaw/tests/unit/company-template-registry.test.ts`

1. Write failing tests for:
   - listing available templates
   - parsing template metadata (`id`, `label`, `description`, `icon`, `roles`, `questions`, defaults)
   - rejecting invalid/missing template assets
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-template-registry.test.ts
   ```
3. Implement minimal registry + schema and add the first `software-studio` template.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/template-registry.ts decent-openclaw/src/company-sim/template-types.ts decent-openclaw/tests/unit/company-template-registry.test.ts company-sims/templates/software-studio
   git commit -m "feat(company-sim): add template registry for team presets"
   ```

---

### Task 2: Compile template answers into an internal company manifest/topology

**Files:**
- Create: `decent-openclaw/src/company-sim/template-compiler.ts`
- Create: `decent-openclaw/tests/unit/company-template-compiler.test.ts`
- Modify: `decent-openclaw/src/company-sim/types.ts`
- Test: `decent-openclaw/tests/unit/company-template-compiler.test.ts`

1. Write failing tests for compiler behavior:
   - selected template + wizard answers produce a valid internal manifest
   - generates employee `agentId`/`accountId`/aliases/channels deterministically
   - allows optional role removal/addition within template limits
   - preserves template behavioral defaults unless explicitly overridden
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-template-compiler.test.ts
   ```
3. Implement minimal compiler.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/template-compiler.ts decent-openclaw/src/company-sim/types.ts decent-openclaw/tests/unit/company-template-compiler.test.ts
   git commit -m "feat(company-sim): compile team templates into internal manifests"
   ```

---

### Task 3: Add installer engine for accounts + topology materialization

**Files:**
- Create: `decent-openclaw/src/company-sim/template-installer.ts`
- Create: `decent-openclaw/tests/integration/company-template-installer.test.ts`
- Modify: `decent-openclaw/src/company-sim/openclaw-config.ts`
- Modify: `decent-openclaw/src/company-sim/workspace-scaffold.ts`
- Test: `decent-openclaw/tests/integration/company-template-installer.test.ts`

1. Write failing integration tests for installer behavior:
   - generates missing DecentChat account entries deterministically for employee roles
   - scaffolds per-agent workspaces
   - merges OpenClaw `agents.list` + `bindings`
   - returns a clear install summary (created agents/accounts/channels)
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/integration/company-template-installer.test.ts
   ```
3. Implement minimal installer engine.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/template-installer.ts decent-openclaw/src/company-sim/openclaw-config.ts decent-openclaw/src/company-sim/workspace-scaffold.ts decent-openclaw/tests/integration/company-template-installer.test.ts
   git commit -m "feat(company-sim): install templates into agents accounts and bindings"
   ```

---

### Task 4: Add operator CLI/install-flow coverage and documentation

**Files:**
- Create: `docs/openclaw/company-sim-template-installer.md`
- Create: `decent-openclaw/tests/integration/company-template-install-flow.test.ts`
- Modify: `docs/openclaw/configuration.md`
- Modify: `docs/openclaw/operations.md`
- Test: `decent-openclaw/tests/integration/company-template-install-flow.test.ts`

1. Write failing install-flow tests for:
   - list templates
   - instantiate `software-studio` with answers
   - install generated topology
   - validate/bootstrap shared DecentChat workspace successfully
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/integration/company-template-install-flow.test.ts
   ```
3. Implement the missing glue and document exact operator steps for a first shippable path.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add docs/openclaw/company-sim-template-installer.md docs/openclaw/configuration.md docs/openclaw/operations.md decent-openclaw/tests/integration/company-template-install-flow.test.ts
   git commit -m "docs(company-sim): document template-first installer workflow"
   ```

---

### Task 5: Add workspace UI for choosing a team template

**Files:**
- Create: `decent-client-web/src/lib/components/modals/InstallTeamTemplateModal.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/TemplateCard.svelte`
- Create: `decent-client-web/tests/integration/company-template-picker.spec.ts`
- Modify: `decent-client-web/src/ui/UIRenderer.ts`
- Modify: `decent-client-web/src/lib/components/layout/Sidebar.svelte`
- Modify: `decent-client-web/src/lib/components/layout/WelcomePage.svelte`
- Test: `decent-client-web/tests/integration/company-template-picker.spec.ts`

1. Write failing UI/integration test for:
   - user opens “Add AI Team” modal
   - sees template cards
   - picks `Software Studio`
   - sees setup questions and review summary
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   PW_ENABLE_SIGNALING=0 bunx playwright test tests/integration/company-template-picker.spec.ts --project=chromium
   ```
3. Implement minimal template-picker modal and wire entry points.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-client-web/src/lib/components/modals/InstallTeamTemplateModal.svelte decent-client-web/src/lib/components/company-sim/TemplateCard.svelte decent-client-web/src/ui/UIRenderer.ts decent-client-web/src/lib/components/layout/Sidebar.svelte decent-client-web/src/lib/components/layout/WelcomePage.svelte decent-client-web/tests/integration/company-template-picker.spec.ts
   git commit -m "feat(company-sim): add template picker UI for team installation"
   ```

---

### Task 6: Wire the wizard to real installation and show install result

**Files:**
- Create: `decent-client-web/src/lib/components/company-sim/TemplateWizard.svelte`
- Create: `decent-client-web/tests/integration/company-template-install.spec.ts`
- Modify: `decent-openclaw/src/channel.ts`
- Modify: `decent-openclaw/src/runtime.ts`
- Modify: `decent-client-web/src/ui/types.ts`
- Modify: `decent-client-web/src/ui/UIRenderer.ts`
- Test: `decent-client-web/tests/integration/company-template-install.spec.ts`

1. Write failing end-to-end integration test for:
   - pick template
   - answer wizard questions
   - trigger install
   - show install summary / success state
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   PW_ENABLE_SIGNALING=0 bunx playwright test tests/integration/company-template-install.spec.ts --project=chromium
   ```
3. Implement minimal glue between UI and installer backend.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-client-web/src/lib/components/company-sim/TemplateWizard.svelte decent-client-web/src/ui/types.ts decent-client-web/src/ui/UIRenderer.ts decent-client-web/tests/integration/company-template-install.spec.ts decent-openclaw/src/channel.ts decent-openclaw/src/runtime.ts
   git commit -m "feat(company-sim): install AI teams from the workspace UI"
   ```

---

### Task 7: Add advanced export/import path for power users

**Files:**
- Create: `decent-openclaw/src/company-sim/template-export.ts`
- Create: `decent-openclaw/tests/unit/company-template-export.test.ts`
- Modify: `docs/openclaw/company-sim-template-installer.md`
- Test: `decent-openclaw/tests/unit/company-template-export.test.ts`

1. Write failing tests for:
   - exporting the generated internal manifest/template instance for backup/debugging
   - importing/replaying an install in advanced mode
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-template-export.test.ts
   ```
3. Implement minimal export/import helpers and docs.
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/template-export.ts decent-openclaw/tests/unit/company-template-export.test.ts docs/openclaw/company-sim-template-installer.md
   git commit -m "feat(company-sim): add advanced export import path for templates"
   ```

---

## Recommended execution order

1. Task 1 — template registry
2. Task 2 — template compiler
3. Task 3 — installer engine
4. Task 4 — install-flow docs + operator coverage
5. Task 5 — template picker UI
6. Task 6 — real install from UI
7. Task 7 — advanced export/import path

## Existing work this plan builds on

Already done on the isolated-agent substrate:
- agent-centric manifest
- agent topology planner
- workspace scaffold
- OpenClaw config/binding materializer
- runtime/bootstrap validation
- agent-local context resolution

This plan should reuse that work instead of replacing it.

## Verification sweep after Tasks 1–6

```bash
cd /Users/claw/Projects/decent-chat/decent-openclaw && bun test
cd /Users/claw/Projects/decent-chat/decent-client-web && bun run test:unit && PW_ENABLE_SIGNALING=0 bunx playwright test tests/integration/company-template-*.spec.ts --project=chromium
cd /Users/claw/Projects/decent-chat/decent-protocol && bun test
cd /Users/claw/Projects/decent-chat && bun run typecheck
```

## Handoff

Options:
1. Subagent-Driven — implement Task 1 now in this session.
2. Parallel Session — spin off a dedicated installer/UI implementation thread.
