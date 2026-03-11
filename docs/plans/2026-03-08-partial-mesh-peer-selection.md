# Partial-Mesh Peer Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add a capped, resilient, dynamically rebalanced peer-selection policy for DecentChat so medium/large workspaces avoid full-mesh costs while preserving delivery reliability through gossip + negentropy sync.

**Architecture:** Keep policy in `decent-client-web/src/app/ChatController.ts`, where workspace/member context, likely-online heuristics, sync orchestration, and maintenance timing already live. Keep `decent-transport-webrtc/src/PeerTransport.ts` mostly transport-only, exposing only extra connection metadata if needed for scoring/debugging. Roll out behind a feature flag, starting conservative: compute a desired peer set, connect up to target, and prune only when safely above cap.

**Tech Stack:** TypeScript, Bun, Playwright/unit tests, existing WebRTC transport (`PeerTransport`), gossip relay (`GOSSIP_TTL = 2`), negentropy/message sync, workspace registry, heartbeat/reconnect logic.

---

## Recommended policy defaults

- Desktop target: `8`
- Mobile target: `5`
- Desktop hard cap: `12`
- Mobile hard cap: `8`
- Minimum safe peers: `3`
- Anchor slots: `2`
- Explorer slots: `2` desktop / `1` mobile
- Explorer rotation: `180000` ms
- Replacement threshold: `20` score points
- Minimum healthy dwell before prune: `90000` ms

---

### Task 1: Extract peer-maintenance policy scaffolding without changing behavior

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts:2362-2820`
- Test: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write a failing unit test that proves candidate collection can be called independently of connect side effects.
2. Add pure/helpers for:
   - collecting workspace candidates
   - classifying likely vs cold peers
   - returning current connected/connecting/ready sets
3. Keep `_runPeerMaintenance()` behavior unchanged for now.
4. Run and verify tests pass.
5. Commit: `refactor peer maintenance into policy helpers`

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/peer-maintenance-policy.test.ts
```

---

### Task 2: Add partial-mesh config/constants and device target computation

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts` (new config/constants near peer-maintenance region)
- Modify: `decent-client-web/src/main.ts` (wire optional settings if exposed)
- Test: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write failing tests for:
   - desktop target = 8
   - mobile target = 5
   - small workspace connects to all if count <= target
   - hard cap is never exceeded by desired-set computation
2. Add config/constants for:
   - `partialMeshEnabled`
   - targets/caps/min-safe/anchor/explorer/rotation/thresholds
3. Add `computeTargetPeerCount()` and `computeHardCap()` helpers.
4. Keep feature disabled by default until later task if you want a zero-risk rollout; otherwise enable only in test/dev path first.
5. Run tests.
6. Commit: `add partial mesh configuration and target computation`

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/peer-maintenance-policy.test.ts
```

---

### Task 3: Track peer health and scoring inputs

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts:2378-2434, 2733-2816, 5109-5200, 2597-2666`
- Modify: `decent-transport-webrtc/src/PeerTransport.ts:256-380, 480-620` (only if exposing metrics is necessary)
- Test: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write failing tests for score ordering:
   - healthy connected peer outranks cold peer
   - recently seen peer outranks stale peer
   - flappy/degraded peer is penalized
2. Add in-memory tracking maps in `ChatController` for:
   - last successful sync per peer
   - recent disconnect/recovery count
   - connection established timestamp
   - explorer last-used timestamp
3. If needed, expose transport-side read-only metadata hooks such as:
   - connection openedAt
   - recent heartbeat recovery count
   - reconnect attempt count
4. Implement `scoreWorkspacePeer(peerId, member, now)` using simple additive weights.
5. Verify tests.
6. Commit: `track peer health and scoring inputs`

**Notes:** keep scoring transparent and logged; do not hide policy in transport.

---

### Task 4: Implement desired-peer-set selection (anchors, core, explorers)

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts:2733-2816`
- Test: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write failing tests for:
   - desired set size == target on large workspace
   - 2 anchors preserved when available
   - explorer slots rotate independently of core peers
   - no duplicate peer selection across buckets
2. Add pure selection helpers:
   - `pickAnchorPeers()`
   - `pickExplorerPeers()`
   - `selectDesiredPeers()`
3. Anchor rules for v1:
   - prefer owner/admin/stable peers
   - fall back to highest score
4. Explorer rules for v1:
   - choose from non-selected peers
   - rotate every `explorerRotationMs`
   - do not rotate on every maintenance sweep
5. Run tests.
6. Commit: `implement desired peer set selection`

---

