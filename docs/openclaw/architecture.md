# Architecture

## High-level components

1. **OpenClaw plugin entry**
   - `decent-openclaw/index.ts`
   - Registers channel plugin and stores runtime handle (`setDecentChatRuntime`)

2. **Channel adapter layer**
   - `decent-openclaw/src/channel.ts`
   - Defines channel capabilities, config resolution, policy hooks, outbound send contract, and gateway lifecycle

3. **Relay/runtime bridge**
   - `decent-openclaw/src/monitor.ts`
   - Converts inbound DecentChat messages into OpenClaw context, dispatches agent reply, relays streaming/final output

4. **Peer runtime**
   - `decent-openclaw/src/peer/NodeXenaPeer.ts`
   - Long-lived DecentChat peer: transport, sync, crypto envelope handling, retries/queues, persistence and media fetch

5. **Crypto protocol adapter**
   - `decent-openclaw/src/peer/NodeMessageProtocol.ts`
   - Handshake management, per-peer ratchet state, encrypt/decrypt, signature verify, state persistence hooks

6. **Persistence backend**
   - `decent-openclaw/src/peer/FileStore.ts`
   - JSON-file KV store under configured `dataDir`

## Runtime lifecycle

- OpenClaw starts channel account via `gateway.startAccount` (`src/channel.ts`)
- `startDecentChatPeer` validates seed and starts `NodeXenaPeer`
- `NodeXenaPeer.start`:
  - derives keys + `peerId`
  - initializes `NodeMessageProtocol`
  - restores workspaces/messages
  - initializes PeerTransport with merged signaling server list
  - binds message/connect/disconnect/error handlers
  - starts maintenance reconnect loop
  - processes invite auto-join retries
- Active peer is placed in singleton registry (`src/peer-registry.ts`) for outbound send path

## Inbound architecture boundary

- Transport payloads are handled in `NodeXenaPeer.handlePeerMessage`
- Supported control/data types include:
  - `handshake`, `name-announce`, `workspace-sync`, `ack`, `read`
  - media request/response/chunk
  - encrypted payload envelopes (legacy + ratchet)
- Normalized inbound message is emitted to `onIncomingMessage` callback
- Callback enters `relayInboundMessageToPeer` (`monitor.ts`)

## Outbound architecture boundary

- OpenClaw outbound channel API (`sendText`) calls active peer methods:
  - `sendToChannel(...)`
  - `sendDirectToPeer(...)`
- Encrypted envelopes are generated in `NodeMessageProtocol.encryptMessage`
- If recipient offline, payload persisted to offline queue and flushed on reconnect/handshake

## Persistence model

Stored via `FileStore`:

- workspaces (`workspaces`)
- peer public keys (`peer-public-keys`)
- peer aliases (`peer-alias-*`)
- ratchet states (`ratchet-*`)
- channel messages (`messages-*`)
- offline queue (`offline-queue-*`, `offline-queue-seq`)
- pending acks (`pending-ack-*`)
- pending read receipts (`pending-read-*`)
- full media cache (`media-full:*`, `media-chunk:*`, `attachment-meta:*`)

## Integration constraints / caveats

- Global singleton peer (`getActivePeer`) implies one active DecentChat peer instance per process
- Multiple account IDs are not meaningfully implemented (`listAccountIds` returns default only)
- `openclaw.plugin.json` metadata lags runtime schema in `src/channel.ts`
