# Adaptive P2P Public Workspaces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Evolve DecentChat into a single adaptive P2P architecture that remains philosophically decentralized while becoming operationally scalable and reliable for very large public workspaces (target: up to 500k members).

**Architecture:** Keep one workspace architecture, but stop assuming every client stores the full roster or that every public channel enumerates every member. Introduce shardable directory/state, policy-derived public channel membership, paged history and presence slices, and capability-based peer roles (directory/relay/archive peers) that are still ordinary peers rather than privileged central servers. Reuse the existing partial-mesh + gossip foundation and migrate clients from full snapshots to paged shell + delta sync.

**Tech Stack:** TypeScript, Bun, IndexedDB, WebRTC/PeerJS transport, Decent protocol/workspace sync, existing partial-mesh topology, gossip relay, negentropy reconciliation, Playwright, Bun test runner.

---

## Non-negotiable architecture decisions

1. **One architecture only** — no “small workspace mode” vs “server mode”.
2. **No mandatory trusted central server** — optional always-on peers are helpers, not authorities.
3. **Correctness must not depend on a singleton peer** — only performance/reliability may degrade.
4. **Public channel membership is policy-derived** — not a giant `channel.members[]` array.
5. **Clients materialize slices, not full state** — page/search/subscribe instead of snapshot-everything.
6. **Large-workspace support is incremental** — ship via backward-compatible protocol extensions and feature flags.

---

## Current codebase reality check

These are the main current blockers in the existing code:

- `decent-protocol/src/workspace/WorkspaceManager.ts`
  - `workspace.members[]` is still the canonical local roster.
  - `addMember()` still appends new members into every public channel’s `channel.members[]`.
- `decent-protocol/src/workspace/SyncProtocol.ts`
  - join/sync still sends full `workspace` objects and `messageHistory` maps.
- `decent-protocol/src/storage/PersistentStore.ts`
  - workspaces are persisted as whole blobs (`saveWorkspace()`), not normalized shards/pages.
- `decent-client-web/src/app/ChatController.ts`
  - topology candidate selection still scans `ws.members`.
  - registry helps discovery, but clients still assume a locally held workspace roster.
- `decent-client-web/src/lib/components/members/MemberList.svelte`
  - roster UI is still list-oriented, not paged/search-first for huge directories.

Good news already present:

- bounded partial mesh
- gossip relay
- workspace peer registry hooks
- adaptive message virtualization
- `isBot` metadata support already landed

---

## Target end-state

A 500k-member workspace should behave like this:

- the client loads a **workspace shell** quickly
- the channel list loads quickly
- roster views are **paged / searchable / virtualized**
- presence is **aggregate and scoped**
- peers connect to a **bounded desired set**, not everyone
- public channel delivery uses **relay/gossip + replicated history**, not “send to all known peers”
- history sync is **paged and repairable**, not snapshot-shaped
- one always-on peer going offline is **annoying but not fatal**

---

## Milestones

### Milestone A — 10k-ready
- no explicit member arrays for public channels
- paged member directory shell
- normalized persistence
- shell + delta sync for workspace metadata

### Milestone B — 100k-ready
- sharded directory replication
- presence aggregates and slice subscriptions
- history page replication
- capability-advertised relay/archive/directory peers

### Milestone C — 500k-ready
- full distributed member directory
- bounded delivery semantics for public channels
- large-workspace load harness and failure drills
- operational observability for shard health and replica coverage

---

## Task 1: Write the protocol DEP and lock invariants

**Files:**
- Create: `specs/deps/DEP-014-adaptive-public-workspaces.md`
- Modify: `specs/deps/README.md`
- Test: n/a (documentation)

1. Write a DEP that codifies the new invariants:
   - one architecture
   - no singleton authorities
   - capability peers are helpers only
   - paged directory and paged history
   - policy-derived public channel access
2. Include migration constraints:
   - old small workspaces must keep working
   - old clients must ignore unknown fields safely
3. Include glossary:
   - workspace shell
   - directory shard
   - capability peer
   - presence slice
   - history page
4. Commit only the DEP draft.

