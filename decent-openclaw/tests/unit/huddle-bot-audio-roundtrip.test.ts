/**
 * huddle-bot-audio-roundtrip.test.ts
 *
 * End-to-end test for bot→browser audio delivery.
 *
 * Root cause of "can't hear bot in real browser":
 *   The bot sends full RTP packets via track.sendMessageBinary(). With the
 *   media handler chain (RtcpSrReporter → RtcpReceivingSession) set on the
 *   track, the data is SRTP-encrypted before hitting the wire.
 *
 * This test verifies:
 *   1. Bot PC with media handler can send RTP → browser PC receives onMessage
 *   2. Bot PC receives browser's RTP via onMessage
 *   3. Full TTS-style RTP packets (marker bit, sequential seq/ts) are received
 *   4. Bidirectional audio track is functional
 */

import { describe, test, expect } from 'bun:test';
import ndc from 'node-datachannel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an RTP packet matching what TextToSpeech.createRtpPacket() produces. */
function makeTtsRtpPacket(
  seq: number,
  timestamp: number,
  ssrc: number,
  payloadSize = 80,
  marker = false,
): Buffer {
  const header = Buffer.alloc(12);
  header[0] = 0x80;
  header[1] = (marker ? 0x80 : 0) | (111 & 0x7f); // PT=111 (Opus)
  header.writeUInt16BE(seq & 0xffff, 2);
  header.writeUInt32BE(timestamp >>> 0, 4);
  header.writeUInt32BE(ssrc >>> 0, 8);
  const payload = Buffer.alloc(payloadSize, 0xAA);
  return Buffer.concat([header, payload]);
}

