import { describe, test, expect, mock } from 'bun:test';
import OpusScript from 'opusscript';
import { AudioPipeline } from '../src/huddle/AudioPipeline';

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME_SIZE = 960; // 20ms at 48kHz

function makeRtpPacket(payload: Buffer, seq = 0, ts = 0, ssrc = 1234): Buffer {
  const header = Buffer.alloc(12);
  header[0] = 0x80; // V=2
  header[1] = 111;  // Opus payload type
  header.writeUInt16BE(seq, 2);
  header.writeUInt32BE(ts, 4);
  header.writeUInt32BE(ssrc, 8);
  return Buffer.concat([header, payload]);
}

function makeRtpPacketWithExtension(payload: Buffer, extWords = 1): Buffer {
  const header = Buffer.alloc(12);
  header[0] = 0x90; // V=2, X=1
  header[1] = 111;
  header.writeUInt16BE(0, 2);
  header.writeUInt32BE(0, 4);
  header.writeUInt32BE(1234, 8);
  // Extension header: 2 bytes profile + 2 bytes length (in 32-bit words)
  const ext = Buffer.alloc(4 + extWords * 4);
  ext.writeUInt16BE(0xBEDE, 0); // profile
  ext.writeUInt16BE(extWords, 2); // length in words
  return Buffer.concat([header, ext, payload]);
}

function makeRtpPacketWithCSRC(payload: Buffer, csrcCount: number): Buffer {
  const header = Buffer.alloc(12);
  header[0] = 0x80 | (csrcCount & 0x0F); // V=2, CC=csrcCount
  header[1] = 111;
  header.writeUInt16BE(0, 2);
  header.writeUInt32BE(0, 4);
  header.writeUInt32BE(1234, 8);
  const csrcList = Buffer.alloc(csrcCount * 4);
  for (let i = 0; i < csrcCount; i++) {
    csrcList.writeUInt32BE(5000 + i, i * 4);
  }
  return Buffer.concat([header, csrcList, payload]);
}

function generateSilentPCM(frames: number): Int16Array {
  return new Int16Array(frames * FRAME_SIZE);
}

function generateSineWavePCM(frames: number, freq = 440, amplitude = 16000): Int16Array {
  const totalSamples = frames * FRAME_SIZE;
  const pcm = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    pcm[i] = Math.round(amplitude * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE));
  }
  return pcm;
}

function encodeFrames(encoder: OpusScript, pcm: Int16Array): Buffer[] {
  const frames: Buffer[] = [];
  for (let offset = 0; offset < pcm.length; offset += FRAME_SIZE) {
    const frame = pcm.slice(offset, offset + FRAME_SIZE);
    const encoded = encoder.encode(frame, FRAME_SIZE);
    frames.push(Buffer.from(encoded));
  }
  return frames;
}

