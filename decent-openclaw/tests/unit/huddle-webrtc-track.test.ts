/**
 * huddle-webrtc-track.test.ts
 *
 * Tests for the bot-side WebRTC audio track negotiation fix.
 *
 * Root cause being tested:
 *   When addTrack() is called before setRemoteDescription(), libdatachannel
 *   fires onLocalDescription TWICE: once for the answer (correct) and once for
 *   a spurious re-offer (bad). The fix is disableAutoNegotiation:true + explicit
 *   setLocalDescription('answer'), which produces exactly ONE answer SDP.
 *
 * Tests:
 *   1. Chrome SDP → exactly one answer generated (no spurious offer)
 *   2. Two-PC loopback → audio track opens + onMessage receives data
 */

import { describe, test, expect } from 'bun:test';
import ndc from 'node-datachannel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid Chrome-style audio offer SDP (sendrecv, Opus PT=111, mid=0). */
const CHROME_OFFER_SDP = [
  'v=0',
  'o=- 8609186977952573793 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS stream1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 9 0 8',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:aBcD',
  'a=ice-pwd:aBcDeFgHiJkLmNoPqRsTuVwX',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
  'a=setup:actpass',
  'a=mid:0',
  'a=sendrecv',
  'a=msid:stream1 track1',
  'a=rtcp-mux',
  'a=rtcp-rsize',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:9 G722/8000',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
  'a=ssrc:1122334455 cname:browser-stream',
  'a=ssrc:1122334455 msid:stream1 track1',
  '',
].join('\r\n');

