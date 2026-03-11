# Swarm Topology Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Define a concrete, production-ready swarm/topology strategy for DecentChat so peer selection behaves like a bounded intelligent swarm rather than a full mesh.

**Architecture:** Keep topology policy in `decent-client-web/src/app/ChatController.ts`, where workspace context, health signals, sync orchestration, and maintenance loops already live. Treat `PeerTransport` as plumbing: it exposes connection state and disconnect/connect primitives, but does not own topology policy. Reuse one physical peer connection across overlapping workspaces and let gossip + negentropy + workspace-state sync repair eventual consistency.

**Tech Stack:** TypeScript, WebRTC/PeerJS transport, ChatController maintenance loop, gossip relay, negentropy sync, workspace registry, Bun tests, Playwright integration.

---

## Core strategy

Each peer should maintain:
- a **known peer set** (discovered / workspace members / registry / invites)
- a **desired peer set** (who we want connected now)
- an **active connected set** (who is actually connected now)

The policy should behave like this:
- discover many peers
- connect to only a bounded subset
- prefer stable / useful / overlapping peers
- keep a couple of rotating exploratory edges
- avoid churn unless a replacement is clearly better
- never intentionally drop below a safe minimum if candidates exist

---

## What a peer should store locally

### Required runtime state

Per remote `peerId`, store:
- `lastSeenAt`
- `lastConnectAttemptAt`
- `connectedAt`
- `lastSuccessfulSyncAt`
- `disconnectCount`
- `lastExplorerAt`
- `sharedWorkspaceCount`
- `isReady`
- `isConnected`
- `isConnecting`
- `roleInActiveWorkspace` (`owner` | `admin` | `member`)
- `workspaceMemberships` (count or IDs)

### Optional but useful later
- `lastHeartbeatRecoveryAt`
- `recentSyncFailureCount`
- `recentConnectFailureCount`
- `recentMessageExchangeAt`
- `transportCostHint` (TURN-only / relay-heavy if inferable)
- `manualPin` / `doNotPrune`

### Important invariant
One physical connection per `peerId` should be treated as reusable across all overlapping workspaces.
Do not build workspace-local duplicate connection thinking.

---

## Topology classes

For the active workspace, divide candidates into:

### 1. Anchors
Stable peers you almost always want.

Prefer:
- owner
- admins
- long-lived healthy peers
- peers shared with multiple workspaces

Suggested count:
- desktop: 2
- mobile: 1–2

### 2. Core peers
Best-scored normal peers filling the bulk of the target degree.

Prefer:
- healthy
- recently seen
- recently synced
- low churn
- overlapping peers

### 3. Explorer peers
Rotating peers used to avoid sticky topology / graph partitioning.

Suggested count:
- desktop: 2
- mobile: 1

Rotation:
- every 2–5 minutes
- not every maintenance tick

---

## Target degree defaults

### Desktop
- target: 8
- hard cap: 12

### Mobile
- target: 5
- hard cap: 8

### Safety floor
- minimum safe connected peers: 3

### Rule
- if candidates <= target: connect to all
- else maintain target-sized desired set
- if connected desired peers < safe minimum: temporarily widen reconnect behavior

---

## Scoring model

Use a simple additive score.

### Positive weights
- connected + ready: +40
- connected but not ready: +25
- connecting: +5
- likely online: +25
- seen within 5 min: +20
- seen within likely window: +10
- successful sync within likely window: +20
- connected long enough past dwell threshold: +10
- owner: +15
- admin: +10
- shared across other workspaces: +5 per extra workspace, capped at +10

### Negative weights
- disconnect churn: -10 per recent disconnect event, capped at -30
- later extensions could add sync/connect failure penalties

### Tie-breakers
1. higher role weight
2. more shared workspaces
3. more recent seen timestamp
4. stable lexical peerId fallback

---

## Hysteresis / anti-flap rules

### Minimum dwell
Do not evict a healthy connected peer before:
- 90 seconds connected, unless urgently necessary

### Replacement threshold
A challenger should only replace a healthy incumbent if:
- challenger score >= incumbent score + 20

### Sticky incumbent rule
If a peer is:
- connected
- healthy enough
- still useful

then keep it unless there is a clearly better reason to replace it.

### Explorer rule
Explorer slots may rotate, but:
- not all at once
- never at the expense of dropping below safe minimum
- never eject anchors first

---

## Pruning strategy

Pruning should be conservative.

### When pruning is allowed
Only consider pruning if:
- partial-mesh mode is enabled
- connected peers > max(desired budget, safe minimum)
- transport exposes disconnect safely

### Who is pruneable
Candidates for pruning:
- connected peers outside desired set
- lower score
- not anchors
- not overlap-important peers if possible
- beyond dwell threshold

