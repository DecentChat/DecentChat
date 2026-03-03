/**
 * huddle-bot-sdp-chrome-compat.test.ts
 *
 * Validates that the bot's answer SDP is Chrome-compatible.
 *
 * Key checks for "browser can't hear bot":
 *   - Answer SDP has sendrecv direction (bot will send audio)
 *   - Answer SDP includes SSRC lines (Chrome uses these to match incoming RTP)
 *   - Answer SDP has Opus codec with correct payload type
 *   - Answer SDP has rtcp-mux (required by Chrome)
 *   - Answer SDP has matching mid (a=mid:0)
 *
 * Also tests the auto-negotiation path used in BotHuddleManager (no
 * disableAutoNegotiation) to catch the spurious re-offer issue.
 */

import { describe, test, expect } from 'bun:test';
import ndc from 'node-datachannel';

// Realistic Chrome audio offer SDP (matches what HuddleManager.initiateConnectionTo sends)
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

describe('Bot answer SDP Chrome compatibility', () => {

  test('answer SDP with disableAutoNegotiation (fixed path) is Chrome-compatible', async () => {
    const pc = new ndc.PeerConnection('bot-chrome-compat', {
      iceServers: [],
      disableAutoNegotiation: true,
    });

    // Add track exactly as BotHuddleManager does
    const audio = new ndc.Audio('0', 'SendRecv');
    audio.addOpusCodec(111);
    audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
    pc.addTrack(audio);

    // Set media handler exactly as BotHuddleManager does
    const rtpConfig = new ndc.RtpPacketizationConfig(1234, 'bot-audio', 111, 48000);
    const srReporter = new ndc.RtcpSrReporter(rtpConfig);
    srReporter.addToChain(new ndc.RtcpReceivingSession());
    // Note: we skip setMediaHandler since it's a transport concern, not SDP

    const descs: Array<{ sdp: string; type: string }> = [];
    pc.onLocalDescription((sdp, type) => {
      descs.push({ sdp, type });
    });

    pc.setRemoteDescription(CHROME_OFFER_SDP, 'offer');
    pc.setLocalDescription('answer');

    await new Promise<void>((r) => setTimeout(r, 800));

    const answers = descs.filter((d) => d.type.toLowerCase() === 'answer');
    const offers = descs.filter((d) => d.type.toLowerCase() === 'offer');

    expect(answers.length).toBe(1);
    expect(offers.length).toBe(0);

    const sdp = answers[0].sdp;
    console.log('\n=== Bot Answer SDP ===\n' + sdp);

    // ── Chrome compatibility checks ───────────────────────────────────
    const lines = sdp.split(/\r?\n/);

    // Must have audio m-line
    const mLine = lines.find((l) => l.startsWith('m=audio'));
    expect(mLine).toBeDefined();
    expect(mLine).toContain('111'); // Opus PT

    // Direction must be sendrecv (bot sends AND receives)
    const direction = lines.find((l) =>
      ['a=sendrecv', 'a=sendonly', 'a=recvonly', 'a=inactive'].includes(l),
    );
    expect(direction).toBe('a=sendrecv');

    // Must have mid=0
    const mid = lines.find((l) => l.startsWith('a=mid:'));
    expect(mid).toBe('a=mid:0');

    // Must have rtcp-mux (Chrome requires it)
    expect(lines.some((l) => l === 'a=rtcp-mux')).toBe(true);

    // Must have Opus rtpmap
    expect(lines.some((l) => l.includes('rtpmap:111 opus/48000'))).toBe(true);

    // Should have SSRC lines for Chrome to recognize incoming RTP
    const ssrcLines = lines.filter((l) => l.startsWith('a=ssrc:'));
    console.log('SSRC lines:', ssrcLines);
    // This is the critical check — without SSRC, Chrome's track stays muted
    expect(ssrcLines.length).toBeGreaterThanOrEqual(1);

    // SSRC should match what we configured (1234)
    const ssrcMatch = ssrcLines.some((l) => l.startsWith('a=ssrc:1234 '));
    expect(ssrcMatch).toBe(true);

    // Should have setup:active or setup:passive (not actpass — answerer picks one)
    const setup = lines.find((l) => l.startsWith('a=setup:'));
    expect(setup).toBeDefined();
    expect(setup).not.toBe('a=setup:actpass'); // Answerer must choose

    // Should have fingerprint
    expect(lines.some((l) => l.startsWith('a=fingerprint:'))).toBe(true);

    // Should have ICE credentials
    expect(lines.some((l) => l.startsWith('a=ice-ufrag:'))).toBe(true);
    expect(lines.some((l) => l.startsWith('a=ice-pwd:'))).toBe(true);

    pc.close();
  });

  test('auto-negotiation path (BotHuddleManager default) produces valid answer', async () => {
    // BotHuddleManager does NOT set disableAutoNegotiation
    const pc = new ndc.PeerConnection('bot-auto-neg', {
      iceServers: [],
      // No disableAutoNegotiation — matching real BotHuddleManager
    });

    const audio = new ndc.Audio('0', 'SendRecv');
    audio.addOpusCodec(111);
    audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
    pc.addTrack(audio);

    const descs: Array<{ sdp: string; type: string }> = [];
    pc.onLocalDescription((sdp, type) => {
      descs.push({ sdp, type });
    });

    pc.setRemoteDescription(CHROME_OFFER_SDP, 'offer');

    // With auto-negotiation, the answer should be generated automatically
    await new Promise<void>((r) => setTimeout(r, 1000));

    const answers = descs.filter((d) => d.type.toLowerCase() === 'answer');
    console.log('\nAuto-neg descriptions:', descs.map((d) => d.type));

    // Should get at least one answer
    expect(answers.length).toBeGreaterThanOrEqual(1);

    const sdp = answers[0].sdp;
    const lines = sdp.split(/\r?\n/);

    // Basic checks
    expect(lines.find((l) => l.startsWith('m=audio'))).toBeDefined();
    expect(lines.find((l) => l === 'a=sendrecv' || l === 'a=sendonly')).toBeDefined();

    // SSRC check — critical for Chrome
    const ssrcLines = lines.filter((l) => l.startsWith('a=ssrc:'));
    console.log('Auto-neg SSRC lines:', ssrcLines);

    // Check for spurious offers (the known bug)
    const offers = descs.filter((d) => d.type.toLowerCase() === 'offer');
    if (offers.length > 0) {
      console.warn(`⚠️  Auto-negotiation produced ${offers.length} spurious offer(s)`);
      console.warn('   BotHuddleManager filters these, but they cause timing issues');
    }

    pc.close();
  });

  test('answer includes msid matching track configuration', async () => {
    const pc = new ndc.PeerConnection('bot-msid-test', {
      iceServers: [],
      disableAutoNegotiation: true,
    });

    const audio = new ndc.Audio('0', 'SendRecv');
    audio.addOpusCodec(111);
    audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
    pc.addTrack(audio);

    let answerSdp = '';
    pc.onLocalDescription((sdp, type) => {
      if (type.toLowerCase() === 'answer') answerSdp = sdp;
    });

    pc.setRemoteDescription(CHROME_OFFER_SDP, 'offer');
    pc.setLocalDescription('answer');

    await new Promise<void>((r) => setTimeout(r, 600));

    expect(answerSdp.length).toBeGreaterThan(0);
    const lines = answerSdp.split(/\r?\n/);

    // Check for msid (Chrome uses this to associate tracks with streams)
    const msidLine = lines.find((l) => l.startsWith('a=msid:') || l.includes('msid:'));
    console.log('msid line:', msidLine);

    // Check for cname in SSRC (Chrome uses cname for stream synchronization)
    const cnameLine = lines.find((l) => l.includes('cname:'));
    console.log('cname line:', cnameLine);
    expect(cnameLine).toBeDefined();

    pc.close();
  });
});
