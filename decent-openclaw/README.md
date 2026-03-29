# @decentchat/decentchat-plugin

OpenClaw channel plugin for [DecentChat](https://github.com/DecentChat/DecentChat) -- peer-to-peer encrypted chat over WebRTC.

Connects your OpenClaw agent to DecentChat workspaces so it can read and reply to messages in channels, groups, DMs, and threads.

## Install

```
openclaw plugins install @decentchat/decentchat-plugin
```

## Configure

The quickest way to set up is with the interactive wizard:

```
openclaw configure
```

Select **DecentChat** when prompted. The wizard will:

1. Offer to generate a new 12-word seed phrase (or let you paste an existing one)
2. Ask for a display name
3. Ask for an invite URL to join a workspace

You can also set the seed phrase via the `DECENTCHAT_SEED_PHRASE` environment variable instead of storing it in the config file.

### Manual configuration

If you prefer to edit the config directly, add a `channels.decentchat` block to your OpenClaw config (`~/.openclaw/openclaw.json` or per-project):

```yaml
channels:
  decentchat:
    enabled: true
    seedPhrase: "your twelve word BIP39 mnemonic goes here ..."
```

That's the minimum. The bot will join the DecentChat network using the default signaling server (`https://0.peerjs.com/`), respond to all messages, and call itself "DecentChat Bot".

### Optional settings

| Key | Default | What it does |
|-----|---------|-------------|
| `signalingServer` | `https://0.peerjs.com/` | PeerJS signaling endpoint |
| `invites` | `[]` | DecentChat invite URIs to auto-join |
| `alias` | `"DecentChat Bot"` | Display name for the bot |
| `dataDir` | auto | Override the data directory |
| `dmPolicy` | `"open"` | DM access: `open`, `pairing`, `allowlist`, or `disabled` |
| `streamEnabled` | `true` | Stream responses token-by-token |
| `replyToMode` | `"all"` | Reply behavior: `off`, `first`, or `all` |

### Reply mode per chat type

You can override `replyToMode` for specific chat types:

```yaml
channels:
  decentchat:
    enabled: true
    seedPhrase: "..."
    replyToMode: all
    replyToModeByChatType:
      direct: "off"
      group: "all"
      channel: "all"
```

### Thread settings

```yaml
channels:
  decentchat:
    thread:
      historyScope: "thread"     # "thread" or "channel"
      inheritParent: false
      initialHistoryLimit: 20
```

- `historyScope: thread` -- the bot only sees messages in the current thread (not the full channel history)
- `inheritParent: false` -- don't prepend the parent message to thread context
- `initialHistoryLimit` -- how many prior thread messages to load for context

### Huddle (voice) settings

```yaml
channels:
  decentchat:
    huddle:
      enabled: true
      autoJoin: false
      sttEngine: "whisper-cpp"    # whisper-cpp | whisper-python | openai | groq
      whisperModel: "base.en"
      sttLanguage: "en"
      ttsVoice: "alloy"
      vadSilenceMs: 800
      vadThreshold: 0.5
```

### Company simulation

The plugin includes a company simulation subsystem (`@decentchat/company-sim`) that lets you run multi-agent teams inside DecentChat workspaces. Configure it per-account:

```yaml
channels:
  decentchat:
    companySim:
      enabled: true
      manifestPath: "./company-manifest.yaml"
      companyId: "acme"
      employeeId: "bot-1"
    companySimBootstrap:
      enabled: true
      mode: "runtime"
```

### Multiple accounts

Run multiple bot identities from one OpenClaw instance:

```yaml
channels:
  decentchat:
    defaultAccount: "main"
    accounts:
      main:
        seedPhrase: "first mnemonic ..."
        alias: "Bot A"
      secondary:
        seedPhrase: "second mnemonic ..."
        alias: "Bot B"
        dmPolicy: "disabled"
```

Each account gets its own peer connection and data directory.

## Quick safety toggles

If the bot is too chatty:

```yaml
# Shut off all replies
replyToMode: "off"

# Keep replies but use full channel history (no per-thread split)
thread:
  historyScope: "channel"

# Disable thread context prefill
thread:
  initialHistoryLimit: 0
```

## How it works

The plugin creates a DecentChat peer (using `@decentchat/protocol` and `@decentchat/transport-webrtc`) that joins the P2P mesh. Incoming messages are routed through OpenClaw's agent pipeline. Responses are sent back to the originating chat, with thread-aware routing so replies land in the right thread.

All traffic is end-to-end encrypted (ECDH + AES-GCM-256). The bot's identity is derived from the seed phrase, same as any other DecentChat client.

## Dependencies

- [@decentchat/protocol](https://npmjs.com/package/@decentchat/protocol) -- DecentChat SDK
- [@decentchat/transport-webrtc](https://npmjs.com/package/@decentchat/transport-webrtc) -- WebRTC transport layer
- [@decentchat/company-sim](https://npmjs.com/package/@decentchat/company-sim) -- company simulation subsystem
- [openclaw](https://openclaw.ai) -- peer dependency (the host runtime)

## License

MIT