### Task 5: Add hysteresis and conservative rebalancing

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts:2733-2816`
- Test: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write failing tests for:
   - slightly better candidate does not evict healthy incumbent
   - healthy incumbent can be replaced only after dwell + threshold
   - minimum-safe peers are never intentionally broken
2. Implement:
   - `shouldKeepIncumbent()`
   - replacement threshold
   - minimum dwell time
   - no-prune behavior when connected <= min-safe
3. First rollout behavior should be conservative:
   - always connect missing desired peers
   - prune only if connected peers are clearly above target and pruning is safe
4. Run tests.
5. Commit: `add hysteresis and safe rebalance rules`

---

### Task 6: Replace “connect to all” maintenance with capped desired-set maintenance

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts:2733-2816`
- Test: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`
- Test: `decent-client-web/tests/unit/reconnect-guard.test.ts` (if behavior changes)

1. Write failing tests that current `_runPeerMaintenance()`:
   - connects only desired peers when partial mesh enabled
   - still aggressively reconnects when below min-safe
   - still sparsely probes cold peers when under-connected
2. Refactor `_runPeerMaintenance()` to:
   - gather candidates
   - compute desired set
   - connect missing desired peers
   - optionally prune excess non-desired healthy peers conservatively
3. Preserve existing special handling:
   - periodic message sync on ready peers
   - no double-scheduling while transport already connecting
4. Run tests.
5. Commit: `switch maintenance to capped desired peer policy`

---

### Task 7: Update UI/status/debug visibility for partial mesh

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts:2449-2514`
- Modify: `decent-client-web/src/ui/types.ts`
- Modify: any sidebar/status renderer that consumes `getConnectionStatus()`
- Test: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write failing tests for status output such as:
   - `connected 6/8 desired`
   - `reconnecting to 2 desired peers`
   - no warning when at healthy target despite not being full mesh
2. Extend connection status model to distinguish:
   - desired peer count
   - currently connected desired peers
   - under-target recovery state
3. Ensure UI does not imply “broken” just because not every member is directly connected.
4. Run tests.
5. Commit: `surface partial mesh connection status`

---

### Task 8: Align invite peer suggestions with topology policy

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts:4535-4558`
- Test: `decent-client-web/tests/unit/invite-topology-selection.test.ts`

1. Write failing tests for invite additional peers:
   - prefers currently selected/healthy anchors/core peers
   - still caps at 3 invite peers
   - falls back to known members if selected peers unavailable
2. Replace the raw connected-first loop with selection-aware invite helper.
3. Keep invite payload backwards-compatible.
4. Run tests.
5. Commit: `align invite fallback peers with topology policy`

---

### Task 9: Add rollout flag and metrics/logging

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts`
- Modify: `decent-client-web/src/main.ts`
- Test: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write failing tests for:
   - feature flag off => old connect-to-all behavior
   - feature flag on => capped policy behavior
2. Add structured logs/metrics for:
   - workspace peer count
   - target count
   - desired set composition (anchor/core/explorer)
   - connected count
   - prune/connect decisions
   - under-target recovery activations
3. Wire flag default.
4. Run tests.
5. Commit: `add partial mesh rollout flag and diagnostics`

---

### Task 10: Add integration tests for medium-size workspace behavior

**Files:**
- Create: `decent-client-web/tests/integration/partial-mesh.spec.ts`
- Modify: existing mocks if needed under `decent-client-web/tests/mocks/`

1. Write failing integration tests for:
   - 10-member workspace converges with target 4/5 in test mode
   - messages propagate through gossip even without full mesh
   - reconnect churn does not explode connection count
   - explorer rotation does not partition the workspace permanently
2. Use MockTransport or a deterministic topology mock to simulate:
   - online members > target
   - rotating availability
   - relay delivery paths
3. Verify convergence via message visibility and workspace state sync.
4. Commit: `add integration coverage for partial mesh`

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
PW_ENABLE_SIGNALING=0 npx playwright test tests/integration/partial-mesh.spec.ts --reporter=line
```

---

### Task 11: Regression matrix before enabling by default

**Files:**
- Test only

1. Run targeted suites:
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/peer-maintenance-policy.test.ts
bun test tests/unit/reconnect-guard.test.ts
bun test tests/unit/workspace-state-sync.test.ts
bun test tests/unit/streaming-thread.test.ts
PW_ENABLE_SIGNALING=0 npx playwright test tests/integration/partial-mesh.spec.ts --reporter=line
```
2. Validate manually in browser with a medium workspace:
   - connected peers stabilize near target
   - no reconnect storm
   - messages still converge after temporary disconnects
   - invite/join still works
3. Only then flip feature flag default.
4. Commit: `enable partial mesh by default` (only if all green)

---

## Implementation notes

- Keep policy in `ChatController`; avoid burying topology decisions in transport.
- Keep `PeerTransport` generic; expose stats, not policy.
- Do **not** start with aggressive pruning.
- Do **not** reduce target below 6 on desktop while `GOSSIP_TTL = 2` remains fixed.
- Treat active workspace as the only aggressively maintained topology in v1.
- Preserve existing periodic sync behavior for already-connected ready peers.

## Risks and mitigations

- **Partition risk** → maintain min-safe peers + explorer slots + conservative target
- **Connection flapping** → hysteresis + dwell time + slower explorer rotation
- **Hidden full-mesh assumptions** → integration tests on gossip/sync/invite flows
- **Bad rollout** → feature flag + diagnostics before default enablement

## Handoff

Options:
1. **Subagent-Driven:** I can turn this into implementation work in this session.
2. **Parallel Session:** Spawn a dedicated execution session and implement task-by-task with checkpoints.
