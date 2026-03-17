/**
 * Huddle noise debug test — replicates EXACTLY what BotHuddleManager does:
 * 1. Media handler chain (RtcpSrReporter + RtcpReceivingSession)
 * 2. Manual RTP construction (same as BotHuddleManager.handleOffer)
 * 3. Stereo Opus encoding (same as diagnostic test tone)
 * 4. Chrome as receiver with amplitude analysis
 *
 * If Chrome plays noise → the manual RTP + media handler combo is broken
 * If Chrome plays clean sine → something else in the live flow is different
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
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  page = await (await browser.newContext()).newPage();
  page.on('console', msg => console.log(`[chrome] ${msg.text()}`));
  await page.setContent(`<html><body><h1>Huddle Noise Debug</h1><script>
    window.diag = { ontrackFired: false, trackMuted: null, playOk: false, connState: null, maxAmp: 0, ampSamples: [] };
  </script></body></html>`);
}, 120000);

afterAll(async () => { await browser?.close(); }, 120000);

async function setupWebRTC(track: ndc.Track) {
  const botPc = (track as any).__pc;

  // Browser creates offer
  const offer = await page.evaluate(async () => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    (window as any).pc = pc;

    // Fake mic (needed to make the offer include audio)
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    for (const t of dest.stream.getTracks()) pc.addTrack(t, dest.stream);

    pc.ontrack = (ev) => {
      console.log('ontrack fired: kind=' + ev.track.kind + ' muted=' + ev.track.muted);
      window.diag.ontrackFired = true;
      window.diag.trackMuted = ev.track.muted;

      const rs = ev.streams[0] ?? new MediaStream([ev.track]);
      const a = new Audio();
      a.autoplay = true;
      a.id = 'bot-audio';
      document.body.appendChild(a);
      a.srcObject = rs;
      a.play().then(() => { window.diag.playOk = true; console.log('play() OK'); }).catch(e => console.log('play() err: ' + e));

      ev.track.onunmute = () => { window.diag.trackMuted = false; console.log('UNMUTED'); };

      // Amplitude monitoring
      try {
        const actx = new AudioContext();
        const msrc = actx.createMediaStreamSource(rs);
        const an = actx.createAnalyser();
        an.fftSize = 256;
        msrc.connect(an);
        const dd = new Uint8Array(an.frequencyBinCount);
        setInterval(() => {
          an.getByteTimeDomainData(dd);
          let mx = 0;
          for (let i = 0; i < dd.length; i++) {
            const v = Math.abs(dd[i] - 128);
            if (v > mx) mx = v;
          }
          if (mx > window.diag.maxAmp) window.diag.maxAmp = mx;
          window.diag.ampSamples.push(mx);
          if (mx > 2) console.log('amplitude: ' + mx + '/128');
        }, 100);
      } catch (e) {
        console.log('analyser error: ' + e);
      }
    };

    pc.onconnectionstatechange = () => {
      window.diag.connState = pc.connectionState;
      console.log('connState=' + pc.connectionState);
    };

    (window as any).bIce = [];
    pc.onicecandidate = (ev) => {
      if (ev.candidate) (window as any).bIce.push(ev.candidate.toJSON());
    };

    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    return { sdp: o.sdp, type: o.type };
  });

  return { offer };
}

async function finishWebRTC(botPc: ndc.PeerConnection, offer: any, answer: any) {
  await page.evaluate(async (a: any) => {
    await ((window as any).pc as RTCPeerConnection).setRemoteDescription(new RTCSessionDescription(a));
  }, answer);

  // ICE exchange
  await new Promise(r => setTimeout(r, 1500));
  const bIce = await page.evaluate(() => (window as any).bIce);
  for (const c of bIce) {
    if (c.candidate) try { botPc.addRemoteCandidate(c.candidate, c.sdpMid || '0'); } catch {}
  }
  await page.evaluate(async (cs: any[]) => {
    for (const c of cs) {
      try {
        await ((window as any).pc as RTCPeerConnection).addIceCandidate(
          new RTCIceCandidate({ candidate: c.candidate, sdpMid: c.mid }),
        );
      } catch {}
    }
  }, []);

  // Wait for connection
  for (let i = 0; i < 30; i++) {
    const st = await page.evaluate(() => window.diag.connState);
    if (st === 'connected') break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1000));
}

describe('Huddle noise debug', () => {
  it('BotHuddleManager-identical setup: media handler + manual RTP + stereo Opus → Chrome hears clean audio', async () => {
    // === STEP 1: Create PC exactly like BotHuddleManager.handleOffer ===
    const botPc = new ndc.PeerConnection('bot-huddle', {
      iceServers: ['stun:stun.l.google.com:19302'],
    });

    const botCandidates: { candidate: string; mid: string }[] = [];
    botPc.onLocalCandidate((c, m) => botCandidates.push({ candidate: c, mid: m }));

    const answerPromise = new Promise<{ sdp: string; type: string }>((resolve) => {
      botPc.onLocalDescription((sdp, type) => {
        const lt = type.toLowerCase();
        console.log(`[bot] onLocalDescription type=${lt} (${sdp.length} chars)`);
        if (lt === 'answer') resolve({ sdp, type: lt });
      });
    });

    // Same track config as BotHuddleManager
    const opusPt = 111;
    const audio = new ndc.Audio('0', 'SendRecv');
    audio.addOpusCodec(opusPt);
    audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
    const track = botPc.addTrack(audio);

    // === MEDIA HANDLER CHAIN (the fix) ===
    const rtpCfg = new ndc.RtpPacketizationConfig(1234, 'bot-audio', opusPt, 48000);
    const srReporter = new ndc.RtcpSrReporter(rtpCfg);
    srReporter.addToChain(new ndc.RtcpReceivingSession());
    track.setMediaHandler(srReporter);

    // Same manual RTP config as BotHuddleManager
    const manualRtp = {
      ssrc: 1234,
      payloadType: opusPt,
      sequenceNumber: Math.floor(Math.random() * 65535),
      timestamp: Math.floor(Math.random() * 0xFFFFFFFF),
    };

    const trackOpenP = new Promise<void>(resolve => {
      track.onOpen(() => {
        console.log('[bot] track OPEN');
        resolve();
      });
    });

    // Browser creates offer
    const offer = await page.evaluate(async () => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      (window as any).pc = pc;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      for (const t of dest.stream.getTracks()) pc.addTrack(t, dest.stream);

      pc.ontrack = (ev) => {
        console.log('ontrack: kind=' + ev.track.kind + ' muted=' + ev.track.muted);
        window.diag.ontrackFired = true;
        window.diag.trackMuted = ev.track.muted;
        const rs = ev.streams[0] ?? new MediaStream([ev.track]);
        const a = new Audio();
        a.autoplay = true;
        a.id = 'bot-audio';
        document.body.appendChild(a);
        a.srcObject = rs;
        a.play().then(() => { window.diag.playOk = true; console.log('play() ok'); }).catch(() => {});
        ev.track.onunmute = () => { window.diag.trackMuted = false; console.log('UNMUTED'); };
        try {
          const actx = new AudioContext();
          const msrc = actx.createMediaStreamSource(rs);
          const an = actx.createAnalyser();
          an.fftSize = 2048;
          msrc.connect(an);
          const freq = new Float32Array(an.frequencyBinCount);
          const td = new Uint8Array(an.frequencyBinCount);
          setInterval(() => {
            an.getByteTimeDomainData(td);
            let mx = 0;
            for (let i = 0; i < td.length; i++) {
              const v = Math.abs(td[i] - 128);
              if (v > mx) mx = v;
            }
            if (mx > window.diag.maxAmp) window.diag.maxAmp = mx;
            window.diag.ampSamples.push(mx);
            if (mx > 2) console.log('amp=' + mx);

            // Also do frequency analysis
            an.getFloatFrequencyData(freq);
            let peakIdx = 0;
            let peakVal = -Infinity;
            for (let i = 0; i < freq.length; i++) {
              if (freq[i] > peakVal) { peakVal = freq[i]; peakIdx = i; }
            }
            const peakFreq = peakIdx * 48000 / (2 * freq.length);
            if (peakVal > -50) console.log('peak freq: ' + Math.round(peakFreq) + 'Hz @ ' + peakVal.toFixed(1) + 'dB');
          }, 200);
        } catch (e) {
          console.log('analyser error: ' + e);
        }
      };

      pc.onconnectionstatechange = () => {
        window.diag.connState = pc.connectionState;
        console.log('conn=' + pc.connectionState);
      };
      (window as any).bIce = [];
      pc.onicecandidate = (ev) => {
        if (ev.candidate) (window as any).bIce.push(ev.candidate.toJSON());
      };
      const o = await pc.createOffer();
      await pc.setLocalDescription(o);
      return { sdp: o.sdp, type: o.type };
    });

    // Set remote description (auto-negotiation generates answer)
    botPc.setRemoteDescription(offer.sdp!, 'Offer' as any);
    const answer = await answerPromise;
    console.log('[bot] Answer SDP:\n' + answer.sdp);

    // Complete ICE
    await page.evaluate(async (a: any) => {
      await ((window as any).pc as RTCPeerConnection).setRemoteDescription(new RTCSessionDescription(a));
    }, answer);

    await new Promise(r => setTimeout(r, 1500));
    const bIce = await page.evaluate(() => (window as any).bIce);
    for (const c of bIce) {
      if (c.candidate) try { botPc.addRemoteCandidate(c.candidate, c.sdpMid || '0'); } catch {}
    }
    await page.evaluate(async (cs: any[]) => {
      for (const c of cs) {
        try { await ((window as any).pc as RTCPeerConnection).addIceCandidate(new RTCIceCandidate({ candidate: c.candidate, sdpMid: c.mid })); } catch {}
      }
    }, botCandidates);

    for (let i = 0; i < 30; i++) {
      const st = await page.evaluate(() => window.diag.connState);
      if (st === 'connected') break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Wait for track to open
    await Promise.race([trackOpenP, new Promise(r => setTimeout(r, 10000))]);
    await new Promise(r => setTimeout(r, 500));

    // === STEP 2: Send stereo Opus sine wave (same as BotHuddleManager test tone) ===
    console.log('[bot] Encoding stereo Opus sine wave...');
    const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    const SPF = 960; // samples per frame (20ms at 48kHz)
    const FREQ = 440;
    const NUM_FRAMES = 100; // 2 seconds

    let sentOk = 0;
    let sentFail = 0;

    for (let f = 0; f < NUM_FRAMES; f++) {
      // Generate stereo PCM (interleaved L,R)
      const stereoPcm = Buffer.alloc(SPF * 4); // 960 samples * 2 channels * 2 bytes
      for (let i = 0; i < SPF; i++) {
        const sample = Math.round(Math.sin(2 * Math.PI * FREQ * (f * SPF + i) / 48000) * 8000);
        stereoPcm.writeInt16LE(sample, i * 4);     // L
        stereoPcm.writeInt16LE(sample, i * 4 + 2); // R
      }

      const opusFrame = Buffer.from(encoder.encode(stereoPcm, SPF));

      // Manual RTP header — SAME code as BotHuddleManager
      manualRtp.sequenceNumber = (manualRtp.sequenceNumber + 1) & 0xFFFF;
      manualRtp.timestamp = (manualRtp.timestamp + SPF) >>> 0;

      const hdr = Buffer.alloc(12);
      hdr[0] = 0x80;
      hdr[1] = (f === 0 ? 0x80 : 0x00) | manualRtp.payloadType;
      hdr.writeUInt16BE(manualRtp.sequenceNumber, 2);
      hdr.writeUInt32BE(manualRtp.timestamp, 4);
      hdr.writeUInt32BE(manualRtp.ssrc, 8);

      const rtpPacket = Buffer.concat([hdr, opusFrame]);
      const ok = track.sendMessageBinary(rtpPacket);
      if (ok) sentOk++;
      else sentFail++;

      if (f < 3) {
        console.log(`[bot] frame ${f}: ${rtpPacket.length}b (opus=${opusFrame.length}b), seq=${manualRtp.sequenceNumber}, ts=${manualRtp.timestamp}, sent=${ok}`);
      }

      await new Promise(r => setTimeout(r, 18));
    }

    encoder.delete();
    console.log(`[bot] Sent ${sentOk}/${NUM_FRAMES} frames (${sentFail} failed)`);

    // === STEP 3: Wait and collect diagnostics ===
    await new Promise(r => setTimeout(r, 4000));

    const diag = await page.evaluate(async () => {
      const pc = (window as any).pc as RTCPeerConnection;
      const stats = await pc.getStats();
      let inbound: any = null;
      stats.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio')
          inbound = {
            ssrc: r.ssrc,
            pkts: r.packetsReceived,
            bytes: r.bytesReceived,
            lost: r.packetsLost,
            jitter: r.jitter,
            codecId: r.codecId,
          };
      });
      // Get codec info
      let codec: any = null;
      if (inbound?.codecId) {
        stats.forEach((r: any) => {
          if (r.id === inbound.codecId)
            codec = { mimeType: r.mimeType, clockRate: r.clockRate, channels: r.channels, sdpFmtpLine: r.sdpFmtpLine };
        });
      }
      const a = document.getElementById('bot-audio') as HTMLAudioElement | null;
      return {
        ...window.diag,
        audioTime: a?.currentTime ?? -1,
        paused: a?.paused ?? true,
        inbound,
        codec,
      };
    });

    console.log('\n' + '='.repeat(60));
    console.log('DIAGNOSTICS');
    console.log('='.repeat(60));
    console.log(JSON.stringify(diag, null, 2));
    console.log('='.repeat(60));

    // Assertions
    expect(diag.connState).toBe('connected');
    expect(diag.ontrackFired).toBe(true);

    if (diag.inbound) {
      console.log(`\n✅ Inbound RTP: ${diag.inbound.pkts} pkts, ${diag.inbound.bytes} bytes, SSRC=${diag.inbound.ssrc}`);
      expect(diag.inbound.pkts).toBeGreaterThan(0);
    } else {
      console.log('\n❌ NO inbound-rtp stats — 0 packets received');
    }

    // Check amplitude — anything above 5/128 is audible signal
    console.log(`Max amplitude: ${diag.maxAmp}/128`);
    const nonZeroSamples = (diag.ampSamples as number[]).filter(a => a > 2).length;
    console.log(`Non-zero amplitude samples: ${nonZeroSamples}/${(diag.ampSamples as number[]).length}`);

    if (diag.maxAmp > 30) {
      console.log('✅ Strong audio signal — Chrome is playing real audio');
    } else if (diag.maxAmp > 5) {
      console.log('⚠️ Weak but present signal');
    } else {
      console.log('❌ Silence — Chrome got packets but couldn\'t decode them');
    }

    // Signal should be clean (not noise), so max amplitude should be reasonable
    // A 440Hz sine at 8000 amplitude through Opus should produce moderate levels
    expect(diag.maxAmp).toBeGreaterThan(3);

    botPc.close();
  }, 60000);
});
