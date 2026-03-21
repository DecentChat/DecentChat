# DM Trust Handoff

## Purpose
Align backend implementation and QA verification around one rule: DM delivery claims must be honest end-to-end.

## Cross-doc invariants
These must stay explicit in **all three** DM trust docs:
- **“sent” must not mean only locally accepted**
- **Inbound DM invariants are part of the core sequence**
- **Canonical peer-id targeting is preferred over ambiguous names**
- **Visibility exists for:** `queued`, `retrying`, `delivered`, `acked`, `expired`, `failed`
- **Stale pending-ack cleanup** is required
- **QA DM trust E2E is the release gate**

## Document split
- `planning/DM-TRUST-BACKEND.md`
  - source of truth for implementation order and backend exit criteria
- `planning/DM-TRUST-QA.md`
  - source of truth for validation scope and release gating
- `planning/DM-TRUST-HANDOFF.md`
  - source of truth for ownership split, dependency order, and final sequencing

## Dependency order
The dependency order is intentional and should not be inverted:

1. **Backend P0 — honest delivery semantics**
   - remove false-success mapping
   - stop treating local acceptance as `sent`
2. **Backend P1 — inbound DM core invariants**
   - fix the no-`channelId` DM path
   - make invariant failures visible
3. **Backend P2 — canonical target resolution**
   - prefer peer-id targeting
   - reject ambiguous names honestly
4. **Backend P3 — pending-ack lifecycle visibility**
   - expose `queued/retrying/delivered/acked/expired/failed`
5. **Backend P4 — stale pending-ack cleanup**
   - end indefinite limbo
6. **QA Q0-Q4 — DM trust verification and release gate**
   - run only after backend surfaces are real and testable

## Ownership split

### Backend owns
- delivery-state semantics
- inbound DM sequence invariants
- canonical peer-id resolution behavior
- pending-ack instrumentation
- stale pending-ack cleanup policy and mechanics

### QA owns
- proving the surface does not fake-success
- verifying the inbound no-`channelId` DM path end-to-end
- validating canonical peer-id success vs ambiguous-name failure
- enforcing pending-ack lifecycle expectations
- blocking release until DM trust E2E is green

## Final priority sequence
1. **P0:** honest delivery semantics (`accepted` is not `sent`)
2. **P1:** inbound DM invariants in the core sequence
3. **P2:** canonical peer-id targeting over ambiguous names
4. **P3:** visibility for `queued / retrying / delivered / acked / expired / failed`
5. **P4:** stale pending-ack cleanup
6. **Q0-Q4:** QA DM trust E2E release gate

## Done means
This handoff is complete only when backend and QA are using the same vocabulary, the same dependency order, and the same release gate.
