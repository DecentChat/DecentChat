# Public Workspace Migration + Rollout Guardrails

Date: 2026-03-11
Status: Phase 1 complete (Tasks 1-15)

## Goal

Ship adaptive public-workspace behavior without breaking mixed-client rooms during rollout.

## Guardrails

### 1) Workspace capability gate (authoritative)

Large-workspace behavior is enabled when the workspace shell advertises either the canonical gate or legacy compatibility aliases:

- `large-workspace-v1` in `workspace.shell.capabilityFlags`

Compatibility aliases are still recognized for already-migrated shells that predate this gate:

- `shell-delta-v1`
- `member-directory-v1`
- `presence-slices-v1`
- `history-pages-v1`

If none of the above are present, clients stay on legacy snapshot semantics.

Note: alias support is transitional compatibility for already-migrated shells that predate `large-workspace-v1`.

### 2) Peer capability negotiation (transport-level)

Even when a workspace is large-workspace capable, clients only use scalable control paths with peers that explicitly advertise support (e.g. `workspace-shell-v1`, `member-directory-v1`).

Legacy peers remain fully functional via workspace-state snapshot sync.

### 3) Safe downgrade behavior

If a workspace is large-workspace capable but currently connected peers do not advertise large-workspace control capabilities:

- no shell request is sent to legacy peers
- no member-page requests are issued
- roster pagination “load more” is suppressed
- clients continue using loaded/snapshot roster data

This keeps mixed rooms usable while avoiding partial or stuck scalable flows.

## Mixed-client compatibility matrix

| Sender / Receiver | Workspace flag | Peer capability | Behavior |
| --- | --- | --- | --- |
| New ↔ New | enabled | present | shell + paged directory path allowed |
| New ↔ Old | enabled | missing | legacy workspace-state fallback |
| New ↔ New | disabled | present | legacy snapshot path (feature gate blocks large mode) |
| Old ↔ Old | n/a | n/a | unchanged legacy behavior |

## Rollout order (required)

1. DEP updates (DEP-014, DEP-015)
2. Scalable types + policy model
3. Persistence normalization
4. Shell/delta protocol
5. Directory page/shard sync
6. Client/UI slice loading
7. Reliability drills + helper-peer failure handling
8. Mixed-client verification + migration guardrails

## Operator checklist

Before enabling `large-workspace-v1` in production workspaces:

1. Upgrade owner/admin heavy-use clients first
2. Upgrade at least two always-on helper peers (directory/relay/archive where applicable)
3. Verify mixed-client tests pass in CI
4. Enable capability bit per workspace
5. Monitor degraded fallback indicators (no directory-capable peers, relay fallback active)

Rollback is safe: clear `large-workspace-v1` and any legacy alias flags (`shell-delta-v1`, `member-directory-v1`, `presence-slices-v1`, `history-pages-v1`) so clients remain on snapshot-compatible behavior.
