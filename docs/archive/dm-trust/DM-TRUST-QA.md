# DM Trust QA Plan

## Goal
Make DM trust a release-gated behavior, not an inferred property.

## Dependency rule
This plan stays **blocked** until backend phases `P0` through `P4` in `planning/DM-TRUST-BACKEND.md` are implemented and exposed in a testable way.

## Non-negotiable assertions
- **“sent” must not mean only locally accepted.**
- **Inbound DM invariants are part of the core sequence.**
- **Canonical peer-id targeting is preferred over ambiguous names.**
- **Visibility exists for:** `queued`, `retrying`, `delivered`, `acked`, `expired`, `failed`.
- **Stale pending-ack cleanup** is verified in tests.
- **QA DM trust E2E is the release gate.**

## QA scope

### Q0. State-honesty checks
Validate that local acceptance is not misreported as successful delivery.

Must cover:
- accepted-only flow is shown as `accepted`/`queued`, never `sent`
- retry transition shows `retrying`
- terminal no-delivery path shows `expired` or `failed`

### Q1. Inbound DM invariant coverage
Validate the receive path that previously hid drops.

Must cover:
- inbound encrypted DM without `channelId`
- DM persistence/conversation routing on canonical participant identity
- ack/read correlation on that same path
- invariant failure visibility instead of silent discard

### Q2. Canonical targeting coverage
Validate preferred peer-id routing and honest alias handling.

Must cover:
- direct send by canonical peer-id succeeds
- alias -> canonical peer-id resolution succeeds when unique
- ambiguous name resolution fails explicitly
- invalid raw target does not fake-success

### Q3. Pending-ack lifecycle coverage
Validate state transitions and observability.

Must cover:
- `queued -> delivered -> acked`
- `queued/retrying -> expired`
- `queued/retrying -> failed`
- stale pending-ack cleanup removes limbo state after policy deadline

### Q4. End-to-end DM trust gate
This is the release blocker.

Required E2E matrix:
1. unique alias -> canonical peer-id -> delivered -> acked
2. direct canonical peer-id send -> delivered -> acked
3. inbound no-`channelId` DM -> stored/routed correctly -> acked
4. transient failure -> `retrying` -> eventual `delivered/acked`
5. unrecoverable/ambiguous target -> honest `failed` result
6. stale pending-ack item -> cleanup -> `expired` or `failed`

## QA release gate
Release is blocked unless the DM trust E2E matrix passes and the observed user-facing states match backend truth.

## QA exit criteria
- No false-success DM state remains in UI, logs, or test helpers.
- The no-`channelId` inbound DM path is covered by automated E2E.
- Canonical peer-id targeting is demonstrably safer than ambiguous names.
- Pending-ack cleanup is automated and verified.
- DM trust E2E is marked green before release.
