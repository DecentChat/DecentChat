#!/usr/bin/env node
/**
 * Hermes Agent DecentChat Bridge
 *
 * Standalone Node.js process that connects to DecentChat P2P network
 * and exposes HTTP endpoints for the Hermes Python gateway adapter.
 *
 * Endpoints:
 *   GET  /health           → { status, connected, alias }
 *   GET  /messages         → long-poll up to 20s, returns IncomingMessage[]
 *   POST /send             → { chatId, body, voice? } → { success, messageId? }
 *   GET  /chat/:chatId     → { name, type, chat_id }
 *
 * Usage:
 *   node bridge.js --port 3001 --data-dir ~/.hermes/decentchat/data \
 *                  --seed-phrase "word1 word2 ..." --alias "Xena"
 */

// MUST be first — installs RTCPeerConnection globals
import './peer/polyfill.js';

import express from 'express';
import { DecentHermesPeer } from './peer.js';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
function getArg(name: string, def = ''): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const PORT = parseInt(getArg('port', process.env.DECENTCHAT_BRIDGE_PORT ?? '3001'), 10);
const DATA_DIR = getArg('data-dir', process.env.DECENTCHAT_DATA_DIR ?? '');
const SEED_PHRASE = getArg('seed-phrase', process.env.DECENTCHAT_SEED_PHRASE ?? '');
const ALIAS = getArg('alias', process.env.DECENTCHAT_ALIAS ?? 'Hermes Agent');
const SIGNALING = getArg('signaling-server', process.env.DECENTCHAT_SIGNALING_SERVER ?? 'https://0.peerjs.com/');
const INVITES_RAW = getArg('invites', process.env.DECENTCHAT_INVITES ?? '');
const INVITES = INVITES_RAW ? INVITES_RAW.split(',').map(s => s.trim()).filter(Boolean) : [];

// STT/TTS (voice)
const HUDDLE_ENABLED = !hasFlag('no-huddle');
const HUDDLE_AUTO_JOIN = !hasFlag('no-auto-join');
const STT_ENGINE = getArg('stt-engine', process.env.DECENTCHAT_STT_ENGINE ?? 'whisper-cpp') as any;
const STT_API_KEY = getArg('stt-api-key', process.env.DECENTCHAT_STT_API_KEY ?? '');
const TTS_ENGINE = getArg('tts-engine', process.env.DECENTCHAT_TTS_ENGINE ?? '') as any;
const TTS_API_KEY = getArg('tts-api-key', process.env.DECENTCHAT_TTS_API_KEY ?? '');
const TTS_VOICE = getArg('tts-voice', process.env.DECENTCHAT_TTS_VOICE ?? '');
const HERMES_API_URL = getArg('hermes-api-url', process.env.HERMES_API_URL ?? 'http://127.0.0.1:8642');

if (!SEED_PHRASE) {
  console.error('[decent-hermes-bridge] ERROR: --seed-phrase or DECENTCHAT_SEED_PHRASE required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Peer setup
// ---------------------------------------------------------------------------
const peer = new DecentHermesPeer({
  seedPhrase: SEED_PHRASE,
  signalingServer: SIGNALING,
  ...(DATA_DIR ? { dataDir: DATA_DIR } : {}),
  alias: ALIAS,
  invites: INVITES,
  huddleEnabled: HUDDLE_ENABLED,
  huddleAutoJoin: HUDDLE_AUTO_JOIN,
  ...(STT_ENGINE ? { sttEngine: STT_ENGINE } : {}),
  ...(STT_API_KEY ? { sttApiKey: STT_API_KEY } : {}),
  ...(TTS_ENGINE ? { ttsEngine: TTS_ENGINE } : {}),
  ...(TTS_API_KEY ? { ttsApiKey: TTS_API_KEY } : {}),
  ...(TTS_VOICE ? { ttsVoice: TTS_VOICE } : {}),
  onVoiceTranscription: HERMES_API_URL ? async (text, chatId, senderName) => {
    // Call Hermes OpenAI-compatible API (api_server platform must be enabled)
    try {
      const res = await fetch(`${HERMES_API_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': chatId,
        },
        body: JSON.stringify({
          model: 'hermes-agent',
          messages: [{ role: 'user', content: text }],
          stream: false,
        }),
      });
      if (!res.ok) return undefined;
      const data = await res.json() as any;
      return data?.choices?.[0]?.message?.content as string | undefined;
    } catch (e) {
      console.error('[decent-hermes-bridge] voice transcription API call failed:', e);
      return undefined;
    }
  } : undefined,
});

// ---------------------------------------------------------------------------
// Express HTTP server
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// GET /health
app.get('/health', (_req, res) => {
  res.json({
    status: peer.isConnected() ? 'connected' : 'connecting',
    connected: peer.isConnected(),
    alias: ALIAS,
  });
});

// GET /messages — long-poll, waits up to 20s for new messages
app.get('/messages', async (_req, res) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const msgs = peer.drainMessages();
    if (msgs.length > 0) {
      res.json(msgs);
      return;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  res.json([]);
});

// POST /send
app.post('/send', async (req, res) => {
  const { chatId, body, voice, replyTo, threadId, model } = req.body as {
    chatId: string;
    body: string;
    voice?: boolean;
    replyTo?: string;
    threadId?: string;
    model?: { modelId?: string; modelName?: string; modelAlias?: string; modelLabel?: string };
  };
  if (!chatId || !body) {
    res.status(400).json({ success: false, error: 'chatId and body required' });
    return;
  }
  try {
    const messageId = await peer.sendMessage(chatId, body, voice === true, replyTo, threadId, model);
    res.json({ success: true, messageId });
  } catch (e: any) {
    console.error('[decent-hermes-bridge] send error:', e?.message);
    res.status(500).json({ success: false, error: String(e?.message ?? e) });
  }
});

// POST /typing — start or stop typing indicator
app.post('/typing', async (req, res) => {
  const { chatId, typing } = req.body as { chatId: string; typing: boolean };
  if (!chatId) {
    res.status(400).json({ success: false, error: 'chatId required' });
    return;
  }
  try {
    await peer.sendTyping(chatId, typing === true);
    res.json({ success: true });
  } catch (e: any) {
    console.error('[decent-hermes-bridge] typing error:', e?.message);
    res.status(500).json({ success: false, error: String(e?.message ?? e) });
  }
});

// GET /chat/:chatId (URL-encoded, colon in chatId replaced with ~ in requests)
app.get('/chat/:chatId', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId).replace(/~/g, ':');
  try {
    const info = await peer.getChatInfo(chatId);
    res.json(info);
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[decent-hermes-bridge] HTTP server listening on 127.0.0.1:${PORT}`);
});

console.log(`[decent-hermes-bridge] Starting DecentChat peer as "${ALIAS}"...`);
peer.start()
  .then(() => console.log('[decent-hermes-bridge] Peer connected'))
  .catch(e => {
    console.error('[decent-hermes-bridge] Peer start failed:', e);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[decent-hermes-bridge] Shutting down...');
  await peer.stop();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await peer.stop();
  process.exit(0);
});
