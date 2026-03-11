# DEP-014: Adaptive P2P Public Workspaces

```
Number:  DEP-014
Title:   Adaptive P2P Public Workspaces
Author:  Alex + Xena
Status:  Draft
Type:    Core
Created: 2026-03-11
Requires: DEP-007 (workspace-state sync), DEP-008 (gossip), DEP-009 (multi-transport)
```

## Abstract

This DEP evolves DecentChat from a small-workspace snapshot model toward a single adaptive P2P architecture capable of supporting very large public workspaces without abandoning the project's decentralized philosophy.

The key shift is from **full local roster and explicit public-channel membership** to **paged, shardable, policy-derived state**. Peers may advertise helpful capabilities such as directory, relay, archive, or presence aggregation, but they remain ordinary peers rather than mandatory trusted servers. Signed state plus replication determine correctness.

## Motivation

The current architecture works well for small and medium collaborative workspaces, but it carries assumptions that do not scale to very large public communities:

- clients locally materialize `workspace.members[]`
- public channels enumerate `channel.members[]`
- join/sync sends full workspace snapshots
- persistence stores full workspace blobs
- peer selection still scans local workspace rosters

These assumptions become expensive or impossible at 100k–500k member scale. At the same time, introducing a separate server-centric architecture would break the project's P2P identity and create long-term complexity.

This DEP defines a path to preserve:

- one workspace architecture
- no mandatory trusted central server
- bounded peer connections
- graceful degradation when helper peers disappear

## Specification

### 1) One adaptive architecture

DecentChat MUST maintain a single workspace architecture for both small and large workspaces.

The protocol may adapt behavior by scale and capability, but it MUST NOT split into separate “small P2P mode” and “public server mode” architectures.

### 2) Capability peers are helpers, not authorities

A peer may advertise optional capabilities such as:

- directory
- relay
- archive
- presence aggregation

These peers are still regular protocol participants.

A peer may advertise directory/relay/archive capabilities, but no single peer is authoritative. Signed state plus replication determine correctness.

Correctness MUST survive the loss of any one helper peer.

### 3) Public channels use derived membership

Public workspace channels MUST move away from explicit per-user membership arrays.

Instead, access is determined by policy, such as:

- all workspace members
- role-gated access
- group-based access
- explicit membership (for small/private cases)

Legacy explicit member arrays MAY remain for backward compatibility, but they are no longer the authoritative model for public channels.

### 4) Clients materialize slices, not full workspace state

Clients MUST be able to open and use a workspace without downloading the full member roster.

Clients should load:

- workspace shell
- visible channel shell
- relevant history pages
- requested member directory pages
- active presence slices

Full roster materialization is not required for correctness.

### 5) Directory and history become paged and shardable

Workspace membership and large-scale metadata SHOULD be represented through:

- paged member directory responses
- shard references / replica advertisements
- cursor-based history pagination
- delta updates instead of full snapshot replay where possible

### 6) Bounded topology remains required

Peers MUST keep bounded desired peer sets.

Large public workspaces rely on:

- partial mesh
- gossip / bounded relay fanout
- replica hints
- capability-aware peer selection

No peer should attempt direct fanout to the entire workspace audience.

### 7) Graceful degradation

If helper peers disappear, the system MUST degrade gracefully:

Still expected to work:
- active messaging among reachable peers
- identity and signed-state validation
- currently cached workspace use

May degrade temporarily:
- roster search completeness
- old history availability
- discovery speed
- presence freshness

## Rationale

This DEP keeps DecentChat philosophically decentralized while acknowledging practical scale constraints.

The core design choice is to reject two bad extremes:

1. **naive egalitarian full-state P2P** — elegant, but does not scale to 500k
2. **centralized server mode** — scalable, but breaks the project's identity

The middle path is adaptive P2P:

- one protocol
- one workspace architecture
- optional peer capabilities
- shard/page/slice loading
- replicated helper roles

This preserves local ownership and decentralization while permitting large-scale operation.

## Backward Compatibility

Backward compatibility is required.

- Existing workspace snapshots continue to work.
- Unknown scalable fields must be ignored safely by old clients.
- Legacy explicit `channel.members[]` remains valid during migration.
- New clients may derive public-channel access from policy even when old clients still carry snapshot member arrays.

The rollout should proceed incrementally:

1. add types and policy fields
2. add normalized persistence
3. add shell + delta sync
4. add directory/history pages
5. update UI and topology logic

## Reference Implementation

Planned implementation areas:

- `decent-protocol/src/workspace/types.ts`
- `decent-protocol/src/workspace/WorkspaceManager.ts`
- `decent-protocol/src/workspace/SyncProtocol.ts`
- `decent-protocol/src/storage/PersistentStore.ts`
- `decent-client-web/src/app/ChatController.ts`
- `decent-client-web/src/lib/components/members/*`

## Security Considerations

- Helper peers must not become hidden central authorities.
- Public-channel policy evaluation must be deterministic and signed-state compatible.
- Replica loss must not corrupt correctness.
- Paging and shard requests must be rate-limited to prevent abuse.
- Older clients must not accidentally widen access when they ignore newer policy fields.

## Test Vectors

### Vector A: public channel membership is derived

1. Workspace has channel `#general` with `accessPolicy.mode = public-workspace`
2. New member joins workspace
3. New member gains access to `#general`
4. Channel membership array does not need mutation

### Vector B: helper peer loss

1. Workspace has directory shard replicated to 3 peers
2. One helper peer disappears
3. Directory queries continue from remaining replicas
4. Active messaging remains functional

### Vector C: legacy client interoperability

1. Old client syncs workspace snapshot containing `channel.members[]`
2. New client also sees `accessPolicy.mode = public-workspace`
3. New client uses policy as authority, old client continues compatibility behavior
4. No correctness break occurs during migration

## References

- DEP-007: workspace snapshot/state sync
- DEP-008: gossip propagation
- DEP-009: multi-transport
- MLS / sender-key style large-group messaging approaches

## Copyright

This document is placed in the public domain (CC0-1.0).
