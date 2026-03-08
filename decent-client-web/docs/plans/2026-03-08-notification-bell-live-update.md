# Notification Bell Live Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make the workspace-rail bell (`🔔`) unread count update immediately (no page refresh) whenever activity unread state changes.

**Architecture:** Keep activity state in `ChatController.activityItems` as source of truth, but drive UI refresh from *unread-count deltas* instead of only array-length changes. Wire Activity Panel actions (`mark read`, `mark all read`) to explicitly refresh shell rail + panel data. Cover regressions with E2E tests that reproduce the stale badge behavior.

**Tech Stack:** TypeScript, Svelte 5 shell stores (`$state`), Playwright E2E (`tests/e2e`), Bun test runner.

---

### Task 1: Reproduce bug with a failing E2E test (badge stale until refresh)

**Files:**
- Modify: `tests/e2e/activity.spec.ts` (add new test near existing activity test)
- Test: `tests/e2e/activity.spec.ts`

1. Write a new failing Playwright test:
   - Create workspace + thread activity item (unread=1).
   - Mark activity read via panel click (unread=0).
   - Simulate another reply in the *same thread* that should flip existing item back to unread.
   - Assert `#activity-btn .activity-badge` becomes `1` **without** reload.
2. Run and verify fail:
   ```bash
   cd ~/Projects/decent-chat/decent-client-web
   npx playwright test tests/e2e/activity.spec.ts -g "badge updates without refresh"
   ```
3. Expected failure symptom: bell badge remains missing/old value until page reload.
4. Commit:
   ```bash
   git add tests/e2e/activity.spec.ts
   git commit -m "test(activity): reproduce stale bell badge without refresh"
   ```

---

### Task 2: Fix unread-change detection in inbound message paths

**Files:**
- Modify: `src/app/ChatController.ts:620-640,1320-1340,5475-5495` (three activityChanged blocks)
- Test: `tests/e2e/activity.spec.ts`

1. Write failing test first (Task 1 already done).
2. Replace current `activityChanged` detection that checks only `activityItems.length` with unread-aware logic:
   - Capture `const unreadBefore = this.getActivityUnreadCount();`
   - Run `maybeRecordMentionActivity` / `maybeRecordThreadActivity`
   - Capture `const unreadAfter = this.getActivityUnreadCount();`
   - Consider changed when either length changed **or** unread count changed.
3. Apply in all three code paths:
   - normal inbound messages
   - stream-done handling
   - batch sync response handling
4. Run test and verify pass:
   ```bash
   npx playwright test tests/e2e/activity.spec.ts -g "badge updates without refresh"
   ```
5. Commit:
   ```bash
   git add src/app/ChatController.ts
   git commit -m "fix(activity): refresh bell badge on unread delta not only length changes"
   ```

---

### Task 3: Fix Activity Panel actions to refresh rail immediately

**Files:**
- Modify: `src/ui/registerShellCallbacks.ts:240-270`
- Modify: `src/ui/uiService.ts` (registerShellCallbacks call + context)
- Modify: `src/ui/registerShellCallbacks.ts` interface (add `refreshActivityPanel` callback)
- Test: `tests/e2e/activity.spec.ts`

1. Write a failing E2E assertion (new test or extension):
   - Open activity panel with unread items.
   - Click `Mark all read`.
   - Assert bell badge disappears immediately without reload.
2. Implement callback wiring:
   - Pass `refreshActivityPanel` from `uiService` into `registerShellCallbacks`.
   - In `onMarkRead` and `onMarkAllRead`, call:
     - `callbacks.markActivityRead/markAllActivityRead`
     - `syncShellRail()`
     - `refreshActivityPanel()`
3. Run and verify pass:
   ```bash
   npx playwright test tests/e2e/activity.spec.ts -g "mark all read updates bell immediately"
   ```
4. Commit:
   ```bash
   git add src/ui/registerShellCallbacks.ts src/ui/uiService.ts tests/e2e/activity.spec.ts
   git commit -m "fix(activity-ui): sync bell and panel immediately after mark read actions"
   ```

---

### Task 4: Add small unit regression for unread delta helper behavior

**Files:**
- Create: `tests/unit/activity-unread-delta.test.ts`
- Modify: `src/app/ChatController.ts` (if extracting tiny helper)
- Test: `tests/unit/activity-unread-delta.test.ts`

1. If logic is extracted to a tiny helper function (recommended), write unit tests for:
   - length unchanged + unread flips false→true => should trigger rail update
   - length unchanged + unread unchanged => no update
   - length changed => update
2. Run and verify pass:
   ```bash
   bun test tests/unit/activity-unread-delta.test.ts
   ```
3. Commit:
   ```bash
   git add tests/unit/activity-unread-delta.test.ts src/app/ChatController.ts
   git commit -m "test(activity): unit coverage for unread-delta driven badge updates"
   ```

---

### Task 5: Full verification run

**Files:**
- Test only

1. Run focused unit + e2e:
   ```bash
   cd ~/Projects/decent-chat/decent-client-web
   bun test tests/unit/notification-manager.test.ts tests/unit/activity-unread-delta.test.ts
   npx playwright test tests/e2e/activity.spec.ts
   ```
2. Run quick typecheck:
   ```bash
   npm run typecheck
   ```
3. Expected output:
   - all targeted tests pass
   - no TS errors
4. Commit verification note:
   ```bash
   git add -A
   git commit -m "chore: verify notification bell live-update fix"
   ```

---

### Task 6: Manual QA checklist (no refresh allowed)

**Files:**
- Modify: none

1. In browser, verify these manually:
   - New unread activity increments bell instantly.
   - Repeated replies in same thread re-increment bell after it was read.
   - `Mark read` and `Mark all read` update bell instantly.
   - Switching channels/workspaces still marks relevant activity as read correctly.
2. Capture short QA notes in PR description.

---

## Suggested Code Snippet (for Task 2)

```ts
const lenBefore = this.activityItems.length;
const unreadBefore = this.getActivityUnreadCount();

this.maybeRecordMentionActivity(msg, channelId, wsIdForMsg);
if (msg.threadId) this.maybeRecordThreadActivity(msg, channelId);

const lenAfter = this.activityItems.length;
const unreadAfter = this.getActivityUnreadCount();

if (lenAfter !== lenBefore || unreadAfter !== unreadBefore) {
  this.ui?.updateChannelHeader();
  this.ui?.updateWorkspaceRail?.();
}
```

## Handoff

1) **Subagent-Driven (same session):** I can execute this plan now in small TDD commits.
2) **Parallel Session:** I can spawn an execution session dedicated to this plan (`executing-plans` flow) and report back with commits + test results.
