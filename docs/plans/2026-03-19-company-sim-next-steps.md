# Company Sim Next Steps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** finish the company-simulation MVP by proving the end-to-end workflow, wiring bootstrap into normal runtime startup, and making local role-file edits cheap to iterate on.

**Architecture:** The foundations already exist across `decent-openclaw`, `decent-protocol`, and `decent-client-web`. The next slice is validation-first: add one realistic cross-layer workflow test, make bootstrap reachable from real runtime config instead of only helper code, and add deterministic context reload so operator edits to role files do not require hacky restarts.

**Tech Stack:** TypeScript, Bun, Playwright, Svelte, DecentChat protocol/client/openclaw packages.

---

### Task 1: Close the full company-sim happy path with one realistic browser workflow

**Files:**
- Create: `decent-client-web/tests/integration/company-sim-workflow.spec.ts`
- Modify: `decent-client-web/tests/integration/helpers.ts`
- Modify: `decent-client-web/tests/e2e/multi-user-helpers.ts`
- Modify: `decent-client-web/src/lib/components/messages/MessageList.svelte`
- Modify: `decent-client-web/src/lib/components/layout/ThreadPanel.svelte`
- Test: `decent-client-web/tests/integration/company-sim-workflow.spec.ts`

1. Write a failing integration test for the exact expected org behavior:
   - human CEO posts feature request in `#general`
   - manager replies in-channel and opens/routes thread work
   - backend engineer answers in the task thread only
   - tester posts verification in the same thread
   - manager posts summary back in `#general`
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-workflow.spec.ts --project=chromium
   ```
3. Add only the minimum hooks needed for stable assertions:
   - test fixture setup for seeded company members
   - stable selectors or test ids for thread panel and message metadata
   - helper utilities for posting as CEO / agent fixtures without coupling to visual text layout
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-client-web/tests/integration/company-sim-workflow.spec.ts decent-client-web/tests/integration/helpers.ts decent-client-web/tests/e2e/multi-user-helpers.ts decent-client-web/src/lib/components/messages/MessageList.svelte decent-client-web/src/lib/components/layout/ThreadPanel.svelte
   git commit -m "test(company-sim): add end-to-end manager specialist workflow coverage"
   ```

**Expected outcome:** one green test that proves the core product promise and catches regressions across routing, threading, and UI rendering.

---

### Task 2: Promote bootstrap from helper code into a real runtime startup path

**Files:**
- Modify: `decent-openclaw/src/channel.ts`
- Modify: `decent-openclaw/src/runtime.ts`
- Modify: `decent-openclaw/src/types.ts`
- Modify: `decent-openclaw/src/company-sim/bootstrap.ts`
- Create: `decent-openclaw/tests/integration/company-bootstrap-runtime.test.ts`
- Test: `decent-openclaw/tests/integration/company-bootstrap-runtime.test.ts`

1. Write a failing integration test for configured startup:
   - config points at `company-sims/software-studio/company.yaml`
   - runtime validates required employee accounts
   - workspace/channels are materialized or looked up deterministically
   - configured employee accounts join the target workspace
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/integration/company-bootstrap-runtime.test.ts
   ```
3. Wire bootstrap into normal runtime/channel initialization:
   - explicit config field for company-sim manifest path / bootstrap mode
   - startup validation errors that name the missing account ids or broken references
   - idempotent bootstrap behavior so restart does not duplicate channels/memberships
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/channel.ts decent-openclaw/src/runtime.ts decent-openclaw/src/types.ts decent-openclaw/src/company-sim/bootstrap.ts decent-openclaw/tests/integration/company-bootstrap-runtime.test.ts
   git commit -m "feat(company-sim): wire bootstrap into runtime startup"
   ```

**Expected outcome:** a real operator can point OpenClaw at one manifest and boot a usable company workspace without bespoke test-only glue.

---

### Task 3: Add deterministic reload for company and employee markdown context

**Files:**
- Modify: `decent-openclaw/src/company-sim/context-loader.ts`
- Modify: `decent-openclaw/src/company-sim/prompt-context.ts`
- Modify: `decent-openclaw/src/monitor.ts`
- Create: `decent-openclaw/tests/unit/company-context-reload.test.ts`
- Create: `decent-openclaw/tests/unit/company-context-cache.test.ts`
- Test: `decent-openclaw/tests/unit/company-context-reload.test.ts`
- Test: `decent-openclaw/tests/unit/company-context-cache.test.ts`

1. Write failing tests for:
   - first message loads company + employee markdown in defined order
   - subsequent messages reuse cached context when files are unchanged
   - touching one employee file refreshes only that employee’s prompt context
   - employee A reload does not contaminate employee B
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-context-reload.test.ts tests/unit/company-context-cache.test.ts
   ```
3. Implement the smallest reload mechanism that is predictable:
   - mtime/hash-based context invalidation or explicit reload token
   - structured cache key per `companyId + employeeId`
   - optional debug logging when a context refresh occurs
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/context-loader.ts decent-openclaw/src/company-sim/prompt-context.ts decent-openclaw/src/monitor.ts decent-openclaw/tests/unit/company-context-reload.test.ts decent-openclaw/tests/unit/company-context-cache.test.ts
   git commit -m "feat(company-sim): support deterministic reload for local role context"
   ```

**Expected outcome:** editing `ROLE.md` / `RULES.md` / `WORKFLOWS.md` becomes fast and safe, which is the difference between a demo and a usable operator workflow.

---

## Recommended execution order

1. Task 1 first — proves the customer-visible product loop.
2. Task 2 second — makes the feature actually bootable without custom glue.
3. Task 3 third — improves iteration speed and makes dogfooding sane.

## Stop conditions / gates

- Do not start autonomous rituals, huddles, or multi-company support before Task 1 is green.
- Do not expose bootstrap UX until Task 2 is idempotent on restart.
- Do not optimize prompt assembly further until Task 3 proves no cross-employee leakage.

## Useful verification sweep after all 3 tasks

```bash
cd /Users/claw/Projects/decent-chat/decent-openclaw && bun test
cd /Users/claw/Projects/decent-chat/decent-client-web && bun run test:unit && PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-*.spec.ts --project=chromium
cd /Users/claw/Projects/decent-chat/decent-protocol && bun test
cd /Users/claw/Projects/decent-chat && bun run typecheck
```

## Handoff

Options:
1. Subagent-Driven — I spawn a coding session to execute Task 1 now.
2. Parallel Session — I spawn a separate execution session and keep this thread for review/checkpoints.
