# Messaging Reliability Hardening — Three-Track Implementation Brief

> **Audience:** backend, protocol, OpenClaw bridge, QA
>
> **Goal:** eliminate false-success messaging behavior, harden DM/channel routing semantics, and make end-to-end delivery behavior observable and testable.

## Executive Summary

This work should be split into three tracks:

1. **Track 1 — Canonical target resolution and fail-closed outbound addressing**
2. **Track 2 — Direct-message envelope semantics and inbound routing invariants**
3. **Track 3 — Delivery-state truthfulness, queue/ACK observability, and end-to-end seam coverage**

That split matches the current failure pattern:
- Track 1 removes ambiguity before a send even starts.
- Track 2 removes DM/channel routing guesswork once a message is in flight.
- Track 3 makes the system honest about what happened and proves it with durable regression coverage.

---

## Recommended execution order

### Recommended order
1. **Track 1 first**
   - It is the lowest-risk hardening pass.
   - It prevents bad targets from entering the system.
   - It reduces noise while validating later routing and delivery work.

2. **Track 2 second**
   - It defines authoritative routing semantics for DM vs workspace/channel traffic.
   - It should land before finalizing delivery-state wording because route ambiguity currently contaminates delivery signals.

3. **Track 3 third**
   - It should build on stable targeting + routing rules.
   - Parts of observability can start earlier, but final user-visible delivery semantics should wait until Tracks 1 and 2 are stable.

### If a protocol or wire-contract change is needed
Before implementing Track 2 or any non-additive Track 3 wire change, write a DEP and update `specs/deps/DEP-000.md`.

Good DEP triggers here:
- changing DM envelope rules
- changing required routing fields
- changing custody/delivery state semantics on the wire
- changing what OpenClaw can truthfully report as message-send success

---

## Shipping strategy

### Can ship independently
- **Track 1** can ship independently.
  - Benefit: ambiguous names stop producing misleading success paths.
  - Low coordination risk.

- **Track 2** can ship independently only if compatibility handling is explicit.
  - Safe if new invariants are additive or guarded.
  - Risky if it silently changes old-client behavior without metrics/logging.

- **Track 3 observability-only slices** can ship independently.
  - Examples: better logs, counters, queue-state inspection, tooltip/source-of-truth cleanup.

### Should ship together
- **Track 2 route-contract changes + Track 3 user-visible delivery wording** should ideally ship together.
  - Reason: the UI/tooling should not claim improved truthfulness while routing is still partly guess-based.

- **Final “messaging reliability hardening” milestone** should require all three tracks plus the full regression suite.

---

## Definition of progress

### Partial improvement
Count as partial improvement if any of the following become true:
- ambiguous target names fail with a deterministic error instead of silently resolving or pretending success
- direct peer-id sends work reliably even when alias lookup fails
- inbound DM routing no longer silently drops known direct messages without a trace
- queued/accepted/dispatched/delivered states are visibly distinguished somewhere in logs/UI/API
- stale pending-ack state is surfaced and cleaned up deterministically

### Done
Count this initiative as done only when all of the following are true:
- no outbound send is reported as “sent” when it was only locally accepted or queued
- DM vs workspace/channel routing is explicit, deterministic, and strongly typed across layers
- explicit bad routing inputs fail closed rather than degrade into fallback behavior
- end-to-end tests cover alias resolution, canonical peer-id sends, DM receive/reply, ack/retry/expiry, and stale queue cleanup
- every meaningful drop/reject/fallback path is observable in logs and test assertions

---

## Fail-closed rules

These are the places the system must fail closed rather than guess:

1. **Ambiguous human-readable targets**
   - If multiple peers/groups match, do not send.
   - Return a typed ambiguity error.

2. **Unknown explicit workspace target**
   - If `workspaceId` is provided and does not resolve, drop/reject.
   - Never reinterpret it as a DM.

3. **Explicit DM vs channel mismatch**
   - If an envelope claims direct semantics but carries channel-only routing, reject.
   - If an envelope claims workspace/channel semantics but lacks resolvable workspace/channel data, reject.

