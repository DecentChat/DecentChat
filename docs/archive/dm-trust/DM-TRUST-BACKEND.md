# DM Trust Backend Plan

## Goal
Make DM delivery state honest, deterministic, and observable end-to-end so the system cannot imply success when it only has local acceptance.

## Non-negotiable rules
- **“sent” must not mean only locally accepted.**
- **Inbound DM invariants are part of the core sequence**, not a best-effort edge path.
- **Canonical peer-id targeting is preferred over ambiguous names.**
- **Visibility must exist for:** `queued`, `retrying`, `delivered`, `acked`, `expired`, `failed`.
- **Stale pending-ack cleanup** is required, not optional hygiene.

## Delivery-state contract
Use explicit transport/application states instead of overloading `sent`.

1. `accepted`
   - Local API/plugin accepted the outbound request.
   - This is **not** a delivery guarantee.
2. `queued`
   - Message is staged for transport or waiting on peer/session availability.
3. `retrying`
   - At least one delivery attempt happened and the system is retrying.
4. `delivered`
   - Remote peer/device/session accepted the payload far enough that local-only success is no longer being claimed.
5. `acked`
   - Explicit receipt/ack correlated to the original message.
6. `expired`
   - Retry window elapsed or the pending-ack item aged out without success.
7. `failed`
   - Terminal failure: invalid target, invariant violation, unrecoverable routing problem, or exhausted retry policy.

**Rule:** user-facing surfaces may show `accepted`/`queued`, but must not label either one as `sent`.

## Backend work sequence

### P0. Delivery semantics and honest status mapping
Establish the source-of-truth state model first.

Required outcomes:
- Replace any false-success mapping where local acceptance renders as `sent`.
- Separate local acceptance from remote evidence.
- Ensure logs/telemetry preserve the raw state, not a lossy success boolean.

### P1. Inbound DM core invariants
Fix the direct-message receive path before additional UX work.

Required invariants:
- Direct encrypted DMs without `channelId` must enter the DM path, not a drop path.
- DM conversation identity must be derivable from canonical peer identity / participant pair.
- Invariant failures must become visible errors/metrics, never silent drops.
- Ack generation/correlation must still work on the no-`channelId` DM path.

### P2. Canonical target resolution
Make targeting deterministic before improving surface messaging.

Required outcomes:
- Canonical peer-id is the preferred outbound target.
- Name/alias targeting must resolve to exactly one canonical peer-id or fail explicitly.
- Ambiguous names must not silently succeed.
- Resolved peer-id must be preserved through the send pipeline for ack correlation and debugging.

### P3. Pending-ack lifecycle visibility
Make the queue inspectable and stateful.

Required outcomes:
- Pending-ack entries expose whether they are `queued`, `retrying`, `delivered`, `acked`, `expired`, or `failed`.
- Retry metadata is queryable: first-attempt time, last-attempt time, attempt count, next retry, expiry deadline.
- Operator/debug views can explain why an item is still pending.

### P4. Stale pending-ack cleanup
Turn indefinite limbo into explicit terminal state.

Required outcomes:
- A sweeper/cleanup path marks stale pending items as `expired` or `failed` according to policy.
- Cleanup removes misleading forever-pending entries.
- Cleanup emits metrics/logging so backlog growth is observable.

## Suggested implementation order
1. P0 — delivery semantics
2. P1 — inbound DM core invariants
3. P2 — canonical target resolution
4. P3 — pending-ack visibility
5. P4 — stale pending-ack cleanup

## Backend exit criteria
- No user-visible `sent` state is produced from local acceptance alone.
- Inbound DM without `channelId` survives the core sequence and can be acked.
- Ambiguous human-name targeting fails honestly instead of fake-succeeding.
- Pending-ack state is inspectable and expires/terminates cleanly.
- QA has a stable backend surface to test against.
