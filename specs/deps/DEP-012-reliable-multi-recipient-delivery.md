# DEP-012: Reliable Multi-Recipient Delivery & Reconnect Replay

```
Number:  DEP-012
Title:   Reliable Multi-Recipient Delivery & Reconnect Replay
Author:  Alex + Xena
Status:  Draft
Type:    Core
Created: 2026-02-23
Replaces: DEP-005 (partial semantics extension)
```

## Abstract

This DEP extends delivery semantics from single-recipient ACKs to deterministic multi-recipient delivery in channels with many members. It introduces per-recipient ACK tracking, recipient snapshotting at send-time, and reconnect replay requirements so messages survive refresh/reconnect races.

## Motivation

Current ACK behavior is sufficient for 1:1 delivery state but under-specifies group semantics:

- A single ACK can incorrectly mark a group message as fully delivered.
- Refresh/reconnect races can make delivery appear inconsistent between UI and runtime.
- Offline recipients need queued replay, without blocking status progression for already-connected peers.

For robust group chat, delivery must be computed per recipient and aggregated in UI.

## Specification

### 1) Recipient Snapshot

At message send-time, sender MUST snapshot recipients for that message:

- `recipientPeerIds: string[]`
- `ackedBy: string[]` (initially empty)

This snapshot defines expected delivery quorum for that message and is immutable after send.

### 2) ACK Semantics in Groups

For each incoming ACK:

1. Add `peerId` to `ackedBy` (idempotent set behavior).
2. Compute `deliveredToAll = recipientPeerIds.every(id => ackedBy.includes(id))`.
3. Message status:
   - `sent` until all recipients ACK.
   - `delivered` only when all snapshotted recipients ACK.

### 3) Recipient Selection for Dispatch

Send pipeline MUST target all workspace members except self.

- Connected recipients: send immediately.
- Disconnected recipients: enqueue for offline replay.

This replaces ready-only recipient selection, which can skip offline members entirely.

### 4) Reconnect Replay

When a peer reconnects and handshake completes:

- Sender MUST flush that peer's queued envelopes.
- Receiver MUST ACK each successfully persisted message.

### 5) UI Aggregation

UI continues using aggregate status:

- `⏳` pending
- `✓` sent (partial ACK or no ACK yet)
- `✓✓` delivered (all snapshotted recipients ACKed)

Future enhancement: optional detailed tooltip `acked/total`.

## Rationale

- **Snapshot at send-time** avoids ambiguity when membership changes later.
- **Per-recipient ACKs** map naturally to P2P partial connectivity.
- **Aggregate UI** keeps interface simple while preserving strict semantics.

## Backward Compatibility

- Older peers that send classic ACKs still work.
- Messages may remain `sent` longer in mixed-version groups where not all peers ACK reliably.
- No wire-format breaking change is required; metadata is sender-local.

## Security Considerations

- ACK spoofing remains bounded by authenticated peer channels.
- Duplicate ACKs are harmless (set semantics).
- Group delivery metadata (`recipientPeerIds`, `ackedBy`) is local sender state.

## Test Vectors

### Scenario A: 3-member channel, one offline

```
Members: Alice(sender), Bob(online), Carol(offline)
T0: Alice sends M1, snapshot recipients [Bob, Carol]
T0+100ms: Bob ACKs => status remains sent (✓)
T0+5m: Carol reconnects, queued M1 replayed
T0+5m+100ms: Carol ACKs => status delivered (✓✓)
```

### Scenario B: Duplicate ACK

```
Bob sends ACK(M1) twice
Sender records Bob once in ackedBy
Status unaffected by duplicate
```

### Scenario C: Membership change after send

```
T0: recipients snapshot [Bob, Carol]
T1: Dave joins channel
M1 delivery quorum remains Bob+Carol only
```

## Reference Implementation

**Initial implementation (Draft):**
- `decent-client-web/src/app/ChatController.ts`
  - ACK handling upgraded to per-recipient aggregation
  - send-time recipient snapshot (`recipientPeerIds`, `ackedBy`)
  - workspace recipient resolution includes offline members

## References

- DEP-005: Message Delivery Acknowledgment
- DEP-004: Heartbeat / reconnect-related transport reliability

## Copyright

This document is placed in the public domain (CC0-1.0).