4. **Receipt validation**
   - Never upgrade message state from an ACK/read receipt that does not validate against an outstanding message, expected recipient, and channel.

5. **Reply/send continuation**
   - If a reply target cannot be reduced to a canonical peer/channel target, do not guess.
   - Return a user-facing error or structured bridge failure.

6. **Target-kind confusion**
   - A user target must not silently fall through into a group/channel target or vice versa.

---

# Track 1 — Canonical target resolution and fail-closed outbound addressing

## Problem statement

Outbound messaging still allows too much ambiguity at the target-resolution boundary. Human-friendly names like `Mira` or `Alex` can be ambiguous, stale, or directory-dependent, yet the system can proceed far enough to imply success. This is the earliest and cheapest place to prevent false-success behavior.

## Scope

- normalize all outbound targets into canonical DecentChat identifiers before send/queue attempts
- require explicit distinction between peer targets and channel/group targets
- make alias/name resolution deterministic and non-silent
- return structured errors for no-match and multi-match cases
- ensure downstream send logic only sees canonical IDs
- ensure OpenClaw/bridge-level send result semantics reflect resolution outcome honestly

### Likely touched files
- `decent-openclaw/src/channel.ts`
- `decent-openclaw/src/peer-registry.ts`
- `decent-openclaw/tests/unit/messaging-target-normalization.test.ts`
- possibly bridge-facing send/result code in `decent-openclaw` where resolution success is currently treated as send success

## Non-goals

- redesigning directory UX/search UX
- adding fuzzy “best effort” smart matching beyond deterministic ranking
- redesigning contact storage
- changing transport delivery behavior

## Required invariants

1. Every outbound target must become one of:
   - `decentchat:<canonical-peer-id>`
   - `decentchat:channel:<canonical-channel-id>`

2. Alias/name inputs are lookup hints only, not durable routing identifiers.

3. If resolution yields zero or multiple candidates at top rank, the send must fail before queueing.

4. Downstream layers must never receive unresolved human-readable names as the operative target.

5. Target kind must remain explicit through the bridge boundary:
   - user/peer target
   - channel/group target

## Acceptance criteria

- sending by canonical peer id succeeds without alias lookup
- sending by canonical channel id succeeds without alias lookup
- single unambiguous alias resolves to exactly one canonical target
- ambiguous alias returns deterministic failure with useful context
- unknown alias returns deterministic failure with useful context
- bridge/tooling no longer implies “message sent” when only target normalization happened

## Regression coverage required

### Unit
- canonical peer-id passthrough
- canonical channel-id passthrough
- alias -> peer-id resolution
- alias -> channel resolution
- ambiguous alias -> explicit failure
- no-match alias -> explicit failure
- user-vs-group kind mismatch rejection

### Integration
- direct send by peer id when name lookup is unavailable
- alias resolution against live directory snapshot
- reply path preserves canonical target once established

### Candidate test files
- `decent-openclaw/tests/unit/messaging-target-normalization.test.ts`
- new integration coverage in `decent-openclaw/tests/integration/*` or bridge smoke tests if that suite already exists elsewhere

## Observability / logging expectations

Emit structured resolution events with at least:
- raw input
- normalized input
- preferred kind
- candidate count
- selected target id, if any
- failure reason (`no_match`, `ambiguous`, `kind_mismatch`, `invalid_target`)

These should be available in logs without requiring deep debug mode.

## Dependency / ordering notes

- This track should land first.
- It is mostly bridge-layer hardening and does not need protocol redesign.
- It reduces the blast radius of Track 2 and Track 3 debugging.

## Key risks / likely failure modes

- stale directory snapshots causing false negatives
- overly aggressive rejection of workflows that previously depended on permissive matching
- hidden callers relying on unresolved names downstream

## Verification commands

```bash
cd /Users/claw/Projects/decent-chat/decent-openclaw
bun test tests/unit/messaging-target-normalization.test.ts
```