**Snippet to include in DEP:**
```md
A peer may advertise directory/relay/archive capabilities, but no single peer is authoritative. Signed state plus replication determine correctness.
```

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat
ls specs/deps
```

**Expected output:**
- New DEP file appears in `specs/deps/`

---

## Task 2: Introduce scalable workspace/domain types

**Files:**
- Modify: `decent-protocol/src/workspace/types.ts`
- Create: `decent-protocol/src/workspace/DirectoryTypes.ts`
- Test: `decent-protocol/tests/workspace/directory-types.test.ts`

1. Write failing tests for new types and shape validation.
2. Add new types without removing current ones:
   - `WorkspaceShell`
   - `MemberSummary`
   - `MemberDirectoryPage`
   - `DirectoryShardRef`
   - `ChannelAccessPolicy`
   - `PresenceAggregate`
   - `HistoryPageRef`
   - `PeerCapabilities`
3. Mark legacy `Channel.members` semantics as “small/private compatibility path only”.
4. Keep wire compatibility by making new fields optional.
5. Commit.

**Suggested type direction:**
```ts
export interface ChannelAccessPolicy {
  mode: 'dm' | 'public-workspace' | 'group' | 'role-gated' | 'explicit';
  groupIds?: string[];
  roles?: Array<'owner' | 'admin' | 'member'>;
  explicitMemberPeerIds?: string[]; // compatibility / small channels only
}
```

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-protocol
bun test tests/workspace/directory-types.test.ts
```

**Expected output:**
- first run fails on missing exports
- second run passes

---

## Task 3: Stop treating public channel membership as explicit arrays

**Files:**
- Modify: `decent-protocol/src/workspace/WorkspaceManager.ts`
- Modify: `decent-protocol/src/workspace/types.ts`
- Test: `decent-protocol/tests/workspace/public-channel-policy.test.ts`

1. Write failing tests proving that adding a member to a large/public workspace does **not** append them into every public channel member list.
2. Introduce channel policy evaluation helpers:
   - `isMemberAllowedInChannel()`
   - `isPublicWorkspaceChannel()`
3. Preserve explicit membership arrays only for:
   - DMs
   - private small channels
   - compatibility migration
4. Update `addMember()` and `removeMember()` to avoid O(workspace.channels × members) mutations for public channels.
5. Commit.

**Key invariant:**
```ts
if (channel.accessPolicy?.mode === 'public-workspace') {
  // membership derived; do not mutate channel.members per join/leave
}
```

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-protocol
bun test tests/workspace/public-channel-policy.test.ts
```

---

## Task 4: Normalize persistence away from whole-workspace blobs

**Files:**
- Modify: `decent-protocol/src/storage/PersistentStore.ts`
- Create: `decent-protocol/src/storage/schema/PublicWorkspaceStores.ts`
- Test: `decent-protocol/tests/storage/public-workspace-store.test.ts`

1. Write failing persistence tests for:
   - saving/loading `WorkspaceShell`
   - saving/loading member pages
   - saving/loading channel policies
   - saving/loading history page refs
2. Add IndexedDB stores for normalized large-workspace data:
   - `workspaceShells`
   - `memberDirectoryPages`
   - `directoryShardRefs`
   - `channelPolicies`
   - `presenceAggregates`
   - `historyPages`
3. Keep old `workspaces` store for backward compat, but add migration hooks.
4. Do **not** yet remove old `saveWorkspace()` path.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-protocol
bun test tests/storage/public-workspace-store.test.ts
```

---

## Task 5: Add workspace shell + delta protocol

**Files:**
- Modify: `decent-protocol/src/workspace/SyncProtocol.ts`
- Create: `decent-protocol/src/workspace/WorkspaceDeltaProtocol.ts`
- Modify: `decent-protocol/src/workspace/types.ts`
- Test: `decent-protocol/tests/workspace/workspace-delta-protocol.test.ts`

1. Write failing tests for:
   - shell fetch
   - delta apply
   - out-of-order delta rejection / buffering
   - version bump behavior
2. Add protocol messages:
   - `workspace-shell-request`
   - `workspace-shell-response`
   - `workspace-delta`
   - `workspace-delta-ack`
3. Keep `join-accepted` / `sync-response` temporarily for legacy clients.
4. Add version numbers/checkpoints to shell data.
5. Commit.

**Migration rule:**
- new clients prefer shell + delta
- old clients keep using current full sync

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-protocol
bun test tests/workspace/workspace-delta-protocol.test.ts
```

---

## Task 6: Introduce distributed member directory pages and shard refs

**Files:**
- Create: `decent-protocol/src/workspace/DirectoryProtocol.ts`
- Create: `decent-protocol/src/workspace/DirectoryShardPlanner.ts`
- Modify: `decent-protocol/src/workspace/types.ts`
- Test: `decent-protocol/tests/workspace/directory-protocol.test.ts`

1. Write failing tests for:
   - page requests by cursor
   - shard ownership refs
   - replica advertisements
   - deterministic member partitioning
2. Add protocol messages:
   - `member-page-request`
   - `member-page-response`
   - `directory-shard-advertisement`
   - `directory-shard-repair`
3. Use a deterministic shard key, e.g. hash(identityId or peerId) prefix.
4. Cap page sizes aggressively (e.g. 50/100/200).
5. Commit.

**Design note:**
- clients should never need full member export to open a workspace

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-protocol
bun test tests/workspace/directory-protocol.test.ts
```

