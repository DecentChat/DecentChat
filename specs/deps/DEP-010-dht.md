# DEP-010: DHT Peer Discovery

```
Number:  DEP-010
Title:   DHT Peer Discovery
Author:  Alex + Xena
Status:  Draft
Type:    Transport
Created: 2026-02-21
```

## Abstract

Replace dependency on PeerJS signaling servers with a Kademlia-style Distributed Hash Table (DHT) for peer discovery. Peers publish their connection information to the DHT keyed by their workspace ID. Other peers looking to join a workspace query the DHT to find members, then connect directly via WebRTC. This eliminates the signaling server as a single point of failure.

## Motivation

DecentChat currently requires at least one PeerJS signaling server to bootstrap WebRTC connections. PEX (DEP-002) improves redundancy by sharing server lists, but fundamentally relies on at least one server being available.

A DHT enables truly serverless operation:
- No central server needed for peer discovery
- Workspace members share contact information directly
- Censorship-resistant (no single entity to block)
- Resilient to server outages

## Specification

### DHT Basics (Kademlia)

- **Node ID**: derived from peer ID (SHA-256, first 160 bits)
- **Key space**: 160-bit (2^160 nodes)
- **Routing table**: k-buckets (k=20) indexed by XOR distance
- **Operations**: `FIND_NODE`, `FIND_VALUE`, `STORE`, `PING`
- **Replication**: store in the k (20) closest nodes to the key

### Workspace Peer Record

Workspace members publish a peer record to the DHT keyed by `SHA-256(workspaceId)`:

```typescript
interface DHTRecord {
  peerId: string;
  signalingHints: string[];  // signaling server URLs (fallback for WebRTC)
  wsRelay?: string;          // WebSocket relay URL (DEP-009)
  pexServers: PEXServer[];   // servers known to this peer (DEP-002)
  publicKey: string;         // for verification
  timestamp: number;
  ttl: number;               // seconds until record expires (default: 3600)
  signature: string;         // ECDSA signature of record body by peer's identity key
}
```

### Bootstrap

To join the DHT, a new peer needs at least one known DHT node (bootstrap node):
1. On first launch, connect to hard-coded bootstrap nodes (well-known, community-operated)
2. After joining, persist discovered nodes to local storage for future sessions
3. PEX server list (DEP-002) can also carry DHT bootstrap node addresses

### Workspace-Level Discovery

```
// Alice wants to find workspace members:
1. key = SHA-256(workspaceId)
2. dht.findValue(key) → [DHTRecord, DHTRecord, ...]
3. For each record: connect to peer using signalingHints or wsRelay
4. On successful connection: exchange workspace sync (existing flow)

// Alice announces herself:
1. record = buildRecord(myPeerId, myPublicKey, knownSignalingServers, ...)
2. dht.store(SHA-256(workspaceId), record)
3. Re-announce every TTL/2 seconds
```

### Integration with PEX

DEP-002 (PEX) provides signaling server discovery. DEP-010 (DHT) provides peer discovery. They are complementary:
- DHT gives you *who* to connect to (peer IDs)
- PEX gives you *how* to signal them (server URLs)
- WebRTC establishes the actual P2P channel

### Browser Constraints

Browser-based DHT requires either:
1. **WebRTC DHT**: use WebRTC data channels for DHT protocol messages (peers must be connected first — bootstrapping problem)
2. **WebSocket DHT**: maintain a WebSocket to a small set of DHT gateway nodes (partial centralisation)
3. **Hybrid**: DHT gateways provide bootstrap; once a peer is connected to workspace members, use WebRTC data channels for DHT messages

Recommended: option 3 (hybrid). Bootstrap via gateways, then use existing workspace WebRTC connections as DHT transport.

## Rationale

**Why Kademlia?** Battle-tested (BitTorrent, IPFS, Ethereum). O(log n) lookups. Well-understood security properties.

**Why not use libp2p directly?** libp2p bundles the full stack (Kademlia, DHT, pubsub, transport) and is large (300KB+ gzip). A minimal Kademlia implementation tailored to DecentChat's needs would be ~15KB. We can adopt libp2p later if the ecosystem warrants it.

## Implementation Status

**DEFERRED** — High complexity. Requires:
1. Kademlia DHT implementation (~1,500 lines)
2. DHT-over-WebRTC transport adapter
3. Bootstrap node infrastructure
4. Integration with workspace join flow

Estimated effort: 4–6 weeks. Target: v0.5.0.

## References

- [Kademlia Paper](https://www.scs.stanford.edu/~dm/home/papers/kpos.pdf)
- [libp2p Kademlia](https://github.com/libp2p/js-libp2p-kad-dht)
- [BitTorrent DHT Spec (BEP 5)](http://www.bittorrent.org/beps/bep_0005.html)

## Copyright

This document is placed in the public domain (CC0-1.0).