---

# Track 2 — Direct-message envelope semantics and inbound routing invariants

## Problem statement

The current system still has brittle DM/channel semantics. Direct messages can depend on fallback behavior, and inbound messages without the expected combination of `isDirect`, `workspaceId`, or `channelId` can be misrouted or dropped. That creates hidden failure paths and undermines trust in anything built above routing.

## Scope

- define the authoritative routing contract for direct vs workspace/channel envelopes
- make DM routing explicit and mutually exclusive with workspace/channel routing
- remove silent inbound drop paths
- preserve compatibility only where intentionally allowed and fully logged
- ensure direct-message receive/reply paths remain stable across OpenClaw bridge and client runtime
- codify exactly when DM fallback is allowed and when it is forbidden

### Likely touched files
- `decent-client-web/src/app/ChatController.ts`
- `decent-openclaw/src/peer/NodeXenaPeer.ts`
- `decent-protocol/src/contacts/DirectConversation.ts`
- `decent-protocol/tests/unit/dm-isDirect-fallback.test.ts`
- `decent-client-web/tests/unit/chat-controller-receipts-security.test.ts`
- additional direct-routing integration tests in `decent-client-web/tests/integration/`

## Non-goals

- redesigning the DM product model or contacts UX
- changing workspace membership/privacy rules beyond routing correctness
- implementing a brand-new conversation identity scheme unless required by the contract

## Required invariants

1. Direct envelopes and workspace/channel envelopes must be explicitly distinguishable.

2. If `isDirect === true`, the message must route only through direct-conversation logic.

3. If `workspaceId` is present and invalid, reject/drop immediately.
   - No DM fallback.

4. If direct-message compatibility fallback exists for legacy traffic, it must be limited to a known direct-contact/conversation case and must emit a compatibility log/metric.

5. No inbound routing decision may fail silently.
   - Every drop/reject/fallback path must leave evidence.

6. A receive-side route decision must be reproducible from logs.

## Acceptance criteria

- explicit direct messages route into the intended direct conversation every time
- explicit workspace messages never degrade into DM fallback when workspace routing is invalid
- known legacy DM traffic without `isDirect` is either:
  - accepted through a clearly defined compatibility rule, or
  - rejected explicitly and observably
- hidden drop path for direct encrypted messages without `channelId` is eliminated
- agent-to-agent DM receive + reply path works end-to-end under the chosen contract

## Regression coverage required

### Unit
- `isDirect=true` routes as DM
- missing `isDirect` + known direct conversation follows explicit compat rule
- missing `isDirect` + unknown sender drops explicitly
- invalid explicit `workspaceId` rejects immediately
- workspace-only message without valid channel/workspace rejects
- direct envelope missing channel identifier still routes correctly if the contract allows deterministic derivation

### Integration
- peer A -> peer B direct DM -> reply back
- direct send by canonical peer id without alias assistance
- mixed direct/workspace traffic does not cross-route
- legacy/compat envelope behavior is tested, not implied

### Candidate test files
- `decent-protocol/tests/unit/dm-isDirect-fallback.test.ts`
- `decent-client-web/tests/integration/messaging.spec.ts`
- `decent-client-web/tests/integration/messaging-simple.spec.ts`
- new targeted DM route spec under `decent-client-web/tests/integration/`

## Observability / logging expectations

Emit route-decision events with fields like:
- sender peer id
- envelope kind candidate (`direct`, `workspace`, `unknown`)
- route decision (`dm`, `workspace`, `drop`, `compat_fallback`)
- workspace id / channel id if relevant
- drop reason (`unknown_workspace`, `unknown_sender`, `missing_route_fields`, `kind_mismatch`)

Important: logging must distinguish normal routing from compatibility routing.

## Dependency / ordering notes

- Land after Track 1.
- If this changes wire semantics or required routing fields, write a DEP first.
- Track 3’s final user-visible status semantics should not be considered complete until this track is stable.

