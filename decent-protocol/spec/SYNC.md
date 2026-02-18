# DecentChat — Synchronization Specification

**Version:** 0.1.0  
**Status:** Draft

## Overview

DecentChat uses three complementary mechanisms for message ordering and synchronization between peers:

1. **Vector Clocks** — Causal ordering without trusting wall clocks
2. **CRDTs** — Conflict-free merging when peers reconnect
3. **Merkle Trees** — Efficient identification of missing messages

Together, these ensure that all peers converge to the same message state regardless of network partitions, offline periods, or merge order.

## 1. Vector Clocks

### 1.1 Purpose

Wall clock timestamps are unreliable in P2P systems (peers may have different times, or malicious peers may fake timestamps). Vector clocks provide **causal ordering** — if message A caused message B, we can prove it cryptographically.

### 1.2 Structure

A vector clock is a map from peer ID to a monotonically increasing counter:

```json
{
  "alice": 3,
  "bob": 2,
  "charlie": 1
}
```

### 1.3 Operations

**Increment** (before sending a message):
```
clock[myPeerId] += 1
```

**Merge** (on receiving a message):
```
for each peerId in remoteClock:
  clock[peerId] = max(clock[peerId], remoteClock[peerId])
clock[myPeerId] += 1
```

**Compare** (determine causal relationship):
```
Given clocks A and B:

if A[p] ≤ B[p] for all p, and A[p] < B[p] for at least one p:
  → A happened BEFORE B

if A[p] ≥ B[p] for all p, and A[p] > B[p] for at least one p:
  → A happened AFTER B

if A[p] = B[p] for all p:
  → A and B are EQUAL

otherwise:
  → A and B are CONCURRENT (conflict!)
```

### 1.4 Concurrent Messages

When two messages are concurrent (neither causally before the other), a deterministic tiebreaker is applied:

1. **Wall time** (lower first) — for human-readable ordering
2. **Sender ID** (lexicographic) — guarantees determinism
3. **Message ID** (lexicographic) — final tiebreaker

This ensures all peers display concurrent messages in the same order.

### 1.5 Properties

- **Partial order**: Not all messages are comparable (concurrent messages exist)
- **Causality preservation**: If A caused B, compare(A, B) = "before"
- **Transitivity**: If A → B and B → C, then A → C

## 2. CRDTs (Conflict-free Replicated Data Types)

### 2.1 Design: Grow-Only Set (G-Set)

Messages form a G-Set CRDT — elements can only be added, never removed. This is enforced by the immutability rule (no editing, no deleting).

### 2.2 CRDT Message Format

Each message includes a vector clock instead of (or in addition to) a wall clock timestamp:

```json
{
  "id": "alice-3",
  "channelId": "ch-general",
  "senderId": "alice",
  "content": "Hello!",
  "type": "text",
  "vectorClock": { "alice": 3, "bob": 2 },
  "wallTime": 1708300000000,
  "prevHash": "a1b2c3..."
}
```

The `id` SHOULD be `{senderId}-{counter}` to guarantee global uniqueness without coordination.

### 2.3 Merge Operation

When two peers exchange message sets:

```
merge(local, remote):
  for each message in remote:
    if message.id not in local:
      local.add(message)
      local.clock = merge(local.clock, message.vectorClock)
  return newly added messages
```

### 2.4 Mathematical Properties

The merge operation MUST satisfy these properties (they are what make it "conflict-free"):

| Property | Definition | Why It Matters |
|---|---|---|
| **Commutative** | merge(A, B) = merge(B, A) | Order of sync doesn't matter |
| **Associative** | merge(merge(A, B), C) = merge(A, merge(B, C)) | Multi-peer sync is consistent |
| **Idempotent** | merge(A, A) = A | Re-syncing is safe |

**Convergence guarantee**: Given any sequence of merge operations between peers, all peers will arrive at the same final state.

### 2.5 Message Ordering After Merge

After merging, messages are sorted by:

1. Vector clock causal order (before < after)
2. For concurrent messages: wall time, then sender ID, then message ID

This produces a **total order** from the partial order, ensuring all peers display messages identically.

