# @decentchat/protocol

Transport-agnostic protocol SDK for serverless, E2E-encrypted, CRDT-based P2P messaging. This is the core library behind [DecentChat](https://github.com/DecentChat/DecentChat).

No servers required. Peers connect directly, encrypt everything end-to-end, and sync state using CRDTs and vector clocks. The protocol layer has no opinion about how peers find each other or how bytes move between them -- that's the transport's job.

## What's in the box

- **Identity** -- BIP39 seed phrases, deterministic HD key derivation (P-256), device linking, recovery URIs
- **Crypto** -- ECDH + AES-GCM-256 encryption, ECDSA signatures, Double Ratchet (Signal-style forward secrecy), pre-key bundles
- **CRDT + sync** -- Vector clocks, message CRDTs, Negentropy set reconciliation for efficient sync
- **Workspaces** -- Multi-workspace management, channels, DMs, member directories, roles and permissions
- **Messages** -- Persistent message store (IndexedDB), offline queue with replay, custody tracking, delivery receipts
- **Media** -- Chunked file transfer, thumbnails, waveform generation, blob storage abstraction
- **Invites** -- Signed invite URIs with workspace/server metadata
- **Security** -- Rate limiting, message guards, peer authentication, handshake verification

## Install

```
npm install @decentchat/protocol
```

The only runtime dependency is `@noble/curves` for elliptic curve crypto.

## Quick start

```ts
import { SeedPhraseManager, IdentityManager, WorkspaceManager, PersistentStore } from '@decentchat/protocol';

// Generate a new identity from a 12-word seed phrase
const { mnemonic, keys } = await SeedPhraseManager.generate();

// Or restore from an existing phrase
const restored = await SeedPhraseManager.fromMnemonic('your twelve words ...');
```

The SDK is transport-agnostic. To actually connect peers, pair it with a transport implementation like [`@decentchat/transport-webrtc`](https://npmjs.com/package/@decentchat/transport-webrtc).

## Build

```
npm run build    # compiles to dist/ via tsc
npm test         # runs the test suite (bun)
```

Both compiled JS (`dist/`) and raw TypeScript (`src/`) are included in the npm package. Bun users get direct `.ts` imports via the `"bun"` export condition.

## Repository

This package lives in the `decent-protocol/` directory of the [DecentChat monorepo](https://github.com/DecentChat/DecentChat).

## License

MIT
