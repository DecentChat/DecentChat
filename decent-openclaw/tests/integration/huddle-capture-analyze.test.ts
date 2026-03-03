/**
 * Capture and analyze what Chrome ACTUALLY receives from the bot.
 * Records the audio stream, saves as WAV, and does spectral analysis
 * to determine if it's clean signal or noise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';
import ndc from 'node-datachannel';
import OpusScript from 'opusscript';
import { writeFileSync } from 'fs';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({
    headless: false,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  page = await (await browser.newContext()).newPage();
  page.on('console', msg => console.log(`[chrome] ${msg.text()}`));
});

afterAll(async () => { await browser?.close(); });

describe('Huddle audio capture & analysis', () => {
  it('captures Chrome audio output and saves as WAV for analysis', async () => {
    // Set up page with audio recording capability
    await page.setContent(`<html><body><h1>Audio Capture Test</h1><script>
      window.diag = {
        ontrackFired: false,
        connState: null,
        recording: [],
        sampleRate: 48000,
        maxAmp: 0,
        peakFreqs: [],
      };

      window.startCapture = (stream) => {
        const ctx = new AudioContext({ sampleRate: 48000 });
        const source = ctx.createMediaStreamSource(stream);

        // Use ScriptProcessorNode to capture raw PCM samples
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        let totalSamples = 0;
        processor.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          // Convert to Int16 and store
          const samples = new Int16Array(data.length);
          for (let i = 0; i < data.length; i++) {
            const s = Math.max(-1, Math.min(1, data[i]));
            samples[i] = s < 0 ? s * 32768 : s * 32767;
          }
          window.diag.recording.push(Array.from(samples));
          totalSamples += data.length;

          // Amplitude analysis
          let mx = 0;
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i]);
            if (v > mx) mx = v;
          }
          if (mx > window.diag.maxAmp) window.diag.maxAmp = mx;

          // Simple frequency detection (zero-crossing rate)
          let crossings = 0;
          for (let i = 1; i < data.length; i++) {
            if ((data[i] >= 0) !== (data[i-1] >= 0)) crossings++;
          }
          const approxFreq = (crossings / 2) * (48000 / data.length);
          if (mx > 0.01) window.diag.peakFreqs.push(Math.round(approxFreq));
        };
        source.connect(processor);
        processor.connect(ctx.destination);

        // Also do FFT analysis
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        source.connect(analyser);
        const freqData = new Float32Array(analyser.frequencyBinCount);
        window._analyserInterval = setInterval(() => {
          analyser.getFloatFrequencyData(freqData);
          let peakIdx = 0, peakVal = -Infinity;
          for (let i = 1; i < freqData.length; i++) {
            if (freqData[i] > peakVal) { peakVal = freqData[i]; peakIdx = i; }
          }
          const hz = peakIdx * 48000 / analyser.fftSize;
          if (peakVal > -60) console.log('FFT peak: ' + Math.round(hz) + 'Hz @ ' + peakVal.toFixed(1) + 'dB');
        }, 200);

        console.log('Audio capture started');
      };
    </script></body></html>`);

    // === Bot setup (identical to BotHuddleManager) ===
    const botPc = new ndc.PeerConnection('bot-huddle', {
      iceServers: ['stun:stun.l.google.com:19302'],
    });

    const botCandidates: { candidate: string; mid: string }[] = [];
    botPc.onLocalCandidate((c, m) => botCandidates.push({ candidate: c, mid: m }));

    const answerPromise = new Promise<{ sdp: string; type: string }>((resolve) => {
      botPc.onLocalDescription((sdp, type) => {
        const lt = type.toLowerCase();
        if (lt === 'answer') resolve({ sdp, type: lt });
      });
    });

    const opusPt = 111;
    const audio = new ndc.Audio('0', 'SendRecv');
    audio.addOpusCodec(opusPt);
    audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
    const track = botPc.addTrack(audio);

    // Media handler chain (the fix)
    const rtpCfg = new ndc.RtpPacketizationConfig(1234, 'bot-audio', opusPt, 48000);
    const srReporter = new ndc.RtcpSrReporter(rtpCfg);
    srReporter.addToChain(new ndc.RtcpReceivingSession());
    track.setMediaHandler(srReporter);

    const manualRtp = {
      ssrc: 1234,
      payloadType: opusPt,
      sequenceNumber: Math.floor(Math.random() * 65535),
      timestamp: Math.floor(Math.random() * 0xFFFFFFFF),
    };

    const trackOpenP = new Promise<void>(r => track.onOpen(() => r()));

    // === Browser offer with audio capture ===
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

      pc.ontrack = (ev) => {
        console.log('ontrack: kind=' + ev.track.kind + ' muted=' + ev.track.muted);
        window.diag.ontrackFired = true;

        const rs = ev.streams[0] ?? new MediaStream([ev.track]);

        // Play via Audio element
        const a = new Audio();
        a.autoplay = true;
        document.body.appendChild(a);
        a.srcObject = rs;
        a.play().catch(() => {});

        // Start recording
        ev.track.onunmute = () => {
          console.log('track UNMUTED — starting capture');
          window.startCapture(rs);
        };
        // Also try immediately in case already unmuted
        if (!ev.track.muted) {
          window.startCapture(rs);
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

    // SDP exchange
    botPc.setRemoteDescription(offer.sdp!, 'Offer' as any);
    const answer = await answerPromise;

    // Log the answer SDP for debugging
    console.log('[bot] Answer SDP:\n' + answer.sdp);

    await page.evaluate(async (a: any) => {
      await ((window as any).pc as RTCPeerConnection).setRemoteDescription(new RTCSessionDescription(a));
    }, answer);

    // ICE
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

    // Wait for connection
    for (let i = 0; i < 30; i++) {
      const st = await page.evaluate(() => window.diag.connState);
      if (st === 'connected') break;
      await new Promise(r => setTimeout(r, 500));
    }
    await Promise.race([trackOpenP, new Promise(r => setTimeout(r, 10000))]);
    await new Promise(r => setTimeout(r, 1000));

    // === Send 440Hz sine wave (3 seconds) ===
    console.log('[bot] Sending 3s of 440Hz stereo Opus...');
    const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    const SPF = 960;
    const FREQ = 440;
    const NUM_FRAMES = 150; // 3 seconds

    for (let f = 0; f < NUM_FRAMES; f++) {
      const stereoPcm = Buffer.alloc(SPF * 4);
      for (let i = 0; i < SPF; i++) {
        const sample = Math.round(Math.sin(2 * Math.PI * FREQ * (f * SPF + i) / 48000) * 8000);
        stereoPcm.writeInt16LE(sample, i * 4);
        stereoPcm.writeInt16LE(sample, i * 4 + 2);
      }
      const opusFrame = Buffer.from(encoder.encode(stereoPcm, SPF));

      manualRtp.sequenceNumber = (manualRtp.sequenceNumber + 1) & 0xFFFF;
      manualRtp.timestamp = (manualRtp.timestamp + SPF) >>> 0;

      const hdr = Buffer.alloc(12);
      hdr[0] = 0x80;
      hdr[1] = (f === 0 ? 0x80 : 0x00) | manualRtp.payloadType;
      hdr.writeUInt16BE(manualRtp.sequenceNumber, 2);
      hdr.writeUInt32BE(manualRtp.timestamp, 4);
      hdr.writeUInt32BE(manualRtp.ssrc, 8);

      track.sendMessageBinary(Buffer.concat([hdr, opusFrame]));
      await new Promise(r => setTimeout(r, 18));
    }
    encoder.delete();
    console.log('[bot] Done sending');

    // Wait for Chrome to process and record
    await new Promise(r => setTimeout(r, 4000));

    // === Capture and analyze the recording ===
    const result = await page.evaluate(() => {
      clearInterval(window._analyserInterval);
      const allSamples: number[] = [];
      for (const chunk of window.diag.recording) {
        allSamples.push(...chunk);
      }
      return {
        totalSamples: allSamples.length,
        maxAmp: window.diag.maxAmp,
        peakFreqs: window.diag.peakFreqs,
        connState: window.diag.connState,
        ontrackFired: window.diag.ontrackFired,
        // Return the raw recording as Int16 values
        samples: allSamples,
      };
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log('CAPTURE RESULTS');
    console.log('='.repeat(60));
    console.log(`Total samples: ${result.totalSamples} (${(result.totalSamples / 48000).toFixed(2)}s)`);
    console.log(`Max amplitude: ${result.maxAmp.toFixed(4)} (${(result.maxAmp * 100).toFixed(1)}%)`);
    console.log(`Peak frequencies detected: ${result.peakFreqs.slice(0, 20).join(', ')}Hz`);
    console.log(`Connection: ${result.connState}`);

    // Save as WAV for offline listening
    const samples = new Int16Array(result.samples);
    const wavBuffer = createWav(samples, 48000);
    const wavPath = '/tmp/huddle-chrome-capture.wav';
    writeFileSync(wavPath, wavBuffer);
    console.log(`\n💾 Saved Chrome capture to: ${wavPath}`);
    console.log(`   Play with: afplay ${wavPath}`);

    // Frequency analysis: if most peak frequencies are near 440Hz, it's clean
    const freqsNear440 = result.peakFreqs.filter(f => f > 400 && f < 500);
    const freqRatio = result.peakFreqs.length > 0 ? freqsNear440.length / result.peakFreqs.length : 0;
    console.log(`\nFrequency analysis: ${freqsNear440.length}/${result.peakFreqs.length} samples near 440Hz (${(freqRatio * 100).toFixed(0)}%)`);

    if (freqRatio > 0.5) {
      console.log('✅ CLEAN — predominant frequency is 440Hz (expected sine wave)');
    } else if (result.maxAmp < 0.01) {
      console.log('❌ SILENCE — no audio detected');
    } else {
      console.log('❌ NOISE — audio present but frequency is not 440Hz');
      // Log the actual frequency distribution
      const freqBuckets: Record<string, number> = {};
      for (const f of result.peakFreqs) {
        const bucket = `${Math.round(f / 100) * 100}Hz`;
        freqBuckets[bucket] = (freqBuckets[bucket] || 0) + 1;
      }
      console.log('Frequency distribution:', JSON.stringify(freqBuckets));
    }

    console.log('='.repeat(60));

    // Assertions
    expect(result.connState).toBe('connected');
    expect(result.ontrackFired).toBe(true);
    expect(result.totalSamples).toBeGreaterThan(0);
    // The signal should be mostly 440Hz
    expect(freqRatio).toBeGreaterThan(0.3);

    botPc.close();
  }, 60000);
});

function createWav(samples: Int16Array, sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const numChannels = 1;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }

  return buffer;
}
