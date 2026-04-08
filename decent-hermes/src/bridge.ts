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
 *   POST /stream/start     → { chatId, replyTo?, threadId?, model? } → { success, messageId }
 *   POST /stream/chunk     → { chatId, messageId, content } → { success }
 *   POST /stream/done      → { chatId, messageId } → { success }
 *   GET  /chat/:chatId     → { name, type, chat_id }
 *
 * Usage:
 *   node bridge.js --port 3001 --data-dir ~/.hermes/decentchat/data \
 *                  --seed-phrase "word1 word2 ..." --alias "Xena"
 */

// MUST be first — installs RTCPeerConnection globals
import './peer/polyfill.js';

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DecentHermesPeer } from './peer.js';
import { createBridgeApp } from './bridge-app.js';

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

export async function main(): Promise<void> {
  if (!SEED_PHRASE) {
    throw new Error('--seed-phrase or DECENTCHAT_SEED_PHRASE required');
  }

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
    onVoiceTranscription: HERMES_API_URL
      ? async (text, chatId) => {
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
            const data = (await res.json()) as any;
            return data?.choices?.[0]?.message?.content as string | undefined;
          } catch (e) {
            console.error('[decent-hermes-bridge] voice transcription API call failed:', e);
            return undefined;
          }
        }
      : undefined,
  });

  const app = createBridgeApp(peer, ALIAS);
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[decent-hermes-bridge] HTTP server listening on 127.0.0.1:${PORT}`);
  });

  console.log(`[decent-hermes-bridge] Starting DecentChat peer as "${ALIAS}"...`);
  await peer.start();
  console.log('[decent-hermes-bridge] Peer connected');

  // Diagnostic signal handlers — log every termination signal we observe so
  // we can tell external kills (gateway, launchd, fuser, OS pressure killer)
  // apart from clean SIGTERM. The pid+ppid+uptime info pinpoints which
  // process group the signal came from.
  const _logSignal = (sig: string): void => {
    const ppid = (process as any).ppid ?? 'unknown';
    const upMs = Math.round(process.uptime() * 1000);
    // eslint-disable-next-line no-console
    console.log(
      `[decent-hermes-bridge] Received ${sig} (pid=${process.pid} ppid=${ppid} uptime=${upMs}ms)`,
    );
  };
  process.on('SIGTERM', async () => {
    _logSignal('SIGTERM');
    console.log('[decent-hermes-bridge] Shutting down...');
    await peer.stop();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    _logSignal('SIGINT');
    await peer.stop();
    process.exit(0);
  });
  // Non-fatal informational handlers — these don't kill us, but logging
  // them lets us see if anything ELSE is hitting us.
  for (const sig of ['SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2', 'SIGPIPE'] as const) {
    process.on(sig, () => _logSignal(sig));
  }
}

const isMainModule =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((e) => {
    console.error('[decent-hermes-bridge] Peer start failed:', e);
    process.exit(1);
  });
}
