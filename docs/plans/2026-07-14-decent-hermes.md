# decent-hermes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add DecentChat as a native Hermes gateway platform so Hermes agents can send and receive messages over the DecentChat P2P network, using the same bridge-subprocess pattern as the existing WhatsApp adapter.

**Architecture:** A TypeScript bridge daemon (`decent-hermes/`) lives in the `decent-chat` monorepo, compiled to a standalone `dist/bridge.js`, and exposes a local HTTP API. A new Python adapter (`gateway/platforms/decentchat.py`) in hermes-agent spawns the bridge subprocess, polls for inbound messages, and routes them through the Hermes gateway loop — mirroring exactly how `scripts/whatsapp-bridge/` + `gateway/platforms/whatsapp.py` works today.

**Tech Stack:** `@decentchat/protocol`, `@decentchat/transport-webrtc`, `node-datachannel` (native binary), `express`, `bun build` (compile bridge), Python `aiohttp` + `asyncio` (adapter), hermes `BasePlatformAdapter`.

**Key Paths:**
- Bridge source: `~/Projects/decent-chat/decent-hermes/`
- Bridge compiled output: `~/Projects/decent-chat/decent-hermes/dist/bridge.js`
- Hermes adapter: `~/.hermes/hermes-agent/gateway/platforms/decentchat.py`
- Hermes agent repo: `~/.hermes/hermes-agent/`
- Reference — existing WhatsApp bridge: `~/.hermes/hermes-agent/scripts/whatsapp-bridge/bridge.js`
- Reference — existing WA adapter: `~/.hermes/hermes-agent/gateway/platforms/whatsapp.py`
- Reference — peer runtime: `~/Projects/decent-chat/decent-openclaw/src/peer/`

**Bridge HTTP API (port 3001 default):**
```
GET  /health                 → { status: "ok"|"connecting"|"error", connected: bool, alias: string }
GET  /messages               → long-poll up to 20s, returns [] or [{ id, chatId, senderId, senderAlias, body, timestamp, chatType, isGroup, workspaceId }]
POST /send                   → { chatId, body, replyTo? }  →  { success, messageId? }
GET  /chat/:chatId            → { name, type, chat_id }
```

**Chat ID format:** `{workspaceId}:{channelId}` for group/channel chats, `{workspaceId}:dm:{contactPublicKeyHash}` for DMs. The Python adapter uses these as opaque strings.

---

## Part A — Bridge (`decent-hermes/` in the monorepo)

### Task 1: Scaffold `decent-hermes/` package

**Files:**
- Create: `decent-chat/decent-hermes/package.json`
- Create: `decent-chat/decent-hermes/tsconfig.json`
- Create: `decent-chat/decent-hermes/postinstall.cjs`
- Modify: `decent-chat/package.json` — add `decent-hermes` to workspaces

**Steps:**

1. Create `decent-hermes/package.json`:
```json
{
  "name": "@decentchat/hermes-bridge",
  "version": "0.1.0",
  "description": "DecentChat P2P bridge daemon for Hermes Agent",
  "type": "module",
  "scripts": {
    "build": "bun build src/bridge.ts --outfile dist/bridge.js --target node --minify",
    "dev": "bun run src/bridge.ts",
    "postinstall": "node postinstall.cjs",
    "test": "bun test tests/"
  },
  "files": ["dist", "postinstall.cjs"],
  "bin": { "decent-hermes-bridge": "dist/bridge.js" },
  "dependencies": {
    "@decentchat/protocol": "workspace:^",
    "@decentchat/transport-webrtc": "workspace:^",
    "better-sqlite3": "^12.8.0",
    "express": "^4.21.0",
    "node-datachannel": "^0.32.1",
    "yaml": "^2.8.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/express": "^5.0.0"
  },
  "publishConfig": { "access": "public" },
  "license": "MIT"
}
```

2. Copy `decent-openclaw/postinstall.cjs` → `decent-hermes/postinstall.cjs` (same node-datachannel check, update display name).

