# Decent OpenClaw Parity + Threading UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Bring `decent-openclaw` to a practical Slack/Discord-like operator UX baseline while keeping DecentChat-native strengths (P2P, offline, encrypted routing).

**Architecture:** Implement in two tracks. Track A is plugin-local parity (reply mode controls, thread history bootstrap, messaging/directory ergonomics, docs/tests). Track B is thread-bound subagent readiness by adding a concrete upstream proposal and compatibility hooks, without blocking Track A delivery.

**Tech Stack:** TypeScript, Bun tests, OpenClaw plugin-sdk, DecentChat runtime (`NodeXenaPeer`), existing `runtime-streaming-e2e` test harness.

---

## Scope and success criteria

1. `replyToModeByChatType` works for `direct|group|channel` and is covered by tests.
2. `thread.initialHistoryLimit` is actually enforced in runtime (currently config-only drift).
3. First turn in a new thread can include bounded historical context from DecentChat store.
4. Tool UX improves: target normalization + basic directory listing for DecentChat peers/channels.
5. A concrete design doc exists for true thread-bound subagent sessions (`sessions_spawn({thread:true})`) on DecentChat, including required upstream OpenClaw hooks.

Non-goal (this plan): shipping full `/focus` + `/unfocus` behavior entirely inside plugin without upstream support.

---

### Task 1: Baseline safety net and parity checklist

**Files:**
- Create: `docs/plans/2026-02-28-decent-openclaw-parity-checklist.md`
- Modify: `decent-openclaw/README.md`
- Test: `decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts`

1. Write failing test placeholders (TODO tests) for chat-type reply mode + initial history limit.
2. Run and verify fail:
   - `cd /Users/claw/Projects/decent-chat`
   - `bun test decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts -t "replyToModeByChatType|initialHistoryLimit"`
3. Add checklist doc with acceptance items and links to test cases.
4. Re-run to verify baseline unchanged (still failing placeholders).
5. Commit:
   - `git add docs/plans/2026-02-28-decent-openclaw-parity-checklist.md decent-openclaw/README.md decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts`
   - `git commit -m "decent-openclaw: add parity checklist and failing test placeholders"`

Expected output snippet:
```text
0 pass
2 fail
```

---

### Task 2: Add `replyToModeByChatType` config contract

**Files:**
- Modify: `decent-openclaw/src/types.ts`
- Modify: `decent-openclaw/src/channel.ts`
- Test: `decent-openclaw/tests/unit/reply-to-mode-by-chat-type.test.ts` (new)

1. Write failing unit tests for resolution priority:
   - `replyToModeByChatType.<chatType>` overrides global `replyToMode`
   - fallback to global when per-chat-type missing
   - fallback default stays stable (`all`)
2. Run and verify fail:
   - `bun test decent-openclaw/tests/unit/reply-to-mode-by-chat-type.test.ts`
3. Implement minimal config/schema/types:
   - `types.ts`: add `replyToModeByChatType?: { direct?:..., group?:..., channel?:... }`
   - `channel.ts`: extend `DecentChatConfigSchema`, resolve account defaults.
4. Run and verify pass.
5. Commit:
   - `git add decent-openclaw/src/types.ts decent-openclaw/src/channel.ts decent-openclaw/tests/unit/reply-to-mode-by-chat-type.test.ts`
   - `git commit -m "decent-openclaw: add replyToModeByChatType config and tests"`

Implementation snippet:
```ts
const byType = ch.replyToModeByChatType ?? {};
const effective = byType[chatType] ?? ch.replyToMode ?? "all";
```

---

### Task 3: Wire chat-type reply mode into runtime routing

**Files:**
- Modify: `decent-openclaw/src/monitor.ts`
- Test: `decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts`

1. Add failing tests in `runtime-streaming-e2e` proving:
   - direct chat can use `off` while group uses `all`
   - `MessageThreadId` omission when effective mode is `off`.