---

## Task 7: Add capability-advertised peers (directory / relay / archive)

**Files:**
- Modify: `decent-protocol/src/workspace/types.ts`
- Modify: `decent-client-web/src/app/ChatController.ts`
- Modify: `decent-transport-webrtc/src/PeerTransport.ts`
- Create: `decent-protocol/tests/workspace/peer-capabilities.test.ts`

1. Write failing tests for capability advertisement and selection.
2. Extend handshake/workspace metadata with optional capabilities:
   - `directory`
   - `relay`
   - `archive`
   - `presence-aggregator`
3. Ensure capability peers are not authoritative — they are just service replicas.
4. Update topology scoring to favor healthy overlap/capability peers for large workspaces.
5. Commit.

**Pseudo-shape:**
```ts
export interface PeerCapabilities {
  directory?: { shardPrefixes: string[] };
  relay?: { channels?: string[] };
  archive?: { retentionDays?: number };
  presenceAggregator?: boolean;
}
```

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat
bun test decent-protocol/tests/workspace/peer-capabilities.test.ts
```

---

## Task 8: Teach ChatController to load slices, not full rosters

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts`
- Create: `decent-client-web/src/app/workspace/PublicWorkspaceController.ts`
- Test: `decent-client-web/tests/integration/public-workspace-shell.spec.ts`

1. Write failing integration tests for opening a workspace from shell-only data.
2. Split current workspace behavior into:
   - workspace shell load
   - visible channel load
   - roster page load
   - search request
   - active-channel presence subscription
3. Keep current `ws.members` path as compatibility fallback only.
4. Add feature flag to enable large-workspace path per workspace capability/version.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
npx playwright test tests/integration/public-workspace-shell.spec.ts --reporter=line
```

---

## Task 9: Rebuild roster UI as paged/search-first

**Files:**
- Modify: `decent-client-web/src/lib/components/members/MemberList.svelte`
- Modify: `decent-client-web/src/lib/components/modals/WorkspaceMembersModal.svelte`
- Modify: `decent-client-web/src/lib/components/modals/ChannelMembersModal.svelte`
- Create: `decent-client-web/src/lib/components/members/MemberDirectoryPage.svelte`
- Test: `decent-client-web/tests/e2e/member-directory-pagination.spec.ts`

1. Write failing UI tests for:
   - page loading
   - search filtering
   - virtualized rows
   - no full 10k/100k render stall
2. Replace list-centric assumptions with directory-centric UX:
   - search bar first
   - online/mod/admin tabs
   - infinite or cursor paging
   - virtualization
3. Do not request more than the visible page + small prefetch window.
4. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
npx playwright test tests/e2e/member-directory-pagination.spec.ts --reporter=line
```

---

## Task 10: Presence aggregates and scoped subscriptions

**Files:**
- Modify: `decent-client-web/src/ui/PresenceManager.ts`
- Create: `decent-protocol/src/workspace/PresenceProtocol.ts`
- Modify: `decent-client-web/src/app/ChatController.ts`
- Test: `decent-client-web/tests/integration/presence-slices.spec.ts`

1. Write failing tests for aggregate/scoped presence updates.
2. Add protocol messages for:
   - `presence-aggregate`
   - `presence-subscribe`
   - `presence-unsubscribe`
   - `presence-page-response`
3. Keep typing indicators limited to the active channel subscription set.
4. Avoid full-roster live online maps for large workspaces.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat
bun test decent-client-web/tests/integration/presence-slices.spec.ts
```

---

## Task 11: Page history and archive replication

**Files:**
- Modify: `decent-protocol/src/workspace/SyncProtocol.ts`
- Create: `decent-protocol/src/history/HistoryPageProtocol.ts`
- Modify: `decent-protocol/src/storage/PersistentStore.ts`
- Test: `decent-protocol/tests/history/history-pages.test.ts`

1. Write failing tests for paged history fetch and local caching.
2. Replace “messageHistory map on join” with:
   - recent page request
   - older page cursor fetch
   - page replication metadata
3. Keep negentropy for repair of hot/recent windows where it still fits.
4. Add replica hints so peers know who can serve recent/deep history.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-protocol
bun test tests/history/history-pages.test.ts
```

---

## Task 12: Public-channel delivery contracts for bounded fanout

**Files:**
- Create: `specs/deps/DEP-015-public-channel-delivery.md`
- Modify: `decent-client-web/src/app/ChatController.ts`
- Test: `decent-client-web/tests/integration/public-channel-fanout.spec.ts`

