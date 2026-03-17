# Company Simulation Workspaces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Let a human create a DecentChat workspace that behaves like a small company, with multiple OpenClaw-backed employee identities, local role files, team boundaries, and manager-style reporting flows.

**Architecture:** Build this as a true multi-identity DecentChat/OpenClaw system, not one bot roleplaying many people. Each employee is a separate DecentChat account/peer hosted by the same OpenClaw gateway, with distinct seed phrase, alias, avatar, role metadata, and local markdown context files. A company manifest defines org structure, employee roles, channel/team routing, escalation rules, and participation heuristics. The DecentChat UI already understands `isBot`; extend that into richer agent profile metadata (role, team, manager, avatar, company-sim flags) and use it to render employee badges and clearer presence.

**Tech Stack:** TypeScript, Bun, Playwright, DecentChat protocol (`decent-protocol`), DecentChat web client (`decent-client-web`), OpenClaw channel plugin (`decent-openclaw`), local markdown manifests, OpenClaw session routing.

---

## Product Spec

### Core Idea

A **company simulation workspace** is a normal DecentChat workspace whose members may include one or more OpenClaw-backed employee identities. Those identities act like people in an org chart, but their capabilities are configurable and need not match human limitations.

Examples:
- small software team: PM + 2 developers + tester + human CEO
- two-team org: engineering + QA + marketing
- research org: analyst + editor + reviewer + coordinator

### Key Product Principles

1. **Real identities, not name swapping**
   - Each employee should be a distinct DecentChat peer/member.
   - Separate alias, avatar, memory, role files, and session history.

2. **Local role context, not hardcoded prompt soup**
   - Company and employee behavior lives in editable `.md` files.
   - Runtime loads those files and injects them as employee-specific context.

3. **Manager-up communication by default**
   - Specialists mostly work in task threads.
   - Managers summarize upward.
   - Human CEO should not receive internal chatter unless asked.

4. **Explicit authority boundaries**
   - Persona, authority, and capability are separate fields.
   - Example: a tester may be direct in tone, able to run test suites, but unable to deploy.

5. **Progressive delivery**
   - MVP: one company, one workspace, one or two teams, 3–6 employees.
   - Follow-up: templates, autonomous rituals, hiring/spawning flows, multi-company support.

---

## MVP Scope

### In Scope
- One workspace can be marked as a company-simulation workspace.
- One OpenClaw gateway can host multiple DecentChat employee accounts.
- Each employee account loads role/company context from local markdown files.
- Employee members appear with distinct bot/role/team metadata in member list and messages.
- Human can talk to specific employees directly in channels/threads.
- Participation rules prevent every employee from replying to everything.
- Team manager / PM acts as default upward summarizer.

### Out of Scope (MVP)
- Dynamic hiring/firing from the UI
- Fully autonomous company running without human prompts
- Cross-company federation
- Payroll/economy/game mechanics
- Fine-grained economic simulation
- Multi-gateway distributed employee hosting

---

## Recommended Local File Layout

```text
company-sims/
  software-studio/
    company.yaml
    COMPANY.md
    ORG.md
    WORKFLOWS.md
    teams/
      engineering.md
      marketing.md
    employees/
      team-manager/
        IDENTITY.md
        ROLE.md
        RULES.md
        MEMORY.md
        PLAYBOOK.md
      backend-dev/
        IDENTITY.md
        ROLE.md
        RULES.md
        MEMORY.md
        PLAYBOOK.md
      frontend-dev/
        IDENTITY.md
        ROLE.md
        RULES.md
        MEMORY.md
        PLAYBOOK.md
      tester/
        IDENTITY.md
        ROLE.md
        RULES.md
        MEMORY.md
        PLAYBOOK.md
```

### Suggested `company.yaml`

```yaml
id: software-studio
name: Software Studio
mode: company-sim
workspace:
  name: Studio HQ
  channels:
    - general
    - engineering
    - qa
    - marketing
    - leadership
teams:
  - id: engineering
    name: Engineering
    managerEmployeeId: team-manager
  - id: qa
    name: QA
    managerEmployeeId: tester
employees:
  - id: team-manager
    accountId: team-manager
    alias: Mira PM
    teamId: engineering
    title: Team Manager
    managerEmployeeId:
    reportsToHumanRole: ceo
    channels: [general, engineering, leadership]
    participation:
      mode: summary-first
      respondWhenMentioned: true
      respondToChannelTopics: [planning, prioritization, blockers, status]
  - id: backend-dev
    accountId: backend-dev
    alias: Rian Backend
    teamId: engineering
    title: Backend Engineer
    managerEmployeeId: team-manager
    channels: [engineering]
    participation:
      mode: specialist
      respondWhenMentioned: true
      replyInThreadsOnly: true
  - id: tester
    accountId: tester
    alias: Iva QA
    teamId: qa
    title: QA Engineer
    managerEmployeeId: team-manager
    channels: [qa, engineering]
    participation:
      mode: specialist
      respondWhenMentioned: true
      replyInThreadsOnly: true
```

