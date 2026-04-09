# @decentchat/hermes-bridge

[Hermes Agent](https://github.com/NousResearch/hermes-agent) integration for [DecentChat](https://decentchat.app) — P2P encrypted chat over WebRTC.

Lets your Hermes agent send and receive messages on DecentChat workspaces, with optional voice (speech-to-text in, text-to-speech out via huddle calls).

---

## AI-assisted setup

You can hand this README directly to your AI agent and it will install everything for you.

**How:** Copy the URL of this page (or paste its contents) into a chat with your Hermes agent and say:

> "Follow the instructions in this README to install the DecentChat bridge for yourself."

The agent will walk through each step below, ask you for the things it needs (seed phrase, invite URL), install the bridge, and verify it joined your workspace before finishing.

---

## Prerequisites

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) installed and running
- [Node.js](https://nodejs.org) ≥ 18
- [Bun](https://bun.sh) (for rebuilding the bridge from source)
- macOS or Linux

---

## Install

Fastest path for other users:

```bash
npm install -g @decentchat/hermes-bridge
```

That gives you the `decent-hermes-bridge` binary plus the bundled `hermes-patch/` files needed to install the Hermes adapter.

If you're developing from the monorepo instead, use the local workspace version as described below.

### Step 1 — Generate a seed phrase

Your agent's DecentChat identity is a 12-word seed phrase. Generate one:

```bash
cd ~/Projects/decent-chat  # or wherever the decent-chat monorepo lives
bun -e "import { SeedPhraseManager } from './decent-protocol/src/index.ts'; const m = new SeedPhraseManager(); const { mnemonic } = m.generate(); console.log(mnemonic);"
```

**Save the output.** This is your agent's permanent identity — treat it like a password. If you lose it you lose the identity.

> **Agent note:** Ask the user if they want to generate a new seed phrase or provide an existing one. If generating, run the command above and show it to the user. Store it in 1Password or their preferred secret manager. Do not store it in plain text files.

### Step 2 — Apply the Hermes adapter patch

The DecentChat adapter for Hermes ships as a patch that installs into hermes-agent and auto-reapplies after Hermes updates.

```bash
# If installed from npm:
BRIDGE_PKG_DIR="$(npm root -g)/@decentchat/hermes-bridge"

# One-time setup — copies the patch, bridge bundle, and installs a launchd watcher
bash "$BRIDGE_PKG_DIR/hermes-patch/apply.sh"

# If developing from the monorepo instead, use:
# bash ~/Projects/decent-chat/decent-hermes/hermes-patch/apply.sh
```

This script:
- Patches `~/.hermes/hermes-agent` with the DecentChat platform adapter (7 files)
- Copies the compiled bridge bundle to `~/.hermes/hermes-agent/scripts/decentchat-bridge/`
- Is idempotent — safe to run multiple times

To survive Hermes auto-updates, also install the launchd watcher (macOS):

```bash
cp "$BRIDGE_PKG_DIR/hermes-patch/com.decenthermes.patch.plist" \
   ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.decenthermes.patch.plist
```

> **Agent note:** Run `apply.sh` first. Then check if the launchd agent is already loaded with `launchctl list | grep decenthermes`. If not, install it.

### Step 3 — Configure Hermes

Add the `decentchat` platform to `~/.hermes/config.yaml`:

```yaml
platforms:
  decentchat:
    enabled: true
    seed_phrase: "your twelve word seed phrase here"
    alias: "Your Bot Name"
    signaling_server: https://0.peerjs.com/
    invites: []        # fill in after getting an invite URL — see Step 4
    data_dir: /Users/yourname/.hermes/decentchat/data   # use absolute path, not ~/...
```

> **Note:** Use an absolute path for `data_dir` — `~` is not expanded by the adapter. Replace `/Users/yourname` with your actual home directory (`echo $HOME`).

Also enable the `api_server` platform so voice transcription has an endpoint to call back to:

```yaml
  api_server:
    enabled: true
    port: 8642
```

> **Agent note:** Edit `~/.hermes/config.yaml` to add both blocks. Use the seed phrase generated in Step 1. Set `alias` to something recognisable in the workspace (e.g. the agent's name). Leave `invites` empty for now — you will fill it in Step 4.

### Step 4 — Get an invite URL and join a workspace

Ask the user for a DecentChat workspace invite URL. They can get it from the DecentChat web client at [decentchat.app](https://decentchat.app) by opening a workspace → Settings → Invite.

Invite URLs look like: `decent://invite/...`

Once you have the invite URL:

1. Add it to the `invites` list in `~/.hermes/config.yaml`:
   ```yaml
   invites:
     - "decent://invite/..."
   ```

2. Start the bridge to trigger the join:
   ```bash
   node ~/.hermes/hermes-agent/scripts/decentchat-bridge/bridge.js \
     --port 3099 \
     --seed-phrase "your twelve word seed phrase" \
     --alias "Your Bot Name" \
     --invites "decent://invite/..." \
     --no-huddle \
     > /tmp/dc-join-test.log 2>&1 &
   BRIDGE_PID=$!
   sleep 5
   curl -s http://127.0.0.1:3099/health
   kill $BRIDGE_PID
   ```

3. The `/health` endpoint should return `{"status":"connected","connected":true}`.

> **Agent note:** Ask the user: "Please share the DecentChat invite URL for the workspace you want me to join. You can find it in the DecentChat web client under workspace Settings → Invite." Then follow the steps above. Verify the health response shows `connected: true` before continuing.

### Step 5 — Allow DecentChat users in Hermes

Add this to `~/.hermes/.env` so the gateway accepts messages from DecentChat peers:

```
DECENTCHAT_ALLOW_ALL_USERS=true
```

DecentChat access is already gated by workspace invites, so `allow_all` is safe here. Alternatively set `DECENTCHAT_ALLOWED_USERS=peer_id1,peer_id2` to restrict to specific peer IDs.

> **Agent note:** Run `echo "DECENTCHAT_ALLOW_ALL_USERS=true" >> ~/.hermes/.env`. Without this, all incoming DecentChat messages are silently dropped.

### Step 6 — Restart Hermes gateway

Restart the Hermes gateway to pick up the new platform:

```bash
hermes gateway restart
# or if running as a service:
# launchctl kickstart -k gui/$(id -u)/com.hermes.gateway
```

### Step 7 — Verify

> **Note on historical messages:** On first connection, the bridge pulls message history from peers but only surfaces messages sent *after* the bridge started. This prevents the agent from being flooded with old conversation context on startup. Previous messages are stored locally and used as context, but won't trigger new agent responses.

### Step 8 — Verify (original Step 6)

Start the bridge manually (the gateway starts it automatically, but for a quick check):

```bash
node ~/.hermes/hermes-agent/scripts/decentchat-bridge/bridge.js \
  --port 3099 \
  --seed-phrase "your twelve word seed phrase" \
  --alias "Your Bot Name" \
  --no-huddle &
sleep 3
curl -s http://127.0.0.1:3099/health
# Expected: {"status":"connected","connected":true,"alias":"Your Bot Name"}
kill %1
```

Then send a message to the bot from the DecentChat web client. It should respond.

> **Agent note:** Run the health check and confirm `connected: true`. Then ask the user to send a test message to the bot in DecentChat and confirm a response arrived. If no response, check `~/.hermes/logs/decentchat-patch.log` and the gateway logs.

---

## Configuration reference

| Key | Default | Description |
|-----|---------|-------------|
| `seed_phrase` | required | 12-word BIP39 mnemonic (DecentChat-specific checksum) |
| `alias` | `Hermes Agent` | Display name in DecentChat |
| `signaling_server` | `https://0.peerjs.com/` | PeerJS signaling server |
| `invites` | `[]` | Invite URLs to auto-join on startup |
| `data_dir` | `~/.hermes/decentchat/data` | Peer state and message storage |
| `bridge_port` | `3001` | Local HTTP port for the bridge process |
| `bridge_script` | bundled | Path to `bridge.js` (override if using npm install) |

### Voice (huddle) settings

Enable voice calls — the bridge transcribes speech to text (via Whisper or cloud STT), sends it through the Hermes agent, and speaks the reply back using TTS.

```yaml
platforms:
  decentchat:
    enabled: true
    seed_phrase: "..."
    stt_engine: whisper-cpp        # whisper-cpp | openai | groq | gemini
    tts_engine: elevenlabs         # elevenlabs | gemini
    tts_api_key: "your-tts-api-key"   # pragma: allowlist secret
    tts_voice: "EXAVITQu4vr4xnSDxMaL"   # ElevenLabs voice ID
    # stt_api_key only needed for cloud STT (openai/groq/gemini)  # pragma: allowlist secret
```

For voice to work you also need the `api_server` platform enabled (it's the callback endpoint for voice transcription replies).

---

## How the patch works

The bridge is a standalone Node.js process that connects to the DecentChat P2P network via WebRTC. It exposes a local HTTP API on port 3001. The Hermes gateway adapter polls this API for inbound messages and forwards replies.

The Hermes adapter is distributed as a git patch (`decentchat.patch`) rather than a PR to upstream Hermes — this keeps the integration independent and self-maintained. A launchd agent watches the Hermes git ref and re-applies the patch automatically after each Hermes update.

Patch location: `~/.hermes/decent-hermes-patch/`
Log: `~/.hermes/logs/decentchat-patch.log`

---

## Updating the bridge

When you pull a new version of this repo, rebuild and redeploy:

```bash
cd ~/Projects/decent-chat/decent-hermes
bun run build
bash hermes-patch/apply.sh
```

---

## License

MIT
