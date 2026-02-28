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


## Config migration (threading parity)

If you are upgrading from pre-parity config, migrate from global-only reply mode to explicit chat-type/thread settings.

Before:

```yaml
channels:
  decentchat:
    enabled: true
    replyToMode: all
```

After:

```yaml
channels:
  decentchat:
    enabled: true
    replyToMode: all
    replyToModeByChatType:
      direct: off
      group: all
      channel: all
    thread:
      historyScope: thread
      inheritParent: false
      initialHistoryLimit: 10
```

## Feature flags and safe defaults

Recommended safe defaults:

- `replyToMode: all`
- `replyToModeByChatType.direct: off`
- `thread.historyScope: thread`
- `thread.initialHistoryLimit: 10`

Fast safety toggles if behavior is noisy:

- Disable thread splitting entirely:
  - `replyToMode: off`
- Keep channel-wide session history (no per-thread split):
  - `thread.historyScope: channel`
- Disable bootstrap thread-context prefill:
  - `thread.initialHistoryLimit: 0`

## Rollback checklist

1. Revert to previous known-good commit.
2. Set conservative config:

```yaml
channels:
  decentchat:
    replyToMode: off
    thread:
      historyScope: channel
      initialHistoryLimit: 0
```

3. Restart OpenClaw runtime.
4. Validate route logs and one direct + one group reply path.
5. Re-enable features gradually (`replyToMode`, then `historyScope`, then `initialHistoryLimit`).
