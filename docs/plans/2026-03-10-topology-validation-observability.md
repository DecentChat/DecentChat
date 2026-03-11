# DecentChat Topology Validation + Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add enough topology stress coverage, telemetry, and anomaly detection to decide safely whether partial-mesh peer selection can be enabled by default.

**Architecture:** Keep topology policy ownership inside `decent-client-web/src/app/ChatController.ts`, but move observability logic into small helper modules so policy code does not turn into an unreadable logging blob. Treat every remote peer as a single reusable physical connection keyed by `peerId` across all workspaces; telemetry and anomaly detection must operate on that invariant and never assume duplicate per-workspace transport edges.

**Tech Stack:** TypeScript, Bun unit tests, deterministic simulation tests, Playwright integration tests, ChatController maintenance loop, WebRTC transport state, local structured logs via `console.info/debug/warn` + in-memory ring buffer for debug UI.

---

## Recommendation

**Do not enable partial mesh by default until this telemetry ships.**

The policy itself is already fairly sophisticated, but right now we do not have enough evidence around:
- churn stability under large candidate sets
- convergence under repeated maintenance sweeps
- overlap-peer protection behavior over time
- reconnect storm detection
- computation cost at 1k / 10k known-member scales

Ship observability first, run the validation matrix below, then make the default-on decision.

---

## Invariants / Non-Negotiables

1. **Single physical connection per peer.**
   All topology accounting is keyed by `peerId`, not `(workspaceId, peerId)`.
2. **Overlap peers are valuable.**
   If a peer overlaps across multiple workspaces, reuse the same connection and prefer it during bounded-peer selection.
3. **1000 / 10000 member validation is mostly simulated.**
   We are validating policy, convergence, and operator confidence — not literally spinning up 10k browsers.
4. **Observability must be cheap enough to leave on in dev / staging.**
   Info logs should summarize; debug logs may be verbose but must be gated.
5. **Anomaly rules should be machine-readable.**
   If we later export telemetry remotely, the local schema should already be structured.

---

## Testing Strategy

Split coverage into three layers.

### A. Pure policy stress tests

Purpose:
- validate bounded desired-set behavior
- validate scoring / overlap preference / incumbent protection
- validate pruning and safe-minimum rules
- validate computation cost on 100 / 1000 / 10000 candidates

Shape:
- no browser
- no real transport
- synthetic candidate arrays
- deterministic timestamps
- run in Bun

Scale targets:
- 100 members: full invariant assertions
- 1000 members: repeated selection + maintenance-cycle snapshots
- 10000 members: policy-only performance + boundedness + overlap correctness

### B. Deterministic simulated swarm tests

Purpose:
- validate repeated maintenance sweeps over time
- validate recovery after disconnects / partitions / flapping peers
- validate explorer rotation cadence
- validate overlap-peer reuse across multiple workspace graphs
- validate anomaly detection emits correct warnings

Shape:
- still no real browser/WebRTC
- simulate a swarm graph and maintenance ticks
- represent one controller plus synthetic remote-peer state transitions
- deterministic PRNG seed and scripted events

Suggested scenarios:
- stable 100-member room with light churn
- 1000-member room with 8-target bounded topology and periodic failures
- 10000-member policy simulation with sampled online/offline state transitions
- overlap-heavy multi-workspace graph where shared peers must never be pruned first
- reconnect storm scenario to prove detector trips

### C. Limited realistic browser tests

Purpose:
- validate real UI/debug surfacing
- validate maintenance loop integrates with transport state correctly
- validate logs/status remain sane in real browser runtime

Shape:
- Playwright only
- keep peer count realistic: ~8–24 browser contexts max
- optionally fake a 100-member roster while only a subset are actually connected candidates

Suggested scope:
- 8-peer real browser smoke
- 16-peer bounded-topology browser test
- 24-peer “stress-ish” browser test with mocked candidate roster of 100 members

Do **not** attempt 1000/10000 real browsers.

---

## Structured Log Schema

Use structured objects, not ad-hoc strings, even if they are emitted through `console.info/debug/warn`.

### Event 1: maintenance-cycle summary

