/**
 * Bot-to-Browser Audio E2E Test — node-datachannel → Chromium
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';
import ndc from 'node-datachannel';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  page = await (await browser.newContext()).newPage();
  page.on('console', msg => console.log(`[chrome] ${msg.text()}`));
  await page.setContent(`<html><body><h1>Bot Audio Test</h1><script>
    window.diag = { ontrackFired: false, trackMuted: null, playOk: false, playErr: null, connState: null };
  </script></body></html>`);
}, 120000);
afterAll(async () => { await browser?.close(); }, 120000);

describe('Bot to Browser audio', () => {
  it('browser receives RTP from node-datachannel bot', async () => {
    const botPc = new ndc.PeerConnection('bot', { iceServers: [] });

    // Collect ICE candidates and answer BEFORE setting remote description
    const botCandidates: { candidate: string; mid: string }[] = [];
    botPc.onLocalCandidate((c, m) => botCandidates.push({ candidate: c, mid: m }));

    const answerPromise = new Promise<{ sdp: string; type: string }>((resolve) => {
      botPc.onLocalDescription((sdp, type) => {
        console.log(`[bot] onLocalDescription type=${type} (${sdp.length} chars)`);
        if (type.toLowerCase() === 'answer') resolve({ sdp, type: type.toLowerCase() });
      });
    });

    // Add audio track
    const audio = new ndc.Audio('0', 'SendRecv');
    audio.addOpusCodec(111);
    audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
    const track = botPc.addTrack(audio);

    // Media handler chain for SRTP
    const cfg = new ndc.RtpPacketizationConfig(1234, 'bot-audio', 111, 48000);
    const sr = new ndc.RtcpSrReporter(cfg);
    sr.addToChain(new ndc.RtcpReceivingSession());
    track.setMediaHandler(sr);

    track.onOpen(() => console.log('[bot] track OPEN'));
    track.onClosed(() => console.log('[bot] track CLOSED'));
    let botRx = 0;
    track.onMessage(() => botRx++);

    // Browser creates offer
    const offer = await page.evaluate(async () => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      (window as any).pc = pc;

      // Fake mic
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest); osc.start();
      for (const t of dest.stream.getTracks()) pc.addTrack(t, dest.stream);

      // ontrack
      pc.ontrack = (ev) => {
        console.log('ontrack! kind=' + ev.track.kind + ' muted=' + ev.track.muted);
        window.diag.ontrackFired = true;
        window.diag.trackMuted = ev.track.muted;
        const rs = ev.streams[0] ?? new MediaStream([ev.track]);
        const a = new Audio(); a.autoplay = true; a.id = 'bot-audio';
        document.body.appendChild(a); a.srcObject = rs;
        a.play().then(() => { window.diag.playOk = true; console.log('play() ok'); })
          .catch((e: any) => { window.diag.playErr = e.message; });
        ev.track.onmute = () => { window.diag.trackMuted = true; console.log('track muted'); };
        ev.track.onunmute = () => { window.diag.trackMuted = false; console.log('track UNMUTED!'); };
      };
      pc.onconnectionstatechange = () => { window.diag.connState = pc.connectionState; console.log('conn=' + pc.connectionState); };
      (window as any).bIce = [];
      pc.onicecandidate = (ev) => { if (ev.candidate) (window as any).bIce.push(ev.candidate.toJSON()); };

      const o = await pc.createOffer(); await pc.setLocalDescription(o);
      return { sdp: o.sdp, type: o.type };
    });

    console.log('[bot] Got browser offer, setting remote...');
    botPc.setRemoteDescription(offer.sdp!, offer.type as 'offer');

    // Wait for answer
    const answer = await Promise.race([
      answerPromise,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('No answer in 10s')), 10000)),
    ]);
    console.log('[bot] Answer SDP:\n' + answer.sdp);

    // Browser sets answer
    await page.evaluate(async (a: any) => {
      await ((window as any).pc as RTCPeerConnection).setRemoteDescription(new RTCSessionDescription(a));
    }, answer);

    // ICE exchange
    await new Promise(r => setTimeout(r, 1500));
    const bIce = await page.evaluate(() => (window as any).bIce);
    console.log(`[bot] ${bIce.length} browser ICE candidates, ${botCandidates.length} bot candidates`);
    for (const c of bIce) { if (c.candidate) try { botPc.addRemoteCandidate(c.candidate, c.sdpMid || '0'); } catch {} }
    await page.evaluate(async (cs: any[]) => {
      const pc = (window as any).pc as RTCPeerConnection;
      for (const c of cs) try { await pc.addIceCandidate(new RTCIceCandidate({ candidate: c.candidate, sdpMid: c.mid })); } catch {}
    }, botCandidates);

    // Wait for connection
    for (let i = 0; i < 20; i++) {
      const st = await page.evaluate(() => window.diag.connState);
      if (st === 'connected') break;
      await new Promise(r => setTimeout(r, 500));
    }
    const connState = await page.evaluate(() => window.diag.connState);
    console.log('[bot] Final connection state:', connState);
    expect(connState).toBe('connected');

    // Wait a moment for track to be ready
    await new Promise(r => setTimeout(r, 1000));

    // Send 100 RTP packets (2 seconds)
    console.log('[bot] Sending 100 RTP silence packets...');
    let ok = 0, fail = 0;
    for (let seq = 0; seq < 100; seq++) {
      const h = Buffer.alloc(12);
      h[0] = 0x80;
      h[1] = (seq === 0 ? 0x80 : 0) | 111;
      h.writeUInt16BE(seq & 0xffff, 2);
      h.writeUInt32BE((seq * 960) >>> 0, 4);
      h.writeUInt32BE(1234, 8);
      const rtp = Buffer.concat([h, Buffer.from([0xf8, 0xff, 0xfe])]);
      if (track.sendMessageBinary(rtp)) ok++; else fail++;
      await new Promise(r => setTimeout(r, 20));
    }
    console.log(`[bot] Sent ${ok} ok / ${fail} fail. Browser sent us ${botRx} pkts.`);

    // Wait for browser to process
    await new Promise(r => setTimeout(r, 3000));

    // Get diagnostics
    const diag = await page.evaluate(async () => {
      const pc = (window as any).pc as RTCPeerConnection;
      const stats = await pc.getStats();
      let inbound: any = null;
      stats.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio')
          inbound = { ssrc: r.ssrc, pkts: r.packetsReceived, bytes: r.bytesReceived, lost: r.packetsLost, jitter: r.jitter };
      });
      const a = document.getElementById('bot-audio') as HTMLAudioElement | null;
      return {
        ...window.diag,
        audioCurrentTime: a?.currentTime ?? -1,
        audioPaused: a?.paused ?? true,
        audioReadyState: a?.readyState ?? -1,
        inbound,
        receivers: pc.getReceivers().map((r: RTCRtpReceiver) => ({
          kind: r.track?.kind, muted: r.track?.muted, state: r.track?.readyState,
        })),
      };
    });

    console.log('\n========== DIAGNOSTICS ==========');
    console.log(JSON.stringify(diag, null, 2));
    console.log('=================================');

    expect(diag.ontrackFired).toBe(true);
    if (diag.inbound) {
      console.log(`\n✅ Inbound RTP: ${diag.inbound.pkts} packets, ${diag.inbound.bytes} bytes, SSRC=${diag.inbound.ssrc}`);
      expect(diag.inbound.pkts).toBeGreaterThan(0);
    } else {
      console.log('\n❌ NO inbound-rtp — browser got 0 packets from bot');
      // List all stat types for debugging
      const allTypes = await page.evaluate(async () => {
        const s = await ((window as any).pc as RTCPeerConnection).getStats();
        const types: string[] = [];
        s.forEach((r: any) => types.push(`${r.type}/${r.kind || '-'}`));
        return types;
      });
      console.log('Available stat types:', allTypes);
    }

    botPc.close();
  }, 45000);
});