## 3. Merkle Trees

### 3.1 Purpose

When peers reconnect after being offline, they need to sync. Naive sync sends all messages — O(n). Merkle trees reduce this to O(log n) by identifying exactly which messages differ.

### 3.2 Construction

1. Collect all message IDs for a channel (sorted)
2. Hash each ID → leaf nodes
3. Build tree bottom-up: each parent = SHA-256(left.hash + right.hash)
4. For odd leaf counts, the last leaf is duplicated

```
          root
         /    \
      h(AB)   h(CD)
      /  \    /  \
    h(A) h(B) h(C) h(D)
     |    |    |    |
    msg1 msg2 msg3 msg4
```

### 3.3 Sync Algorithm

```
PEER A                          PEER B
  │                               │
  │  1. Send root hash ──────►    │
  │                               │  Compare with own root
  │    ◄────── 2. Roots match?    │
  │           YES → Done!         │
  │           NO  → Continue      │
  │                               │
  │  3. Exchange subtree hashes   │
  │    ◄──────────────────────►   │
  │                               │
  │  4. Identify differing leaves │
  │    (message IDs that differ)  │
  │                               │
  │  5. Request/send only the     │
  │     missing messages          │
  │    ◄──────────────────────►   │
  │                               │
  │  6. Both rebuild trees        │
  │     Roots now match ✓         │
```

### 3.4 Diff Algorithm

```
diff(localNode, remoteNode):
  if localNode.hash == remoteNode.hash:
    return []  // Subtrees identical

  if remoteNode is leaf:
    return [remoteNode.messageId]

  if localNode is leaf:
    return collectAllLeafIds(remoteNode)

  return diff(local.left, remote.left) 
       + diff(local.right, remote.right)
```

### 3.5 Bandwidth Analysis

| Scenario | Naive Sync | Merkle Sync |
|---|---|---|
| 1000 messages, 0 missing | Send all 1000 | Compare 1 hash |
| 1000 messages, 1 missing | Send all 1000 | Compare ~10 hashes + send 1 message |
| 1000 messages, 100 missing | Send all 1000 | Compare ~100 hashes + send 100 messages |

## 4. Complete Sync Flow

When two peers connect:

```
1. HANDSHAKE
   Exchange ECDH public keys → derive shared secret

2. WORKSPACE SYNC
   Exchange workspace metadata (members, channels, invite codes)
   
3. PER-CHANNEL MERKLE SYNC
   For each shared channel:
     a. Exchange Merkle root hashes
     b. If roots differ: run diff algorithm
     c. Exchange missing messages
     d. Both sides run CRDT merge
     e. Verify hash chains on imported messages
     
4. LIVE MESSAGING
   New messages broadcast to all connected peers in real-time
   Each message includes vector clock for causal ordering
```

## 5. Conflict Scenarios

### 5.1 Concurrent Edits to Workspace

Workspace metadata (members, channels) uses last-writer-wins with vector clock ordering:
- Add member: commutative (order doesn't matter)
- Remove member: last seen vector clock wins
- Create channel: commutative (unique IDs prevent conflicts)

### 5.2 Network Partition

During a partition, each partition operates independently:
- Messages are added to local CRDT
- Hash chains continue independently per partition
- On reconnection: Merkle diff → CRDT merge → chains reconciled

### 5.3 Malicious Peer

If a peer sends tampered messages:
- Hash chain verification fails → reject entire message set
- ECDSA signature mismatch → reject specific message
- Vector clock regression → detected (counters only increase)

## 6. Implementation Requirements

### MUST
- Implement vector clock increment before every outgoing message
- Implement vector clock merge on every incoming message
- Provide deterministic ordering for concurrent messages
- Preserve CRDT merge properties (commutative, associative, idempotent)
- Verify hash chains on imported message sets

### SHOULD
- Implement Merkle tree sync for channels with >100 messages
- Cache Merkle trees and update incrementally
- Rate-limit sync requests to prevent DoS

### MAY
- Fall back to full sync for small message sets (<50 messages)
- Implement bloom filters for faster set difference estimation
- Use delta-CRDTs for bandwidth optimization
