# Workspace DM Privacy During Invite-Accept Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Let users allow/disallow “DMs from workspace members” during invite acceptance (Discord-like), with real enforcement (not only UI).

**Architecture:** Add a per-member privacy flag in workspace membership (`allowWorkspaceDMs`) that defaults to `true` for backward compatibility. Capture the preference in invite-accept modals, persist it in workspace member state, and sync it to peers through existing workspace state/name announce flows. Enforce DM policy at both sender-side UX (disable/start-block) and receiver-side security checks (drop unauthorized workspace-context DMs), with a denial control event for clear feedback.

**Tech Stack:** TypeScript, Svelte 5 UI (`decent-client-web`), `decent-protocol` workspace/member model, Playwright E2E, Bun unit tests.

---

### Task 1: Write protocol decision record (DEP) for DM privacy semantics

**Files:**
- Create: `specs/deps/DEP-013-workspace-dm-privacy.md`
- Modify: `specs/deps/DEP-000.md` (index/table update)

1. Write a failing “spec check” by adding a TODO checklist item in DEP index referencing DEP-013 as required before merge.
2. Run and verify fail (or unresolved checklist state).
3. Implement DEP-013 with exact semantics:
   - New member field: `allowWorkspaceDMs?: boolean` (default `true`)
   - Join-time capture via invite acceptance UI
   - Sender-side + receiver-side enforcement
   - Backward compatibility rules for missing flag/legacy clients
   - Rejection signaling (`direct-denied` reason)
4. Run docs lint/check commands used in repo (if none, run markdown link validation manually).
5. Commit.

**Commands:**
- `cd /Users/claw/Projects/decent-chat`
- `rg "DEP-013" specs/deps/DEP-000.md`

**Expected output:**
- DEP index includes DEP-013 reference and status line.

---

### Task 2: Extend protocol/member types with workspace DM privacy flag

**Files:**
- Modify: `decent-protocol/src/workspace/types.ts`
- Modify: `decent-protocol/src/workspace/WorkspaceManager.ts`
- Test: `decent-protocol/tests/unit/workspace.test.ts`
- Test: `decent-protocol/tests/unit/sync-edge-cases.test.ts`

1. Write failing unit tests:
   - New members default to allow DMs (`true` when undefined).
   - Imported/synced workspaces preserve explicit `allowWorkspaceDMs=false`.
2. Run tests and verify fail.
3. Implement minimal type/model changes:
   - Add `allowWorkspaceDMs?: boolean` to `WorkspaceMember`.
   - Normalize/compat in import path so missing value behaves as allow.
4. Run tests and verify pass.
5. Commit.

**Commands:**
- `cd /Users/claw/Projects/decent-chat/decent-protocol`
- `bun test tests/unit/workspace.test.ts tests/unit/sync-edge-cases.test.ts`

**Expected output:**
- New tests pass; no regressions in touched files.

---

### Task 3: Add invite-accept UI control (Discord-style toggle)

**Files:**
- Modify: `decent-client-web/src/lib/components/modals/JoinWorkspaceModal.svelte`
- Modify: `decent-client-web/src/ui/uiModalActions.ts`
- Modify: `decent-client-web/src/ui/types.ts`
- Modify: `decent-client-web/src/main.ts`
- Test: `decent-client-web/tests/e2e/app.spec.ts` (or create dedicated invite modal spec)

1. Write failing E2E/UI test:
   - Invite accept modal shows checkbox “Allow direct messages from workspace members”.
   - Default is checked.
   - Unchecking sends `allowWorkspaceDMs=false` via join callback.
2. Run test and verify fail.
3. Implement UI plumbing in both join paths:
   - Svelte `JoinWorkspaceModal` (manual join flow)
   - legacy `showJoinWithInvite` modal used for invite URL deep-links.
4. Update callback signatures (`joinWorkspace`) to carry join options.
5. Run test and verify pass.
6. Commit.