2. Run and verify fail.
3. Implement minimal runtime change:
   - `resolveDecentThreadingFlags` takes `chatType` and applies per-chat-type override.
4. Run and verify pass.
5. Commit with focused message.

Expected command:
- `bun test decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts -t "replyToMode=off keeps base channel session|chat-type"`

---

### Task 4: Add thread history retrieval API on peer runtime

**Files:**
- Modify: `decent-openclaw/src/peer/NodeXenaPeer.ts`
- Modify: `decent-openclaw/src/monitor.ts` (adapter type only)
- Test: `decent-openclaw/tests/unit/history-restore.test.ts`

1. Write failing test for new API contract (returns latest N messages in thread order, excludes current message id when provided).
2. Run and verify fail.
3. Implement `NodeXenaPeer` method, e.g.:
   - `getThreadHistory(channelId, threadId, limit, opts?: { excludeMessageId?: string })`
4. Extend `StreamingPeerAdapter` type in monitor to include optional history fetch method.
5. Run tests and commit.

Implementation snippet:
```ts
public getThreadHistory(...) {
  const all = this.messageStore.getMessages(channelId);
  return all
    .filter(m => m.threadId === threadId && m.id !== excludeMessageId)
    .slice(-limit);
}
```

---

### Task 5: Enforce `thread.initialHistoryLimit` in inbound processing

**Files:**
- Modify: `decent-openclaw/src/monitor.ts`
- Test: `decent-openclaw/tests/unit/thread-initial-history-limit.test.ts` (new)
- Test: `decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts`

1. Write failing tests:
   - first turn in thread loads max N historical messages into formatted context
   - `initialHistoryLimit=0` disables bootstrap history
   - subsequent turns do not re-bootstrap full thread history.
2. Run and verify fail.
3. Implement minimal change in `processInboundMessage`:
   - detect first thread turn (`!previousTimestamp`)
   - if `initialHistoryLimit > 0` and `xenaPeer.getThreadHistory` exists, prepend concise history block.
4. Run and verify pass.
5. Commit.

Context snippet format:
```text
[Thread context: last 5 messages]
- Alice: ...
- Bob: ...
```

---

### Task 6: Improve plugin capability signaling (honest parity)

**Files:**
- Modify: `decent-openclaw/src/channel.ts`
- Test: `decent-openclaw/tests/unit/plugin-capabilities.test.ts` (new)

1. Write failing test asserting capabilities are explicit and truthful.
2. Implement minimal capability update:
   - keep `chatTypes`
   - add `threads: true`, `media: true`
   - set `nativeCommands` only when adapter support is actually added.
3. Run and verify pass.
4. Commit.

Note: do **not** advertise reactions/actions yet unless implemented.

---

### Task 7: Add messaging target normalization/hints for tool ergonomics

**Files:**
- Modify: `decent-openclaw/src/channel.ts`
- Test: `decent-openclaw/tests/unit/messaging-target-normalization.test.ts` (new)

1. Write failing tests for acceptable target inputs:
   - `decentchat:channel:<id>`
   - `channel:<id>`
   - `decentchat:<peerId>`
   - raw `<peerId>`
2. Run and verify fail.
3. Add `messaging.normalizeTarget` + `targetResolver.hint` to plugin.
4. Run and verify pass.
5. Commit.

Expected hint:
```text
<peerId|channel:<id>|decentchat:channel:<id>>
```

---

### Task 8: Add lightweight local directory adapter (peers/channels)

**Files:**
- Modify: `decent-openclaw/src/peer/NodeXenaPeer.ts`
- Modify: `decent-openclaw/src/channel.ts`
- Test: `decent-openclaw/tests/unit/directory-live.test.ts` (new)

1. Write failing test for directory list from runtime cache:
   - peers from workspace members
   - groups from workspace channels.
2. Add runtime methods:
   - `listDirectoryPeersLive()`
   - `listDirectoryGroupsLive()`
3. Hook plugin `directory` adapter using `getActivePeer()`.
4. Run and verify pass.
5. Commit.

---

### Task 9: Add observability for thread/session routing decisions

