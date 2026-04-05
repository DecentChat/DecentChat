# DEP-012 Implementation Checklist

## Phase 1 — Multi-recipient semantics
- [x] Snapshot recipients at send-time (`recipientPeerIds`)
- [x] Track ACKs per sender (`ackedBy`)
- [x] Mark `delivered` only when all snapshotted recipients ACK
- [x] Keep idempotent ACK handling (duplicate ACK safe)

## Phase 2 — Offline member dispatch
- [x] Include offline workspace members in recipient set
- [x] Queue envelopes for disconnected recipients
- [x] Keep direct-send path for ready peers

## Phase 3 — Robust replay (next)
- [x] Make outbox flush non-destructive until transport send succeeds
- [x] Add per-item dequeue after successful send
- [x] Add retry/backoff metadata (`attempts`, `lastAttempt`)
- [x] Add dead-letter handling for max retries

## Phase 4 — Group UX (next)
- [ ] Optional tooltip/detail: `acked/total`
- [ ] Optional per-recipient delivery inspector in debug panel

## Phase 5 — Tests
- [x] Unit: recipient snapshot immutability
- [x] Unit: duplicate ACK idempotency
- [x] Unit: group message needs all ACKs for delivered
- [x] Integration: one recipient offline, replay on reconnect
- [x] Integration: partial delivery progress tracking