**Commands:**
- `cd /Users/claw/Projects/decent-chat/decent-client-web`
- `bun run test:e2e -- tests/e2e/app.spec.ts`

**Expected output:**
- Invite modal test passes with checked-by-default and persisted value.

---

### Task 4: Persist preference at join and sync through workspace-state/name-announce

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts`
- Modify: `decent-client-web/src/main.ts`
- Test: `decent-client-web/tests/unit/workspace-state-sync.test.ts`

1. Write failing unit tests:
   - `joinWorkspace(..., { allowWorkspaceDMs: false })` stores self member flag.
   - Outbound workspace-state includes `allowWorkspaceDMs` for members.
   - Incoming workspace-state merges `allowWorkspaceDMs` updates safely.
2. Run test and verify fail.
3. Implement minimal changes:
   - Add `joinOpts?: { allowWorkspaceDMs?: boolean }` parameter.
   - Set joining member preference on provisional local workspace member.
   - Include `allowWorkspaceDMs` in `workspace-sync` member mapping (send+merge).
   - Include in `name-announce` payload for lightweight updates when relevant.
4. Run tests and verify pass.
5. Commit.

**Commands:**
- `cd /Users/claw/Projects/decent-chat/decent-client-web`
- `bun run test:unit -- tests/unit/workspace-state-sync.test.ts`

**Expected output:**
- Workspace state sync test includes DM flag and passes.

---

### Task 5: Add sender-side gating for workspace-origin DM initiation

**Files:**
- Modify: `decent-client-web/src/ui/uiService.ts`
- Modify: `decent-client-web/src/ui/registerShellCallbacks.ts`
- Modify: `decent-client-web/src/app/ChatController.ts`
- Modify: `decent-client-web/src/ui/types.ts`
- Test: `decent-client-web/tests/unit/chat-controller-receipts-security.test.ts` (or new `workspace-dm-permissions.test.ts`)

1. Write failing tests:
   - Starting DM from workspace member list fails when target member has `allowWorkspaceDMs=false`.
   - Start DM from contacts view (no workspace context) is unaffected.
2. Run tests and verify fail.
3. Implement:
   - Pass `sourceWorkspaceId` when member row starts DM.
   - Add controller guard: if target member in source workspace disallows DMs, throw typed error.
   - Show clear toast: “This member disallows workspace DMs.”
4. Run tests and verify pass.
5. Commit.

**Commands:**
- `cd /Users/claw/Projects/decent-chat/decent-client-web`
- `bun test tests/unit/workspace-dm-permissions.test.ts`

**Expected output:**
- Sender-side permission checks pass.

---

### Task 6: Add receiver-side enforcement (authoritative) for workspace-context DMs

**Files:**
- Modify: `decent-protocol/src/contacts/DirectConversation.ts` (optional `originWorkspaceId` metadata)
- Modify: `decent-client-web/src/app/ChatController.ts`
- Test: `decent-client-web/tests/unit/workspace-dm-permissions.test.ts`

1. Write failing tests:
   - Incoming `isDirect` message with `workspaceContextId` is rejected if receiver’s member flag is false for that workspace.
   - Receiver sends denial control event (`direct-denied`) to sender.
   - Legacy direct messages without `workspaceContextId` remain backward-compatible.
2. Run tests and verify fail.
3. Implement:
   - Add optional envelope metadata: `workspaceContextId` for workspace-origin DMs.
   - In inbound direct-message handler, before storing message, check local workspace membership record for self.
   - Reject unauthorized DMs and emit denial event.
4. Run tests and verify pass.
5. Commit.

**Commands:**
- `cd /Users/claw/Projects/decent-chat/decent-client-web`
- `bun test tests/unit/workspace-dm-permissions.test.ts`

**Expected output:**
- Receiver-side enforcement tests pass.

---

### Task 7: UX polish for disabled DM affordances inside workspace

**Files:**
- Modify: `decent-client-web/src/lib/components/members/MemberRow.svelte`
- Modify: `decent-client-web/src/lib/components/modals/WorkspaceMembersModal.svelte`
- Modify: `decent-client-web/src/ui/styles/main.css`
- Modify: `decent-client-web/src/ui/uiShellSync.ts`
- Test: `decent-client-web/tests/e2e/dm.spec.ts`

1. Write failing E2E assertion:
   - Member DM button shows disabled state/tooltip when target disallows workspace DMs.
2. Run and verify fail.
3. Implement:
   - Add disabled icon state + tooltip text.
   - Keep click no-op with deterministic toast.
4. Run test and verify pass.
5. Commit.

**Commands:**
- `cd /Users/claw/Projects/decent-chat/decent-client-web`
- `bun run test:e2e -- tests/e2e/dm.spec.ts`

**Expected output:**
- DM button state reflects permission and test passes.

---

### Task 8: Integration test across invite/join and multi-user DM privacy behavior

**Files:**
- Create: `decent-client-web/tests/integration/workspace-dm-privacy.spec.ts`
- Modify: `decent-client-web/tests/integration/helpers.ts` (if helper extension needed)

1. Write integration test scenario (failing first):
   - Alice invites Bob.
   - Bob unchecks “allow workspace DMs” at join.
   - Alice cannot start DM from workspace member list.
   - If Alice sends crafted workspace-context DM anyway, Bob rejects it.
2. Run and verify fail.
3. Implement minimal glue/helpers only.
4. Run and verify pass.
5. Commit.

**Commands:**
- `cd /Users/claw/Projects/decent-chat/decent-client-web`
- `PW_ENABLE_SIGNALING=0 bun run test:integration -- tests/integration/workspace-dm-privacy.spec.ts`

**Expected output:**
- Integration spec passes end-to-end.

---

### Task 9: Add optional in-workspace toggle post-join (recommended)

**Files:**
- Modify: `decent-client-web/src/lib/components/modals/SettingsModal.svelte` (or workspace settings modal surface)
- Modify: `decent-client-web/src/app/ChatController.ts`
- Modify: `decent-client-web/src/ui/types.ts`
- Test: `decent-client-web/tests/e2e/app.spec.ts` or new settings spec

1. Write failing test:
   - User can later switch the same DM privacy setting inside workspace settings.
2. Run and verify fail.
3. Implement update path:
   - Update local member flag.
   - Broadcast `name-announce`/workspace-sync member update to peers.
4. Run and verify pass.
5. Commit.

**Commands:**
- `cd /Users/claw/Projects/decent-chat/decent-client-web`
- `bun run test:e2e -- tests/e2e/app.spec.ts`

**Expected output:**
- Toggle persists and propagates.

---

### Task 10: Full verification + regression gate

**Files:**
- Modify: `docs/deployment.md` (brief note if feature flag/migration caveat needed)
- Modify: `README.md` (user-facing behavior note)

1. Run full relevant suite (protocol + client unit + focused e2e/integration).
2. Verify no regressions in workspace isolation/threading paths.
3. Document behavior and backward compatibility.
4. Commit final verification changes.

**Commands:**
- `cd /Users/claw/Projects/decent-chat`
- `bun run test:protocol`
- `bun run test:unit`
- `bun run test:integration -- tests/integration/workspace-dm-privacy.spec.ts`
- `bun run test:e2e -- tests/e2e/dm.spec.ts`

**Expected output:**
- Green on new privacy tests; no regressions in existing suite.

---

## Notes / Guardrails

- **Backward compatibility:** missing `allowWorkspaceDMs` must mean `true`.
- **Scope discipline:** this feature governs **workspace-origin DMs**; do not break existing direct contacts DM path.
- **Security model:** sender-side disable is UX; receiver-side drop is enforcement.
- **Migration:** no DB schema migration required if using optional fields in existing records.