```ts
{
  kind: 'topology.maintenance',
  level: 'info' | 'debug' | 'warn',
  ts: number,
  reason: string,
  workspaceId: string,
  activeWorkspace: boolean,
  partialMeshEnabled: boolean,
  candidatePeerCount: number,
  desiredPeerCount: number,
  connectedPeerCount: number,
  connectedDesiredPeerCount: number,
  connectingDesiredPeerCount: number,
  likelyPeerCount: number,
  coldPeerCount: number,
  anchorPeerIds: string[],
  explorerPeerIds: string[],
  desiredAddedPeerIds: string[],
  desiredRemovedPeerIds: string[],
  reconnectAttemptsThisSweep: number,
  pruneCountThisSweep: number,
  safeMinimumRecovery: boolean,
  safeMinimumTarget: number,
  overlapSelectedCount: number,
  overlapDesiredPeerIds: string[],
  selectionDurationMs: number,
  maintenanceDurationMs: number,
  desiredBudget: number,
  hardCap: number,
  targetDegree: number
}
```

### Event 2: peer event

```ts
{
  kind: 'topology.peer',
  level: 'info' | 'debug' | 'warn',
  ts: number,
  workspaceId: string,
  peerId: string,
  event:
    | 'selected-anchor'
    | 'selected-core'
    | 'selected-explorer'
    | 'selected-overlap'
    | 'skipped-incumbent-protection'
    | 'connect-attempt'
    | 'connected'
    | 'disconnected'
    | 'pruned'
    | 'sync-succeeded'
    | 'sync-failed',
  reason?: string,
  sharedWorkspaceCount?: number,
  score?: number,
  connected?: boolean,
  connecting?: boolean,
  ready?: boolean,
  likelyOnline?: boolean,
  disconnectCount?: number,
  connectedAt?: number,
  lastSyncAt?: number
}
```

### Event 3: anomaly event

```ts
{
  kind: 'topology.anomaly',
  level: 'warn',
  ts: number,
  workspaceId: string,
  anomaly:
    | 'reconnect-storm'
    | 'desired-set-flapping'
    | 'stuck-under-target'
    | 'below-safe-minimum-too-long'
    | 'over-prune-recovery-loop'
    | 'explorer-rotation-too-frequent'
    | 'overlap-peer-pruned-repeatedly'
    | 'selection-too-slow',
  metric: string,
  observed: number,
  threshold: number,
  windowMs: number,
  severity: 'low' | 'medium' | 'high',
  suggestedAction: string,
  context?: Record<string, unknown>
}
```

---

## Log Level Split

### Info-level useful logs

Emit once per maintenance sweep and for important state transitions:
- `topology.maintenance`
- `selected-anchor`
- `selected-explorer`
- `connect-attempt`
- `pruned`
- `connected`
- `disconnected`
- `sync-succeeded` (sampled or summarized, not every packet)
- anomaly summary when triggered

### Debug-level noisy logs

Emit only behind explicit debug flag:
- full ranked candidate snapshot
- per-candidate score breakdown
- incumbent-vs-challenger replacement comparisons
- desired-set diff with reasons
- per-peer “skipped because…” explanations
- full anomaly detector rolling-window counters

### Warning-level anomaly logs

Only for operator-actionable problems:
- reconnect storm
- stuck under target
- time below safe minimum too long
- over-pruning followed by recovery loop
- explorer rotation too frequent
- repeated pruning of overlap peers
- selection computation too slow for workspace size

---

## Anomaly Detection Rules

All anomaly state should live in a small detector with rolling windows keyed by `workspaceId` and `peerId`.

### 1. Reconnect storm
- **Signal / metric:** reconnect attempts per workspace over rolling window
- **Threshold:** `>= 20` attempts in `60_000ms` for desktop target 8; `>= 40` attempts in `120_000ms` absolute hard alarm
- **Severity:** high
- **Suggested operator action:** inspect signaling reachability, peer flapping, retry cooldowns, and whether target/budget is too aggressive

### 2. Desired-set flapping
- **Signal / metric:** desired-set additions + removals per sweep/window
- **Threshold:** `> 30%` of desired set replaced for `3` consecutive sweeps, or `>= 12` total desired-set changes in `5 min`
- **Severity:** medium
- **Suggested operator action:** inspect hysteresis threshold, dwell time, explorer cadence, and score instability

### 3. Stuck under target
- **Signal / metric:** connectedDesiredPeerCount / desiredPeerCount ratio
- **Threshold:** below `0.6` for `>= 5 min` while candidatePeerCount >= desiredPeerCount
- **Severity:** high
- **Suggested operator action:** inspect connect success rate, signaling, candidate liveness heuristics, and whether desired peers are unrealistic

### 4. Time spent below safe minimum
- **Signal / metric:** continuous time with connected peer count `< PARTIAL_MESH_MIN_SAFE_PEERS`
- **Threshold:** `> 30s` warning, `> 120s` high severity
- **Severity:** medium/high depending on duration
- **Suggested operator action:** force recovery mode, widen reconnect policy, inspect partition / offline conditions