/** Set up two PeerConnections mimicking the real bot↔browser flow. */
async function setupBotBrowserPair(): Promise<{
  botPc: ndc.PeerConnection;
  browserPc: ndc.PeerConnection;
  botTrack: ndc.Track;
  browserTrack: ndc.Track;
  cleanup: () => void;
}> {
  // ── Browser PC (offerer) ──────────────────────────────────────────
  const browserPc = new ndc.PeerConnection('browser', {
    iceServers: [],
    disableAutoNegotiation: true,
  });
  const brAudio = new ndc.Audio('0', 'SendRecv');
  brAudio.addOpusCodec(111);
  brAudio.addSSRC(5678, 'browser', 'browser-stream', 'browser-track');
  const browserTrack = browserPc.addTrack(brAudio);

  // ── Bot PC (answerer) — matches BotHuddleManager.handleOffer() ───
  const botPc = new ndc.PeerConnection('bot', {
    iceServers: [],
    disableAutoNegotiation: true,
  });
  const botAudio = new ndc.Audio('0', 'SendRecv');
  botAudio.addOpusCodec(111);
  botAudio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
  const botTrack = botPc.addTrack(botAudio);

  // Media handler chain — exactly what BotHuddleManager sets up
  const rtpConfig = new ndc.RtpPacketizationConfig(1234, 'bot-audio', 111, 48000);
  const srReporter = new ndc.RtcpSrReporter(rtpConfig);
  const recvSession = new ndc.RtcpReceivingSession();
  srReporter.addToChain(recvSession);
  botTrack.setMediaHandler(srReporter);

  // ── Signaling exchange ────────────────────────────────────────────
  const pendingBotCand: { c: string; m: string }[] = [];
  const pendingBrCand: { c: string; m: string }[] = [];
  let botRemSet = false;
  let brRemSet = false;

  browserPc.onLocalCandidate((c, m) => {
    if (botRemSet) botPc.addRemoteCandidate(c, m);
    else pendingBrCand.push({ c, m });
  });
  botPc.onLocalCandidate((c, m) => {
    if (brRemSet) browserPc.addRemoteCandidate(c, m);
    else pendingBotCand.push({ c, m });
  });

  // Browser generates offer
  const offerSdp = await new Promise<string>((resolve) => {
    browserPc.onLocalDescription((sdp, type) => {
      if (type.toLowerCase() === 'offer') resolve(sdp);
    });
    browserPc.setLocalDescription('Offer');
  });

  // Bot processes offer and generates answer (mirroring BotHuddleManager)
  const answerSdp = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('no answer SDP within 5s')), 5000);
    botPc.onLocalDescription((sdp, type) => {
      if (type.toLowerCase() === 'answer') {
        clearTimeout(timeout);
        resolve(sdp);
      }
    });
    botPc.setRemoteDescription(offerSdp, 'Offer');
    botRemSet = true;
    pendingBrCand.forEach(({ c, m }) => botPc.addRemoteCandidate(c, m));
    botPc.setLocalDescription('Answer');
  });

  // Browser receives answer
  browserPc.setRemoteDescription(answerSdp, 'Answer');
  brRemSet = true;
  pendingBotCand.forEach(({ c, m }) => browserPc.addRemoteCandidate(c, m));

  // Wait for both tracks to open
  const botTrackOpen = new Promise<void>((r) => botTrack.onOpen(() => r()));
  const browserTrackOpen = new Promise<void>((r) => browserTrack.onOpen(() => r()));

  await Promise.race([
    Promise.all([botTrackOpen, browserTrackOpen]),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('tracks did not open within 8s')), 8000),
    ),
  ]);

  return {
    botPc,
    browserPc,
    botTrack,
    browserTrack,
    cleanup: () => {
      botPc.close();
      browserPc.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bot→Browser audio round-trip (with media handler)', () => {
  test('bot sends TTS-style RTP packets → browser receives them', async () => {
    const { botTrack, browserTrack, cleanup } = await setupBotBrowserPair();

    try {
      const received: Buffer[] = [];
      const allReceived = new Promise<void>((resolve) => {
        browserTrack.onMessage((buf: Buffer) => {
          received.push(Buffer.from(buf));
          if (received.length >= 10) resolve();
        });
      });

      // Send 10 RTP packets mimicking TTS output (marker on first)
      for (let i = 0; i < 10; i++) {
        const rtp = makeTtsRtpPacket(i, i * 960, 1234, 80, i === 0);
        botTrack.sendMessageBinary(rtp);
        await new Promise((r) => setTimeout(r, 20)); // 20ms pacing
      }

      await Promise.race([
        allReceived,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout: only received ${received.length}/10 packets`)), 5000),
        ),
      ]);

      expect(received.length).toBeGreaterThanOrEqual(10);

      // Each received packet should have data
      for (const pkt of received) {
        expect(pkt.length).toBeGreaterThan(0);
      }
    } finally {
      cleanup();
    }
  }, 20000);

  test('browser sends RTP → bot receives via onMessage', async () => {
    const { botTrack, browserTrack, cleanup } = await setupBotBrowserPair();

    try {
      const received: Buffer[] = [];
      const gotEnough = new Promise<void>((resolve) => {
        botTrack.onMessage((buf: Buffer) => {
          received.push(Buffer.from(buf));
          if (received.length >= 5) resolve();
        });
      });

      // Browser sends 5 RTP packets
      for (let i = 0; i < 5; i++) {
        const rtp = makeTtsRtpPacket(i, i * 960, 5678, 60);
        browserTrack.sendMessageBinary(rtp);
        await new Promise((r) => setTimeout(r, 20));
      }

      await Promise.race([
        gotEnough,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout: only received ${received.length}/5 packets`)), 5000),
        ),
      ]);

      expect(received.length).toBeGreaterThanOrEqual(5);
    } finally {
      cleanup();
    }
  }, 20000);

  test('bidirectional: both sides send and receive simultaneously', async () => {
    const { botTrack, browserTrack, cleanup } = await setupBotBrowserPair();

    try {
      const botReceived: Buffer[] = [];
      const browserReceived: Buffer[] = [];

      const botGot5 = new Promise<void>((resolve) => {
        botTrack.onMessage((buf: Buffer) => {
          botReceived.push(Buffer.from(buf));
          if (botReceived.length >= 5) resolve();
        });
      });

      const browserGot5 = new Promise<void>((resolve) => {
        browserTrack.onMessage((buf: Buffer) => {
          browserReceived.push(Buffer.from(buf));
          if (browserReceived.length >= 5) resolve();
        });
      });

      // Both sides send simultaneously
      for (let i = 0; i < 5; i++) {
        botTrack.sendMessageBinary(makeTtsRtpPacket(i, i * 960, 1234, 80, i === 0));
        browserTrack.sendMessageBinary(makeTtsRtpPacket(i, i * 960, 5678, 60));
        await new Promise((r) => setTimeout(r, 20));
      }

      await Promise.race([
        Promise.all([botGot5, browserGot5]),
        new Promise<void>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `timeout: bot=${botReceived.length}/5, browser=${browserReceived.length}/5`,
                ),
              ),
            5000,
          ),
        ),
      ]);

      expect(botReceived.length).toBeGreaterThanOrEqual(5);
      expect(browserReceived.length).toBeGreaterThanOrEqual(5);
    } finally {
      cleanup();
    }
  }, 20000);

  test('TTS burst: 50 packets at 20ms pacing all arrive', async () => {
    const { botTrack, browserTrack, cleanup } = await setupBotBrowserPair();

    try {
      const received: Buffer[] = [];
      const allReceived = new Promise<void>((resolve) => {
        browserTrack.onMessage((buf: Buffer) => {
          received.push(Buffer.from(buf));
          if (received.length >= 50) resolve();
        });
      });

      // Simulate a ~1 second TTS response (50 × 20ms)
      for (let i = 0; i < 50; i++) {
        const rtp = makeTtsRtpPacket(i, i * 960, 1234, 80, i === 0);
        botTrack.sendMessageBinary(rtp);
        await new Promise((r) => setTimeout(r, 18)); // slightly under 20ms like real code
      }

      await Promise.race([
        allReceived,
        new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error(`timeout: received ${received.length}/50 packets`)),
            8000,
          ),
        ),
      ]);

      // Allow some packet loss but require at least 90% delivery
      expect(received.length).toBeGreaterThanOrEqual(45);
    } finally {
      cleanup();
    }
  }, 20000);
});