---

## Runtime Model

### Employee Identity
Each employee is backed by a DecentChat/OpenClaw account entry with:
- `accountId`
- `seedPhrase`
- `alias`
- `avatarUrl` or default avatar
- `companySim.companyId`
- `companySim.employeeId`

### Role Context Construction
On inbound message for an employee account, build prompt context from:
1. `COMPANY.md`
2. `ORG.md`
3. `WORKFLOWS.md`
4. team file (optional)
5. employee `IDENTITY.md`
6. employee `ROLE.md`
7. employee `RULES.md`
8. employee `PLAYBOOK.md`
9. employee `MEMORY.md`

### Participation Rules
Each employee manifest should define when they speak:
- mention-only
- specialist-thread-only
- summary-first
- silent-unless-routed
- proactive-on-owned-channel

### Reporting Rules
Default org behavior:
- specialists answer in task threads
- manager summarizes to `#general` or `#leadership`
- human CEO can mention a team or manager, not just an individual

---

## UX Acceptance Criteria

1. Human can create or configure a workspace with 3–6 employee agents.
2. Employee agents appear as separate members with role/team/bot affordances.
3. Human can address employees by name/mention and get role-appropriate replies.
4. Only the relevant employees respond; no “agent pile-on”.
5. Manager can summarize work from specialists without leaking internal role memory.
6. Employee files are editable locally and change behavior after reload/restart.
7. Each employee has isolated session history and memory.
8. Threads remain the default place for task execution.

---

## Technical Risks / Design Constraints

1. **Multi-account DecentChat plugin support is the main enabler**
   - Current plugin only resolves a single default account.
   - True employee identities require multiple DecentChat accounts per gateway.

2. **Participation control matters as much as identity**
   - Without routing heuristics, every employee will speak too often.

3. **Prompt injection / role contamination risk**
   - Company markdown files are trusted local files.
   - Channel messages are untrusted.
   - Employee memory must not silently leak across employees.

4. **Thread routing must remain stable**
   - This pairs with the recent fix that auto-threads top-level messages.
   - Company employees should default to thread replies for task work.

---

## Implementation Tasks

### Task 1: Define company-sim manifest schema + example template

**Files:**
- Create: `decent-openclaw/src/company-sim/types.ts`
- Create: `decent-openclaw/src/company-sim/manifest.ts`
- Create: `decent-openclaw/tests/unit/company-manifest.test.ts`
- Create: `company-sims/software-studio/company.yaml`
- Create: `company-sims/software-studio/COMPANY.md`
- Create: `company-sims/software-studio/ORG.md`
- Create: `company-sims/software-studio/WORKFLOWS.md`
- Create: `company-sims/software-studio/employees/team-manager/{IDENTITY.md,ROLE.md,RULES.md,MEMORY.md,PLAYBOOK.md}`
- Create: `company-sims/software-studio/employees/backend-dev/{IDENTITY.md,ROLE.md,RULES.md,MEMORY.md,PLAYBOOK.md}`
- Create: `company-sims/software-studio/employees/tester/{IDENTITY.md,ROLE.md,RULES.md,MEMORY.md,PLAYBOOK.md}`
- Test: `decent-openclaw/tests/unit/company-manifest.test.ts`

1. Write failing unit tests for:
   - manifest parsing
   - employee/team lookup
   - invalid manager/team references rejected
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-manifest.test.ts
   ```
3. Implement minimal parser/validator and example template.
4. Re-run and verify pass.
5. Commit:
   ```bash
   git add decent-openclaw/src/company-sim decent-openclaw/tests/unit/company-manifest.test.ts company-sims/software-studio
   git commit -m "feat(company-sim): add manifest schema and software-studio template"
   ```

---

### Task 2: Add multi-account DecentChat plugin support for employee identities

**Files:**
- Modify: `decent-openclaw/src/channel.ts`
- Modify: `decent-openclaw/src/types.ts`
- Modify: `decent-openclaw/src/peer-registry.ts`
- Modify: `decent-openclaw/src/runtime.ts`
- Create: `decent-openclaw/tests/unit/multi-account-company-sim.test.ts`
- Test: `decent-openclaw/tests/unit/multi-account-company-sim.test.ts`

1. Write failing tests for:
   - multiple DecentChat account IDs resolved from config
   - each account gets its own peer runtime + alias
   - company-sim metadata can be attached per account
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/multi-account-company-sim.test.ts
   ```
