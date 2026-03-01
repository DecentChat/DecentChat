import { describe, it, expect } from 'bun:test';
import { execSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SpeechToText } from '../src/huddle/SpeechToText';

describe('SpeechToText', () => {
  it('transcribes "Hello world" from macOS say command', async () => {
    const testWav = join(tmpdir(), 'test-stt-hello.wav');

    // Generate test WAV using macOS say
    execSync(`say -o ${testWav} --data-format=LEI16@48000 "Hello world"`);

    // Read the WAV file and extract PCM (skip 44-byte header)
    const wavData = readFileSync(testWav);
    const pcm = wavData.subarray(44);

    // Clean up the generated wav
    unlinkSync(testWav);

    const stt = new SpeechToText({
      log: { info: (s: string) => console.log(s) },
    });

    const result = await stt.transcribe(pcm, 48000);

    console.log(`Transcription result: "${result}"`);

    // Verify result contains "hello" (case-insensitive)
    expect(result.toLowerCase()).toContain('hello');
  }, 30_000);

  it('cleans up temp files after transcription', async () => {
    const testWav = join(tmpdir(), 'test-stt-cleanup.wav');
    execSync(`say -o ${testWav} --data-format=LEI16@48000 "Testing cleanup"`);

    const wavData = readFileSync(testWav);
    const pcm = wavData.subarray(44);
    unlinkSync(testWav);

    const stt = new SpeechToText({
      log: { info: (s: string) => console.log(s) },
    });

    await stt.transcribe(pcm, 48000);

    // Check that no stt- temp files remain
    const tmp = tmpdir();
    const leftover = readdirSync(tmp).filter(f => f.startsWith('stt-'));
    expect(leftover).toEqual([]);
  }, 30_000);
});