## Key risks / likely failure modes

- legacy clients depending on permissive fallback behavior
- direct-conversation IDs derived inconsistently across layers
- route hardening accidentally breaking backward compatibility without visibility
- logging too little to diagnose cross-layer mismatches

## Verification commands

```bash
cd /Users/claw/Projects/decent-chat/decent-protocol
bun test tests/unit/dm-isDirect-fallback.test.ts

cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/chat-controller-receipts-security.test.ts tests/unit/workspace-dm-permissions.test.ts
```

---

# Track 3 — Delivery-state truthfulness, queue/ACK observability, and end-to-end seam coverage

## Problem statement

Today the system can imply success when a message was merely accepted locally, normalized, or queued. Pending-ack and retry queues hide real failures, and the seams between OpenClaw, DecentChat routing, transport dispatch, and session wake-up are not observable enough. This is the trust problem users actually feel.

## Scope

- define a truthful end-to-end delivery state model
- separate local acceptance/queueing from actual dispatch and confirmed delivery
- make retry, expiry, and failure states inspectable
- ensure ACK/read receipts only upgrade valid outstanding messages
- expose enough telemetry/logging to diagnose failures across the OpenClaw <-> DecentChat seam
- add first-class end-to-end regression coverage for agent-to-agent DM scenarios

### Likely touched files
- `decent-protocol/src/messages/CustodyTypes.ts`
- `decent-protocol/src/messages/OfflineQueue.ts`
- `decent-protocol/src/messages/CustodyStore.ts`
- `decent-client-web/src/app/ChatController.ts`
- `decent-client-web/src/ui/types.ts`
- `decent-client-web/src/ui/uiService.types.ts`
- `decent-client-web/tests/unit/message-receipts.test.ts`
- `decent-protocol/tests/unit/delivery-ack.test.ts`
- `decent-client-web/tests/e2e/delivery-tooltip.spec.ts`
- `decent-client-web/tests/e2e/offline-peer.spec.ts`
- `decent-client-web/tests/e2e/sync-reliability.spec.ts`
- any bridge-facing send-result surface in `decent-openclaw` that currently collapses accepted/queued/dispatched into “success”

## Non-goals

- promising guaranteed delivery in all offline/network-partition scenarios
- transport rewrite
- adding a complex metrics backend as a prerequisite

## Required invariants

1. Local acceptance is not the same as sent.
   - The system must represent local acceptance/queueing distinctly.

2. Delivered means recipient ACK validated.
   - Not “we tried”
   - Not “we enqueued”
   - Not “transport accepted bytes locally” unless the contract explicitly defines a separate state

3. Read means validated read receipt.

4. Unknown or invalid receipts must never upgrade delivery state.

5. Queue state must be inspectable per message:
   - queued
   - retrying/backing off
   - dispatched/sent
   - delivered/acknowledged
   - read
   - expired
   - failed

6. Stale pending-ack state must age out deterministically.

7. Tooling/bridge responses must not overclaim certainty.

## Acceptance criteria

- user-visible and tool-visible status language no longer equates local acceptance with actual send/delivery
- queued/retrying/expired/failed states are inspectable somewhere deterministic
- delivery tooltip/status view reflects authoritative state transitions
- stale unacked envelopes are eventually marked expired/failed according to policy
- ACK/read receipt validation rejects bad receipts without corrupting state
- agent-to-agent DM e2e tests pass for alias send, peer-id send, reply back, retry, and stale cleanup

## Regression coverage required

### Unit
- accepted/queued/dispatched/delivered/read status transitions
- invalid ACK/read does not upgrade state
- duplicate ACK/read is idempotent
- stale envelope expiry transitions correctly
- retry/backoff state is exposed and stable

### Integration
- offline recipient -> queue -> reconnect -> deliver -> ack
- mixed direct and workspace recipients preserve correct receipt attribution
- bridge/API send result reflects accepted/queued vs delivered truthfully

