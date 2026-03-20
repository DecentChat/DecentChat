# Company Sim Control Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** ship a workspace-scoped Company Sim control center in the DecentChat web app that lets operators inspect and edit company docs, understand agent inheritance/routing, and verify provisioning/runtime health.

**Architecture:** Reuse the current company-template install path and extend the existing P2P host control plane instead of introducing a parallel admin backend. Add a new shell-level Company Sim panel in `decent-client-web` (left nav + content panes) backed by explicit control-plane RPCs exposed by `decent-openclaw` for state, docs, effective context, routing preview, and provisioning status. Keep source/generated/live distinctions explicit in the data model and UI so operators can see what is saved, what is installed, and what is actually online.

**Tech Stack:** TypeScript, Svelte 5, Bun, Playwright, DecentChat web client, DecentChat/OpenClaw company-sim control plane.

---

## Scope

### In for v1
- Company Sim entry point from workspace menu and post-install flow
- Overview screen with health/status cards
- Docs browser/editor for company/team/employee markdown
- People inspector with effective-context preview
- Channels inspector with access + routing preview
- Provisioning/runtime status panel
- Sandbox message simulation panel

### Explicitly out for v1
- Rich org-chart drag/drop editing
- Multi-company dashboard
- Real-time collaborative doc editing
- Per-doc version history UI (capture raw change metadata only if cheap)
- Automatic live-apply on every keystroke

### Product rules
- **Raw markdown access is mandatory**
- **Source / Generated / Live status must be visually distinct**
- **Routing decisions must be explainable**
- **Apply/provision is explicit, not automatic**

---

## Task 1: Extend the company-sim control plane with inspect/edit/simulate RPCs

**Files:**
- Create: `decent-openclaw/src/company-sim/control-plane.ts`
- Modify: `decent-openclaw/src/peer/NodeXenaPeer.ts`
- Modify: `decent-openclaw/src/company-sim/context-loader.ts`
- Modify: `decent-openclaw/src/company-sim/prompt-context.ts`
- Modify: `decent-openclaw/src/company-sim/router.ts`
- Create: `decent-openclaw/tests/unit/company-sim-control-plane-state.test.ts`
- Create: `decent-openclaw/tests/unit/company-sim-control-plane-docs.test.ts`
- Create: `decent-openclaw/tests/unit/company-sim-control-plane-routing-preview.test.ts`
- Test: `decent-openclaw/tests/unit/company-sim-control-plane-state.test.ts`
- Test: `decent-openclaw/tests/unit/company-sim-control-plane-docs.test.ts`
- Test: `decent-openclaw/tests/unit/company-sim-control-plane-routing-preview.test.ts`

1. Write failing unit tests for three RPC groups:
   - `company-sim-state-request/response` returns overview, employees, teams, channels, docs, and provisioning summary for a workspace/company
   - `company-sim-doc-read-request/response` and `company-sim-doc-write-request/response` can read/write `COMPANY.md`, `COMMUNICATION.md`, `ORG.md`, `WORKFLOWS.md`, `teams/*.md`, and employee role files
   - `company-sim-routing-preview-request/response` returns responders, suppressed agents, and reasons for a simulated message/tag/owner/channel scenario
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-openclaw
   bun test tests/unit/company-sim-control-plane-state.test.ts tests/unit/company-sim-control-plane-docs.test.ts tests/unit/company-sim-control-plane-routing-preview.test.ts
   ```
3. Implement the smallest service layer in `src/company-sim/control-plane.ts`:
   - resolve the company manifest + doc file map from `company.yaml`
   - load effective context origins per employee (company/team/employee docs)
   - read/write markdown files safely within the company-sim root
   - reuse existing routing logic to produce human-readable reasons instead of duplicating branching in the UI
4. Wire `NodeXenaPeer` to recognize and answer the new workspace-sync control-plane message types without bloating the peer class with file-system logic.
5. Re-run and verify pass.
6. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-openclaw/src/company-sim/control-plane.ts decent-openclaw/src/peer/NodeXenaPeer.ts decent-openclaw/src/company-sim/context-loader.ts decent-openclaw/src/company-sim/prompt-context.ts decent-openclaw/src/company-sim/router.ts decent-openclaw/tests/unit/company-sim-control-plane-state.test.ts decent-openclaw/tests/unit/company-sim-control-plane-docs.test.ts decent-openclaw/tests/unit/company-sim-control-plane-routing-preview.test.ts
   git commit -m "feat(company-sim): add inspect edit and routing preview control plane"
   ```

**Expected outcome:** the host peer exposes everything the UI needs for a real control center without scraping files locally in the browser.

---

## Task 2: Add typed web-client control-plane adapters and company-sim state store

