# Configuration

The plugin reads configuration from `channels.decentchat` in OpenClaw config.

Primary schema source: `decent-openclaw/src/channel.ts` (`DecentChatConfigSchema`, `resolveDecentChatAccount`).

## Required

### `seedPhrase` (string)

- Required to start peer runtime
- Must be a valid BIP39 mnemonic
- Used to deterministically derive:
  - peer identity (`peerId`)
  - ECDH keypair
  - ECDSA signing keypair
- Validation errors come from:
  - `src/monitor.ts` (`startDecentChatPeer`) and
  - `src/peer/NodeXenaPeer.ts` (`start`)

## Core options

### `enabled` (boolean, default: true)

Whether account is active.

### `signalingServer` (string, default: `https://decentchat.app/peerjs`)

Base PeerJS signaling URL. Additional signaling servers can be discovered from invite URIs and merged/deduplicated at startup (`NodeXenaPeer.start`).

### `invites` (string[])

DecentChat invite URIs auto-joined on startup (with retry/backoff).

### `alias` (string, default: `Xena AI`)

Display name announced to peers (`name-announce`) and attached to sent envelopes.

### `dataDir` (string)

Optional persistence root. Default:

- `~/.openclaw/data/decentchat`

## OpenClaw policy/threading options

### `dmPolicy` (enum)

- `open` | `pairing` | `allowlist` | `disabled`

Resolved through channel security hooks (`src/channel.ts`, `security.resolveDmPolicy`).

### `channels.<groupId>.requireMention` (boolean)

Per-group mention requirement (with `*` wildcard fallback).

### `streamEnabled` (boolean, default: true)

Enables token-level streaming relay to peers (`stream-start` / `stream-delta` / `stream-done`).

### `replyToMode` (enum: `off` | `first` | `all`, default: `all`)

Controls thread routing semantics for inbound replies.

### `thread.historyScope` (`thread` | `channel`, default: `thread`)

When `channel`, thread routing is flattened into base channel session.

### `thread.inheritParent` (boolean, default: false)

When true, thread sessions set `ParentSessionKey` to base channel session.

### `thread.initialHistoryLimit` (number, default: 20)

Currently schema-exposed but not consumed by runtime logic.

## Example

```yaml
channels:
  decentchat:
    enabled: true
    seedPhrase: "word1 word2 ... word12"
    signalingServer: "https://decentchat.app/peerjs"
    invites:
      - "decent://host:443/INVITECODE?secure=1&path=%2F&peer=peer-abc"
    alias: "Xena AI"
    dataDir: "/var/lib/openclaw/decentchat"
    dmPolicy: "pairing"
    allowFrom:
      - "peer-abc"
    streamEnabled: true
    replyToMode: "all"
    thread:
      historyScope: "thread"
      inheritParent: false
      initialHistoryLimit: 20
    channels:
      "*":
        requireMention: true
      "general":
        requireMention: false
```

## Env vars

No dedicated plugin-specific environment variables are used in the current implementation. Runtime behavior is config-driven.