### 5. Over-pruning followed by recovery
- **Signal / metric:** prune event followed by reconnect to maintain safe minimum shortly after
- **Threshold:** `>= 3` prune→recovery loops in `10 min`
- **Severity:** medium
- **Suggested operator action:** reduce pruning aggressiveness; check whether overlap peers or incumbents were pruned too eagerly

### 6. Explorer rotation too often
- **Signal / metric:** explorer slot churn rate per hour
- **Threshold:** any explorer replaced before `PARTIAL_MESH_EXPLORER_ROTATION_MS / 2`, or `>= 6` explorer rotations in `10 min`
- **Severity:** low/medium
- **Suggested operator action:** inspect explorer rotation timestamp handling and desired-set flapping interactions

### 7. Overlap peers repeatedly pruned
- **Signal / metric:** prune count of peers with `sharedWorkspaceCount > 1`
- **Threshold:** same overlap peer pruned `>= 2` times in `15 min`, or `>= 3` overlap-prune events per workspace in `30 min`
- **Severity:** high
- **Suggested operator action:** inspect overlap weighting, prune pool filters, and safe-minimum protection

### 8. Selection computation too slow
- **Signal / metric:** `selectionDurationMs`
- **Threshold:**
  - 100 peers: `> 10ms` warn, `> 25ms` fail
  - 1000 peers: `> 30ms` warn, `> 75ms` fail
  - 10000 peers: `> 120ms` warn, `> 250ms` fail
- **Severity:** medium/high depending on overage
- **Suggested operator action:** profile sort/filter allocations, reduce repeated scans across all workspaces, cache overlap counts per sweep

---

## Pass / Fail Criteria

### 100-member workspace

Success means:
- desired set remains bounded at target/hard-cap rules
- no reconnect storm anomalies in steady-state tests
- desired-set churn stays below `20%` per 5-minute steady-state window
- safe minimum never violated for more than `10s` during simulated failures
- overlap peers are consistently retained when beneficial
- selectionDurationMs stays `< 10ms` median, `< 25ms` p95 in pure policy tests
- browser integration with 8–16 real peers remains stable

Fail means any of:
- unbounded desired set
- overlap peer protection violated in deterministic scenarios
- repeated prune/recovery loop
- p95 selection cost > 25ms

### 1000-member workspace

Success means:
- policy-only / simulator runs keep desired set bounded with no O(N²)-feeling regressions
- no reconnect storm in deterministic swarm runs
- churn below `25%` of desired set per 5-minute steady-state window
- safe-minimum recovery converges within `<= 30s`
- overlap peers are reused and not repeatedly pruned
- selectionDurationMs stays `< 30ms` median, `< 75ms` p95

Fail means any of:
- repeated anomaly triggers in stable scenario
- convergence > 30s after induced failure where enough healthy candidates exist
- overlap peers pruned repeatedly
- p95 selection cost > 75ms

### 10000-member workspace

Success means:
- simulation completes without memory blow-up or pathological churn
- desired set remains strictly bounded
- no assumption of one connection per workspace/member combination
- anomaly detector remains quiet in healthy scripted scenarios
- safe-minimum recovery converges in policy simulation within `<= 60s`
- selectionDurationMs stays `< 120ms` median, `< 250ms` p95

Fail means any of:
- selection becomes too slow or alloc-heavy
- desired-set flapping under healthy conditions
- overlap preference breaks under scale
- repeated high-severity anomalies in healthy scenario

---

## Suggested Debug Dashboard Summary

Add a small developer-facing summary object (not a full UI project yet):
- active workspace id
- desired / connected / connecting counts
- anchors / explorers
- overlap-selected count
- last selection duration
- last maintenance duration
- anomalies in last 15 min
- reconnect attempts / prune count in last 15 min
- time below safe minimum in last 15 min

For now, this can surface via:
- `getConnectionStatus().debug`
- `window.__ctrl.getTopologyDebugSnapshot?.()`
- recent ring-buffer logs on controller instance

Do **not** build a large UI first. Build the telemetry substrate first.

---

## Repo Integration

### Core code
- Modify: `decent-client-web/src/app/ChatController.ts`
  - instrument `selectDesiredPeers(...)`
  - instrument `runPeerMaintenanceNow(...)`
  - instrument connection/disconnect/sync event sites
  - expose cheap debug snapshot accessor
- Modify: `decent-client-web/src/ui/types.ts`
  - extend debug/status typing for topology telemetry summary

