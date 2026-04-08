# DecentChat

> Serverless, encrypted, peer-to-peer chat — like email, anyone can build a client.

**[→ Try it live at decentchat.app](https://decentchat.app)**

Inspired by **Bitcoin** (seed phrase identity, no central authority), **BitTorrent** (decentralized mesh, no servers), and **Signal Protocol** (E2E encryption, safety numbers, forward secrecy).

Instead of Bitcoin's Proof of Work, DecentChat achieves consensus through **CRDTs** (Conflict-free Replicated Data Types) — a mathematical guarantee that all peers converge to the same state without mining, voting, or coordination. Combined with **vector clocks** for causal ordering and **Negentropy set reconciliation** for efficient sync, peers can go offline, diverge, and merge back seamlessly. No energy wasted, no blocks to wait for — just eventual consistency by design.

## AI Agent Integrations

Connect your AI agent to DecentChat so it can read and reply to messages in your workspaces.

| Integration | Platform | Install |
|-------------|----------|---------|
| [decent-openclaw](decent-openclaw/README.md) | [OpenClaw](https://openclaw.ai) | `openclaw plugins install @decentchat/decentchat-plugin` |
| [decent-hermes](decent-hermes/README.md) | [Hermes Agent](https://github.com/NousResearch/hermes-agent) | See README |

### Let your agent install itself

Both integrations are written so an AI agent can follow the instructions and install itself into your workspace. Just share the README link with your agent:

**For OpenClaw agents** — paste or link to [`decent-openclaw/README.md`](decent-openclaw/README.md) and say:
> "Follow these instructions to connect yourself to my DecentChat workspace."

**For Hermes agents** — paste or link to [`decent-hermes/README.md`](decent-hermes/README.md) and say:
> "Follow these instructions to connect yourself to my DecentChat workspace."

Your agent will walk through setup, generate its own seed phrase, apply the necessary configuration, ask you for an invite URL to your workspace, join it, and verify everything is working before it finishes.

---

## What is this?

A protocol + reference client for P2P messaging over WebRTC. No servers, no accounts, no tracking. Your identity is a cryptographic key pair, recoverable from a 12-word seed phrase — like a Bitcoin wallet, but for communication.

## Architecture

```
decent-protocol/          ← SDK (npm package, zero deps)
  ├── crypto/           ← ECDH P-256, AES-GCM-256, ECDSA signing
  ├── messages/         ← MessageStore (hash chains), OfflineQueue
  ├── workspace/        ← Workspaces, channels, DMs, sync protocol
  ├── crdt/             ← VectorClock, MessageCRDT (G-Set), Negentropy
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
- **Efficient sync** — Negentropy set reconciliation (minimal delta exchange)
- **Persistent** — IndexedDB survives refresh/restart
- **NAT traversal** — STUN + TURN servers with retry
- **PWA** — Installable on mobile, works offline

## Quick Start

```bash
bun install

# Run tests
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

## Local Perf + Integrity Runner

Run local peer simulation scenarios (no CI required):

```bash
# Baseline: all peers online
bun run perf:smoke

# Chaos: subset offline, then reconnect + queue flush
bun run perf:reconnect
```

CLI flags (runner: `decent-protocol/tests/perf/run.ts`):

- `--peers=<n>` number of simulated peers (default: `5`)
- `--scenario=smoke|reconnect-chaos` scenario selection
- `--check-integrity` fail process if any integrity check fails

Report output: `artifacts/perf-report.json`

Integrity checks cover message/history, workspace, thread, persistence, and offline queue consistency.

## Documentation

- Docs site: [`docs/`](docs/)
- Run locally: `bun run docs:dev`
- Protocol specifications: [`decent-protocol/spec/`](decent-protocol/spec/)
- DEP process and proposals: [`specs/deps/`](specs/deps/)

## Specs

Detailed protocol specifications in `decent-protocol/spec/`:
- `PROTOCOL.md` — Architecture overview
- `MESSAGE-FORMAT.md` — JSON schemas for all message types
- `CRYPTO.md` — Cryptographic primitives and flows
- `SYNC.md` — Vector clocks, CRDT properties, Negentropy sync

### DEPs (Decent Enhancement Proposals)

Formal evolution process for the protocol (inspired by Bitcoin BIPs, Nostr NIPs):

- **[DEP-000](specs/deps/DEP-000.md)** — DEP Process
- **[DEP-001](specs/deps/DEP-001.md)** — Negentropy Set Reconciliation
- **[DEP-002](specs/deps/DEP-002.md)** — Peer Exchange for Signaling Server Discovery
- **[DEP-003](specs/deps/DEP-003-derived-peer-id.md)** — Derived Peer ID
- **[DEP-004](specs/deps/DEP-004-heartbeat.md)** — Heartbeat
- **[DEP-005](specs/deps/DEP-005-delivery-ack.md)** — Delivery Acknowledgement
- **[DEP-006](specs/deps/DEP-006-pre-keys.md)** — Pre-Key Bundle (X3DH)
- **[DEP-007](specs/deps/DEP-007-workspace-snapshot.md)** — Workspace Snapshot
- **[DEP-008](specs/deps/DEP-008-gossip.md)** — Gossip Relay
- **[DEP-009](specs/deps/DEP-009-multi-transport.md)** — Multi-Transport
- **[DEP-010](specs/deps/DEP-010-dht.md)** — DHT Peer Discovery
- **[DEP-011](specs/deps/DEP-011-at-rest-encryption.md)** — At-Rest Encryption
- **[DEP-012](specs/deps/DEP-012-reliable-multi-recipient-delivery.md)** — Reliable Multi-Recipient Delivery
- **[DEP-013](specs/deps/DEP-013-workspace-dm-privacy.md)** — Workspace DM Privacy
- **[DEP-014](specs/deps/DEP-014-adaptive-public-workspaces.md)** — Adaptive Public Workspaces
- **[DEP-015](specs/deps/DEP-015-public-channel-delivery.md)** — Public Channel Delivery
- **[DEP-016](specs/deps/DEP-016-mobile-client-ios.md)** — Mobile Client (iOS)

See [specs/deps/](specs/deps/) for the full list and submission process.

## Tests

```
1394 pass, 0 fail — 94 test files
├── crypto              — ECDH, AES-GCM, ECDSA, KeyStore
├── integrity           — Hash chains, anti-tampering, attack scenarios
├── workspace           — CRUD, members, channels, DMs, invite codes, sync
├── sync                — Join flow, broadcasting, full sync, tamper rejection
├── vector-clock        — Ordering, merge, concurrent detection
├── crdt                — G-Set properties, offline merge, 3-peer scenarios
├── negentropy          — Set reconciliation, diff, bidirectional sync
├── identity            — Export/import, safety numbers, device linking, QR
├── seed-phrase         — BIP39 mnemonic, deterministic derivation, full flow
├── persistence         — IndexedDB, offline queue, restart survival
└── security            — Encryption edge cases, ban persistence, clock skew
```

## Support / Sponsorship

If DecentChat is useful to you and you want to help fund development, protocol work, and infrastructure, donations are welcome:

- **Bitcoin (BTC):** `bc1qj7rf9vc0nvk8maux6gc6dwzpelj2d3ck0krlm7`
- **Litecoin (LTC):** `ltc1qjhsl7eztls8l557vrtmhlm4g86hlql2qq4x5jz`
- **Ethereum (ETH):** `0x33e98006401fE7298a255f5890380403e57cdf67`
- **Monero (XMR):** `42uEmNUt3Jp5qNpP8sg2rQf45eNEthvMadZutxT6z2eR3opSZepkN93cQ5wxdstyA2MfkyRjB93tgis6a5DBhqgh3u8PnZh`
- **Zcash (ZEC):** `u1deqeprze5jdwz2ywmr3q9kmgdf4vel5shr8jeamm9upvrjlc08yqx55a0w2zq2kggaa4e7ctymw3nthqdv329l6vygypqd9228r9628y70anfk78mj9tld4hrjsh9zrlq7ekth6q23zhjlw7tsdrvsvcx53ggsclmuk6q7wl3cht9m5p`

## License

MIT
