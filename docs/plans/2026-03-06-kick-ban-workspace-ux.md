# Kick/Ban Workspace Access Revocation UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** When a member is kicked or banned, they immediately lose access, the workspace disappears from their UI/local storage, and the UX clearly explains what happened.

**Architecture:** Reuse one revocation pipeline in `ChatController` for both kick and ban self-cases: purge local workspace data, remove workspace from in-memory state, and navigate to safe fallback UX. Extend workspace membership protocol with explicit ban metadata + join rejection so banned peers cannot re-enter using stale invite links. Tighten handshake/state-sync behavior to avoid re-adding revoked users via fallback membership heuristics.

**Tech Stack:** TypeScript, Playwright integration tests, Svelte modals/components, DecentChat workspace-sync protocol (`decent-protocol` + `decent-client-web`).

---

## UX Acceptance Criteria

1. **Kicked user:** workspace is removed from rail/sidebar within 1 sync turn; active view auto-switches to another workspace or welcome screen.
2. **Banned user:** same as kicked + rejoin via old invite is rejected with clear reason and optional ban expiry.
3. **No data ghosting:** kicked/banned user cannot read old channels/messages/member list from UI after revocation.
4. **Admin UX:** remove/ban actions are explicit and confirmed; result toast clearly states outcome.
5. **No workspace leak:** revoked user never receives subsequent `workspace-state` snapshots for that workspace.

---

### Task 1: Add failing integration test for self-kick purge + workspace disappearance

**Files:**
- Create: `decent-client-web/tests/integration/workspace-revocation.spec.ts`
- Modify: `decent-client-web/tests/integration/helpers.ts` (helper: getWorkspaceSnapshot)
- Test: `decent-client-web/tests/integration/workspace-revocation.spec.ts`

1. Write failing test scenario:
   - Alice creates WS-A + WS-B
   - Bob joins WS-A
   - Alice removes Bob from WS-A
   - Assert on Bob:
     - WS-A no longer in `workspaceManager.getAllWorkspaces()`
     - `persistentStore.getAllWorkspaces()` excludes WS-A
     - WS-B (if Bob is in it) remains intact
2. Run and verify fail:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   bun run test:integration -- tests/integration/workspace-revocation.spec.ts
   ```
   Expected: assertion fails because removed user still sees workspace.
3. Implement minimal test-only utilities as needed (no product fix yet).
4. Re-run and keep failing (red phase).
5. Commit:
   ```bash
   git add tests/integration/workspace-revocation.spec.ts tests/integration/helpers.ts
   git commit -m "test: add failing workspace revocation self-kick scenario"
   ```

---

### Task 2: Implement unified self-revocation cleanup path in ChatController

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts` (member-removed branch + helper)
- Test: `decent-client-web/tests/integration/workspace-revocation.spec.ts`

1. Write failing unit/integration assertion first (if needed): active workspace should be nulled/switched when self removed.
2. Implement helper:
   ```ts
   private async handleSelfWorkspaceRevocation(wsId: string, reason: 'kicked' | 'banned', byPeerId: string): Promise<void>
   ```
   Behavior:
   - call `cleanupWorkspaceLocalState(wsId, ws)`
   - `workspaceManager.removeWorkspace(wsId)`
   - switch to fallback workspace if available
   - show toast: `You were removed from <workspace>` / `You were banned from <workspace>`
   - refresh rail/sidebar/header/messages/compose
3. In existing `member-removed` handling, replace toast-only branch with `handleSelfWorkspaceRevocation(...)`.
4. Run tests:
   ```bash
   bun run test:integration -- tests/integration/workspace-revocation.spec.ts
   ```
   Expected: Task 1 test passes.
5. Commit:
   ```bash
   git add src/app/ChatController.ts
   git commit -m "fix: purge and hide workspace when current user is removed"
   ```

---

### Task 3: Fix kick command path to use broadcast-safe controller API

**Files:**
- Modify: `decent-client-web/src/commands/registerCommands.ts`
- Test: `decent-client-web/tests/integration/remove-member.spec.ts`

1. Write failing test: `/kick <peerId>` must remove member on all peers (not local-only).
2. Replace current direct manager mutation:
   ```ts
   ctrl.workspaceManager.removeMember(...)
   ```
   with:
   ```ts
   await ctrl.removeWorkspaceMember(peerId)
   ```
3. Ensure command reports controller error text unchanged.
4. Run tests:
   ```bash
   bun run test:integration -- tests/integration/remove-member.spec.ts
   ```
   Expected: command path now propagates correctly.
5. Commit:
   ```bash
   git add src/commands/registerCommands.ts tests/integration/remove-member.spec.ts
   git commit -m "fix(commands): route /kick through removeWorkspaceMember broadcast flow"
   ```

---

### Task 4: Add ban model + sync event (protocol-level)

**Files:**
- Modify: `decent-protocol/src/workspace/types.ts`
- Modify: `decent-protocol/src/workspace/WorkspaceManager.ts`
- Modify: `decent-client-web/src/app/ChatController.ts`
- Test: `decent-protocol/tests/unit/workspace.test.ts`
- Test: `decent-protocol/tests/unit/workspace-roles.test.ts`

1. Write failing protocol tests for:
   - add ban record
   - check ban active/expired
   - remove ban
2. Extend workspace types:
   ```ts
   interface WorkspaceBan {
     peerId: string;
     bannedBy: string;
     bannedAt: number;
     expiresAt?: number;
     reason?: string;
   }
   // in Workspace:
   bans?: WorkspaceBan[];
   ```
