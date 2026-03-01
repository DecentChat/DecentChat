import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

export interface STTOptions {
  engine?: 'whisper-cpp' | 'whisper-python';
  model?: string;     // 'base.en' (default)
  language?: string;
  log?: { info: (s: string) => void; warn?: (s: string) => void };
}

const DEFAULT_MODEL = 'base.en';
const MODEL_DIR = '/opt/homebrew/share/whisper-cpp/models';
const WHISPER_BIN = 'whisper-cli';
const EXEC_TIMEOUT = 30_000;

/**
 * SpeechToText — converts PCM audio buffers to text using whisper-cpp.
 */
export class SpeechToText {
  private modelPath: string;
  private log?: { info: (s: string) => void; warn?: (s: string) => void };

  constructor(opts?: STTOptions) {
    const model = opts?.model ?? DEFAULT_MODEL;
    this.modelPath = join(MODEL_DIR, `ggml-${model}.bin`);
    this.log = opts?.log;
  }

  /**
   * Convert PCM buffer (16-bit signed LE, mono) to text.
   * @param pcmBuffer  Raw PCM samples (Int16 LE, mono)
   * @param sampleRate Sample rate of the PCM data (default 48000)
   */
  async transcribe(pcmBuffer: Buffer, sampleRate = 48000): Promise<string> {
    const id = randomBytes(6).toString('hex');
    const tmp = tmpdir();
    const inputWav = join(tmp, `stt-${id}.wav`);
    const resampledWav = join(tmp, `stt-${id}-16k.wav`);
    const outputBase = join(tmp, `stt-${id}-out`);
    const outputTxt = `${outputBase}.txt`;

    const tempFiles = [inputWav, resampledWav, outputTxt];

    try {
      // 1. Write PCM to WAV (RIFF header + raw PCM)
      const wavBuffer = this.createWavBuffer(pcmBuffer, sampleRate);
      await writeFile(inputWav, wavBuffer);
      this.log?.info(`[STT] Wrote ${wavBuffer.length} bytes WAV → ${inputWav}`);

      // 2. Resample to 16 kHz mono via ffmpeg
      await execFileAsync('ffmpeg', [
        '-i', inputWav,
        '-ar', '16000',
        '-ac', '1',
        '-y', resampledWav,
      ], { timeout: EXEC_TIMEOUT });
      this.log?.info(`[STT] Resampled to 16 kHz → ${resampledWav}`);

      // 3. Run whisper-cli
      await execFileAsync(WHISPER_BIN, [
        '--model', this.modelPath,
        '--output-txt',
        '--output-file', outputBase,
        '--no-timestamps',
        resampledWav,
      ], { timeout: EXEC_TIMEOUT });
      this.log?.info(`[STT] whisper-cli finished`);

      // 4. Read the generated .txt
      const text = await readFile(outputTxt, 'utf-8');
      return text.trim();
    } finally {
      // 5. Clean up ALL temp files
      await Promise.all(
        tempFiles.map(f => unlink(f).catch(() => {})),
      );
      this.log?.info(`[STT] Cleaned up temp files`);
    }
  }

  /**
   * Create a valid WAV (RIFF) buffer from raw 16-bit signed LE PCM data.
   */
  private createWavBuffer(pcm: Buffer, sampleRate: number): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcm.length;
    const headerSize = 44;

    const header = Buffer.alloc(headerSize);
    let offset = 0;

    // RIFF chunk descriptor
    header.write('RIFF', offset); offset += 4;
    header.writeUInt32LE(dataSize + headerSize - 8, offset); offset += 4;
    header.write('WAVE', offset); offset += 4;

    // fmt sub-chunk
    header.write('fmt ', offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4;           // Subchunk1Size (PCM)
    header.writeUInt16LE(1, offset); offset += 2;            // AudioFormat (PCM = 1)
    header.writeUInt16LE(numChannels, offset); offset += 2;  // NumChannels
    header.writeUInt32LE(sampleRate, offset); offset += 4;   // SampleRate
    header.writeUInt32LE(byteRate, offset); offset += 4;     // ByteRate
    header.writeUInt16LE(blockAlign, offset); offset += 2;   // BlockAlign
    header.writeUInt16LE(bitsPerSample, offset); offset += 2; // BitsPerSample

    // data sub-chunk
    header.write('data', offset); offset += 4;
    header.writeUInt32LE(dataSize, offset); offset += 4;

    return Buffer.concat([header, pcm]);
  }
}