### E2E
- delivery tooltip/status updates live while state changes
- agent A -> agent B -> reply back
- alias resolution send
- canonical peer-id send
- stale pending-ack cleanup scenario

### Candidate test files
- `decent-protocol/tests/unit/delivery-ack.test.ts`
- `decent-client-web/tests/unit/message-receipts.test.ts`
- `decent-client-web/tests/unit/offline-replay-reconciliation.test.ts`
- `decent-client-web/tests/e2e/delivery-tooltip.spec.ts`
- `decent-client-web/tests/e2e/offline-peer.spec.ts`
- `decent-client-web/tests/e2e/sync-reliability.spec.ts`
- new bridge/e2e coverage for OpenClaw-driven DM send/receive paths

## Observability / logging expectations

At minimum, each outbound message should be traceable by:
- message id
- envelope id/op id
- canonical target id(s)
- route kind (`direct` / `workspace`)
- state transition timestamps
- retry count / backoff state
- terminal state (`delivered`, `read`, `expired`, `failed`)
- last failure reason

Recommended counters/events:
- `message.accepted_local`
- `message.queued`
- `message.dispatched`
- `message.ack_valid`
- `message.ack_invalid`
- `message.read_valid`
- `message.expired`
- `message.failed`
- `message.route_compat_fallback`
- `message.send_claim_overstated` (temporary audit metric while migrating semantics)

## Dependency / ordering notes

- Can begin observability scaffolding in parallel with Track 2.
- Final delivery-state wording and API semantics should ship after Track 2 routing rules are stable.
- If delivery states change on the wire or in protocol types, write a DEP first.

## Key risks / likely failure modes

- breaking UI expectations that currently assume `sent` as soon as local dispatch happens
- accidentally double-counting delivery/read state for multi-recipient or multi-device scenarios
- instrumentation drift between bridge logs and client/protocol reality
- adding logs without correlation ids, making them noisy instead of useful

## Verification commands

```bash
cd /Users/claw/Projects/decent-chat/decent-protocol
bun test tests/unit/delivery-ack.test.ts

cd /Users/claw/Projects/decent-chat/decent-client-web
bun test tests/unit/message-receipts.test.ts tests/unit/offline-replay-reconciliation.test.ts
bun run test:e2e -- tests/e2e/delivery-tooltip.spec.ts tests/e2e/offline-peer.spec.ts
```

---

# Cross-track QA handoff

## Minimum end-to-end scenarios QA should own

1. **Alias -> canonical peer-id -> DM send**
2. **Canonical peer-id direct send with no directory help**
3. **Peer A -> Peer B -> reply back**
4. **Ambiguous alias rejection**
5. **Invalid explicit workspace routing rejection**
6. **Queued send while peer offline -> reconnect -> ACK**
7. **Queued send -> never ACKs -> expiry/failure surfaced**
8. **Invalid or spoofed receipt ignored**
9. **DM/workspace mixed traffic does not cross-route**
10. **Bridge/tool/API response text does not overstate delivery certainty**

## Suggested milestone gates

### Gate 1 — Safe addressing
- Track 1 complete
- ambiguous sends fail closed
- canonical peer-id sends proven

### Gate 2 — Safe routing
- Track 2 complete
- no silent DM drops
- DM/workspace route decisions fully logged

### Gate 3 — Trustworthy delivery
- Track 3 complete
- queue/ack states observable
- false-success language removed
- end-to-end reliability suite green

---

# Recommended next implementation steps

1. **Write DEP if needed** for any route-contract or delivery-state wire changes.
2. **Land Track 1** with fail-closed resolution and explicit errors.
3. **Land Track 2** with explicit routing invariants and drop/fallback logs.
4. **Land Track 3** with truthful state semantics and end-to-end seam tests.
5. **Do not call the initiative done** until QA validates the full matrix above.

---

# Short verdict

The architecture is still good.
The main issue is not “messaging is broken everywhere.”
The issue is that the system currently has too many places where it can look successful without being end-to-end trustworthy.

This brief is meant to fix exactly that.