3. Extend sync payload compatibility (non-breaking):
   - `member-removed` gets optional fields: `reason?: 'kicked'|'banned'`, `banExpiresAt?: number`
   - optional `ban-updated` sync message for future parity
4. Add manager helpers:
   - `banMember(...)`
   - `unbanMember(...)`
   - `isBanned(workspaceId, peerId)`
5. Run tests:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-protocol
   bun test tests/unit/workspace.test.ts tests/unit/workspace-roles.test.ts
   ```
   Expected: green.
6. Commit:
   ```bash
   git add src/workspace/types.ts src/workspace/WorkspaceManager.ts tests/unit/workspace.test.ts tests/unit/workspace-roles.test.ts
   git commit -m "feat(protocol): add workspace ban model and manager helpers"
   ```

---

### Task 5: Enforce ban on join/re-sync and prevent workspace-state leaks

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts` (`sendWorkspaceState`, join handling, name-announce fallback)
- Test: `decent-client-web/tests/integration/workspace-revocation.spec.ts`

1. Write failing test:
   - Alice bans Bob
   - Bob reconnects / tries invite again
   - Bob must not receive workspace-state, channels, members, or messages for banned workspace.
2. Tighten `sendWorkspaceState(peerId, workspaceId?)`:
   - remove active-workspace fallback for non-members
   - send state only if `peerId` is a current member and not banned
3. Harden fallback auto-membership (`ensurePeerInActiveWorkspace` + name-announce auto-add):
   - never auto-add banned/revoked peers
   - require explicit join acceptance path for new members
4. For rejected join/rejoin, send explicit error sync and show user toast:
   - `Join rejected: you are banned from this workspace`
5. Run tests:
   ```bash
   cd /Users/claw/Projects/decent-chat/decent-client-web
   bun run test:integration -- tests/integration/workspace-revocation.spec.ts
   bun run test:integration -- tests/integration/workspace-isolation.spec.ts
   ```
6. Commit:
   ```bash
   git add src/app/ChatController.ts tests/integration/workspace-revocation.spec.ts tests/integration/workspace-isolation.spec.ts
   git commit -m "fix(security): block workspace-state leaks and enforce ban on rejoin"
   ```

---

### Task 6: UX polish for kicked/banned users + admin controls

**Files:**
- Modify: `decent-client-web/src/lib/components/modals/WorkspaceMembersModal.svelte`
- Modify: `decent-client-web/src/ui/uiModalActions.ts`
- Modify: `decent-client-web/src/ui/types.ts`
- Modify: `decent-client-web/src/main.ts`
- Modify: `decent-client-web/src/ui/styles/main.css` (if new banner styles needed)
- Test: `decent-client-web/tests/integration/workspace-revocation.spec.ts`

1. Write failing UI test:
   - admin sees **Remove** and **Ban** actions
   - banned user sees clear revocation copy and no stale workspace in rail
2. Add Ban action flow:
   - confirm modal (`Ban member? Duration?`)
   - call `ctrl.banWorkspaceMember(...)`
3. Add user-facing revocation message UX (toast/banner):
   - includes workspace name + action type
   - optional expiry text for temporary bans
4. Run tests:
   ```bash
   bun run test:integration -- tests/integration/workspace-revocation.spec.ts
   bun run typecheck
   ```
5. Commit:
   ```bash
   git add src/lib/components/modals/WorkspaceMembersModal.svelte src/ui/uiModalActions.ts src/ui/types.ts src/main.ts src/ui/styles/main.css tests/integration/workspace-revocation.spec.ts
   git commit -m "feat(ui): add ban UX and revocation messaging"
   ```

---

### Task 7: DEP + docs + regression gate

**Files:**
- Create: `specs/deps/DEP-012-workspace-access-revocation.md` (or next available number)
- Modify: `docs/protocol/index.md`
- Modify: `docs/testing.md`
- Test: full suite slices

1. Draft DEP for protocol semantics:
   - kick vs ban behavior
   - backward compatibility
   - sync fields and validation
2. Add docs examples (admin flow, user flow, rejection copy).
3. Run regression gate:
   ```bash
   cd /Users/claw/Projects/decent-chat
   bun run test:protocol
   bun run test:integration -- tests/integration/remove-member.spec.ts
   bun run test:integration -- tests/integration/workspace-revocation.spec.ts
   bun run test:integration -- tests/integration/workspace-isolation.spec.ts
   bun run typecheck
   ```
4. Expected output:
   - All targeted tests pass
   - No workspace resurrection after kick/ban
   - No cross-workspace leaks introduced
5. Commit:
   ```bash
   git add specs/deps/DEP-012-workspace-access-revocation.md docs/protocol/index.md docs/testing.md
   git commit -m "docs(protocol): specify workspace kick/ban access revocation UX"
   ```

---

## Rollout Notes

- Ship in two increments if needed:
  1. **Hotfix:** Task 2 + Task 3 (self-kick workspace disappears immediately)
  2. **Hardening:** Tasks 4–7 (true ban semantics + rejoin prevention + UX polish)
- Keep `member-removed` backward compatible by making new fields optional.
- If protocol DEP review delays, still ship hotfix without ban extensions.

---

## Done Definition

- Kicked/banned users cannot see revoked workspace in UI.
- Revoked workspace data is purged locally for that user.
- Banned user cannot rejoin via stale invite during active ban window.
- Admin has clear, safe controls and users get clear revocation UX messaging.
