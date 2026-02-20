# DEP-008: Gossip Message Propagation

```
Number:  DEP-008
Title:   Gossip Message Propagation
Author:  Alex + Xena
Status:  Active
Type:    Transport
Created: 2026-02-21
```

## Abstract

Enable message delivery in partial-mesh workspaces by having intermediate peers relay messages they receive to other connected workspace members. Each relayed message is re-encrypted for its next hop, preserving end-to-end security. A hop-count (TTL) and a seen-set prevent infinite propagation.

## Motivation

DecentChat's proactive peer maintenance (DEP/T2.5) attempts to keep all workspace members connected. In practice, some connections fail: corporate firewalls, symmetric NAT, temporary network partitions. When Alice cannot reach Carol directly, Bob (who is connected to both) can relay Alice's message to Carol.

Without gossip: undelivered messages sit in Alice's offline queue until Carol connects directly to Alice.  
With gossip: Carol receives the message within seconds via Bob, even if Alice never establishes a direct connection.

## Specification

### Envelope Fields (unencrypted metadata)

The following fields are appended to the existing message envelope alongside `channelId`, `workspaceId`, etc.:

```typescript
interface GossipMetadata {
  /** Original message ID (before re-encryption). Used for dedup at all hops. */
  _originalMessageId?: string;
  /** ID of the peer who originally authored the plaintext. */
  _gossipOriginalSender?: string;
  /** Number of relay hops so far. Absent on direct sends (hop 0). */
  _gossipHop?: number;
}
```

### Algorithm

**Sender side (original author, hop 0):**  
No change to the existing send path. Relay nodes handle forwarding automatically.

**Relay side (any receiving peer):**

```
on receive(fromPeer, envelope):
  origId = envelope._originalMessageId
  if origId ∈ seenGossipIds → DROP (already processed + relayed)
  add origId to seenGossipIds (expires after 5 min)

  hop = (envelope._gossipHop ?? 0) + 1
  if hop > GOSSIP_TTL → process only, do not relay

  for each member in workspace:
    if member == self → skip
    if member == fromPeer → skip (don't relay back)
    if member == _gossipOriginalSender → skip (don't send back to author)
    if member not in connectedPeers → skip
    if no shared session with member → skip

    re-encrypt(plaintext, member)
    send relayEnvelope {
      ...encrypted,
      channelId, workspaceId, threadId, vectorClock,
      _originalMessageId: origId,
      _gossipOriginalSender: envelope._gossipOriginalSender ?? fromPeer,
      _gossipHop: hop,
    }
```

**Receiving a gossip-relayed message:**  
Use `_gossipOriginalSender` as the message `senderId` for correct display attribution. All other processing (CRDT, hash chain, ACK) is identical to a direct message.

### Constants

| Constant | Value | Description |
|---------|-------|-------------|
| `GOSSIP_TTL` | `2` | Max relay hops. `0` = original send, `1` = first relay, `2` = second relay. |
| Seen-set TTL | 5 min | Entries older than 5 min are purged to bound memory. |

### Overhead Analysis

**Full mesh (all peers connected to each other):**  
No sessions with extra peers → gossip relay skipped for all members → overhead ≈ 0.

**Partial mesh (some connections missing):**  
At most `(n-1) × GOSSIP_TTL` extra messages per original message (n = workspace size). For n=10, TTL=2: at most 18 relay messages. CRDT dedup handles the rare case where the same message arrives via multiple paths.

## Rationale

**Why re-encrypt instead of forwarding the encrypted bytes?**  
The existing Double Ratchet is per-peer: ciphertext encrypted for Bob cannot be decrypted by Carol. Re-encryption at the relay is necessary. The relay (Bob) has the plaintext in memory after decryption; re-encryption for Carol adds one `AES-GCM-256` call per hop.

**Why `_gossipOriginalSender` as unencrypted metadata?**  
PeerIds are not secret (already exchanged in handshakes and workspace member lists). Including it unencrypted allows the receiver to correctly attribute the message without needing the relay node to claim authorship.

**Why not include `_originalMessageId` in the encrypted payload?**  
The encrypted payload is opaque to intermediates. Including dedup metadata in unencrypted headers lets relay nodes discard duplicates without decrypting — saves CPU.

## Backward Compatibility

Peers that don't implement DEP-008 ignore unknown envelope fields. Gossip metadata fields start with `_` to signal their optional/internal nature. Existing message processing is unaffected.

## Security Considerations

- **Relay integrity**: Relay nodes re-encrypt with their own ratchet key. Recipients verify the signature using the relay node's identity, not the original sender's. **Attribution is by `_gossipOriginalSender` field only — not cryptographically verified.** A malicious relay could spoof the sender. Mitigation: workspace member validation still applies; only members of the target workspace can relay. Future: sign the original message ID with the original sender's key and include the signature in relay metadata.
- **Privacy**: Relay nodes see the plaintext. This is inherent to re-encryption gossip. Users in a workspace implicitly trust all workspace members. For higher-security scenarios, use direct connection only (disable gossip).
- **Amplification**: TTL=2 bounds propagation. Seen-set prevents loops.

## Reference Implementation

Implemented in `decent-client-web/src/app/ChatController.ts`:
- `_gossipSeen: Map<string, number>` — dedup set
- `_gossipRelay()` — relay method
- `startGossipCleanup()` — seen-set pruning

## Copyright

This document is placed in the public domain (CC0-1.0).