/** Build a minimal 20-byte RTP packet (12-byte header + 8-byte payload). */
function makeRtpPacket(ssrc: number, payloadType = 111, seq = 1): Buffer {
  const pkt = Buffer.alloc(20);
  pkt[0] = 0x80;                       // V=2
  pkt[1] = payloadType & 0x7f;
  pkt.writeUInt16BE(seq, 2);
  pkt.writeUInt32BE(960, 4);            // timestamp
  pkt.writeUInt32BE(ssrc, 8);
  // 8-byte payload: silence / zeros (valid enough for transport test)
  return pkt;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('node-datachannel audio track negotiation (bot fix)', () => {
  /**
   * Test 1: static Chrome SDP → exactly one answer, zero spurious offers.
   *
   * This validates the core fix without needing a real network connection.
   * Without the fix (no disableAutoNegotiation), addTrack() before
   * setRemoteDescription() causes a spurious 'offer' to fire from libdatachannel.
   */
  test('disableAutoNegotiation: addTrack before setRemoteDescription yields exactly one answer SDP', async () => {
    const pc = new ndc.PeerConnection('bot-sdp-test', {
      iceServers: [],
      disableAutoNegotiation: true,
    });

    const audio = new ndc.Audio('0', 'SendRecv');
    audio.addOpusCodec(111);
    audio.addSSRC(22222222, 'bot', 'bot-stream', 'bot-track');
    pc.addTrack(audio);

    const localDescs: Array<{ sdp: string; type: string }> = [];
    pc.onLocalDescription((sdp, type) => {
      localDescs.push({ sdp, type });
    });

    // Feed a realistic Chrome offer AFTER addTrack (the problematic order).
    // setRemoteDescription does NOT auto-generate an answer with disableAutoNegotiation:true.
    pc.setRemoteDescription(CHROME_OFFER_SDP, 'offer');
    // Explicit answer generation — this is the fix.
    pc.setLocalDescription('answer');

    // Give libdatachannel time to fire all callbacks (up to 600ms).
    await new Promise<void>(r => setTimeout(r, 600));

    const answers = localDescs.filter(d => d.type.toLowerCase() === 'answer');
    const offers  = localDescs.filter(d => d.type.toLowerCase() === 'offer');

    expect(answers.length).toBe(1);  // exactly one answer
    expect(offers.length).toBe(0);   // zero spurious re-offers

    // Sanity: answer SDP should contain Opus and the correct mid
    expect(answers[0].sdp).toContain('opus');
    expect(answers[0].sdp.toLowerCase()).toContain('a=mid:0');

    pc.close();
  });

  /**
   * Test 2: two-PC loopback — audio track opens and onMessage receives data.
   *
   * PC1 ("browser") creates an offer; PC2 ("bot") processes it using the fixed
   * approach (disableAutoNegotiation:true + explicit setLocalDescription).
   * Both PCs connect via loopback ICE (no STUN needed in the same process).
   */
  test('two-PC loopback: track opens and onMessage receives RTP data', async () => {
    // ── PC1: "browser" (offerer) ──────────────────────────────────────
    const pc1 = new ndc.PeerConnection('browser', {
      iceServers: [],
      disableAutoNegotiation: true,
    });
    const audio1 = new ndc.Audio('0', 'SendRecv');
    audio1.addOpusCodec(111);
    audio1.addSSRC(11111111, 'browser', 'browser-stream', 'browser-track');
    const track1 = pc1.addTrack(audio1);

    // ── PC2: "bot" (answerer) — fixed approach ────────────────────────
    const pc2 = new ndc.PeerConnection('bot', {
      iceServers: [],
      disableAutoNegotiation: true,
    });
    const audio2 = new ndc.Audio('0', 'SendRecv');
    audio2.addOpusCodec(111);
    audio2.addSSRC(22222222, 'bot', 'bot-stream', 'bot-track');
    const track2 = pc2.addTrack(audio2);

    // Collect PC2's local descriptions to verify the count.
    const pc2LocalDescs: Array<{ sdp: string; type: string }> = [];

    // ── Signaling exchange ────────────────────────────────────────────
    pc1.onLocalDescription((sdp, type) => {
      if (type.toLowerCase() === 'offer') {
        // Bot: receive offer, set remote description, then explicitly generate answer.
        pc2.setRemoteDescription(sdp, 'offer');
        pc2.setLocalDescription('answer');
      }
    });

    pc2.onLocalDescription((sdp, type) => {
      pc2LocalDescs.push({ sdp, type });
      if (type.toLowerCase() === 'answer') {
        pc1.setRemoteDescription(sdp, 'answer');
      }
    });

    // ICE candidate trickle (loopback — no STUN needed)
    pc1.onLocalCandidate((c, mid) => pc2.addRemoteCandidate(c, mid));
    pc2.onLocalCandidate((c, mid) => pc1.addRemoteCandidate(c, mid));

    // ── Track open promises ───────────────────────────────────────────
    const track1OpenP = new Promise<void>(r => track1.onOpen(() => r()));
    const track2OpenP = new Promise<void>(r => track2.onOpen(() => r()));

    // ── onMessage promise ─────────────────────────────────────────────
    let receivedBuf: Buffer | null = null;
    const msgP = new Promise<void>(r => {
      track2.onMessage((buf: Buffer) => {
        if (receivedBuf === null) {
          receivedBuf = buf;
          r();
        }
      });
    });

    // ── Start: PC1 generates offer ────────────────────────────────────
    pc1.setLocalDescription('offer');

    // Wait for both tracks to open (up to 8 s).
    await Promise.race([
      Promise.all([track1OpenP, track2OpenP]),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('timeout: tracks did not open within 8s')), 8000)
      ),
    ]);

    // ── Verify: PC2 generated exactly ONE answer, zero spurious offers ─
    const answers = pc2LocalDescs.filter(d => d.type.toLowerCase() === 'answer');
    const offers  = pc2LocalDescs.filter(d => d.type.toLowerCase() === 'offer');
    expect(answers.length).toBe(1);
    expect(offers.length).toBe(0);

    // ── Send RTP from browser track → bot track should receive it ─────
    const rtp = makeRtpPacket(11111111);
    track1.sendMessageBinary(rtp);

    await Promise.race([
      msgP,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('timeout: onMessage did not fire within 3s')), 3000)
      ),
    ]);

    expect(receivedBuf).not.toBeNull();
    expect((receivedBuf as Buffer).length).toBeGreaterThan(0);

    // ── Cleanup ───────────────────────────────────────────────────────
    pc1.close();
    pc2.close();
  }, 15000); // 15-second timeout for the integration test
});
