import { afterEach, describe, expect, mock, test } from 'bun:test';
import { SpeechToText } from '../../src/huddle/SpeechToText.js';
import { TextToSpeech } from '../../src/huddle/TextToSpeech.js';

const originalFetch = globalThis.fetch;

function makeWavPcm16Mono(sampleRate: number, samples: Int16Array): Buffer {
  const dataSize = samples.length * 2;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byteRate
  header.writeUInt16LE(2, 32); // blockAlign
  header.writeUInt16LE(16, 34); // bitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const pcm = Buffer.alloc(dataSize);
  for (let i = 0; i < samples.length; i++) {
    pcm.writeInt16LE(samples[i] ?? 0, i * 2);
  }

  return Buffer.concat([header, pcm]);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

describe('Gemini huddle engines', () => {
  test('SpeechToText engine=gemini posts audio to Gemini and returns transcript text', async () => {
    const fetchMock = mock(async (..._args: any[]) => new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'hello from gemini' }],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    ));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stt = new SpeechToText({
      engine: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: 'gem-key', // pragma: allowlist secret
    });

    const transcript = await stt.transcribe(Buffer.alloc(4_800), 48_000);
    expect(transcript).toBe('hello from gemini');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(String(url)).toContain('key=gem-key');

    const body = JSON.parse(String(init.body ?? '{}'));
    const parts = body?.contents?.[0]?.parts ?? [];
    expect(parts[0]?.text).toContain('Transcribe');
    expect(parts[1]?.inlineData?.mimeType).toBe('audio/wav');
    expect(typeof parts[1]?.inlineData?.data).toBe('string');
    expect(parts[1]?.inlineData?.data.length).toBeGreaterThan(10);
  });

  test('SpeechToText engine=gemini returns empty string when API key is missing', async () => {
    const fetchMock = mock(async (..._args: any[]) => new Response('should-not-be-called'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stt = new SpeechToText({
      engine: 'gemini',
      model: 'gemini-2.5-flash',
      log: { info: () => {}, warn: () => {} },
    });

    const transcript = await stt.transcribe(Buffer.alloc(4_800), 48_000);
    expect(transcript).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test('SpeechToText engine=gemini rejects known unavailable Gemini models', () => {
    expect(() => new SpeechToText({
      engine: 'gemini',
      model: 'gemini-2.0-flash',
      apiKey: 'gem-key', // pragma: allowlist secret
    })).toThrow(/no longer supported/i);
  });

  test('TextToSpeech provider=gemini requests audio and returns Opus frames', async () => {
    const sampleRate = 24_000;
    const samples = new Int16Array(sampleRate / 5);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.round(Math.sin((i / 30) * Math.PI * 2) * 12_000);
    }
    const wav = makeWavPcm16Mono(sampleRate, samples);
    const wavBase64 = wav.toString('base64');

    const fetchMock = mock(async (..._args: any[]) => new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/wav',
                    data: wavBase64,
                  },
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    ));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const tts = new TextToSpeech({
      provider: 'gemini',
      apiKey: 'gem-tts-key', // pragma: allowlist secret
      model: 'gemini-2.5-flash-preview-tts',
      voiceId: 'Kore',
      log: { info: () => {} },
    });

    const frames = await tts.speakRaw('Fast response please.');
    expect(frames.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(frames[0])).toBe(true);
    tts.destroy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent');
    expect(String(url)).toContain('key=gem-tts-key');

    const body = JSON.parse(String(init.body ?? '{}'));
    expect(body?.generationConfig?.responseModalities).toContain('AUDIO');
    expect(body?.contents?.[0]?.parts?.[0]?.text).toContain('Fast response please.');
  });
});