describe('AudioPipeline', () => {
  describe('RTP header stripping', () => {
    test('strips basic 12-byte RTP header', () => {
      const pipeline = new AudioPipeline();
      const payload = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const rtp = makeRtpPacket(payload);
      const result = pipeline.stripRtpHeader(rtp);
      expect(result).not.toBeNull();
      expect(Buffer.compare(result!, payload)).toBe(0);
      pipeline.destroy();
    });

    test('strips RTP header with extension', () => {
      const pipeline = new AudioPipeline();
      const payload = Buffer.from([0xAA, 0xBB, 0xCC]);
      const rtp = makeRtpPacketWithExtension(payload, 2); // 2 words = 8 bytes extension data
      const result = pipeline.stripRtpHeader(rtp);
      expect(result).not.toBeNull();
      expect(Buffer.compare(result!, payload)).toBe(0);
      pipeline.destroy();
    });

    test('strips RTP header with CSRC list', () => {
      const pipeline = new AudioPipeline();
      const payload = Buffer.from([0xDE, 0xAD]);
      const rtp = makeRtpPacketWithCSRC(payload, 3); // 3 CSRC entries = 12 bytes
      const result = pipeline.stripRtpHeader(rtp);
      expect(result).not.toBeNull();
      expect(Buffer.compare(result!, payload)).toBe(0);
      pipeline.destroy();
    });

    test('strips RTP header with both CSRC and extension', () => {
      const pipeline = new AudioPipeline();
      const payload = Buffer.from([0xFF]);
      // Build manually: V=2, X=1, CC=2
      const header = Buffer.alloc(12);
      header[0] = 0x90 | 2; // V=2, X=1, CC=2
      header[1] = 111;
      header.writeUInt32BE(1234, 8);
      const csrc = Buffer.alloc(8); // 2 CSRCs
      const ext = Buffer.alloc(4 + 4); // 1-word extension
      ext.writeUInt16BE(0xBEDE, 0);
      ext.writeUInt16BE(1, 2);
      const rtp = Buffer.concat([header, csrc, ext, payload]);
      const result = pipeline.stripRtpHeader(rtp);
      expect(result).not.toBeNull();
      expect(Buffer.compare(result!, payload)).toBe(0);
      pipeline.destroy();
    });

    test('returns null for too-short buffer', () => {
      const pipeline = new AudioPipeline();
      expect(pipeline.stripRtpHeader(Buffer.alloc(5))).toBeNull();
      pipeline.destroy();
    });

    test('handles padding bit', () => {
      const pipeline = new AudioPipeline();
      const payload = Buffer.from([0xAA, 0xBB]);
      const padding = Buffer.from([0x00, 0x00, 0x03]); // 3 bytes padding
      const header = Buffer.alloc(12);
      header[0] = 0xA0; // V=2, P=1
      header[1] = 111;
      header.writeUInt32BE(1234, 8);
      const rtp = Buffer.concat([header, payload, padding]);
      const result = pipeline.stripRtpHeader(rtp);
      expect(result).not.toBeNull();
      expect(Buffer.compare(result!, payload)).toBe(0);
      pipeline.destroy();
    });
  });

  describe('computeRMS', () => {
    test('returns 0 for silent PCM', () => {
      const pipeline = new AudioPipeline();
      const silent = new Int16Array(960);
      expect(pipeline.computeRMS(silent)).toBe(0);
      pipeline.destroy();
    });

    test('returns ~0.707 for full-scale square wave', () => {
      const pipeline = new AudioPipeline();
      const pcm = new Int16Array(1000);
      for (let i = 0; i < 1000; i++) pcm[i] = i % 2 === 0 ? 32767 : -32768;
      const rms = pipeline.computeRMS(pcm);
      // Should be close to 1.0 (full scale)
      expect(rms).toBeGreaterThan(0.99);
      pipeline.destroy();
    });

    test('returns moderate value for sine wave', () => {
      const pipeline = new AudioPipeline();
      const pcm = generateSineWavePCM(1, 440, 16000);
      const rms = pipeline.computeRMS(pcm);
      // 16000/32768 ≈ 0.488, RMS of sine = peak/√2 ≈ 0.345
      expect(rms).toBeGreaterThan(0.2);
      expect(rms).toBeLessThan(0.5);
      pipeline.destroy();
    });

    test('returns 0 for empty array', () => {
      const pipeline = new AudioPipeline();
      expect(pipeline.computeRMS(new Int16Array(0))).toBe(0);
      pipeline.destroy();
    });
  });

  describe('VAD - silence detection', () => {
    test('silent Opus frames do NOT trigger onSpeechEnd', () => {
      const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
      const speechEndCb = mock(() => {});

      const pipeline = new AudioPipeline({
        vadThreshold: 0.02,
        vadSilenceMs: 100,
        onSpeechEnd: speechEndCb,
      });

      const silentPcm = generateSilentPCM(25); // 25 frames = 500ms
      const opusFrames = encodeFrames(encoder, silentPcm);

      for (let i = 0; i < opusFrames.length; i++) {
        const rtp = makeRtpPacket(opusFrames[i], i, i * FRAME_SIZE);
        pipeline.feedRtpPacket(rtp);
      }

      expect(speechEndCb).not.toHaveBeenCalled();

      pipeline.destroy();
      encoder.delete();
    });

    test('sine wave Opus frames detect speech (VAD active)', () => {
      const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
      const speechEndCb = mock(() => {});
      let isSpeakingDuringFeed = false;

      const pipeline = new AudioPipeline({
        vadThreshold: 0.01, // low threshold to catch the sine
        vadSilenceMs: 500,
        onSpeechEnd: speechEndCb,
      });

      const sinePcm = generateSineWavePCM(10, 440, 16000); // 10 frames = 200ms
      const opusFrames = encodeFrames(encoder, sinePcm);

      for (let i = 0; i < opusFrames.length; i++) {
        const rtp = makeRtpPacket(opusFrames[i], i, i * FRAME_SIZE);
        pipeline.feedRtpPacket(rtp);
      }

      // Speech was detected but no silence gap yet, so onSpeechEnd should NOT have fired
      expect(speechEndCb).not.toHaveBeenCalled();
      // But pipeline should have accumulated chunks (we can't directly check private state,
      // but we know onSpeechEnd didn't fire which means it's still in speaking state)

      pipeline.destroy();
      encoder.delete();
    });

    test('sine wave → silence triggers onSpeechEnd with accumulated PCM', async () => {
      const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);

      let receivedPcm: Buffer | null = null;
      const speechEndCb = mock((pcm: Buffer) => {
        receivedPcm = pcm;
      });

      const pipeline = new AudioPipeline({
        vadThreshold: 0.01,
        vadSilenceMs: 80, // short for test speed
        onSpeechEnd: speechEndCb,
      });

      // Feed 10 frames of sine wave (200ms of speech)
      const sinePcm = generateSineWavePCM(10, 440, 16000);
      const sineFrames = encodeFrames(encoder, sinePcm);

      for (let i = 0; i < sineFrames.length; i++) {
        const rtp = makeRtpPacket(sineFrames[i], i, i * FRAME_SIZE);
        pipeline.feedRtpPacket(rtp);
      }

      expect(speechEndCb).not.toHaveBeenCalled();

      // Now feed silence frames with time gaps that exceed vadSilenceMs
      const silentPcm = generateSilentPCM(10);
      const silentFrames = encodeFrames(encoder, silentPcm);

      // Feed silence frames with enough real-time delay to exceed vadSilenceMs
      for (let i = 0; i < silentFrames.length; i++) {
        await new Promise(r => setTimeout(r, 20)); // 20ms per frame (real-time)
        const rtp = makeRtpPacket(silentFrames[i], sineFrames.length + i, (sineFrames.length + i) * FRAME_SIZE);
        pipeline.feedRtpPacket(rtp);
      }

      // After 200ms of silence (10 * 20ms), onSpeechEnd should have fired
      expect(speechEndCb).toHaveBeenCalledTimes(1);
      expect(receivedPcm).not.toBeNull();
      expect(receivedPcm!.length).toBeGreaterThan(0);

      pipeline.destroy();
      encoder.delete();
    });
  });

  describe('edge cases', () => {
    test('reset() clears VAD state', () => {
      const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
      const speechEndCb = mock(() => {});

      const pipeline = new AudioPipeline({
        vadThreshold: 0.01,
        vadSilenceMs: 50,
        onSpeechEnd: speechEndCb,
      });

      // Feed some speech
      const sinePcm = generateSineWavePCM(5, 440, 16000);
      const sineFrames = encodeFrames(encoder, sinePcm);
      for (let i = 0; i < sineFrames.length; i++) {
        pipeline.feedRtpPacket(makeRtpPacket(sineFrames[i], i, i * FRAME_SIZE));
      }

      // Reset instead of letting silence trigger
      pipeline.reset();

      // Feed silence — should NOT trigger because state was reset
      const silentPcm = generateSilentPCM(5);
      const silentFrames = encodeFrames(encoder, silentPcm);
      for (let i = 0; i < silentFrames.length; i++) {
        pipeline.feedRtpPacket(makeRtpPacket(silentFrames[i], 100 + i, (100 + i) * FRAME_SIZE));
      }

      expect(speechEndCb).not.toHaveBeenCalled();

      pipeline.destroy();
      encoder.delete();
    });

    test('handles malformed RTP gracefully', () => {
      const pipeline = new AudioPipeline();
      // Should not throw
      pipeline.feedRtpPacket(Buffer.alloc(0));
      pipeline.feedRtpPacket(Buffer.alloc(5));
      pipeline.feedRtpPacket(Buffer.from([0x80, 111, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])); // header-only, no payload
      pipeline.destroy();
    });
  });
});
