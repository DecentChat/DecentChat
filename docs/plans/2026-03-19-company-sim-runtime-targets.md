# Company Sim Runtime Targets & Multi-Instance Routing Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** support local self-hosted OpenClaw, hosted OpenClaw, and multiple user-owned local OpenClaw instances as installation targets for AI teams.

**Architecture:** add a runtime-target layer above the existing template installer. Templates still compile into internal manifests, but installation no longer assumes one local OpenClaw runtime. Instead, each team install targets a selected runtime host (`local`, `hosted`, or `external paired runtime`). In v1, one team install maps to exactly one runtime target to avoid split-brain. Later phases can support sharded/failover multi-runtime teams.

**Tech Stack:** TypeScript, Bun, DecentChat web client, Decent OpenClaw plugin, OpenClaw multi-agent routing, pairing/registry metadata.

---

## Product model

### New abstraction: Runtime Target
A runtime target is an OpenClaw environment capable of hosting one or more employee agents.

Example kinds:
- `local-self-hosted` — the user’s current local OpenClaw
- `hosted-managed` — our hosted OpenClaw tenant/runtime
- `external-paired` — another user’s paired local OpenClaw instance

Each target should expose:
- `runtimeTargetId`
- `kind`
- `ownerUserId`
- `label`
- `status` (`online`, `offline`, `degraded`)
- `capabilities` (templates supported, plugin support, version, model/auth readiness)
- `installMode` (`exclusive`, later maybe `shared`)

### Core safety rule for v1
**One installed AI team = one runtime target.**

Do not distribute employees of the same team across multiple runtimes in v1.
Why:
- avoids split-brain
- avoids duplicate bindings/accounts
- makes billing/debugging/ops much simpler

---

## How to handle multiple local OpenClaws

### User story
Multiple users may each have their own local OpenClaw instance and all participate in the same DecentChat workspace.

### Proposed handling
Treat each local OpenClaw as a separately paired runtime target.

So the workspace might have available targets like:
- `alex-macbook` (local-self-hosted or external-paired)
- `adela-mac-mini` (external-paired)
- `hosted-eu-west-1` (hosted-managed)

When installing a team, the installer asks:
**“Where should this AI team run?”**

Options shown:
- Alex’s MacBook (online)
- Hosted Cloud (online)
- Adela’s Mac mini (offline)

The user chooses one target.
That target becomes the owner of:
- generated employee accounts
- OpenClaw agents
- bindings
- team runtime lifecycle

### Important consequence
We do **not** auto-merge multiple local OpenClaws into one logical runtime.
Each is just another available target.

That keeps routing deterministic and understandable.

---

## Proposed setup UX

### Install AI Team wizard
1. Choose template
2. Answer team questions
3. Choose runtime target:
   - This device / local OpenClaw
   - Hosted OpenClaw
   - Another paired OpenClaw instance
4. Review plan
5. Install

### Pairing another local OpenClaw
A separate flow should let a user pair/register their OpenClaw instance into the workspace as an available runtime target.

Think of it like:
- “Connect OpenClaw runtime”
- runtime registers itself with label, owner, capabilities, status
- workspace admins can then deploy AI teams to it

---

## Task 1: Define runtime-target schema and registry model

**Files:**
- Create: `decent-openclaw/src/company-sim/runtime-targets.ts`
- Create: `decent-openclaw/tests/unit/company-runtime-targets.test.ts`
- Modify: `decent-openclaw/src/company-sim/types.ts`
- Test: `decent-openclaw/tests/unit/company-runtime-targets.test.ts`

1. Write failing tests for runtime target parsing/validation.
2. Include fields for id, kind, owner, label, status, capabilities, install mode.
3. Re-run to green.

---

## Task 2: Add installer target-selection model

**Files:**
- Modify: `decent-openclaw/src/company-sim/template-compiler.ts`
- Create: `decent-openclaw/src/company-sim/install-target-planner.ts`
- Create: `decent-openclaw/tests/unit/company-install-target-planner.test.ts`
- Test: `decent-openclaw/tests/unit/company-install-target-planner.test.ts`

1. Write failing tests for choosing a runtime target.
2. Ensure compiled install plans bind one team install to exactly one runtime target.
3. Reject ambiguous multi-target ownership in v1.

---

## Task 3: Add local/self-hosted runtime adapter

**Files:**
- Create: `decent-openclaw/src/company-sim/runtime-adapters/local-openclaw.ts`
- Create: `decent-openclaw/tests/integration/company-local-runtime-adapter.test.ts`
- Modify: `decent-openclaw/src/company-sim/template-installer.ts`
- Test: `decent-openclaw/tests/integration/company-local-runtime-adapter.test.ts`

1. Install to the current local OpenClaw config/runtime.
2. Reuse existing scaffold/config/bindings/bootstrap work.
3. Return an install summary.

---

## Task 4: Add paired external-local runtime model

**Files:**
- Create: `decent-openclaw/src/company-sim/runtime-adapters/external-paired.ts`
- Create: `decent-openclaw/tests/unit/company-external-runtime-pairing.test.ts`
- Modify: `docs/openclaw/company-sim-template-installer.md`
- Test: `decent-openclaw/tests/unit/company-external-runtime-pairing.test.ts`

1. Model another user’s local OpenClaw as a paired runtime target.
2. Define registration/pairing metadata only first.
3. Do not implement full remote deployment if transport/protocol is not yet ready; document the shape.

---

## Task 5: Add hosted runtime adapter interface

**Files:**
- Create: `decent-openclaw/src/company-sim/runtime-adapters/hosted-openclaw.ts`
- Create: `decent-openclaw/tests/unit/company-hosted-runtime-adapter.test.ts`
- Create: `docs/openclaw/company-sim-hosted-runtime.md`
- Test: `decent-openclaw/tests/unit/company-hosted-runtime-adapter.test.ts`

1. Define the adapter contract for hosted OpenClaw.
2. Treat hosted as one runtime target per customer/team in v1.
3. Keep employee agents inside that hosted runtime.

---

## Task 6: Add multi-instance safety rules

**Files:**
- Create: `decent-openclaw/src/company-sim/install-leases.ts`
- Create: `decent-openclaw/tests/unit/company-install-leases.test.ts`
- Modify: `decent-openclaw/src/company-sim/template-installer.ts`
- Test: `decent-openclaw/tests/unit/company-install-leases.test.ts`

1. Prevent duplicate installs of the same team to multiple runtimes accidentally.
2. Add lease/ownership semantics for team installs.
3. Reject conflicting bindings/accounts cleanly.

---

## Task 7: Surface runtime target selection in UI

**Files:**
- Modify: `decent-client-web/src/lib/components/company-sim/TemplateWizard.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/RuntimeTargetCard.svelte`
- Create: `decent-client-web/tests/integration/company-runtime-target-picker.spec.ts`
- Test: `decent-client-web/tests/integration/company-runtime-target-picker.spec.ts`

1. Show available targets in the install wizard.
2. Let the user choose local, hosted, or paired external runtime.
3. Show status/capability hints.

---

## Recommended v1 product decisions

- **One team install = one runtime target**
- **Hosted runtime is per customer/team, not per employee**
- **Multiple local OpenClaws are treated as separate selectable targets**
- **No employee sharding across runtimes in v1**
- **YAML remains advanced/export only**

## Plain-English answer to the multi-local question

If several users each have their own local OpenClaw, we do **not** try to magically fuse them together.
We list them as separate runtime targets, and the installer asks which target should host the AI team.
That chosen target becomes the single owner of that team.

This is the cleanest path technically and product-wise.