**Files:**
- Modify: `decent-client-web/src/ui/types.ts`
- Modify: `decent-client-web/src/app/ChatController.ts`
- Modify: `decent-client-web/src/main.ts`
- Create: `decent-client-web/src/lib/company-sim/controlPlane.ts`
- Create: `decent-client-web/src/lib/company-sim/types.ts`
- Create: `decent-client-web/src/lib/company-sim/store.svelte.ts`
- Create: `decent-client-web/tests/unit/company-sim-control-plane-client.test.ts`
- Test: `decent-client-web/tests/unit/company-sim-control-plane-client.test.ts`

1. Write a failing unit test that exercises the browser-side request helpers:
   - request state for active workspace
   - read/write a markdown doc
   - request employee effective context
   - request routing preview
   - normalize partial/error responses into stable UI state
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   bun test tests/unit/company-sim-control-plane-client.test.ts
   ```
3. Add explicit company-sim UI contracts to `src/ui/types.ts`, for example:
   - `CompanySimOverview`
   - `CompanySimDocRecord`
   - `CompanySimEmployeeRecord`
   - `CompanySimChannelRecord`
   - `CompanySimProvisioningState`
   - `CompanySimRoutingPreview`
4. Implement `src/lib/company-sim/controlPlane.ts` as a thin typed wrapper over new `ChatController` request methods.
5. Implement `src/lib/company-sim/store.svelte.ts` for panel state:
   - active section (`overview`, `docs`, `people`, `channels`, `provisioning`, `sandbox`)
   - selected doc / employee / channel
   - load/save/apply/simulate busy flags
   - last-fetched source/generated/live summary
6. Re-run and verify pass.
7. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-client-web/src/ui/types.ts decent-client-web/src/app/ChatController.ts decent-client-web/src/main.ts decent-client-web/src/lib/company-sim/controlPlane.ts decent-client-web/src/lib/company-sim/types.ts decent-client-web/src/lib/company-sim/store.svelte.ts decent-client-web/tests/unit/company-sim-control-plane-client.test.ts
   git commit -m "feat(company-sim): add typed client control plane and UI store"
   ```

**Expected outcome:** the web app has one typed source of truth for company-sim state and no panel component needs to know about raw workspace-sync envelopes.

---

## Task 3: Add the shell-level Company Sim control center with overview page

**Files:**
- Modify: `decent-client-web/src/lib/stores/shell.svelte.ts`
- Modify: `decent-client-web/src/ui/registerShellCallbacks.ts`
- Modify: `decent-client-web/src/lib/components/AppShell.svelte`
- Modify: `decent-client-web/src/lib/components/layout/Sidebar.svelte`
- Modify: `decent-client-web/src/lib/components/modals/InstallTeamTemplateModal.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanySimPanel.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanySimSidebar.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanySimOverview.svelte`
- Create: `decent-client-web/tests/integration/company-sim-control-center-shell.spec.ts`
- Test: `decent-client-web/tests/integration/company-sim-control-center-shell.spec.ts`

1. Write a failing Playwright integration test for the shell flow:
   - create/open a workspace
   - open Company Sim from workspace menu (and optionally from post-install CTA)
   - verify left-nav sections render
   - verify overview cards show source/generated/live/provisioned counts
   - close panel and return to normal chat shell intact
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-control-center-shell.spec.ts --project=chromium
   ```
3. Implement a shell-level panel instead of a new router:
   - add `shellData.companySim` panel state similar to activity/search
   - add `onOpenCompanySim` / `onCloseCompanySim` callbacks
   - expose a new workspace-menu action: `Company Sim`
   - add a primary CTA in install result when the template is runtime/config provisioned or when local shell creation completes
4. Build only the overview slice here:
   - header with workspace/company name
   - status strip with **Source / Generated / Live** badges
   - health cards for people, teams, channels, docs, provisioned accounts, online-ready accounts
   - warnings panel for missing docs, muted channels, drift, or offline employees
5. Re-run and verify pass.
6. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-client-web/src/lib/stores/shell.svelte.ts decent-client-web/src/ui/registerShellCallbacks.ts decent-client-web/src/lib/components/AppShell.svelte decent-client-web/src/lib/components/layout/Sidebar.svelte decent-client-web/src/lib/components/modals/InstallTeamTemplateModal.svelte decent-client-web/src/lib/components/company-sim/CompanySimPanel.svelte decent-client-web/src/lib/components/company-sim/CompanySimSidebar.svelte decent-client-web/src/lib/components/company-sim/CompanySimOverview.svelte decent-client-web/tests/integration/company-sim-control-center-shell.spec.ts
   git commit -m "feat(company-sim): add control center shell and overview"
   ```

**Expected outcome:** operators have a discoverable entry point and a non-modal company-sim workspace view that already answers “is this thing alive?”.

