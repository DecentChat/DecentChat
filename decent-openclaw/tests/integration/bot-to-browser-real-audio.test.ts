/**
 * Bot-to-Browser with REAL Opus-encoded audio (not silence frames).
 * If Chrome plays noise → encoding/packetization bug.
 * If Chrome plays sine wave → encoding is fine, issue is elsewhere.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';
import ndc from 'node-datachannel';
import OpusScript from 'opusscript';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  page = await (await browser.newContext()).newPage();
  page.on('console', msg => console.log(`[chrome] ${msg.text()}`));
  await page.setContent(`<html><body><h1>Real Audio Test</h1><script>
    window.diag = { ontrackFired: false, trackMuted: null, playOk: false, connState: null };
  </script></body></html>`);
}, 120000);
afterAll(async () => { await browser?.close(); }, 120000);

describe('Bot to Browser REAL audio', () => {
  it('Chrome decodes Opus-encoded sine wave correctly', async () => {
    // Encode a 440Hz sine wave with OpusScript (same as TTS)
    const encoder = new OpusScript(48000, 1, OpusScript.Application.AUDIO);
    const frameSize = 960;
    const bytesPerFrame = frameSize * 2;
    const numFrames = 100; // 2 seconds
    const pcm = Buffer.alloc(numFrames * bytesPerFrame);

    for (let i = 0; i < numFrames * frameSize; i++) {
      const value = Math.round(16000 * Math.sin(2 * Math.PI * 440 * i / 48000));
      pcm.writeInt16LE(value, i * 2);
    }

    // Encode all frames
    const opusFrames: Buffer[] = [];
    for (let f = 0; f < numFrames; f++) {
      const frame = pcm.subarray(f * bytesPerFrame, (f + 1) * bytesPerFrame);
      const encoded = encoder.encode(frame, frameSize);
      opusFrames.push(Buffer.from(encoded));
    }
    console.log(`[bot] Encoded ${opusFrames.length} Opus frames, sizes: ${opusFrames.slice(0,5).map(f=>f.length).join(', ')}...`);

    // Create bot PeerConnection
    const botPc = new ndc.PeerConnection('bot', { iceServers: [] });
    const botCandidates: { candidate: string; mid: string }[] = [];
    botPc.onLocalCandidate((c, m) => botCandidates.push({ candidate: c, mid: m }));
    const answerP = new Promise<{ sdp: string; type: string }>((resolve) => {
      botPc.onLocalDescription((sdp, type) => {
        if (type.toLowerCase() === 'answer') resolve({ sdp, type: type.toLowerCase() });
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

    // Browser offer
    const offer = await page.evaluate(async () => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      (window as any).pc = pc;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator(); osc.frequency.setValueAtTime(440, ctx.currentTime);
      const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start();
      for (const t of dest.stream.getTracks()) pc.addTrack(t, dest.stream);

      pc.ontrack = (ev) => {
        console.log('ontrack! muted=' + ev.track.muted);
        window.diag.ontrackFired = true;
        window.diag.trackMuted = ev.track.muted;
        const rs = ev.streams[0] ?? new MediaStream([ev.track]);
        const a = new Audio(); a.autoplay = true; a.id = 'bot-audio';
        document.body.appendChild(a); a.srcObject = rs;
        a.play().then(() => { window.diag.playOk = true; }).catch(() => {});
        ev.track.onmute = () => { window.diag.trackMuted = true; };
        ev.track.onunmute = () => { window.diag.trackMuted = false; console.log('UNMUTED'); };

        // Amplitude analysis
        try {
          const actx = new AudioContext();
          const msrc = actx.createMediaStreamSource(rs);
          const an = actx.createAnalyser(); an.fftSize = 256;
          msrc.connect(an);
          const dd = new Uint8Array(an.frequencyBinCount);
          (window as any)._ampInterval = setInterval(() => {
            an.getByteTimeDomainData(dd);
            let mx = 0;
            for (let i = 0; i < dd.length; i++) { const v = Math.abs(dd[i] - 128); if (v > mx) mx = v; }
            if (mx > 0) console.log('amplitude: ' + mx + '/128');
          }, 200);
        } catch (e) { console.log('analyser error: ' + e); }
      };
      pc.onconnectionstatechange = () => { window.diag.connState = pc.connectionState; };
      (window as any).bIce = [];
      pc.onicecandidate = (ev) => { if (ev.candidate) (window as any).bIce.push(ev.candidate.toJSON()); };
      const o = await pc.createOffer(); await pc.setLocalDescription(o);
      return { sdp: o.sdp, type: o.type };
    });

    botPc.setRemoteDescription(offer.sdp!, offer.type as 'offer');
    const answer = await answerP;
    await page.evaluate(async (a: any) => {
      await ((window as any).pc as RTCPeerConnection).setRemoteDescription(new RTCSessionDescription(a));
    }, answer);

    await new Promise(r => setTimeout(r, 1500));
    const bIce = await page.evaluate(() => (window as any).bIce);
    for (const c of bIce) { if (c.candidate) try { botPc.addRemoteCandidate(c.candidate, c.sdpMid || '0'); } catch {} }
    await page.evaluate(async (cs: any[]) => {
      for (const c of cs) try { await ((window as any).pc as RTCPeerConnection).addIceCandidate(new RTCIceCandidate({ candidate: c.candidate, sdpMid: c.mid })); } catch {}
    }, botCandidates);

    // Wait for connection
    for (let i = 0; i < 20; i++) {
      const st = await page.evaluate(() => window.diag.connState);
      if (st === 'connected') break;
      await new Promise(r => setTimeout(r, 500));
    }

    await new Promise(r => setTimeout(r, 1000));

    // Send REAL Opus-encoded audio
    console.log('[bot] Sending 100 real Opus frames (2 seconds of 440Hz sine)...');
    let ok = 0, fail = 0;
    for (let seq = 0; seq < opusFrames.length; seq++) {
      const h = Buffer.alloc(12);
      h[0] = 0x80;
      h[1] = (seq === 0 ? 0x80 : 0) | 111;
      h.writeUInt16BE(seq & 0xffff, 2);
      h.writeUInt32BE((seq * 960) >>> 0, 4);
      h.writeUInt32BE(1234, 8);
      const rtp = Buffer.concat([h, opusFrames[seq]]);
      if (track.sendMessageBinary(rtp)) ok++; else fail++;
      await new Promise(r => setTimeout(r, 20));
    }
    console.log(`[bot] Sent ${ok}/${opusFrames.length}`);

    // Wait for playback + analysis
    await new Promise(r => setTimeout(r, 3000));

    const diag = await page.evaluate(async () => {
      const pc = (window as any).pc as RTCPeerConnection;
      const stats = await pc.getStats();
      let inbound: any = null;
      stats.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio')
          inbound = { ssrc: r.ssrc, pkts: r.packetsReceived, bytes: r.bytesReceived };
      });
      const a = document.getElementById('bot-audio') as HTMLAudioElement | null;
      return { ...window.diag, time: a?.currentTime ?? -1, inbound };
    });

    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(diag, null, 2));
    if (diag.inbound) console.log(`Inbound: ${diag.inbound.pkts} pkts, ${diag.inbound.bytes} bytes`);

    expect(diag.connState).toBe('connected');
    expect(diag.ontrackFired).toBe(true);
    if (diag.inbound) expect(diag.inbound.pkts).toBeGreaterThan(0);

    encoder.delete();
    botPc.close();
  }, 45000);
});
