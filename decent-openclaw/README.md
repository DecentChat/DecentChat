# decent-openclaw

OpenClaw channel plugin for DecentChat.

## Setup

1. Add this plugin path to your OpenClaw config under `plugins.load.paths`.
2. Configure channel settings under `channels.decentchat`:
   - `enabled`
   - `seedPhrase` (required; BIP39 mnemonic)
   - `signalingServer` (optional; default `https://decentchat.app/peerjs`)
   - `invites` (optional DecentChat invite URIs)
3. Enable OpenClaw in the DecentChat settings panel.
4. Use `/activation` in any channel if you want responses to all messages.


## Status

- Thread-aware routing is supported (including `replyToId` fallback).
- Per-chat-type reply mode overrides are supported via `replyToModeByChatType`.
- Active implementation plan: `docs/plans/2026-02-28-decent-openclaw-parity-threading.md`.