**Files:**
- Modify: `decent-openclaw/src/monitor.ts`
- Test: `decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts`

1. Write failing assertion for debug log content in key branches (thread split vs base session fallback).
2. Implement concise structured logs:
   - effective reply mode
   - historyScope
   - derived thread id
   - resulting session key.
3. Run tests and verify pass.
4. Commit.

Log example:
```text
[decentchat] route chatType=channel replyToMode=all historyScope=thread thread=root-777 session=...:thread:root-777
```

---

### Task 10: Upstream thread-bound sessions design doc (Discord parity path)

**Files:**
- Create: `docs/openclaw/decent-thread-bindings-design.md`
- Modify: `docs/openclaw/index.md`
- Test: N/A (design/spec task)

1. Write design doc describing how DecentChat can support OpenClaw thread bindings parity with Discord.
2. Include required upstream hooks (core + plugin interface) and migration plan:
   - binding manager keyed by channel/provider, not Discord-only
   - provider capability check
   - `spawnSubagentSessions` / `spawnAcpSessions` semantics for DecentChat.
3. Include sequence diagrams for:
   - `sessions_spawn({thread:true, mode:"session"})`
   - `/focus` bind flow
   - `/unfocus` + TTL expiry.
4. Link doc in index.
5. Commit.

---

### Task 11: Full verification gate

**Files:**
- Modify: `docs/testing.md` (append DecentChat plugin regression command set)
- Test: all touched test files

1. Run targeted tests first:
   - `bun test decent-openclaw/tests/unit/reply-to-mode-by-chat-type.test.ts`
   - `bun test decent-openclaw/tests/unit/thread-initial-history-limit.test.ts`
   - `bun test decent-openclaw/tests/unit/messaging-target-normalization.test.ts`
   - `bun test decent-openclaw/tests/unit/directory-live.test.ts`
2. Run regression pack:
   - `bun test decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts`
   - `bun test decent-openclaw/tests/unit/history-restore.test.ts`
   - `bun run typecheck`
3. Verify all green.
4. Commit docs/test command updates.
5. Tag milestone in changelog or release notes.

Expected output snippet:
```text
N pass
0 fail
```

---

### Task 12: Rollout strategy

**Files:**
- Modify: `decent-openclaw/README.md`
- Modify: `docs/openclaw/deployment.md` (or project deployment doc)

1. Add config migration examples with before/after blocks.
2. Add feature flags section:
   - safe defaults
   - how to disable history bootstrap quickly.
3. Add rollback checklist (single revert commit + config toggles).
4. Dry-run on staging/secondary account.
5. Ship.

Config example:
```yaml
channels:
  decentchat:
    replyToMode: all
    replyToModeByChatType:
      direct: off
      group: all
      channel: all
    thread:
      historyScope: thread
      inheritParent: false
      initialHistoryLimit: 10
```

---

## Execution order (recommended)

1. Tasks 1–3 (reply mode correctness)
2. Tasks 4–5 (history limit actually works)
3. Tasks 6–8 (operator/tooling UX parity)
4. Task 9 (observability)
5. Task 10 (upstream parity design)
6. Tasks 11–12 (verification + rollout)

## Risks and mitigations

- **Risk:** history bootstrap bloats prompt context.
  - **Mitigation:** hard cap by `initialHistoryLimit`, concise line format, optional truncation.
- **Risk:** stale peer directory data.
  - **Mitigation:** mark entries as cached and include last-seen timestamp.
- **Risk:** over-claiming capabilities.
  - **Mitigation:** only set capability flags after test-backed implementation.
- **Risk:** Discord-only upstream assumptions block Decent thread-binding parity.
  - **Mitigation:** ship plugin-local parity first, submit upstream design separately.

## Definition of done

- All new tests pass.
- No regression in existing `runtime-streaming-e2e` and `history-restore` tests.
- `thread.initialHistoryLimit` no longer config drift.
- Decent plugin docs clearly document current capabilities + thread-binding future path.