---

## Task 4: Build the Docs workspace with raw markdown editing and usage visibility

**Files:**
- Create: `decent-client-web/src/lib/components/company-sim/CompanySimDocs.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanyDocTree.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanyDocEditor.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/SourceStateBadge.svelte`
- Modify: `decent-client-web/src/lib/components/company-sim/CompanySimPanel.svelte`
- Create: `decent-client-web/tests/integration/company-sim-docs-editor.spec.ts`
- Create: `decent-client-web/tests/unit/company-sim-doc-state.test.ts`
- Test: `decent-client-web/tests/unit/company-sim-doc-state.test.ts`
- Test: `decent-client-web/tests/integration/company-sim-docs-editor.spec.ts`

1. Write failing tests for doc behavior:
   - doc tree contains `COMPANY.md`, `COMMUNICATION.md`, `ORG.md`, `WORKFLOWS.md`, `teams/*`, and employee docs
   - selecting a doc loads raw markdown
   - editing shows dirty state
   - save persists via control plane and refreshes preview/used-by metadata
   - source/generated/live badges remain visible during editing
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   bun test tests/unit/company-sim-doc-state.test.ts
   PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-docs-editor.spec.ts --project=chromium
   ```
3. Implement the docs experience:
   - left doc tree grouped by company / teams / employees
   - tabs for `Edit`, `Preview`, and `Used by`
   - raw markdown editor as the primary edit surface
   - explicit `Save` and `Revert` actions
   - impact list that shows which employees inherit the selected doc
4. Keep the preview intentionally lightweight (rendered markdown only; no WYSIWYG detour).
5. Re-run and verify pass.
6. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-client-web/src/lib/components/company-sim/CompanySimDocs.svelte decent-client-web/src/lib/components/company-sim/CompanyDocTree.svelte decent-client-web/src/lib/components/company-sim/CompanyDocEditor.svelte decent-client-web/src/lib/components/company-sim/SourceStateBadge.svelte decent-client-web/src/lib/components/company-sim/CompanySimPanel.svelte decent-client-web/tests/integration/company-sim-docs-editor.spec.ts decent-client-web/tests/unit/company-sim-doc-state.test.ts
   git commit -m "feat(company-sim): add markdown docs workspace"
   ```

**Expected outcome:** the operator can directly edit the actual company markdown files and see who those edits affect.

---

## Task 5: Build People and Channels inspectors with effective-context and routing preview

**Files:**
- Create: `decent-client-web/src/lib/components/company-sim/CompanySimPeople.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanyEmployeeDetail.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanyEffectiveContext.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanySimChannels.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanyChannelDetail.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/RoutingPreviewPanel.svelte`
- Modify: `decent-client-web/src/lib/components/company-sim/CompanySimPanel.svelte`
- Create: `decent-client-web/tests/integration/company-sim-people-and-channels.spec.ts`
- Create: `decent-client-web/tests/unit/company-sim-routing-preview.test.ts`
- Test: `decent-client-web/tests/unit/company-sim-routing-preview.test.ts`
- Test: `decent-client-web/tests/integration/company-sim-people-and-channels.spec.ts`

1. Write failing tests for the two hardest questions operators ask:
   - “What exactly does this employee inherit?”
   - “Why did / didn’t this agent reply in this channel?”
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   bun test tests/unit/company-sim-routing-preview.test.ts
   PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-people-and-channels.spec.ts --project=chromium
   ```
3. Implement the People screen:
   - roster list with name, role, team, model, provisioning status, last seen
   - employee detail tabs: `Profile`, `Instructions`, `Effective context`, `Access`, `Runtime`
   - effective-context view labeled by origin (`COMPANY.md`, team doc, employee role/rules/playbook)
4. Implement the Channels screen:
   - channel list with type, members count, muted-agents count, access mode
   - channel detail with member list, allowed responders, mute rules, and access summary
   - routing preview form for message text, tag (`TASK`, `BLOCKED`, `DONE`, plain), owner, and mention target
   - preview output with `responders`, `suppressed`, and `reason` strings from the control plane
5. Re-run and verify pass.
6. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-client-web/src/lib/components/company-sim/CompanySimPeople.svelte decent-client-web/src/lib/components/company-sim/CompanyEmployeeDetail.svelte decent-client-web/src/lib/components/company-sim/CompanyEffectiveContext.svelte decent-client-web/src/lib/components/company-sim/CompanySimChannels.svelte decent-client-web/src/lib/components/company-sim/CompanyChannelDetail.svelte decent-client-web/src/lib/components/company-sim/RoutingPreviewPanel.svelte decent-client-web/src/lib/components/company-sim/CompanySimPanel.svelte decent-client-web/tests/integration/company-sim-people-and-channels.spec.ts decent-client-web/tests/unit/company-sim-routing-preview.test.ts
   git commit -m "feat(company-sim): add people inspector and channel routing preview"
   ```