### New helpers
- Create: `decent-client-web/src/app/topology/TopologyTelemetry.ts`
  - ring buffer, structured event helpers, maintenance diff helpers
- Create: `decent-client-web/src/app/topology/TopologyAnomalyDetector.ts`
  - rolling-window counters and anomaly emission logic
- Create: `decent-client-web/src/app/topology/TopologySimulator.ts`
  - deterministic swarm harness for 100/1000/10000 policy simulation

### Tests
- Modify: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`
- Modify: `decent-client-web/tests/unit/invite-topology-selection.test.ts`
- Create: `decent-client-web/tests/unit/topology-telemetry.test.ts`
- Create: `decent-client-web/tests/unit/topology-anomaly-detector.test.ts`
- Create: `decent-client-web/tests/unit/topology-policy-stress.test.ts`
- Create: `decent-client-web/tests/simulation/topology-simulator.test.ts`
- Modify: `decent-client-web/tests/integration/partial-mesh.spec.ts`
- Create: `decent-client-web/tests/integration/partial-mesh-observability.spec.ts`

### Notes on DEPs
This plan should **not** require a DEP unless you decide to:
- export topology telemetry over the wire
- persist telemetry in shared protocol state
- alter protocol semantics

For local controller telemetry + test harness work, no DEP should be necessary.

---

## Task 1: Add topology telemetry types and ring buffer

**Files:**
- Create: `decent-client-web/src/app/topology/TopologyTelemetry.ts`
- Modify: `decent-client-web/src/ui/types.ts`
- Test: `decent-client-web/tests/unit/topology-telemetry.test.ts`

1. Write failing tests for:
   - maintenance-cycle event serialization
   - desired-set diff detection (additions/removals)
   - ring buffer cap / eviction behavior
2. Run and verify fail.
3. Implement `TopologyTelemetry` with:
   - event type definitions
   - `recordMaintenanceCycle(...)`
   - `recordPeerEvent(...)`
   - bounded in-memory ring buffer (e.g. 250 events)
4. Extend `ConnectionStatusModel.debug` typing to include a compact topology summary.
5. Run and verify pass.
6. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/topology-telemetry.test.ts
bun run typecheck
```

---

## Task 2: Instrument ChatController maintenance summaries

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts`
- Test: `decent-client-web/tests/unit/topology-telemetry.test.ts`
- Test: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write failing tests that assert maintenance-cycle telemetry includes:
   - workspaceId
   - candidatePeerCount
   - desiredPeerCount
   - connectedDesiredPeerCount
   - anchors / explorers
   - overlapSelectedCount
   - selectionDurationMs
   - reconnectAttemptsThisSweep / pruneCountThisSweep
   - safeMinimumRecovery flag
2. Hook telemetry into `selectDesiredPeers(...)` and `runPeerMaintenanceNow(...)`.
3. Emit **info-level** summary once per sweep; keep ranked-candidate detail out of info logs.
4. Expose `getTopologyDebugSnapshot()` from controller for tests/debugging.
5. Run tests and verify pass.
6. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/topology-telemetry.test.ts tests/unit/peer-maintenance-policy.test.ts
bun run typecheck
```

---

## Task 3: Add per-peer topology event logging

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts`
- Test: `decent-client-web/tests/unit/topology-telemetry.test.ts`

1. Write failing tests for peer event emission:
   - selected-anchor
   - selected-explorer
   - selected-overlap
   - skipped-incumbent-protection
   - connect-attempt
   - pruned
   - connected / disconnected
   - sync-succeeded / sync-failed
2. Hook event emission at existing decision points rather than adding duplicate scans.
3. Make overlap selection explicit when `sharedWorkspaceCount > 1` materially influenced selection.
4. Gate noisy score-by-score comparisons behind debug mode only.
5. Run tests and verify pass.
6. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/topology-telemetry.test.ts
bun run typecheck
```

---

## Task 4: Build anomaly detector

**Files:**
- Create: `decent-client-web/src/app/topology/TopologyAnomalyDetector.ts`
- Modify: `decent-client-web/src/app/ChatController.ts`
- Test: `decent-client-web/tests/unit/topology-anomaly-detector.test.ts`

1. Write failing tests for each anomaly rule:
   - reconnect storm
   - desired-set flapping
   - stuck under target
   - below safe minimum too long
   - over-prune recovery loop
   - explorer rotation too frequent
   - overlap-peer pruned repeatedly
   - selection too slow
