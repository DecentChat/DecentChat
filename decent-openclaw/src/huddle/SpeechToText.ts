import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

export interface STTOptions {
  engine?: 'whisper-cpp' | 'whisper-python' | 'openai' | 'groq';
  model?: string;
  language?: string;
  apiKey?: string;        // For openai/groq engines
  log?: { info: (s: string) => void; warn?: (s: string) => void };
}

const DEFAULT_MODEL = 'base.en';
const MODEL_DIR = '/opt/homebrew/share/whisper-cpp/models';
const WHISPER_BIN = 'whisper-cli';
const EXEC_TIMEOUT = 30_000;

/**
 * SpeechToText — converts PCM audio buffers to text.
 * Supports local whisper-cpp or cloud APIs (OpenAI, Groq).
 */
export class SpeechToText {
  private engine: string;
  private modelPath: string;
  private model: string;
  private language?: string;
  private apiKey?: string;
  private log?: { info: (s: string) => void; warn?: (s: string) => void };

  constructor(opts?: STTOptions) {
    this.engine = opts?.engine ?? 'whisper-cpp';
    this.model = opts?.model ?? DEFAULT_MODEL;
    this.modelPath = join(MODEL_DIR, `ggml-${this.model}.bin`);
    this.language = opts?.language;
    this.apiKey = opts?.apiKey;
    this.log = opts?.log;
  }

  /**
   * Convert PCM buffer (16-bit signed LE, mono) to text.
   */
  async transcribe(pcmBuffer: Buffer, sampleRate = 48000): Promise<string> {
    if (this.engine === 'openai' || this.engine === 'groq') {
      return this.transcribeCloud(pcmBuffer, sampleRate);
    }
    return this.transcribeLocal(pcmBuffer, sampleRate);
  }

  /**
   * Cloud transcription via OpenAI or Groq Whisper API.
   */
  private async transcribeCloud(pcmBuffer: Buffer, sampleRate: number): Promise<string> {
    const wavBuffer = this.createWavBuffer(pcmBuffer, sampleRate);
    const duration = (pcmBuffer.length / 2 / sampleRate).toFixed(1);

    const isGroq = this.engine === 'groq';
    const baseUrl = isGroq
      ? 'https://api.groq.com/openai/v1'
      : 'https://api.openai.com/v1';
    // Only use this.model for cloud if it looks like a cloud model name
    // (contains 'whisper'). Otherwise use the provider default.
    const isCloudModel = this.model.includes('whisper');
    const model = isGroq
      ? (isCloudModel ? this.model : 'whisper-large-v3-turbo')
      : (isCloudModel ? this.model : 'whisper-1');
    const key = this.apiKey
      ?? (isGroq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY)
      ?? '';

    if (!key) {
      this.log?.warn?.(`[STT] No API key for ${this.engine} — set ${isGroq ? 'GROQ_API_KEY' : 'OPENAI_API_KEY'}`);
      return '';
    }

    this.log?.info(`[STT] ${this.engine} transcribe: ${duration}s audio, model=${model}${this.language ? ', lang=' + this.language : ''}`);
    const start = Date.now();

    // Build multipart form data
    const boundary = '----STTBoundary' + randomBytes(8).toString('hex');
    const parts: Buffer[] = [];

    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
    ));
    parts.push(wavBuffer);
    parts.push(Buffer.from('\r\n'));

    // Model part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
    ));

    // Language part (optional)
    if (this.language) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${this.language}\r\n`
      ));
    }

    // Response format
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`
    ));

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    const elapsed = Date.now() - start;

    if (!response.ok) {
      const err = await response.text().catch(() => 'unknown');
      this.log?.warn?.(`[STT] ${this.engine} error ${response.status}: ${err}`);
      return '';
    }

    const text = (await response.text()).trim();
    this.log?.info(`[STT] ${this.engine} transcribed in ${elapsed}ms: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
    return text;
  }

  /**
   * Local transcription via whisper-cli.
   */
  private async transcribeLocal(pcmBuffer: Buffer, sampleRate: number): Promise<string> {
    const id = randomBytes(6).toString('hex');
    const tmp = tmpdir();
    const inputWav = join(tmp, `stt-${id}.wav`);
    const resampledWav = join(tmp, `stt-${id}-16k.wav`);
    const outputBase = join(tmp, `stt-${id}-out`);
    const outputTxt = `${outputBase}.txt`;

    const tempFiles = [inputWav, resampledWav, outputTxt];

    try {
      // 1. Write PCM to WAV
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
      const args = [
        '--model', this.modelPath,
        '--output-txt',
        '--output-file', outputBase,
        '--no-timestamps',
      ];
      if (this.language) {
        args.push('--language', this.language);
      }
      args.push(resampledWav);
      this.log?.info(`[STT] whisper-cli args: ${args.join(' ')}`);
      await execFileAsync(WHISPER_BIN, args, { timeout: EXEC_TIMEOUT });
      this.log?.info(`[STT] whisper-cli finished`);

      // 4. Read the generated .txt
      const text = await readFile(outputTxt, 'utf-8');
      return text.trim();
    } finally {
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

    header.write('RIFF', offset); offset += 4;
    header.writeUInt32LE(dataSize + headerSize - 8, offset); offset += 4;
    header.write('WAVE', offset); offset += 4;

    header.write('fmt ', offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4;
    header.writeUInt16LE(1, offset); offset += 2;
    header.writeUInt16LE(numChannels, offset); offset += 2;
    header.writeUInt32LE(sampleRate, offset); offset += 4;
    header.writeUInt32LE(byteRate, offset); offset += 4;
    header.writeUInt16LE(blockAlign, offset); offset += 2;
    header.writeUInt16LE(bitsPerSample, offset); offset += 2;

    header.write('data', offset); offset += 4;
    header.writeUInt32LE(dataSize, offset); offset += 4;

    return Buffer.concat([header, pcm]);
  }
}
