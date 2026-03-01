# Bot Joins Huddle (Voice Conversation) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Enable the OpenClaw bot (Xena) to join DecentChat huddles and have real-time voice conversations — receive human speech, transcribe it, get an LLM response, and speak it back over WebRTC audio.

**Architecture:** The `decent-openclaw` plugin already receives all peer messages via `NodeXenaPeer.handlePeerMessage()`. We add a `BotHuddleManager` that intercepts `huddle-*` signals and creates a separate `node-datachannel` PeerConnection for audio media (the existing data channel transport handles signaling). Incoming Opus audio is decoded to PCM, buffered with energy-based VAD, transcribed via Whisper, processed by Claude, converted to speech via ElevenLabs, encoded to Opus, and sent back over the WebRTC audio track.

**Tech Stack:**
- `node-datachannel` 0.32.1 (already installed) — WebRTC PeerConnection, Audio, Track
- `opusscript` 0.1.1 (already installed) — Opus encode/decode
- `whisper-cpp` (brew, already installed) — local STT, Apple Silicon optimized
- ElevenLabs streaming API (key available) — TTS
- `ffmpeg` (installed) — audio format conversion
- OpenClaw `dispatchReplyWithBufferedBlockDispatcher` — LLM integration

---

## Architecture Diagram

```
Human Browser                          Bot (decent-openclaw)
┌─────────────┐                       ┌──────────────────────────┐
│ HuddleManager│──data channel────────│ NodeXenaPeer             │
│ (signaling)  │  huddle-* signals    │  ├─ handlePeerMessage()  │
│              │                      │  └─ botHuddle.handleSig()│
│              │                      │                          │
│ RTCPeerConn  │──WebRTC audio────────│ BotHuddleManager        │
│ (browser)    │  Opus RTP packets    │  ├─ node-datachannel PC  │
│              │                      │  ├─ Track.onMessage()    │
└─────────────┘                      │  ├─ OpusDecoder → PCM    │
                                      │  ├─ VAD (energy-based)   │
                                      │  ├─ whisper-cpp → text   │
                                      │  ├─ Claude → response    │
                                      │  ├─ ElevenLabs → audio   │
                                      │  ├─ OpusEncoder → RTP    │
                                      │  └─ Track.sendMessage()  │
                                      └──────────────────────────┘
```

## Audio Pipeline

```
RECEIVE PATH:
  Track.onMessage(rtpBuffer)
  → strip RTP header (12 bytes + CSRC + extensions)
  → extract Opus payload
  → OpusScript.decode(opus, 48000, 1) → PCM Int16 buffer
  → feed to VAD ring buffer
  → on silence detected (500ms):
      write accumulated PCM to /tmp/huddle-<id>.wav
      spawn whisper-cpp --model base.en --output-txt
      read transcription → send to LLM

SEND PATH:
  LLM response text
  → ElevenLabs POST /v1/text-to-speech/<voice>/stream
     (model: eleven_turbo_v2, output_format: pcm_24000)
  → PCM 16-bit 24kHz mono stream
  → resample to 48kHz (linear interpolation)
  → OpusScript.encode(pcm, 960, 1) → Opus frames
  → wrap in RTP packet (header + payload)
  → Track.sendMessageBinary(rtpBuffer)
```

---

## Task 1: BotHuddleManager — Signal Handling (no audio yet)

**Files:**
- Create: `decent-openclaw/src/huddle/BotHuddleManager.ts`
- Modify: `decent-openclaw/src/peer/NodeXenaPeer.ts` (add huddle signal routing)
- Test: `decent-openclaw/tests/huddle-signaling.test.ts`

### Steps

1. Create `BotHuddleManager` class that handles all `huddle-*` message types:
   - `huddle-announce` → if autoJoin, send `huddle-join` back
   - `huddle-offer` → create node-datachannel PeerConnection, generate answer (stub for now)
   - `huddle-answer` → setRemoteDescription on existing PC
   - `huddle-ice` → addRemoteCandidate
   - `huddle-leave` → cleanup peer connection
   - `huddle-mute` → track mute state (informational)

