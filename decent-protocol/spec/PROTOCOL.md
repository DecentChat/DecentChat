# DecentChat — Overview & Architecture

**Version:** 0.1  
**Status:** Draft  
**Date:** 2026-02

---

## 1. Goals & Non-Goals

### 1.1 Goals

| Goal | Description |
|------|-------------|
| **Serverless** | No central server stores messages, routes traffic, or holds keys. All state is local. |
| **Peer-to-peer** | Every node is both client and server. Any node can relay to any other. |
| **End-to-end encryption** | Messages are encrypted on the sender's device and decrypted only by the intended recipient. The transport layer sees only ciphertext. |
| **Tamper-evident** | Every channel forms a cryptographic hash chain. Modifying any message invalidates all subsequent hashes, making tampering detectable. |
| **Offline-first / CRDT-based** | Peers that were offline can reconnect and their message sets merge automatically, without conflicts, without a coordinator. |
| **Transport-agnostic** | The protocol is independent of the underlying byte-delivery mechanism (WebRTC, WebSocket, Bluetooth, in-process, etc.). |
| **Implementable in any language** | This specification is self-contained. A conforming implementation in Python, Go, Rust, etc. must be able to interoperate with a browser implementation. |

### 1.2 Non-Goals

- **Anonymity / metadata hiding** — Peer IDs and timing are visible to the transport. If anonymity is required, use an onion-routing overlay.
- **Perfect forward secrecy beyond session** — ECDH shared secrets are derived per session pair, not per message. Adding PFS ratcheting (e.g., Signal X3DH) is possible but is not defined here.
- **Availability guarantees** — There is no store-and-forward server. If both sides are offline, messages cannot be delivered until they reconnect.
- **Large file transfer** — This protocol is optimised for text messages. Binary blobs should be transferred out-of-band or via a chunked extension.

---

## 2. Concepts & Terminology

| Term | Definition |
|------|------------|
| **Peer** | A node participating in the network. Identified by a globally unique **Peer ID** (assigned by the signaling/discovery layer, e.g., PeerJS cloud). |
| **Workspace** | A named group of peers. Equivalent to a Slack "workspace." Identified by a UUID. |
| **Channel** | A named message stream within a workspace. Type is either `channel` (multi-party) or `dm` (exactly two members). |
| **Message** | An immutable, ordered record in a channel. Forms a hash-linked chain. |
| **Hash Chain** | A sequence of messages where each message embeds the SHA-256 hash of the previous one, starting from the genesis hash. |
| **CRDT** | Conflict-free Replicated Data Type. A data structure that can be merged from multiple sources in any order and always converges to the same result. |
| **Vector Clock** | A logical timestamp assigning a counter per peer. Used for causal ordering without trusting wall-clock time. |
| **Negentropy** | Set-reconciliation protocol where peers exchange compact range fingerprints and request only missing message IDs, minimizing sync payload. |
| **Invite Code** | An 8-character alphanumeric token that authorises a peer to join a workspace. Transmitted out-of-band (e.g., copied and pasted). |

---

## 3. Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                         │
│         (UI, settings, file attachments, notifications)          │
└───────────────────────────────┬─────────────────────────────────┘
                                │ uses
┌───────────────────────────────▼─────────────────────────────────┐
│                       PROTOCOL LAYER (this SDK)                  │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐             │
│  │   Crypto    │  │   Messages   │  │ Workspaces │             │
│  │  (ECDH key  │  │ (MessageStore│  │(Manager +  │             │
│  │  exchange,  │  │  + HashChain)│  │  Sync      │             │
│  │  AES-GCM,   │  │              │  │  Protocol) │             │
│  │  ECDSA sig) │  │              │  │            │             │
│  └─────────────┘  └──────────────┘  └────────────┘             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    CRDT Layer                            │   │
│  │      (VectorClock + MessageCRDT + Negentropy)            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Transport Interface (abstract)              │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ implements Transport
┌───────────────────────────────▼─────────────────────────────────┐
│                     TRANSPORT LAYER                              │
│   (decent-transport-webrtc / WebSocket / Bluetooth / in-process)   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Crypto Layer

Handles key generation and key exchange between peers.

- Each peer generates an **ECDH P-256 key pair** on first launch.
- When two peers connect, they exchange public keys via a **handshake message**.
- Each peer derives a **shared AES-256-GCM key** using ECDH + HKDF-SHA-256.
- Messages are encrypted with AES-256-GCM. Each encryption uses a fresh random 12-byte IV.
- Each peer optionally generates an **ECDSA P-256 signing key pair** for message authentication.

See [CRYPTO.md](./CRYPTO.md) for full details.

### 3.2 Message Layer

Manages ordered, immutable message sequences per channel.

- Messages are stored in a **per-channel hash chain** (`MessageStore`).
- Each message includes `prevHash` = SHA-256 of the previous message's canonical form.
- The first message in a channel uses the **genesis hash** (64 zero hex characters).
- Incoming messages are verified against the chain before being accepted.
- Messages are **immutable after creation** — no edits, no deletes.

See [MESSAGE-FORMAT.md](./MESSAGE-FORMAT.md) and [CRYPTO.md](./CRYPTO.md) for details.

### 3.3 CRDT Layer

Provides convergent, conflict-free merge of message sets across peers.