3. Replace single-account assumptions with `accounts.<id>` support in config resolution.
4. Ensure per-account runtime isolation.
5. Re-run tests and verify pass.
6. Commit:
   ```bash
   git add decent-openclaw/src/channel.ts decent-openclaw/src/types.ts decent-openclaw/src/peer-registry.ts decent-openclaw/src/runtime.ts decent-openclaw/tests/unit/multi-account-company-sim.test.ts
   git commit -m "feat(decent-openclaw): add multi-account support for employee identities"
   ```

---

### Task 3: Load employee/company markdown context and inject it per account

**Files:**
- Create: `decent-openclaw/src/company-sim/context-loader.ts`
- Create: `decent-openclaw/src/company-sim/prompt-context.ts`
- Modify: `decent-openclaw/src/monitor.ts`
- Create: `decent-openclaw/tests/unit/company-context-loader.test.ts`
- Create: `decent-openclaw/tests/unit/company-prompt-context.test.ts`
- Test: `decent-openclaw/tests/unit/company-context-loader.test.ts`
- Test: `decent-openclaw/tests/unit/company-prompt-context.test.ts`

1. Write failing tests for:
   - ordered markdown loading
   - employee-specific prompt context assembly
   - isolation between employee A and employee B
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-context-loader.test.ts tests/unit/company-prompt-context.test.ts
   ```
3. Implement context loader and prompt prefix builder.
4. Modify inbound message handling so each account receives its own company/role context.
5. Re-run and verify pass.
6. Commit:
   ```bash
   git add decent-openclaw/src/company-sim/context-loader.ts decent-openclaw/src/company-sim/prompt-context.ts decent-openclaw/src/monitor.ts decent-openclaw/tests/unit/company-context-loader.test.ts decent-openclaw/tests/unit/company-prompt-context.test.ts
   git commit -m "feat(company-sim): inject per-employee company and role context"
   ```

---

### Task 4: Extend directory/member metadata for role, team, manager, and avatar

**Files:**
- Modify: `decent-protocol/src/workspace/DirectoryTypes.ts`
- Modify: `decent-protocol/src/workspace/types.ts`
- Modify: `decent-protocol/src/workspace/WorkspaceManager.ts`
- Create: `decent-protocol/tests/unit/company-member-profile.test.ts`
- Test: `decent-protocol/tests/unit/company-member-profile.test.ts`

1. Write failing protocol tests for new member metadata:
   - `roleTitle`
   - `teamId`
   - `managerPeerId`
   - `avatarUrl`
   - `automationKind: 'openclaw-agent'`
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-protocol
   bun test tests/unit/company-member-profile.test.ts
   ```
3. Add backward-compatible optional fields to member and directory types.
4. Ensure manager preserves/merges metadata safely during sync.
5. Re-run and verify pass.
6. Commit:
   ```bash
   git add decent-protocol/src/workspace/DirectoryTypes.ts decent-protocol/src/workspace/types.ts decent-protocol/src/workspace/WorkspaceManager.ts decent-protocol/tests/unit/company-member-profile.test.ts
   git commit -m "feat(protocol): add company employee profile metadata to workspace members"
   ```

---

### Task 5: Render agent/company metadata in the web UI

**Files:**
- Modify: `decent-client-web/src/lib/components/members/MemberRow.svelte`
- Modify: `decent-client-web/src/lib/components/modals/WorkspaceMembersModal.svelte`
- Modify: `decent-client-web/src/lib/components/modals/ChannelMembersModal.svelte`
- Modify: `decent-client-web/src/lib/components/messages/MessageItem.svelte`
- Modify: `decent-client-web/src/ui/styles/main.css`
- Create: `decent-client-web/tests/integration/company-sim-badges.spec.ts`
- Test: `decent-client-web/tests/integration/company-sim-badges.spec.ts`

