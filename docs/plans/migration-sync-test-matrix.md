# Migration + Diverged-Client Sync Test Matrix

Goal: protect established workspaces during schema evolution and mixed-version rollouts.

## 1) Local migration safety (client persistence)

- [ ] Fresh install at latest schema
- [ ] Upgrade path v1 -> latest with existing data
- [ ] Idempotency (re-run at latest = no-op)
- [ ] Resume after interruption / transient migration failure
- [ ] Unknown/custom fields preserved through migration

## 2) Established workspace scale

- [ ] Large workspace fixtures (many channels/members/messages)
- [ ] No record loss (count invariants)
- [ ] Existing fields preserved (no accidental overwrite)
- [ ] New required fields backfilled (`vectorClock`, `attachments`, `workspace.settings`)

## 3) Diverged-client sync compatibility

- [ ] Legacy payload missing newer optional fields is still accepted
- [ ] Newer payload with unknown additive fields does not crash older path
- [ ] Mixed-version sync converges on same workspace/channel/message set
- [ ] Feature-gated fields degrade gracefully (capability checks)

## 4) Rollout guardrails

- [ ] Handshake exposes protocol/capability versions
- [ ] Breaking fields blocked by min-version gate
- [ ] Additive-first rollout (write-new/read-old compatibility window)

## 5) CI strategy

- Unit: migration chain + invariants
- Integration: mixed-version peers + sync replay
- E2E: realistic seeded workspace migration + rejoin/sync
- Perf smoke: migration on large fixture under bounded time

---

## Initial implemented coverage (this changeset)

- `decent-protocol/tests/unit/migration-established-workspace.test.ts`
  - large established workspace migration without data loss
  - unknown field preservation
  - transient failure + resume behavior
- `decent-protocol/tests/unit/mixed-version-sync-compat.test.ts`
  - legacy `join-accepted` payload acceptance
  - additive unknown fields in channel-message payload tolerated

## Next step (recommended)

Add a browser-level integration test in `decent-client-web/tests/integration/` that:
1. seeds IndexedDB with legacy shape,
2. starts app (runs migration path),
3. joins/syncs with another peer,
4. verifies convergence and no cross-workspace leakage.
