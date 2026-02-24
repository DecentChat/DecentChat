# Decent OpenClaw Plugin

`decent-openclaw` is a DecentChat channel adapter for OpenClaw. It runs a persistent P2P peer (`NodeXenaPeer`) inside OpenClaw, translates incoming DecentChat messages into OpenClaw inbound context, dispatches replies via OpenClaw runtime, and sends responses back over DecentChat.

## Scope

Package: `decent-openclaw/`

Core code paths:

- Plugin registration: `decent-openclaw/index.ts`
- Channel plugin contract and config schema: `decent-openclaw/src/channel.ts`
- Runtime relay (inbound → OpenClaw → outbound): `decent-openclaw/src/monitor.ts`
- P2P peer implementation: `decent-openclaw/src/peer/NodeXenaPeer.ts`
- Message crypto protocol: `decent-openclaw/src/peer/NodeMessageProtocol.ts`
- Local persistence: `decent-openclaw/src/peer/FileStore.ts`

## Implementation status

Implemented:

- OpenClaw channel registration + account lifecycle
- Seed phrase identity derivation and validation
- WebRTC signaling server selection (with invite-derived server expansion)
- Handshake + encrypted messaging (Double Ratchet with legacy fallback)
- Group + direct messaging
- Reply threading/session mapping controls
- Streaming replies (start/delta/done)
- Offline outbound queue + ack tracking + resend after reconnect
- Read receipt queue + flush after reconnect
- Workspace/message persistence to local file store
- Unit tests for thread/session routing, streaming finalize semantics, URL normalization, seed validation, offline reconnect, and restore flows

Partially implemented / gaps:

- `thread.initialHistoryLimit` is exposed in config schema but currently not applied in runtime flow
- `replyToMode: "first"` is accepted but handled effectively like `"all"` in monitor routing logic
- `openclaw.plugin.json` schema/UI hints are behind `src/channel.ts` (missing newer fields like `streamEnabled`, `replyToMode`, `thread`, `allowFrom`)
- Media chunk integrity hash is TODO (`chunkHash` left empty)
- Single active peer registry (`peer-registry.ts`) is process-global; multi-account/multi-instance behavior is limited

## Documentation map

- [Configuration](./configuration)
- [Architecture](./architecture)
- [Event Flow](./event-flow)
- [Operations & Troubleshooting](./operations)
