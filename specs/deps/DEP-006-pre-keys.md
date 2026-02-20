# DEP-006: Pre-Key Bundle Distribution

```
Number:  DEP-006
Title:   Pre-Key Bundle Distribution
Author:  Alex + Xena
Status:  Draft
Type:    Protocol
Created: 2026-02-20
Requires: DEP-003
```

## Abstract

Enable asynchronous message delivery by distributing pre-generated key bundles through the signaling layer. Inspired by Signal's pre-key system, this allows Alice to send Bob an encrypted session-initializer even when Bob is offline — Bob can decrypt and process it when he comes back online, without requiring simultaneous presence.

## Motivation

**Current problem:**  
Both peers must be online simultaneously to complete the WebRTC handshake and establish an encrypted session. If Bob is offline when Alice wants to send him a message, the message is queued locally and only delivered when Bob reconnects *while Alice is also online*. For workspaces with intermittent members, this means messages can be delayed for hours or never delivered.

**With pre-keys:**
1. Bob generates a bundle of one-time pre-keys and uploads them to the signaling server on startup.
2. Alice, wanting to send Bob a message, fetches one of Bob's pre-keys from the server.
3. Alice constructs a sealed session-initializer — an encrypted message Bob can process cold.
4. Alice sends the session-initializer to a relay (or stores it on the signaling server).
5. When Bob comes online, he fetches and processes queued session-initializers.
6. Communication proceeds normally via Double Ratchet.

No simultaneous presence required.

## Specification

### Pre-Key Bundle

Bob generates and publishes:

```typescript
interface PreKeyBundle {
  /** Bob's long-term identity key (ECDH P-256, base64 raw) */
  identityKey: string;
  /** Signed pre-key: a medium-term ECDH key signed with Bob's identity key */
  signedPreKey: {
    id: number;
    key: string;       // base64 raw ECDH public key
    signature: string; // base64 ECDSA signature of key bytes using identityKey's signing counterpart
  };
  /** One-time pre-keys: a pool of single-use ECDH keys, each used once then discarded */
  oneTimePreKeys: Array<{
    id: number;
    key: string;       // base64 raw ECDH public key
  }>;
  /** Timestamp of bundle creation */
  createdAt: number;
}
```

**Key lifetimes:**
- Identity key: permanent (same as DEP-003 derived peer identity)
- Signed pre-key: rotate every 30 days
- One-time pre-keys: consumed once, replenish when pool drops below 10

### Session-Initializer (X3DH)

Alice initializes a session with Bob using X3DH (Extended Triple Diffie-Hellman):

```typescript
interface PreKeySessionInit {
  type: 'pre-key-session-init';
  /** Which of Bob's OTPKs was used (so Bob can look it up and delete it) */
  preKeyId: number;
  /** Alice's ephemeral ECDH key for this session (base64 raw) */
  ephemeralKey: string;
  /** Alice's identity key (base64 raw), so Bob can verify and start ratchet */
  senderIdentityKey: string;
  /** The first ratchet message, encrypted with the X3DH-derived session key */
  ratchet: RatchetMessage;  // same RatchetMessage type from DEP already in use
  /** Timestamp */
  ts: number;
}
```

**X3DH derivation (Alice's side):**
```
IK_A = Alice's identity key
EK_A = Alice's ephemeral key (fresh per session)
IK_B = Bob's identity key
SPK_B = Bob's signed pre-key
OTPK_B = Bob's one-time pre-key

DH1 = DH(IK_A, SPK_B)
DH2 = DH(EK_A, IK_B)
DH3 = DH(EK_A, SPK_B)
DH4 = DH(EK_A, OTPK_B)

masterSecret = KDF(DH1 || DH2 || DH3 || DH4)
```

The `masterSecret` becomes the Double Ratchet root key.

### Distribution API

Requires a self-hosted signaling server with added REST routes:

```
POST /prekeys/:peerId         — upload/replace bundle (authenticated by peerId signature)
GET  /prekeys/:peerId/bundle  — fetch bundle and consume one OTP key
DELETE /prekeys/:peerId       — revoke all pre-keys (on logout/key rotation)
```

**Fetch response** returns the bundle with exactly one one-time pre-key removed from the server's pool (consumed). Server removes it to prevent reuse.

### Queued Session-Initializers

```
POST /inbox/:peerId           — store a session-init for an offline peer
GET  /inbox/:peerId           — fetch pending session-inits (authenticated)
DELETE /inbox/:peerId/:id     — ack + delete after processing
```

Server stores ciphertext only. Server cannot decrypt.

### Backward Compatibility

If `GET /prekeys/:peerId/bundle` returns 404 (server doesn't support pre-keys, or peer hasn't uploaded), fall back to the current behavior: queue the message locally and wait for both peers to be online.

Peers signal pre-key support by including `preKeySupport: true` in their handshake (DEP-004 handshake extension).

## Rationale

**Why X3DH + Double Ratchet?** Same cryptographic foundation as Signal, battle-tested, provides forward secrecy and deniability. Reuses the DoubleRatchet already implemented in decent-protocol.

**Why server-stored inbox?** WebRTC requires both peers online. Without a server-side relay (even temporary), true async delivery is impossible. The server only sees ciphertext — privacy is preserved.

**Why one-time pre-keys?** Prevents replay attacks: each session-init consumes a pre-key, so the same init cannot be replayed to establish a second session.

## Security Considerations

- **MITM on pre-key fetch**: Signed pre-key signature must be verified by Alice using Bob's long-term identity key before proceeding with X3DH.
- **Replay of session-init**: One-time pre-key consumption on server prevents replay. If OTPK pool is empty, signed pre-key is used alone (slightly weaker but still secure).
- **Server compromise**: Server sees only ciphertext. Compromised server cannot read messages, but can delete or withhold pre-keys (DoS, not confidentiality breach).
- **Identity binding**: Alice's identity key is included in the session-init; Bob must verify it matches a trusted peer before accepting.

## Implementation Status

**DEFERRED** — requires:
1. Self-hosted PeerJS signaling server with `/prekeys` and `/inbox` REST extensions
2. Key management UI (pre-key replenishment, rotation)
3. Integration with existing DoubleRatchet session management

Estimated effort: 2–3 weeks. Target: v0.3.0.

## References

- [Signal X3DH Specification](https://signal.org/docs/specifications/x3dh/)
- [Signal Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
- [DEP-003: Derived Peer ID](./DEP-003-derived-peer-id.md)

## Copyright

This document is placed in the public domain (CC0-1.0).