2. In `NodeXenaPeer.handlePeerMessage()`, add before the `!msg?.encrypted` guard:
   ```typescript
   if (typeof msg?.type === 'string' && msg.type.startsWith('huddle-')) {
     await this.botHuddle?.handleSignal(fromPeerId, msg);
     return;
   }
   ```

3. Initialize `BotHuddleManager` in `NodeXenaPeer.start()` after transport ready.

4. Write test verifying signal routing: announce → auto-join, offer → answer sent, leave → cleanup.

5. Run: `cd ~/Projects/decent-chat && bun test decent-openclaw/tests/huddle-signaling.test.ts`
6. Commit: `feat(huddle): add BotHuddleManager signal handling`

---

## Task 2: WebRTC Audio PeerConnection

**Files:**
- Modify: `decent-openclaw/src/huddle/BotHuddleManager.ts`
- Test: `decent-openclaw/tests/huddle-audio-receive.test.ts`

### Steps

1. Implement `handleOffer()` with real node-datachannel PeerConnection:
   - Create PC with STUN config
   - Add Audio track (sendrecv) with Opus codec (payload type 111)
   - Set `track.onMessage()` callback for incoming audio
   - Set remote description (browser's offer SDP)
   - Send generated local description as huddle-answer
   - Forward ICE candidates

2. **SDP compatibility:** Browser sends `{ sdp: { sdp: string, type: string } }`. Bot's node-datachannel uses `pc.setRemoteDescription(sdpString, typeString)`. Extract correctly.

3. **ICE compatibility:** Browser sends `{ candidate: { candidate: string, sdpMid: string } }`. Bot uses `pc.addRemoteCandidate(candidateString, mid)`.

4. Test with loopback: two node-datachannel PCs exchanging SDP/ICE locally.
5. Commit: `feat(huddle): WebRTC audio PeerConnection with Opus`

---

## Task 3: Opus Decode + Energy-Based VAD

**Files:**
- Create: `decent-openclaw/src/huddle/AudioPipeline.ts`
- Test: `decent-openclaw/tests/huddle-audio-pipeline.test.ts`

### Steps

1. Create `AudioPipeline` class:
   - `feedRtpPacket(buf)` → strip RTP header → decode Opus → PCM
   - Energy-based VAD: compute RMS of each frame, track speaking state
   - On silence detected (configurable, default 500ms): emit `onSpeechEnd(pcmBuffer)`
   - `stripRtpHeader()` handles variable header (CSRC, extensions)
   - `computeRMS()` on Int16 PCM samples

2. Test: encode known PCM → Opus → RTP → feed to pipeline → verify VAD detection and PCM output.
3. Commit: `feat(huddle): Opus decode + energy-based VAD pipeline`

---

## Task 4: Speech-to-Text via whisper-cpp

**Files:**
- Create: `decent-openclaw/src/huddle/SpeechToText.ts`
- Test: `decent-openclaw/tests/huddle-stt.test.ts`

### Steps

1. Create `SpeechToText` class:
   - `transcribe(pcmBuffer, sampleRate)` → string
   - Write PCM to temporary WAV file (with proper RIFF header)
   - Resample to 16kHz with ffmpeg (whisper requirement)
   - Run whisper-cpp: `whisper-cpp --model <path> --output-txt --no-timestamps <wav>`
   - Read output text file, return trimmed result
   - Clean up temp files

2. Model path: `/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin`
3. Test: use macOS `say` to generate a WAV fixture, transcribe, verify output.
4. Commit: `feat(huddle): speech-to-text via whisper-cpp`

---

## Task 5: Text-to-Speech via ElevenLabs + Opus Encode

**Files:**
- Create: `decent-openclaw/src/huddle/TextToSpeech.ts`
- Test: `decent-openclaw/tests/huddle-tts.test.ts`

### Steps

1. Create `TextToSpeech` class:
   - `speak(text)` → AsyncGenerator<Buffer> of RTP packets
   - POST to ElevenLabs streaming API (pcm_24000 format)
   - Stream response → resample 24kHz→48kHz → Opus encode → RTP packetize
   - Pace output at ~20ms per frame for real-time playback
   - `createRtpPacket(payload, seq, timestamp, ssrc, pt)` utility

2. Use ElevenLabs API key from env `ELEVENLABS_API_KEY`
3. Voice: configurable, default "Rachel" (`EXAVITQu4vr4xnSDxMaL`)
4. Test: generate speech, verify output is valid RTP packet sequence.
5. Commit: `feat(huddle): text-to-speech via ElevenLabs + Opus encoding`

---

## Task 6: Wire STT → LLM → TTS Pipeline

**Files:**
- Modify: `decent-openclaw/src/huddle/BotHuddleManager.ts`
- Modify: `decent-openclaw/src/peer/NodeXenaPeer.ts`

### Steps

1. When `AudioPipeline.onSpeechEnd(pcm)` fires:
   - `SpeechToText.transcribe(pcm)` → text
   - If empty/noise, skip
   - Log: `[Huddle] Heard: "<text>"`
   - Route through OpenClaw session system (treat as synthetic text message)
   - Collect full LLM response text
   - `TextToSpeech.speak(response)` → stream RTP packets to track

2. For LLM integration, use `NodeXenaPeer`'s existing `onIncomingMessage` callback with a synthetic message, OR create a dedicated `handleHuddleTranscription(text, peerId)` method.

3. For MVP: batch approach (wait for full LLM response, then TTS). Future: streaming (TTS sentences as they arrive).

4. Commit: `feat(huddle): wire STT → LLM → TTS pipeline`

---

## Task 7: Configuration + Lifecycle

**Files:**
- Modify: `decent-openclaw/src/channel.ts` (schema)
- Modify: `decent-openclaw/src/peer/NodeXenaPeer.ts` (init/destroy)

### Steps

1. Add huddle config to `DecentChatConfigSchema`:
   ```typescript
   huddle: z.object({
     enabled: z.boolean().optional().default(false),
     autoJoin: z.boolean().optional().default(true),
     sttEngine: z.enum(['whisper-cpp', 'whisper-python']).optional().default('whisper-cpp'),
     whisperModel: z.string().optional().default('base.en'),
     ttsVoice: z.string().optional().default('Rachel'),
     vadSilenceMs: z.number().optional().default(500),
     vadThreshold: z.number().optional().default(0.02),
   }).optional()
   ```

2. Init BotHuddleManager in `NodeXenaPeer.start()`, cleanup in `destroy()`.
3. Commit: `feat(huddle): configuration + lifecycle integration`

---

## Task 8: E2E Testing + Deploy

**Files:**
- Create: `decent-openclaw/tests/huddle-e2e.test.ts`

### Steps

1. Integration test: two node-datachannel PCs, exchange SDP, send Opus audio, verify pipeline triggers.
2. Deploy to decentchat.app, manual smoke test.
3. Commit: `test(huddle): end-to-end integration tests`

---

## Dependencies (already available)

- `node-datachannel` 0.32.1 ✅ (WebRTC + Audio + Track)
- `opusscript` 0.1.1 ✅ (Opus encode/decode)
- `whisper-cpp` ✅ (brew installed)
- `ffmpeg` ✅ (installed)
- `ELEVENLABS_API_KEY` ✅ (env)
- No new npm packages needed for MVP!

## Execution Order

Serial: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
With parallelism: (1 + 3 + 4 + 5) → 2 → 6 → 7 → 8

## Open Questions

1. **TURN server** — Only STUN configured. Won't work across strict NATs.
2. **Streaming STT** — Deepgram would eliminate batch latency (needs API key).
3. **Interruption** — Stop TTS when human speaks? (Future.)
4. **Echo cancellation** — Bot hearing its own TTS from human's speakers. (Mute receive during playback.)
5. **Multi-peer** — One human for MVP. Multi-peer needs audio mixing.
6. **Session context** — Accumulate multi-turn voice context (not just per-transcription).
