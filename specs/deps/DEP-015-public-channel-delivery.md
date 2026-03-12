# DEP-015: Public-Channel Delivery Contracts for Bounded Fanout

```
Number:  DEP-015
Title:   Public-Channel Delivery Contracts for Bounded Fanout
Author:  Alex + Xena
Status:  Draft
Type:    Core
Created: 2026-03-12
Requires: DEP-008 (gossip), DEP-014 (adaptive public workspaces)
```

## Abstract

This DEP defines delivery contracts for public-workspace channels so a sender does **not** directly fan out to all known members.

The first rollout uses the existing partial-mesh topology + gossip relay path:

- sender performs bounded direct fanout to a relay subset
- receivers relay via existing gossip rules
- correctness remains decentralized (no singleton relay authority)

It also defines the forward-compatible upgrade path to sender-key / group-key delivery without requiring it in this rollout.

## Motivation

DEP-014 established that large public workspaces cannot rely on sender→all-member direct delivery. The implementation still needed an explicit contract for message fanout semantics.

Without a contract, senders can regress into:

- O(N) direct fanout attempts
- massive offline queue pressure
- transport and encryption spikes at large member counts

Bounded sender fanout is required before cryptographic group-delivery upgrades.

## Specification

### 1) Delivery contract modes

Channels use one of the following delivery contracts:

1. `direct-members-v1`
   - For DMs, explicit/small/private channels, and compatibility paths.
   - Sender may target explicit channel/workspace recipients directly.

2. `bounded-gossip-v1`
   - For channels with `accessPolicy.mode = public-workspace`.
   - Sender MUST use bounded relay fanout (not sender→all-members).

### 2) Sender behavior for `bounded-gossip-v1`

For each outbound public-channel message, sender MUST:

- derive candidate recipients from known workspace peers
- prioritize currently healthy partial-mesh peers (desired/connected/ready)
- cap direct recipients to a bounded local limit (device/transport dependent)
- avoid fanout attempts to every known member

Sender MUST NOT:

- iterate all known workspace members for direct delivery in public-workspace channels
- enqueue per-member direct sends to every known member in public-workspace channels

### 3) First implementation path

The first implementation of `bounded-gossip-v1` uses existing mechanisms:

- bounded sender fanout from partial-mesh recipient selection
- DEP-008 gossip relay for additional propagation
- existing TTL/dedup safeguards

This means sender fanout is bounded immediately, while network-wide reach comes from mesh relay propagation.

### 4) Delivery acknowledgement semantics

For `bounded-gossip-v1`, per-message recipient ACK/READ tracking is scoped to the sender’s bounded direct recipient set, not to the full channel audience.

Channel-wide delivery certainty remains eventual and topology-dependent in this phase.

### 5) Backward compatibility

- Legacy clients that do not understand this DEP continue operating with direct fanout behavior.
- New clients keep `direct-members-v1` for explicit/small/private channels.
- Wire compatibility is preserved (no mandatory breaking message type changes in this phase).

## Future Work: Sender-Key / Group-Key Upgrade Path

This DEP intentionally does **not** require sender-key/group-key cryptography in phase one.

Planned follow-up path:

1. Introduce `bounded-groupkey-v1` delivery contract.
2. Add group epoch/key-rotation metadata and membership-bound key distribution.
3. Keep partial-mesh + gossip transport for envelope propagation.
4. Migrate `bounded-gossip-v1` public channels gradually via capability/version negotiation.

This keeps rollout incremental: bounded transport semantics first, cryptographic group optimization second.

## Security Considerations

- Bounded fanout reduces amplification and queue-abuse risk.
- Relay peers are helpers, not authorities; correctness remains replication + signed-state based.
- Gossip dedup and TTL are required to bound replay and loop risk.
- Sender-key/group-key transition must include membership change rekey guarantees.

## References

- DEP-008: Gossip propagation
- DEP-014: Adaptive P2P Public Workspaces

## Copyright

This document is placed in the public domain (CC0-1.0).