3. Create `decent-hermes/tsconfig.json`:
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["src/**/*"]
}
```

4. Add `"decent-hermes"` to the root `package.json` workspaces array.

5. Run `bun install` from monorepo root to link the workspace.

**Verify:** `bun install` exits 0, `ls decent-hermes/node_modules/@decentchat/protocol` resolves.

---

### Task 2: Peer bootstrap helpers

**Files:**
- Create: `decent-hermes/src/polyfill.ts`
- Create: `decent-hermes/src/peer.ts`

**Steps:**

1. Copy `decent-openclaw/src/peer/polyfill.ts` → `decent-hermes/src/polyfill.ts` verbatim (installs `RTCPeerConnection` globals from `node-datachannel`).

2. Create `decent-hermes/src/peer.ts` — a slimmed-down peer runtime (no company-sim, no huddle). Adapt from `decent-openclaw/src/peer/DecentChatNodePeer.ts`. Expose:
```typescript
export interface BridgeConfig {
  seedPhrase: string;
  signalingServer?: string;
  dataDir: string;
  alias?: string;
  invites?: string[];
}

export interface IncomingMessage {
  id: string;
  chatId: string;       // "{workspaceId}:{channelId}" or "{workspaceId}:dm:{hash}"
  senderId: string;
  senderAlias: string;
  body: string;
  timestamp: number;
  chatType: 'direct' | 'channel';
  isGroup: boolean;
  workspaceId: string;
}

export class DecentHermesPeer {
  constructor(config: BridgeConfig) { ... }
  async start(): Promise<void>
  async stop(): Promise<void>
  isConnected(): boolean
  drainMessages(): IncomingMessage[]     // take & clear buffered messages
  async sendMessage(chatId: string, body: string): Promise<string>  // returns messageId
  async getChatInfo(chatId: string): Promise<{ name: string; type: string; chat_id: string }>
}
```

3. Write a unit test `decent-hermes/tests/peer-config.test.ts` that constructs a `DecentHermesPeer` with a mock config and verifies it doesn't throw.

4. Run `bun test tests/peer-config.test.ts` — should pass.

**Verify:** `bun run --cwd decent-hermes bun test tests/peer-config.test.ts` exits 0.

---

### Task 3: HTTP bridge server

**Files:**
- Create: `decent-hermes/src/bridge.ts`

**Steps:**

1. Create `decent-hermes/src/bridge.ts` — the main entry point:

```typescript
// MUST be first — installs RTCPeerConnection globals
import './polyfill.js';

import express from 'express';
import { DecentHermesPeer } from './peer.js';

// Parse CLI args
function getArg(name: string, def: string): string { ... }
const PORT = parseInt(getArg('port', '3001'), 10);
const DATA_DIR = getArg('data-dir', `${process.env.HOME}/.hermes/decentchat/data`);
const SEED_PHRASE = getArg('seed-phrase', process.env.DECENTCHAT_SEED_PHRASE ?? '');
const ALIAS = getArg('alias', process.env.DECENTCHAT_ALIAS ?? 'Hermes Agent');
const SIGNALING = getArg('signaling-server', 'https://0.peerjs.com/');
const INVITES = getArg('invites', '').split(',').filter(Boolean);

const app = express();
app.use(express.json());

const peer = new DecentHermesPeer({ seedPhrase: SEED_PHRASE, signalingServer: SIGNALING, dataDir: DATA_DIR, alias: ALIAS, invites: INVITES });

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: peer.isConnected() ? 'connected' : 'connecting', connected: peer.isConnected(), alias: ALIAS });
});

// GET /messages — long-poll up to 20s
app.get('/messages', async (req, res) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const msgs = peer.drainMessages();
    if (msgs.length > 0) return res.json(msgs);
    await new Promise(r => setTimeout(r, 500));
  }
  res.json([]);
});

