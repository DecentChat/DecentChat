# DecentChat

> Serverless, encrypted, peer-to-peer chat — like email, anyone can build a client.

Inspired by **Bitcoin** (seed phrase identity, no central authority), **BitTorrent** (decentralized mesh, no servers), and **Signal Protocol** (E2E encryption, safety numbers, forward secrecy).

Instead of Bitcoin's Proof of Work, DecentChat achieves consensus through **CRDTs** (Conflict-free Replicated Data Types) — a mathematical guarantee that all peers converge to the same state without mining, voting, or coordination. Combined with **vector clocks** for causal ordering and **Merkle trees** for efficient sync, peers can go offline, diverge, and merge back seamlessly. No energy wasted, no blocks to wait for — just eventual consistency by design.

## What is this?

A protocol + reference client for P2P messaging over WebRTC. No servers, no accounts, no tracking. Your identity is a cryptographic key pair, recoverable from a 12-word seed phrase — like a Bitcoin wallet, but for communication.

## Architecture

```
decent-protocol/          ← SDK (npm package, zero deps)
  ├── crypto/           ← ECDH P-256, AES-GCM-256, ECDSA signing
  ├── messages/         ← MessageStore (hash chains), OfflineQueue
  ├── workspace/        ← Workspaces, channels, DMs, sync protocol
  ├── crdt/             ← VectorClock, MessageCRDT (G-Set), MerkleTree
  ├── identity/         ← Seed phrase (BIP39), safety numbers, multi-device
  ├── storage/          ← PersistentStore (IndexedDB)
  └── transport/        ← Abstract Transport interface

decent-transport-webrtc/  ← WebRTC/PeerJS transport (swappable)

decent-client-web/        ← Reference Slack-like PWA (142KB JS)
```

## Key Features

- **No server** — Pure P2P via WebRTC DataChannels
- **E2E encrypted** — ECDH key exchange + AES-GCM-256
- **Tamper-proof** — SHA-256 hash chain (immutable message history)
- **Offline-resilient** — CRDT merge + offline message queue
- **Seed phrase identity** — 12-word BIP39 mnemonic, deterministic key derivation
- **Causal ordering** — Vector clocks, not wall time
- **Efficient sync** — Merkle trees for O(log n) diff
- **Persistent** — IndexedDB survives refresh/restart
- **NAT traversal** — STUN + TURN servers with retry
- **PWA** — Installable on phone, works offline

## Quick Start

```bash
bun install

# Run tests (200 tests, 0 failures)
bun run test

# Start dev server
bun run dev:client

# Build for production
bun run build:client
```

## Protocol Design

The protocol is transport-agnostic. WebRTC is the default, but you can swap in WebSocket, Bluetooth, or anything that implements the `Transport` interface:

```typescript
interface Transport {
  init(peerId?: string): Promise<string>;
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): void;
  send(peerId: string, data: unknown): void;
  getConnectedPeers(): string[];
  destroy(): void;
  onConnect?: (peerId: string) => void;
  onDisconnect?: (peerId: string) => void;
  onMessage?: (peerId: string, data: unknown) => void;
  onError?: (error: Error) => void;
}
```

## Identity

Your identity = your key pair. No email, no phone number, no server signup.

- **Seed phrase**: 12 words → deterministic ECDH + ECDSA key pairs
- **Recovery**: Enter 12 words on any device → same identity
- **Verification**: 60-digit safety number (like Signal) for in-person verification
- **Multi-device**: Same seed phrase on multiple devices

## Specs

Detailed protocol specifications in `decent-protocol/spec/`:
- `PROTOCOL.md` — Architecture overview
- `MESSAGE-FORMAT.md` — JSON schemas for all message types
- `CRYPTO.md` — Cryptographic primitives and flows
- `SYNC.md` — Vector clocks, CRDT properties, Merkle sync

### DEPs (Decent Enhancement Proposals)

Formal evolution process for the protocol (inspired by Bitcoin BIPs, Nostr NIPs):

- **[DEP-000](specs/deps/DEP-000.md)** — DEP Process (Final)
- **[DEP-001](specs/deps/DEP-001.md)** — Negentropy Set Reconciliation (Draft)
- **[DEP-002](specs/deps/DEP-002.md)** — Peer Exchange for Signaling Server Discovery (Draft)

See [specs/deps/](specs/deps/) for all proposals and submission process.

## Tests

```
200 pass, 0 fail, 10 test files, 502 assertions
├── crypto (19)        — ECDH, AES-GCM, ECDSA, KeyStore
├── integrity (27)     — Hash chains, anti-tampering (7 attack scenarios)
├── workspace (28)     — CRUD, members, channels, DMs, invite codes, sync
├── sync (11)          — Join flow, broadcasting, full sync, tamper rejection
├── vector-clock (17)  — Ordering, merge, concurrent detection
├── crdt (13)          — G-Set properties, offline merge, 3-peer scenarios
├── merkle (15)        — Tree building, diff, bidirectional sync
├── identity (24)      — Export/import, safety numbers, device linking, QR
├── seed-phrase (19)   — BIP39 mnemonic, deterministic derivation, full flow
└── persistence (27)   — IndexedDB, offline queue, restart survival
```

## License

MIT
