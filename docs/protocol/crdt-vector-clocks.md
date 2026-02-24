# CRDT / Vector Clocks

## 1) What it is

Causality tracking and conflict-tolerant merge structures for messages using vector clocks and a grow-only message CRDT.

## 2) How it works

- `VectorClock` supports increment, merge, and causal comparison.
- `MessageCRDT` stores immutable messages, merges remote messages, and provides causal sorting with deterministic tie-breakers.
- The web app attaches vector clocks to messages and mirrors them into per-channel CRDT instances.

## 3) Current implementation status

**Partially implemented**

## 4) Limitations / gaps

- CRDT state is maintained locally, but runtime sync is not driven primarily by CRDT merge protocols.
- Reconnect/message sync now prefers Negentropy-based ID reconciliation with timestamp-based transfer as fallback for non-negotiated peers.
- The CRDT implementation is present and used, but not yet the sole source of truth for full network reconciliation.

## 5) Where in code it lives

- `decent-protocol/src/crdt/VectorClock.ts`
- `decent-protocol/src/crdt/MessageCRDT.ts`
- `decent-client-web/src/app/ChatController.ts`
- `decent-protocol/tests/unit/crdt.test.ts`