// POST /send
app.post('/send', async (req, res) => {
  const { chatId, body } = req.body;
  try {
    const messageId = await peer.sendMessage(chatId, body);
    res.json({ success: true, messageId });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /chat/:chatId
app.get('/chat/:chatId', async (req, res) => {
  try {
    const info = await peer.getChatInfo(req.params.chatId);
    res.json(info);
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

peer.start().catch(e => { console.error('Peer start failed:', e); process.exit(1); });
app.listen(PORT, '127.0.0.1', () => console.log(`decent-hermes-bridge listening on 127.0.0.1:${PORT}`));
```

2. Test manually: `bun run src/bridge.ts --port 3001 --seed-phrase "test test ..."` → health endpoint returns `{ status: "connecting" }`.

3. Write `tests/bridge-http.test.ts` — starts bridge with a mock/stub peer, hits `/health` and `/messages`, asserts response shapes.

4. Run `bun test tests/bridge-http.test.ts` — pass.

**Verify:** `curl http://127.0.0.1:3001/health` returns JSON.

---

### Task 4: Build & compile bridge

**Files:**
- Modify: `decent-hermes/package.json` (already has build script from Task 1)

**Steps:**

1. Run `bun run build` from `decent-hermes/`:
```bash
cd ~/Projects/decent-chat/decent-hermes
bun build src/bridge.ts --outfile dist/bridge.js --target node
```

2. Verify output: `ls -lh dist/bridge.js` — should be a single JS file.

3. Test the compiled output:
```bash
node dist/bridge.js --port 3099 --seed-phrase "abandon abandon ..." &
curl http://127.0.0.1:3099/health
kill %1
```

4. Add `dist/` to `.gitignore` if not already there. Add a `npm run build` to CI.

**Verify:** `node dist/bridge.js --help 2>&1 || curl http://127.0.0.1:3099/health` — exits clean.

---

## Part B — Hermes Adapter

### Task 5: Add `DECENTCHAT` to Platform enum

**Files:**
- Modify: `~/.hermes/hermes-agent/gateway/config.py`

**Steps:**

1. Add to `Platform` enum (alphabetical position):
```python
DECENTCHAT = "decentchat"
```

2. Add env-var override in `_apply_env_overrides()` (after the WhatsApp block):
```python
# DecentChat
dc_seed = os.getenv("DECENTCHAT_SEED_PHRASE")
if dc_seed:
    if Platform.DECENTCHAT not in config.platforms:
        config.platforms[Platform.DECENTCHAT] = PlatformConfig()
    config.platforms[Platform.DECENTCHAT].enabled = True
    config.platforms[Platform.DECENTCHAT].extra["seed_phrase"] = dc_seed
```

3. Update `get_connected_platforms()` to treat DecentChat like WhatsApp (enabled flag, not token):
```python
if platform == Platform.DECENTCHAT:
    return pconfig.enabled
```

4. Run existing gateway config tests:
```bash
cd ~/.hermes/hermes-agent && source venv/bin/activate
python -m pytest tests/gateway/test_config.py -q
```

**Verify:** All existing tests pass; `Platform.DECENTCHAT` accessible.

---

### Task 6: Implement `gateway/platforms/decentchat.py`

**Files:**
- Create: `~/.hermes/hermes-agent/gateway/platforms/decentchat.py`

**Steps:**

1. Use `whatsapp.py` as the structural template. Key differences:
   - No QR code / pairing flow (seed phrase = identity, no interactive auth)
   - Bridge args: `--port`, `--data-dir`, `--seed-phrase`, `--alias`, `--signaling-server`, `--invites`
   - Default bridge port: `3001` (not `3000`)
   - Default bridge script: `{hermes_home}/scripts/decentchat-bridge/bridge.js`
   - Session lock key: `"decentchat-session"`

2. `check_decentchat_requirements()` — check `node --version`.

3. `DecentChatAdapter(BasePlatformAdapter)`:
   - `__init__`: parse `config.extra` for `seed_phrase`, `bridge_port` (default 3001), `bridge_script`, `signaling_server`, `alias`, `invites`, `data_dir`
   - `connect()`: launch bridge subprocess with the above args, wait for `/health` to return `connected`
   - `disconnect()`: kill bridge process group
   - `_poll_messages()`: `GET /messages` long-poll loop → emit `handle_message(event)` for each
   - `send(chat_id, text)`: `POST /send`
   - `send_typing(chat_id)`: no-op (P2P has no typing indicator in v1)
   - `send_image(chat_id, url, caption)`: download image, send caption+path via `POST /send` (text fallback in v1)
   - `get_chat_info(chat_id)`: `GET /chat/{chat_id}`

4. Message event mapping — from bridge JSON to `MessageEvent`:
```python
MessageEvent(
    message_id=data["id"],
    chat_id=data["chatId"],
    sender_id=data["senderId"],
    sender_name=data.get("senderAlias", ""),
    text=data["body"],
    timestamp=data["timestamp"],
    message_type=MessageType.GROUP if data["isGroup"] else MessageType.PRIVATE,
    raw=data,
)
```

5. Write `tests/gateway/test_decentchat_adapter.py` with unit tests for:
   - `check_decentchat_requirements()` returns bool
   - `DecentChatAdapter.__init__` parses config correctly
   - `_poll_messages()` emits `handle_message` for each bridge response (mock aiohttp)

6. Run: `python -m pytest tests/gateway/test_decentchat_adapter.py -q`

**Verify:** All new tests pass.

---

### Task 7: Wire adapter into `gateway/run.py`

**Files:**
- Modify: `~/.hermes/hermes-agent/gateway/run.py`

**Steps:**

1. Add to `_create_adapter()` (after the WhatsApp block):
```python
elif platform == Platform.DECENTCHAT:
    from gateway.platforms.decentchat import DecentChatAdapter, check_decentchat_requirements
    if not check_decentchat_requirements():
        logger.warning("DecentChat: Node.js not found")
        return None
    return DecentChatAdapter(config)
```

2. Add to BOTH dicts in `_is_user_authorized()`:
```python
platform_env_map = {
    ...
    Platform.DECENTCHAT: "DECENTCHAT_ALLOWED_USERS",
}
platform_allow_all_map = {
    ...
    Platform.DECENTCHAT: "DECENTCHAT_ALLOW_ALL_USERS",
}
```

3. Run gateway tests: `python -m pytest tests/gateway/ -q`

**Verify:** All gateway tests pass.

---

### Task 8: Add platform hint

**Files:**
- Modify: `~/.hermes/hermes-agent/agent/prompt_builder.py`

**Steps:**

1. Add to `PLATFORM_HINTS`:
```python
"decentchat": (
    "You are on DecentChat, a P2P end-to-end encrypted chat network. "
    "Messages do not support markdown rendering — use plain text only. "
    "The network is decentralized; there are no servers, only peers. "
    "Chat IDs are formatted as workspaceId:channelId or workspaceId:dm:contactHash."
),
```

2. Run: `python -m pytest tests/ -k prompt_builder -q`

**Verify:** Prompt builder tests pass.

---

### Task 9: Add toolset

**Files:**
- Modify: `~/.hermes/hermes-agent/toolsets.py`

**Steps:**

1. Add toolset definition:
```python
"hermes-decentchat": {
    "description": "DecentChat P2P bot toolset",
    "tools": _HERMES_CORE_TOOLS,
    "includes": []
},
```

2. Add to `hermes-gateway` composite includes:
```python
"hermes-gateway": {
    "includes": [..., "hermes-decentchat"]
}
```

3. Run: `python -m pytest tests/test_model_tools.py -q`

**Verify:** Toolset resolution tests pass.

---

### Task 10: Wire into cron and send_message_tool

**Files:**
- Modify: `~/.hermes/hermes-agent/cron/scheduler.py`
- Modify: `~/.hermes/hermes-agent/tools/send_message_tool.py`

**Steps:**

1. `cron/scheduler.py` — add to `platform_map` in `_deliver_result()`:
```python
"decentchat": Platform.DECENTCHAT,
```

2. `tools/send_message_tool.py`:

Add to `platform_map` in `send_message_tool()`:
```python
"decentchat": Platform.DECENTCHAT,
```

Add routing in `_send_to_platform()`:
```python
elif platform == Platform.DECENTCHAT:
    return await _send_decentchat(pconfig, chat_id, message)
```

Implement `_send_decentchat()` — sends directly to the bridge HTTP endpoint without needing the full adapter (for cron use outside gateway process):
```python
async def _send_decentchat(pconfig: PlatformConfig, chat_id: str, message: str) -> bool:
    import aiohttp
    port = pconfig.extra.get("bridge_port", 3001)
    url = f"http://127.0.0.1:{port}/send"
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json={"chatId": chat_id, "body": message}) as resp:
            data = await resp.json()
            return data.get("success", False)
```

3. Run full test suite: `python -m pytest tests/ -q`

**Verify:** All ~3000 tests pass (or only pre-existing failures).

---

### Task 11: Bundle compiled bridge into hermes-agent

**Files:**
- Create: `~/.hermes/hermes-agent/scripts/decentchat-bridge/` (symlink or copy)

**Steps:**

1. Build the bridge:
```bash
cd ~/Projects/decent-chat/decent-hermes
bun run build
```

2. Create bridge directory in hermes-agent and copy the compiled output + package.json:
```bash
mkdir -p ~/.hermes/hermes-agent/scripts/decentchat-bridge
cp ~/Projects/decent-chat/decent-hermes/dist/bridge.js ~/.hermes/hermes-agent/scripts/decentchat-bridge/
cp ~/Projects/decent-chat/decent-hermes/package.json ~/.hermes/hermes-agent/scripts/decentchat-bridge/
# Install production deps (for native modules like node-datachannel)
cd ~/.hermes/hermes-agent/scripts/decentchat-bridge
npm install --production
```

3. The adapter's `_DEFAULT_BRIDGE_DIR` in `decentchat.py` points here:
```python
_DEFAULT_BRIDGE_DIR = Path(__file__).resolve().parents[2] / "scripts" / "decentchat-bridge"
```

4. Verify bridge starts: `node ~/.hermes/hermes-agent/scripts/decentchat-bridge/bridge.js --port 3099 &`; `curl http://127.0.0.1:3099/health`; kill the process.

**Verify:** Health endpoint returns `{ "status": "connecting" }` (no seed phrase yet = expected).

---

### Task 12: End-to-end integration test

**Files:**
- Create: `~/.hermes/hermes-agent/tests/gateway/test_decentchat_integration.py`

**Steps:**

1. Write a test that:
   - Starts the bridge subprocess with a test seed phrase and port 3099
   - Waits for `/health` to return status != error
   - Calls `/health` and asserts shape
   - POSTs a `/send` to a dummy chatId (will fail at P2P level, but HTTP should return structured error)
   - Kills the bridge
   - Asserts no zombie processes

2. Mark test with `@pytest.mark.integration` and skip if `DECENTCHAT_TEST_SEED` env is not set.

3. Run unit-only suite to confirm nothing broken: `python -m pytest tests/ -q -m "not integration"`

**Verify:** All non-integration tests pass. Integration test passes with a real seed phrase.

---

### Task 13: User-facing config documentation

**Files:**
- Create: `~/.hermes/hermes-agent/docs/platforms/decentchat.md`

**Steps:**

1. Write a short setup guide covering:

```markdown
# DecentChat Platform Setup

## config.yaml

```yaml
platforms:
  decentchat:
    enabled: true
    bridge_port: 3001          # HTTP port for local bridge (default: 3001)
    seed_phrase: "word1 word2 ..." # 12-word BIP39 phrase (your P2P identity)
    alias: Xena                # Display name on the network
    signaling_server: https://0.peerjs.com/
    data_dir: ~/.hermes/decentchat/data
    invites:                   # Optional: join workspaces on start
      - decent://invite/...
```

## Home channel

Set a home channel for cron job delivery:

```yaml
home_channels:
  decentchat: "workspace123:general"
```

## Install bridge (if not bundled)

```bash
npm install -g @decentchat/hermes-bridge
# Then set bridge_script in config.yaml:
bridge_script: /usr/local/bin/decent-hermes-bridge
```

## Logs

Bridge logs: `~/.hermes/decentchat/bridge.log`
```

2. Reference this file from `ADDING_A_PLATFORM.md` as an example.

**Verify:** File exists and is readable.

---

## Checklist

- [ ] Task 1: `decent-hermes/` scaffolded, workspace linked
- [ ] Task 2: `DecentHermesPeer` class + unit test
- [ ] Task 3: `bridge.ts` HTTP server, all 4 endpoints
- [ ] Task 4: `dist/bridge.js` compiles & runs clean
- [ ] Task 5: `Platform.DECENTCHAT` in enum + env override
- [ ] Task 6: `decentchat.py` adapter implemented + unit tests pass
- [ ] Task 7: Wired into `gateway/run.py` factory + auth maps
- [ ] Task 8: Platform hint in `prompt_builder.py`
- [ ] Task 9: Toolset added + gateway composite updated
- [ ] Task 10: Cron + send_message_tool wired
- [ ] Task 11: Bridge bundled in hermes-agent scripts/
- [ ] Task 12: Integration test written + passing
- [ ] Task 13: User docs written

---

## Handoff

After this plan is saved, two execution options:

1. **Subagent-Driven (same session)** — load `executing-plans` skill and execute task-by-task with verification at each step.
2. **Parallel Session** — open a new session, load `executing-plans`, point it at this plan file.

Plan saved to: `~/Projects/decent-chat/docs/plans/2026-07-14-decent-hermes.md`
