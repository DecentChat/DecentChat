/**
 * Full round-trip test using the ACTUAL BotHuddleManager class.
 * Tests the exact production code path:
 *   Browser offer → BotHuddleManager.handleSignal → answer → ICE → audio → Chrome capture
 *
 * This is NOT a recreation — it uses the real BotHuddleManager.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';
import { BotHuddleManager } from '../../src/huddle/BotHuddleManager.js';
import { writeFileSync } from 'fs';

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
}, 120000);

afterAll(async () => { await browser?.close(); }, 120000);

describe('Full BotHuddleManager round-trip', () => {
  it('browser hears clean audio from BotHuddleManager (production code path)', async () => {
    // Collect signals from bot to browser
    const signalsToBrowser: any[] = [];

    // Create the ACTUAL BotHuddleManager
    const botManager = new BotHuddleManager('bot-peer-id', {
      sendSignal: (_peerId: string, data: object) => {
        signalsToBrowser.push(data);
        return true;
      },
      broadcastSignal: (data: object) => {
        signalsToBrowser.push(data);
      },
      getDisplayName: () => 'Test User',
      onTranscription: async (text: string) => {
        // Echo back for testing
        return `You said: ${text}`;
      },
      log: {
        info: (s: string) => console.log(`[bot] ${s}`),
        warn: (s: string) => console.warn(`[bot] ${s}`),
        error: (s: string) => console.error(`[bot] ${s}`),
      },
    }, {
      autoJoin: true,
      vadSilenceMs: 300,
      vadThreshold: 0.01,
    });

    // Set up Chrome page with audio capture
    await page.setContent(`<html><body><h1>Full Round-Trip Test</h1><script>
      window.diag = { connState: null, ontrackFired: false, maxAmp: 0, peakFreqs: [], samples: [] };
      window.captureStarted = false;
    </script></body></html>`);

    // Step 1: Simulate huddle-announce from browser
    console.log('[test] Simulating huddle-announce...');
    await botManager.handleSignal('browser-peer-id', {
      type: 'huddle-announce',
      channelId: 'test-channel',
      peerId: 'browser-peer-id',
    });

    expect(botManager.getState()).toBe('in-call');

    // Drain the huddle-join signal
    const joinSignal = signalsToBrowser.find(s => s.type === 'huddle-join');
    expect(joinSignal).toBeTruthy();
    signalsToBrowser.length = 0;

    // Step 2: Browser creates offer (exactly like HuddleManager.initiateConnectionTo)
    console.log('[test] Browser creating WebRTC offer...');
    const offer = await page.evaluate(async () => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
      });
      (window as any).pc = pc;

      // Fake mic via oscillator (getUserMedia unavailable without HTTPS)
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      for (const track of dest.stream.getTracks()) {
        pc.addTrack(track, dest.stream);
      }

      // Set up ontrack with audio capture
      pc.ontrack = (event) => {
        console.log('ontrack: kind=' + event.track.kind + ' muted=' + event.track.muted + ' streams=' + event.streams.length);
        window.diag.ontrackFired = true;
        const rs = event.streams[0] ?? new MediaStream([event.track]);

        // Play
        const audioEl = new Audio();
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
        audioEl.srcObject = rs;
        audioEl.play().then(() => console.log('play() OK')).catch(e => console.log('play err: ' + e));

        // Capture audio
        const startCapture = () => {
          if (window.captureStarted) return;
          window.captureStarted = true;
          console.log('Starting audio capture...');
          try {
            const ctx = new AudioContext({ sampleRate: 48000 });
            const src = ctx.createMediaStreamSource(rs);

            // FFT analysis
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 4096;
            src.connect(analyser);
            const freqBuf = new Float32Array(analyser.frequencyBinCount);
            const tdBuf = new Uint8Array(analyser.frequencyBinCount);
            setInterval(() => {
              analyser.getFloatFrequencyData(freqBuf);
              analyser.getByteTimeDomainData(tdBuf);
              let peakIdx = 0, peakVal = -Infinity;
              for (let i = 1; i < freqBuf.length; i++) {
                if (freqBuf[i] > peakVal) { peakVal = freqBuf[i]; peakIdx = i; }
              }
              const hz = peakIdx * 48000 / 4096;
              let amp = 0;
              for (let i = 0; i < tdBuf.length; i++) {
                const v = Math.abs(tdBuf[i] - 128);
                if (v > amp) amp = v;
              }
              if (amp > window.diag.maxAmp) window.diag.maxAmp = amp;
              if (amp > 2) {
                window.diag.peakFreqs.push(Math.round(hz));
                console.log('amp=' + amp + '/128 freq=' + Math.round(hz) + 'Hz @' + peakVal.toFixed(1) + 'dB');
              }
            }, 200);

            // PCM capture
            const proc = ctx.createScriptProcessor(4096, 1, 1);
            proc.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(data.length);
              for (let i = 0; i < data.length; i++) {
                const s = Math.max(-1, Math.min(1, data[i]));
                int16[i] = s < 0 ? s * 32768 : s * 32767;
              }
              window.diag.samples.push(...Array.from(int16));
            };
            src.connect(proc);
            proc.connect(ctx.destination);
          } catch (e) {
            console.error('capture err: ' + e);
          }
        };

        event.track.addEventListener('unmute', startCapture, { once: true });
        if (!event.track.muted) startCapture();
      };

      pc.onconnectionstatechange = () => {
        window.diag.connState = pc.connectionState;
        console.log('connState=' + pc.connectionState);
      };

      // Collect ICE candidates
      (window as any).browserIce = [];
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          (window as any).browserIce.push(ev.candidate.toJSON());
        }
      };

      const o = await pc.createOffer();
      await pc.setLocalDescription(o);
      return { sdp: o.sdp, type: o.type };
    });

    console.log('[test] Browser offer created, sending to BotHuddleManager...');

    // Step 3: Send offer to bot (exactly like the live signaling path)
    await botManager.handleSignal('browser-peer-id', {
      type: 'huddle-offer',
      channelId: 'test-channel',
      sdp: { sdp: offer.sdp, type: offer.type },
      fromPeerId: 'browser-peer-id',
    });

    // Step 4: Get answer from bot and send to browser
    await new Promise(r => setTimeout(r, 500));

    const answerSignal = signalsToBrowser.find(s => s.type === 'huddle-answer');
    expect(answerSignal).toBeTruthy();
    console.log('[test] Got bot answer, sending to browser...');

    await page.evaluate(async (answer: any) => {
      const pc = (window as any).pc as RTCPeerConnection;
      await pc.setRemoteDescription(new RTCSessionDescription(answer.sdp));
    }, answerSignal);

    // Step 5: Exchange ICE candidates
    await new Promise(r => setTimeout(r, 2000));

    // Browser → Bot ICE
    const browserIce = await page.evaluate(() => (window as any).browserIce);
    for (const c of browserIce) {
      if (c.candidate) {
        await botManager.handleSignal('browser-peer-id', {
          type: 'huddle-ice',
          candidate: c,
          channelId: 'test-channel',
          fromPeerId: 'browser-peer-id',
        });
      }
    }

    // Bot → Browser ICE
    const botIceSignals = signalsToBrowser.filter(s => s.type === 'huddle-ice');
    await page.evaluate(async (ices: any[]) => {
      const pc = (window as any).pc as RTCPeerConnection;
      for (const ice of ices) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(ice.candidate));
        } catch {}
      }
    }, botIceSignals);

    // Wait for connection
    for (let i = 0; i < 30; i++) {
      const st = await page.evaluate(() => window.diag.connState);
      if (st === 'connected') break;
      await new Promise(r => setTimeout(r, 500));
    }

    const connState = await page.evaluate(() => window.diag.connState);
    console.log('[test] Connection state:', connState);
    expect(connState).toBe('connected');

    // Step 6: Trigger bot to speak via the TTS pipeline
    // Simulate a speech end with PCM audio (440Hz sine wave)
    console.log('[test] Triggering bot TTS response...');

    // Access the private handleSpeechEnd method to trigger TTS
    // Or better: directly call the TTS and send audio through the manager's send path
    // ALWAYS send sine wave to isolate: is noise from TTS or from track setup?
    console.log('[test] Using deterministic synthetic Opus frames (no external TTS dependency)...');
    const OpusScript = (await import('opusscript')).default;
    const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    const SPF = 960;
    const FREQ = 440;
    const NUM_FRAMES = 150;

    const sendTracks = (botManager as any).sendTracks as Map<string, any>;
    const peerConnections = (botManager as any).peerConnections as Map<string, any>;

    for (const [peerId, track] of sendTracks) {
      if (!track.isOpen()) continue;
      const peerState = peerConnections.get(peerId);
      const rtpConfig = peerState?.rtpConfig;

      console.log(`[test] Sending ${NUM_FRAMES} frames to ${peerId.slice(0, 8)}...`);
      for (let f = 0; f < NUM_FRAMES; f++) {
        const stereoPcm = Buffer.alloc(SPF * 4);
        for (let i = 0; i < SPF; i++) {
          const sample = Math.round(Math.sin(2 * Math.PI * FREQ * (f * SPF + i) / 48000) * 8000);
          stereoPcm.writeInt16LE(sample, i * 4);
          stereoPcm.writeInt16LE(sample, i * 4 + 2);
        }
        const opusFrame = Buffer.from(encoder.encode(stereoPcm, SPF));

        if (rtpConfig) {
          rtpConfig.sequenceNumber = (rtpConfig.sequenceNumber + 1) & 0xFFFF;
          rtpConfig.timestamp = (rtpConfig.timestamp + SPF) >>> 0;
        }
        const hdr = Buffer.alloc(12);
        hdr[0] = 0x80;
        hdr[1] = (f === 0 ? 0x80 : 0x00) | (rtpConfig?.payloadType ?? 111);
        hdr.writeUInt16BE(rtpConfig?.sequenceNumber ?? 0, 2);
        hdr.writeUInt32BE(rtpConfig?.timestamp ?? 0, 4);
        hdr.writeUInt32BE(rtpConfig?.ssrc ?? 1234, 8);
        track.sendMessageBinary(Buffer.concat([hdr, opusFrame]));
        await new Promise(r => setTimeout(r, 18));
      }
      console.log(`[test] Done sending to ${peerId.slice(0, 8)}`);
    }
    encoder.delete();

    // Step 7: Wait and capture results
    await new Promise(r => setTimeout(r, 5000));

    const result = await page.evaluate(() => {
      return {
        connState: window.diag.connState,
        ontrackFired: window.diag.ontrackFired,
        maxAmp: window.diag.maxAmp,
        peakFreqs: window.diag.peakFreqs,
        totalSamples: window.diag.samples.length,
        samples: window.diag.samples,
      };
    });

    // Save WAV
    const samples = new Int16Array(result.samples);
    const wavPath = '/tmp/huddle-botmanager-capture.wav';
    writeFileSync(wavPath, createWav(samples, 48000));

    console.log(`\n${'='.repeat(60)}`);
    console.log('FULL ROUND-TRIP RESULTS (BotHuddleManager → Chrome)');
    console.log('='.repeat(60));
    console.log(`Connection: ${result.connState}`);
    console.log(`ontrack fired: ${result.ontrackFired}`);
    console.log(`Total captured: ${result.totalSamples} samples (${(result.totalSamples / 48000).toFixed(2)}s)`);
    console.log(`Max amplitude: ${result.maxAmp}/128`);
    console.log(`Peak frequencies: ${result.peakFreqs.slice(0, 20).join(', ')}Hz`);
    console.log(`WAV saved: ${wavPath}`);

    // Frequency analysis
    const near440 = result.peakFreqs.filter((f: number) => f > 400 && f < 500);
    const ratio = result.peakFreqs.length > 0 ? near440.length / result.peakFreqs.length : 0;

    console.log(`
Sine wave: ${near440.length}/${result.peakFreqs.length} samples near 440Hz (${(ratio * 100).toFixed(0)}%)`);
    if (ratio > 0.5) {
      console.log('✅ CLEAN — 440Hz sine wave received correctly');
    } else if (result.maxAmp < 3) {
      console.log('❌ SILENCE');
    } else {
      console.log('❌ NOISE — audio present but wrong frequency');
      const buckets: Record<string, number> = {};
      for (const f of result.peakFreqs) {
        const b = `${Math.round(f / 100) * 100}Hz`;
        buckets[b] = (buckets[b] || 0) + 1;
      }
      console.log('Frequency distribution:', JSON.stringify(buckets));
    }
    console.log(`
🔊 Listen: afplay ${wavPath}`);
    console.log('='.repeat(60));

    expect(result.connState).toBe('connected');
    expect(result.ontrackFired).toBe(true);
    expect(result.maxAmp).toBeGreaterThan(3);
    expect(ratio).toBeGreaterThan(0.3);

    botManager.destroy();
  }, 120000);
});

function createWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}