**Expected outcome:** the control center becomes explainable, not magical.

---

## Task 6: Add provisioning + sandbox panes and finish with a full integration sweep

**Files:**
- Create: `decent-client-web/src/lib/components/company-sim/CompanySimProvisioning.svelte`
- Create: `decent-client-web/src/lib/components/company-sim/CompanySimSandbox.svelte`
- Modify: `decent-client-web/src/lib/components/company-sim/CompanySimPanel.svelte`
- Create: `decent-client-web/tests/integration/company-sim-provisioning-and-sandbox.spec.ts`
- Modify: `decent-client-web/tests/integration/company-sim-workflow.spec.ts`
- Test: `decent-client-web/tests/integration/company-sim-provisioning-and-sandbox.spec.ts`
- Test: `decent-client-web/tests/integration/company-sim-workflow.spec.ts`

1. Write failing integration tests for:
   - provisioning screen clearly separating source / generated / live
   - sandbox simulation showing why a manager stays silent vs responds on `[BLOCKED]`
   - post-edit control-center changes still preserve the core manager → backend → QA workflow
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-provisioning-and-sandbox.spec.ts tests/integration/company-sim-workflow.spec.ts --project=chromium
   ```
3. Implement the final panes:
   - Provisioning: source validation, generated/install summary, live runtime readiness, drift warnings, explicit `Refresh` / `Validate` / `Apply` actions if available
   - Sandbox: scenario presets, freeform message box, routing explanation trace, target channel selector
4. Re-run and verify pass.
5. Commit:
   ```bash
   cd /Users/claw/Projects/decent-chat
   git add decent-client-web/src/lib/components/company-sim/CompanySimProvisioning.svelte decent-client-web/src/lib/components/company-sim/CompanySimSandbox.svelte decent-client-web/src/lib/components/company-sim/CompanySimPanel.svelte decent-client-web/tests/integration/company-sim-provisioning-and-sandbox.spec.ts decent-client-web/tests/integration/company-sim-workflow.spec.ts
   git commit -m "feat(company-sim): add provisioning and sandbox panes"
   ```

**Expected outcome:** the UI now covers authoring, inspection, and operations, and the original end-to-end workflow still works.

---

## Implementation notes

### Recommended UI structure
- Keep this as a shell-level panel, not a new router, to fit the existing app architecture.
- Left nav sections:
  - Overview
  - Docs
  - People
  - Channels
  - Provisioning
  - Sandbox
- Add Teams later only if People/Docs proves insufficient in v1.

### Data model rules
- Prefer one normalized store keyed by workspace/company rather than many component-local fetches.
- Keep `dirty` doc edits local until explicit save.
- Keep provisioning state immutable per refresh cycle so badges do not flicker.

### Safety rules
- Doc writes must be confined to the resolved company-sim directory.
- Do not allow arbitrary path writes from the UI.
- Routing preview must be read-only and must not enqueue real messages.

### DEP / protocol note
- No DEP is expected **unless** this work changes durable `decent-protocol` sync payloads or message semantics outside the existing workspace-sync control plane. If that line gets crossed, stop and document the protocol delta first.

---

## Recommended execution order

1. Task 1 — control plane first
2. Task 2 — typed client wrapper/store
3. Task 3 — shell + overview
4. Task 4 — docs
5. Task 5 — people + channels
6. Task 6 — provisioning + sandbox + final sweep

---

## Stop conditions / review gates

- Do not start rich visual builders before raw markdown editing is green.
- Do not ship the panel if source/generated/live state is ambiguous anywhere in the UI.
- Do not expose doc editing until path confinement tests pass.
- Do not mark v1 done until `company-sim-workflow.spec.ts` still passes after the UI additions.

---

## Final verification sweep

```bash
cd /Users/claw/Projects/decent-chat/decent-openclaw && bun test tests/unit/company-sim-control-plane-*.test.ts
cd /Users/claw/Projects/decent-chat/decent-client-web && bun test tests/unit/company-sim-*.test.ts
cd /Users/claw/Projects/decent-chat/decent-client-web && PW_ENABLE_SIGNALING=0 playwright test tests/integration/company-sim-*.spec.ts --project=chromium
cd /Users/claw/Projects/decent-chat/decent-client-web && bun run build
cd /Users/claw/Projects/decent-chat && bun run typecheck
```

---

## Handoff

Options:
1. **Subagent-Driven** — spawn a coding session to execute Task 1 now.
2. **Parallel Session** — spawn a separate execution session and keep this thread for review/checkpoints.