1. Write a follow-up DEP for bounded delivery semantics in very large channels.
2. Write failing tests proving that a sender does **not** attempt direct fanout to all known members.
3. Use the existing partial-mesh + gossip path as the first bounded-delivery implementation.
4. Define the later upgrade path to sender-key / group-key delivery without forcing it into the first rollout.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
npx playwright test tests/integration/public-channel-fanout.spec.ts --reporter=line
```

---

## Task 13: Reliability rules for always-on peer loss

**Files:**
- Create: `decent-client-web/tests/integration/capability-peer-failure.spec.ts`
- Modify: `decent-client-web/src/app/ChatController.ts`
- Modify: `decent-protocol/src/workspace/DirectoryProtocol.ts`
- Test: same files above

1. Write failing tests for loss of one directory/relay/archive peer.
2. Enforce replica rules:
   - minimum 2 replicas for important shards in medium+ workspaces
   - preferred 3 replicas when available
3. Define degraded-but-correct behaviors:
   - chat continues
   - discovery slower
   - deeper history may be delayed
   - directory search may be partial until repair
4. Ensure no feature hard-depends on exactly one helper peer.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
npx playwright test tests/integration/capability-peer-failure.spec.ts --reporter=line
```

---

## Task 14: Load testing harness for 10k / 100k / 500k metadata scale

**Files:**
- Create: `decent-client-web/tests/perf/public-workspace-scale.perf.ts`
- Create: `decent-protocol/tests/perf/directory-shard.perf.ts`
- Create: `docs/plans/2026-03-11-public-workspace-benchmarks.md`
- Test: performance scripts

1. Create synthetic generators for:
   - 10k member workspace shell
   - 100k directory pages
   - 500k shard metadata only (not all in DOM)
2. Measure:
   - open workspace shell time
   - first page render time
   - search latency
   - memory growth
   - join readiness time
3. Fail the perf suite if regressions exceed agreed thresholds.
4. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat
bun test decent-protocol/tests/perf/directory-shard.perf.ts
bun test decent-client-web/tests/perf/public-workspace-scale.perf.ts
```

---

## Task 15: Migration and rollout guardrails

**Files:**
- Create: `docs/plans/2026-03-11-public-workspace-migration.md`
- Modify: `docs/protocol/index.md`
- Modify: `docs/architecture.md`
- Test: `decent-client-web/tests/integration/public-workspace-mixed-client.spec.ts`

1. Write failing mixed-client tests:
   - old client + new client
   - shell/delta capable peer + legacy snapshot peer
2. Add feature gating:
   - workspace capability bit for large-workspace features
   - safe downgrade path when peers do not support them
3. Document rollout order:
   - DEP first
   - types + persistence
   - shell/delta
   - directory pages
   - UI
   - reliability drills
4. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
npx playwright test tests/integration/public-workspace-mixed-client.spec.ts --reporter=line
```

---

## Recommended implementation order

1. DEP-014 (architecture contract)
2. scalable types
3. channel policy model
4. normalized persistence
5. shell + delta sync
6. directory pages + shard refs
7. capability peers
8. ChatController slice-loading
9. roster UI
10. presence slices
11. history paging
12. bounded public-channel fanout
13. failure drills
14. perf harness
15. mixed-client migration

Do not skip the early protocol/data-model tasks and jump straight to UI. That would create cosmetic scale without real scale.

---

## Risks

### Risk 1: accidental hidden second architecture
If “large workspace” code drifts too far from normal workspace flows, you will recreate the dual-architecture problem under a different name.

**Mitigation:**
- keep the same workspace objects and protocol families
- add optional scalable fields/capabilities
- make behavior adaptive, not separate

### Risk 2: too much authority in helper peers
Directory/relay/archive peers could accidentally become central points of failure.

**Mitigation:**
- signed state
- replica counts > 1
- repair and replacement
- no singleton assumptions in tests

### Risk 3: pairwise delivery assumptions leak into public channels
Even with partial mesh, message handling may still assume sender-to-peer semantics too often.

**Mitigation:**
- codify bounded fanout
- introduce delivery contracts before optimizing throughput

### Risk 4: IndexedDB migration pain
Normalized stores can get messy quickly.

**Mitigation:**
- versioned schema changes
- migration tests
- leave old stores intact until new path is stable

---

## Definition of done

This plan is complete when the codebase can demonstrate all of the following:

- opening a very large workspace does **not** require full roster download
- public channels no longer carry giant explicit member arrays
- loss of one helper peer does not break correctness
- history, directory, and presence can be loaded as slices/pages
- topology remains bounded at scale
- perf harness shows acceptable open/search/render behavior at synthetic 100k+ metadata scale
- migration path exists for legacy peers

---

## Handoff

Options:
1. **Subagent-Driven (same session)** — I can break this into the first executable batch and start with DEP-014 + type changes.
2. **Parallel Session (new session with executing-plans)** — I can spawn a dedicated execution session to implement this plan task-by-task with checkpoints.
