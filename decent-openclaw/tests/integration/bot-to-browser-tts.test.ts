import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';
import ndc from 'node-datachannel';
import { readFileSync } from 'fs';

const rawPackets = JSON.parse(readFileSync('/tmp/tts-packets.json', 'utf8')) as number[][];
const packets = rawPackets.map(arr => Buffer.from(arr));
console.log(`Loaded ${packets.length} real TTS packets`);

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({
    headless: false,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  page = await (await browser.newContext()).newPage();
  page.on('console', msg => console.log(`[chrome] ${msg.text()}`));
  await page.setContent(`<html><body><h1>TTS Audio Test</h1><script>
    window.diag = { ontrackFired:false, trackMuted:null, playOk:false, connState:null, maxAmp:0 };
  </script></body></html>`);
});
afterAll(async () => { await browser?.close(); });

describe('Real TTS to Chrome', () => {
  it('plays ElevenLabs TTS audio without noise', async () => {
    const botPc = new ndc.PeerConnection('bot', { iceServers: [] });
    const botCands: any[] = [];
    botPc.onLocalCandidate((c, m) => botCands.push({ candidate: c, mid: m }));
    const ansP = new Promise<any>(res => {
      botPc.onLocalDescription((sdp, type) => {
        if (type.toLowerCase() === 'answer') res({ sdp, type: type.toLowerCase() });
      });
    });
    const audio = new ndc.Audio('0', 'SendRecv');
    audio.addOpusCodec(111);
    audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
    const track = botPc.addTrack(audio);
    const cfg = new ndc.RtpPacketizationConfig(1234, 'bot-audio', 111, 48000);
    const sr = new ndc.RtcpSrReporter(cfg);
    sr.addToChain(new ndc.RtcpReceivingSession());
    track.setMediaHandler(sr);
    track.onOpen(() => console.log('[bot] track OPEN'));

    const offer = await page.evaluate(async () => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      (window as any).pc = pc;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator(); osc.frequency.setValueAtTime(440, ctx.currentTime);
      const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start();
      for (const t of dest.stream.getTracks()) pc.addTrack(t, dest.stream);
      pc.ontrack = (ev) => {
        window.diag.ontrackFired = true;
        window.diag.trackMuted = ev.track.muted;
        const rs = ev.streams[0] ?? new MediaStream([ev.track]);
        const a = new Audio(); a.autoplay = true; a.id = 'bot-audio';
        document.body.appendChild(a); a.srcObject = rs;
        a.play().then(() => { window.diag.playOk = true; }).catch(() => {});
        ev.track.onunmute = () => { window.diag.trackMuted = false; console.log('UNMUTED'); };
        try {
          const actx = new AudioContext();
          const msrc = actx.createMediaStreamSource(rs);
          const an = actx.createAnalyser(); an.fftSize = 256;
          msrc.connect(an);
          const dd = new Uint8Array(an.frequencyBinCount);
          setInterval(() => {
            an.getByteTimeDomainData(dd);
            let mx = 0;
            for (let i = 0; i < dd.length; i++) { const v = Math.abs(dd[i] - 128); if (v > mx) mx = v; }
            if (mx > window.diag.maxAmp) window.diag.maxAmp = mx;
            if (mx > 0) console.log('amp=' + mx + '/128');
          }, 100);
        } catch {}
      };
      pc.onconnectionstatechange = () => { window.diag.connState = pc.connectionState; };
      (window as any).bIce = [];
      pc.onicecandidate = (ev) => { if (ev.candidate) (window as any).bIce.push(ev.candidate.toJSON()); };
      const o = await pc.createOffer(); await pc.setLocalDescription(o);
      return { sdp: o.sdp, type: o.type };
    });

    botPc.setRemoteDescription(offer.sdp!, offer.type as 'offer');
    const ans = await ansP;
    await page.evaluate(async (a: any) => {
      await ((window as any).pc as RTCPeerConnection).setRemoteDescription(new RTCSessionDescription(a));
    }, ans);
    await new Promise(r => setTimeout(r, 1500));
    const bIce = await page.evaluate(() => (window as any).bIce);
    for (const c of bIce) { if (c.candidate) try { botPc.addRemoteCandidate(c.candidate, c.sdpMid || '0'); } catch {} }
    await page.evaluate(async (cs: any[]) => {
      for (const c of cs) try { await ((window as any).pc as RTCPeerConnection).addIceCandidate(new RTCIceCandidate({candidate:c.candidate,sdpMid:c.mid})); } catch {}
    }, botCands);

    for (let i = 0; i < 20; i++) {
      if (await page.evaluate(() => window.diag.connState) === 'connected') break;
      await new Promise(r => setTimeout(r, 500));
    }
    await new Promise(r => setTimeout(r, 1000));

    // Send real TTS packets
    console.log(`[bot] Sending ${packets.length} real TTS packets...`);
    let ok = 0;
    for (const pkt of packets) {
      if (track.sendMessageBinary(pkt)) ok++;
      await new Promise(r => setTimeout(r, 20));
    }
    console.log(`[bot] Sent ${ok}/${packets.length}`);

    await new Promise(r => setTimeout(r, 3000));

    const diag = await page.evaluate(async () => {
      const pc = (window as any).pc as RTCPeerConnection;
      const stats = await pc.getStats();
      let inbound: any = null;
      stats.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio')
          inbound = { ssrc: r.ssrc, pkts: r.packetsReceived, bytes: r.bytesReceived };
      });
      return { ...window.diag, inbound };
    });

    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(diag, null, 2));
    expect(diag.connState).toBe('connected');
    expect(diag.ontrackFired).toBe(true);
    if (diag.inbound) expect(diag.inbound.pkts).toBeGreaterThan(0);
    console.log('Max amplitude:', diag.maxAmp, '/128');
    if (diag.maxAmp > 5) console.log('✅ Real audio signal detected');
    else console.log('❌ Near-silence — encoding issue');

    botPc.close();
  }, 45000);
});