### Who should be protected
Avoid pruning peers that:
- are anchors
- are shared across multiple workspaces and likely valuable
- are within minimum dwell window
- keep us at or near safe minimum

### Current recommended behavior
- prune at most a small number per maintenance sweep
- prefer a slow converge-down rather than aggressive chopping

---

## Reconnect strategy

### Desired peers
Reconnect aggressively to desired peers that are likely online.

### Cold peers
Probe sparingly using a cooldown window.

### Under-connected mode
If connected desired peers < safe minimum:
- temporarily allow reconnect attempts beyond desired set
- use likely-online peers first
- fall back to cold peers with cooldown

This is the “survival mode” of the topology.

---

## Invite strategy

When generating an invite, include up to 3 additional fallback peers.

Priority order:
1. connected desired peers
2. desired peers not currently connected
3. connected non-desired peers
4. known workspace members

This makes invite joins more resilient while staying aligned with topology policy.

---

## Status / debug model

Connection status should distinguish between:
- browser/network offline
- signaling disconnected
- partial-mesh healthy
- partial-mesh under target but recovering
- no desired peers connected

### Debug fields worth exposing
- `partialMeshEnabled`
- `desiredPeerCount`
- `connectedDesiredPeerCount`
- `connectingDesiredPeerCount`
- `connectedPeerCount`
- `likelyPeerCount`
- `coldPeerCount`
- `desiredPeers`
- `anchors`
- `explorers`

This is essential for debugging topology behavior in the wild.

---

## Metrics to watch in production

### Connectivity
- average connected peer count
- average desired peer count
- ratio of connected desired / desired
- time spent below safe minimum

### Stability
- disconnects per hour
- reconnect attempts per hour
- prunes per hour
- explorer rotations per hour

### Delivery / convergence
- message sync success rate
- negentropy success/failure rate
- average time to catch up after reconnect
- duplicate/gossip relay rate

### Resource usage
- browser CPU spikes
- memory growth with larger workspaces
- TURN-heavy connection rate if measurable

---

## Comparison to BitTorrent

### Similar principles
- many known peers, bounded active peers
- stable preferred peers
- a few rotating exploratory peers
- no need to connect to everyone
- recovery via sync/reconciliation

### Important differences
BitTorrent optimizes for:
- chunk throughput
- interchangeable peers
- hash-verified bulk transfer

DecentChat optimizes for:
- low-latency message propagation
- workspace/channel correctness
- social state (presence, typing, thread behavior)
- sync convergence under churn

So we should copy the **peer-management instincts**, not the exact sparsity profile.

---

## Go-live criteria

Before enabling by default:
- unit tests green
- partial-mesh integration tests green
- broader regression sufficiently clean
- no evidence of reconnect storms
- no delivery regressions in simulated medium workspaces
- no obvious invite/join regressions

If broader integration is noisy for unrelated reasons, keep gated until triaged.

---

## Task 1: Lock the policy contract in tests

**Files:**
- Modify: `decent-client-web/tests/unit/peer-maintenance-policy.test.ts`
- Modify: `decent-client-web/tests/unit/invite-topology-selection.test.ts`
- Test: same files

1. Add explicit tests for:
   - overlap-shared peers being preferred under budget pressure
   - anchors preserved under churn
   - explorers rotating without duplicating desired set
   - prune safety floor respected
2. Run failing tests first.
3. Implement minimal logic if anything is missing.
4. Re-run and verify pass.
5. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/peer-maintenance-policy.test.ts tests/unit/invite-topology-selection.test.ts
```

---

## Task 2: Validate maintenance behavior against real policy invariants

**Files:**
- Modify: `decent-client-web/tests/integration/partial-mesh.spec.ts`
- Test: `decent-client-web/tests/integration/partial-mesh.spec.ts`

1. Add/expand integration checks for:
   - prune keeps overlap-important peer when possible
   - under-connected recovery widens candidate attempts
   - status/debug fields reflect desired topology
2. Run the integration suite.
3. Keep the feature gated unless confidence is high.
4. Commit.

**Commands:**
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
PW_ENABLE_SIGNALING=0 npx playwright test tests/integration/partial-mesh.spec.ts --reporter=line
```

---

## Task 3: Run broader regressions and make explicit go/no-go decision

**Files:**
- No code required unless regressions point to real issues

1. Run broader unit regression:
```bash
cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit
```
2. Run broader integration sweep as far as practical.
3. If failures are clearly unrelated/pre-existing, document that and keep gated.
4. If all meaningful coverage is clean, decide whether to flip the default.
5. Commit only if enabling by default is justified.

---

## Handoff

Options:
1. **Subagent-Driven:** Implement/validate this strategy in the same session.
2. **Parallel Session:** Spawn a dedicated execution session to finish the rollout decision.