2. Implement rolling-window counters and timers keyed by workspace/peer.
3. Emit structured `topology.anomaly` warning events.
4. Feed anomalies into controller debug snapshot.
5. Run and verify pass.
6. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/topology-anomaly-detector.test.ts
bun run typecheck
```

---

## Task 5: Add pure policy stress tests for 100 / 1000 / 10000 members

**Files:**
- Create: `decent-client-web/tests/unit/topology-policy-stress.test.ts`
- Modify: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write failing stress tests that generate synthetic candidate sets at sizes 100, 1000, 10000.
2. Assert:
   - desired set stays bounded
   - anchors preserved
   - overlap peers preferred
   - prune set excludes overlap peers when alternatives exist
   - selection duration stays under thresholds
3. Use deterministic seeded peer data so failures are reproducible.
4. Run and verify pass.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/topology-policy-stress.test.ts tests/unit/peer-maintenance-policy.test.ts
```

---

## Task 6: Add deterministic swarm simulator

**Files:**
- Create: `decent-client-web/src/app/topology/TopologySimulator.ts`
- Create: `decent-client-web/tests/simulation/topology-simulator.test.ts`

1. Write failing simulation tests for:
   - stable 100-member room
   - 1000-member churn scenario
   - 10000-member policy-only scenario
   - overlap-heavy multi-workspace scenario
   - reconnect storm scenario
2. Implement simulator primitives:
   - seeded PRNG
   - synthetic peer registry keyed by `peerId`
   - maintenance-tick driver
   - scripted disconnect / reconnect / sync success / sync failure events
   - summary report object
3. Add assertions on anomaly counts, churn rate, and convergence time.
4. Run and verify pass.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/simulation/topology-simulator.test.ts
```

---

## Task 7: Extend invite and overlap protection coverage

**Files:**
- Modify: `decent-client-web/tests/unit/invite-topology-selection.test.ts`
- Modify: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`

1. Write failing tests for:
   - invite fallback peer list preferring connected desired overlap peers
   - overlap/shared-workspace peers surviving conservative prune sweeps
   - overlap peers not being repeatedly pruned under maintenance loops
2. Implement only the minimal code needed if gaps are exposed.
3. Run and verify pass.
4. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/invite-topology-selection.test.ts tests/unit/peer-maintenance-policy.test.ts
```

---

## Task 8: Add limited realistic browser observability checks

**Files:**
- Modify: `decent-client-web/tests/integration/partial-mesh.spec.ts`
- Create: `decent-client-web/tests/integration/partial-mesh-observability.spec.ts`

1. Write failing Playwright tests that assert:
   - topology debug snapshot is populated in browser runtime
   - maintenance logs contain structured summary fields
   - overlap-important peer is not pruned
   - safe-minimum recovery flips on when under-connected
2. Keep peer count small and realistic (single browser page with mocked controller state is enough for most checks).
3. Add one scenario with a 100-member roster and bounded desired set; do **not** use 100 browsers.
4. Run and verify pass.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
PW_ENABLE_SIGNALING=0 npx playwright test tests/integration/partial-mesh.spec.ts tests/integration/partial-mesh-observability.spec.ts --reporter=line
```

---

## Task 9: Run full validation matrix and write go/no-go summary

**Files:**
- Modify: `docs/plans/2026-03-10-topology-validation-observability.md` (append results section)
- Optional Create: `docs/reports/2026-03-10-partial-mesh-validation.md`

1. Run unit coverage:
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/ tests/simulation/
```
2. Run integration coverage:
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
PW_ENABLE_SIGNALING=0 npx playwright test tests/integration/partial-mesh.spec.ts tests/integration/partial-mesh-observability.spec.ts --reporter=line
```
3. Run typecheck/build:
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun run typecheck
bun run build
```
4. Record:
   - pass/fail by 100 / 1000 / 10000 tier
   - anomaly counts by scenario
   - selection duration stats
   - overlap-peer correctness outcome
   - recommendation: keep gated / enable by default
5. Commit.

---

## Suggested final decision rule

Enable partial mesh by default **only if** all of the following are true:
- no high-severity anomalies in healthy 100 / 1000 / 10000 scripted scenarios
- overlap peers are never incorrectly pruned in deterministic coverage
- selection cost stays within thresholds above
- limited browser integration remains stable
- no regression in invite fallback topology behavior

Otherwise keep it gated and ship telemetry first.

---

## Handoff

Options:
1. **Subagent-Driven:** I can execute this plan task-by-task and start with telemetry substrate + stress tests.
2. **Parallel Session:** Spawn a dedicated execution session to implement the observability system while we keep chatting here.