1. Write failing integration test asserting:
   - employee agents show bot affordance + role title
   - avatar fallback uses OpenClaw/company-sim default when `avatarUrl` missing
   - manager/team metadata is visible in members UX
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-badges.spec.ts --project=chromium
   ```
3. Implement UI chips/badges:
   - `BOT`
   - role title (e.g. `QA Engineer`)
   - optional team tag
4. Re-run and verify pass.
5. Commit:
   ```bash
   git add src/lib/components/members/MemberRow.svelte src/lib/components/modals/WorkspaceMembersModal.svelte src/lib/components/modals/ChannelMembersModal.svelte src/lib/components/messages/MessageItem.svelte src/ui/styles/main.css tests/integration/company-sim-badges.spec.ts
   git commit -m "feat(ui): render company employee badges and avatars"
   ```

---

### Task 6: Add company participation/routing policy so not every employee responds

**Files:**
- Create: `decent-openclaw/src/company-sim/router.ts`
- Create: `decent-openclaw/src/company-sim/participation.ts`
- Modify: `decent-openclaw/src/monitor.ts`
- Create: `decent-openclaw/tests/unit/company-routing.test.ts`
- Test: `decent-openclaw/tests/unit/company-routing.test.ts`

1. Write failing tests for routing decisions:
   - mention of specialist routes to that specialist
   - channel topic maps to team manager or specialist set
   - unmentioned irrelevant employees stay silent
   - manager summarizes when specialists talk in threads
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-routing.test.ts
   ```
3. Implement routing policy from manifest participation rules.
4. Make monitor suppress responses when employee is not the intended participant.
5. Re-run and verify pass.
6. Commit:
   ```bash
   git add decent-openclaw/src/company-sim/router.ts decent-openclaw/src/company-sim/participation.ts decent-openclaw/src/monitor.ts decent-openclaw/tests/unit/company-routing.test.ts
   git commit -m "feat(company-sim): add employee participation and routing policy"
   ```

---

### Task 7: Add workspace bootstrap flow for a company template

**Files:**
- Create: `decent-openclaw/src/company-sim/bootstrap.ts`
- Modify: `decent-openclaw/src/channel.ts`
- Create: `decent-openclaw/tests/integration/company-bootstrap.test.ts`
- Test: `decent-openclaw/tests/integration/company-bootstrap.test.ts`

1. Write failing integration test for:
   - loading software-studio template
   - creating expected channels
   - auto-joining configured employee accounts to target workspace
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/integration/company-bootstrap.test.ts
   ```
3. Implement bootstrap helper that:
   - validates company manifest
   - maps employees → account configs
   - seeds channel membership/invite flow
4. Re-run and verify pass.
5. Commit:
   ```bash
   git add decent-openclaw/src/company-sim/bootstrap.ts decent-openclaw/src/channel.ts decent-openclaw/tests/integration/company-bootstrap.test.ts
   git commit -m "feat(company-sim): bootstrap workspace and employee accounts from template"
   ```

---

### Task 8: Add end-to-end happy-path company simulation tests

**Files:**
- Create: `decent-client-web/tests/integration/company-sim-workflow.spec.ts`
- Modify: `decent-client-web/tests/integration/helpers.ts`
- Test: `decent-client-web/tests/integration/company-sim-workflow.spec.ts`

1. Write failing end-to-end scenario:
   - human CEO joins workspace
   - manager, backend dev, tester are present as separate members
   - CEO asks for a feature in `#general`
   - manager responds and opens thread / routes work
   - specialist replies only in task thread
   - tester posts verification
   - manager posts summary back to CEO
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-workflow.spec.ts --project=chromium
   ```
3. Implement missing hooks/fixtures until green.
4. Re-run broader checks:
   ```bash
   cd /Users/claw/Projects/decent-chat
   bun run test:protocol
   cd decent-openclaw && bun test
   cd ../decent-client-web && bun run test:unit && PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-*.spec.ts --project=chromium
   cd .. && bun run typecheck
   ```
5. Commit:
   ```bash
   git add decent-client-web/tests/integration/company-sim-workflow.spec.ts decent-client-web/tests/integration/helpers.ts
   git commit -m "test(company-sim): add end-to-end software-studio workflow coverage"
   ```

---

## Rollout Order

1. Manifest + template
2. Multi-account support
3. Prompt/context injection
4. Protocol metadata
5. UI badges/avatar/role rendering
6. Participation routing
7. Bootstrap flow
8. Full E2E workflow

---

## Notes for Implementation

- Reuse existing `isBot` support; do not invent a second bot flag.
- Keep company-sim metadata optional and backward compatible.
- Treat all markdown role files as trusted local config, not synced workspace content.
- Preserve per-employee session isolation.
- Keep task execution in threads by default.
- Pair this with the top-level auto-threading fix so multiple employee conversations do not block each other.
- Huddle support should be a follow-up once employee identities are stable; the existing `decent-openclaw/src/huddle/*` stack already gives a strong starting point.

---

## Handoff

After review, choose one:
1. **Subagent-Driven** — I break this into execution slices here and implement it in phases.
2. **Parallel Session** — I spawn an isolated implementation session focused only on company-sim MVP.
