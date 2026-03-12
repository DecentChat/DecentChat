# Architecture Overview

DecentChat is a serverless, encrypted, peer-to-peer messaging system with a modular architecture.

## High-Level Components

```text
decent-protocol/
  Core protocol logic (identity, crypto, sync, CRDTs, storage interfaces)

+ decent-transport-webrtc/
  Transport implementation for WebRTC/PeerJS

+ decent-client-web/
  Reference web app (PWA, routing, UI, app bootstrap)

+ decent-openclaw/
  OpenClaw-facing integration helpers
```

## Design Principles

- **Transport agnostic protocol:** protocol code should not be coupled to WebRTC.
- **Deterministic identity:** seed phrase => stable keys => stable identity.
- **Conflict-free sync:** CRDT + vector clocks + Negentropy for reconciliation.
- **Tamper evidence:** hash-chain style message integrity.
- **Resilience-first UX:** degraded networks, reconnects, retries, offline support.
- **Single adaptive workspace architecture:** one protocol path with capability-gated scaling features (no separate server mode).

## Runtime Lifecycle (Web Client)

1. Load app shell
2. Initialize local storage
3. Resolve identity from seed phrase
4. Initialize transport (only in app route)
5. Join/restore workspace
6. Sync peer state and render chat UI

## Important Routing Constraint

Landing (`/`) and App (`/app`) must remain isolated:

- `/` should not initialize transport or peer identity ownership.
- `/app` performs full bootstrap (identity + transport + workspace state).

This prevents duplicate peer ID contention in multi-tab scenarios.

## Adaptive public workspace guardrails

Large-workspace mechanics (shell/delta sync, member-directory paging, helper capabilities) are opt-in per workspace:

- workspace gate: `large-workspace-v1` capability flag in workspace shell (with temporary legacy-alias compatibility during migration)
- peer gate: only use scalable flows with peers advertising matching capabilities
- mixed-client fallback: if gates are absent, remain on legacy workspace-state snapshot sync

This keeps old/new clients interoperable during phased rollouts.

Rollout and migration order: `docs/plans/2026-03-11-public-workspace-migration.md`

## Protocol References

- `decent-protocol/spec/PROTOCOL.md`
- `decent-protocol/spec/CRYPTO.md`
- `decent-protocol/spec/MESSAGE-FORMAT.md`
- `decent-protocol/spec/SYNC.md`

## Governance

Protocol evolution is managed via DEPs in `specs/deps/`.