- **VectorClock:** Tracks logical time per peer. Used to determine causal ordering.
- **MessageCRDT:** A grow-only G-Set of messages. Merge is idempotent, commutative, and associative.
- **Negentropy:** Efficient set reconciliation over message IDs using range fingerprints and targeted missing-item exchange.

See [SYNC.md](./SYNC.md) for full details.

### 3.4 Workspace Layer

Manages workspace membership, channels, and P2P synchronisation.

- **WorkspaceManager:** CRUD for workspaces, members, channels, DMs. All in-memory (backed by client-side IndexedDB).
- **SyncProtocol:** Handles join requests, member announcements, channel creation broadcasts, and full workspace sync responses.

### 3.5 Transport Layer (abstract)

The protocol has no dependency on any specific networking library.  
Implementations must satisfy the `Transport` interface:

```typescript
interface Transport {
  init(peerId?: string): Promise<string>;
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): void;
  send(peerId: string, data: unknown): boolean;
  onConnect:    ((peerId: string) => void) | null;
  onDisconnect: ((peerId: string) => void) | null;
  onMessage:    ((peerId: string, data: unknown) => void) | null;
  onError:      ((error: Error) => void) | null;
  getConnectedPeers(): string[];
  destroy(): void;
}
```

The reference implementation (`decent-transport-webrtc`) uses PeerJS over WebRTC data channels.

---

## 4. Connection Lifecycle

```
Alice                           Bob
  │                               │
  │──── connect() ───────────────▶│   (transport level)
  │                               │
  │◀─── onConnect ────────────────│   (transport fires callback)
  │                               │
  │──── Handshake{publicKey} ───▶│   Alice sends ECDH public key
  │◀─── Handshake{publicKey} ────│   Bob sends ECDH public key
  │                               │
  │  [both derive shared secret]  │   ECDH + HKDF
  │                               │
  │══════ Encrypted channel ══════│   AES-256-GCM from here on
  │                               │
  │──── ChatMessage{encrypted} ─▶│
  │◀─── ChatMessage{encrypted} ───│
  │                               │
  │──── disconnect() ────────────▶│   (or network loss)
  │◀─── onDisconnect ─────────────│
```

### 4.1 Handshake

Immediately after a transport connection opens, **both sides** must send a handshake:

```json
{
  "type": "handshake",
  "publicKey": "<Base64url JWK>",
  "peerId": "<string>"
}
```

Both sides derive the shared secret concurrently. Neither side sends a chat message until `onHandshake` has been processed and the shared secret is cached.

### 4.2 Workspace Join

Workspace membership is established out-of-band via an **invite code**. The joining peer must already have a transport connection to an existing member:

```
Bob                             Alice (existing member)
  │                               │
  │──── join-request ────────────▶│  { type: "workspace-sync", sync: { type: "join-request", inviteCode, member } }
  │                               │  Alice validates code, adds Bob to workspace
  │◀─── join-accepted ────────────│  { type: "workspace-sync", sync: { type: "join-accepted", workspace, messageHistory } }
  │                               │
  │  Bob imports workspace state  │
  │  Bob imports message history  │
```

---

## 5. Security Model

### 5.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Eavesdropping on transport | AES-256-GCM encryption; ciphertext is all the transport sees |
| Man-in-the-middle on key exchange | Public keys are bound to peer IDs; invite code delivered out-of-band acts as a trust anchor |
| Message tampering | Hash chain: modifying any message invalidates all subsequent `prevHash` values |
| Message insertion | Attacker cannot insert messages without knowing the shared secret and the current chain hash |
| Message replay | Each message has a monotonically increasing timestamp that must exceed the previous message's timestamp |
| Message deletion | Hash chain continuity check detects gaps |
| History rewriting during sync | `importMessages` verifies the full chain before accepting any imported history |
| Impersonation | ECDH shared secret is specific to the key pair; a peer without the private key cannot encrypt to the same shared secret |

### 5.2 Trust Assumptions

- Peers **trust the invite code** delivery channel. The invite code is not authenticated by the protocol — it is assumed to be exchanged through a trusted out-of-band channel (e.g., Signal, phone call, physical proximity).
- The PeerJS signaling server is used only for NAT traversal (SDP offer/answer). It **never sees message content** and cannot impersonate peers because it doesn't have their ECDH private keys.
- Wall-clock timestamps are **not used for ordering** (they are for display only). Causal ordering uses vector clocks.

---

## 6. Transport Requirements

An implementation that satisfies the `Transport` interface must:

1. **Deliver messages reliably and in order** per connection (equivalent to TCP semantics, not UDP). WebRTC data channels configured with `ordered: true, reliable: true` satisfy this.
2. **Support arbitrary JSON-serialisable payloads** up to at least 256 KiB per message.
3. **Fire `onConnect` before any `onMessage`** events for that peer.
4. **Fire `onDisconnect` at most once** per peer, after all `onMessage` events for that peer.
5. **Be idempotent on `connect()`** — connecting to an already-connected peer must be a no-op.

---

## 7. Versioning & Compatibility

The wire format uses JSON objects with a `type` discriminant. Future versions must:

- Not reuse existing `type` strings with incompatible semantics.
- Treat unknown `type` values as no-ops (forward-compatibility).
- Negotiate version via a `version` field in the handshake (future).

Current version: **`"meshproto/0.1"`** (not yet sent on wire; reserved for future negotiation).
