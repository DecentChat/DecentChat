import { describe, it, expect } from 'bun:test';
import { TextToSpeech } from '../../src/huddle/TextToSpeech.js';

describe('TTS resample handles odd byte counts', () => {
  const tts = new TextToSpeech({ apiKey: 'fake-for-test' });

  it('resamples even-length buffer (28048 bytes)', () => {
    const buf = Buffer.alloc(28048);
    for (let i = 0; i < buf.length - 1; i += 2) {
      buf.writeInt16LE(Math.floor(Math.random() * 10000 - 5000), i);
    }
    const result = tts.resample(buf, 24000, 48000);
    expect(result.length).toBe(56096);
    expect(result.length % 2).toBe(0);
  });

  it('resamples odd-length buffer (99519 bytes) without crashing', () => {
    const buf = Buffer.alloc(99519);
    for (let i = 0; i < buf.length - 1; i += 2) {
      buf.writeInt16LE(Math.floor(Math.random() * 10000 - 5000), i);
    }
    // This was the exact bug: 99519 bytes from ElevenLabs caused RangeError
    const result = tts.resample(buf, 24000, 48000);
    expect(result.length % 2).toBe(0);
    expect(result.length).toBeGreaterThan(0);
  });

  it('resamples large odd-length buffer (183529 bytes) without crashing', () => {
    const buf = Buffer.alloc(183529);
    for (let i = 0; i < buf.length - 1; i += 2) {
      buf.writeInt16LE(Math.floor(Math.random() * 10000 - 5000), i);
    }
    const result = tts.resample(buf, 24000, 48000);
    expect(result.length % 2).toBe(0);
    expect(result.length).toBeGreaterThan(0);
  });

  it('identity resample returns same buffer', () => {
    const buf = Buffer.alloc(1000);
    const result = tts.resample(buf, 48000, 48000);
    expect(result).toBe(buf);
  });
});
