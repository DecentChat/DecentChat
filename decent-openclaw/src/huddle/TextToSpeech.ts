import OpusScript from 'opusscript';

export interface TTSOptions {
  apiKey: string;
  voiceId?: string;       // Default: 'EXAVITQu4vr4xnSDxMaL' (Rachel)
  model?: string;         // Default: 'eleven_turbo_v2_5' (multilingual)
  language?: string;      // Language code for multilingual models (e.g. 'sk', 'en')
  sampleRate?: number;    // Output sample rate for Opus: 48000
  log?: { info: (s: string) => void };
}

const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const DEFAULT_MODEL = 'eleven_turbo_v2_5';
const DEFAULT_SAMPLE_RATE = 48000;
const ELEVENLABS_PCM_RATE = 24000;
const FRAME_DURATION_MS = 20;
const OPUS_PT = 111;
const DEFAULT_SSRC = 1234;

export class TextToSpeech {
  private apiKey: string;
  private voiceId: string;
  private model: string;
  private language?: string;
  private sampleRate: number;
  private log?: { info: (s: string) => void };
  private encoder: OpusScript;

  constructor(opts: TTSOptions) {
    this.apiKey = opts.apiKey;
    this.voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.language = opts.language;
    this.sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.log = opts.log;
    this.encoder = new OpusScript(this.sampleRate, 2, OpusScript.Application.AUDIO);
  }

  /**
   * Convert text to a sequence of RTP packets containing Opus-encoded audio.
   * Each packet represents a 20ms frame.
   */
  async speak(text: string): Promise<Buffer[]> {
    this.log?.info(`TTS: synthesizing "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);

    // 1. Fetch PCM audio from ElevenLabs
    const pcm24k = await this.fetchPcmFromElevenLabs(text);
    this.log?.info(`TTS: received ${pcm24k.length} bytes of PCM @ ${ELEVENLABS_PCM_RATE}Hz`);

    // 2. Resample 24kHz → 48kHz
    //    ElevenLabs occasionally returns odd byte counts; truncate to even
    //    since PCM 16-bit requires 2 bytes per sample.
    const pcmEven = pcm24k.length % 2 !== 0 ? pcm24k.subarray(0, pcm24k.length - 1) : pcm24k;
    const pcm48k = this.resample(pcmEven, ELEVENLABS_PCM_RATE, this.sampleRate);
    this.log?.info(`TTS: resampled to ${pcm48k.length} bytes @ ${this.sampleRate}Hz`);

    // 3. Chunk into 20ms frames and Opus encode
    const samplesPerFrame = (this.sampleRate * FRAME_DURATION_MS) / 1000; // 960 at 48kHz
    const bytesPerFrame = samplesPerFrame * 2; // 16-bit samples = 2 bytes each
    const packets: Buffer[] = [];
    let seq = 0;
    let timestamp = 0;

    for (let offset = 0; offset + bytesPerFrame <= pcm48k.length; offset += bytesPerFrame) {
      const pcmFrame = pcm48k.subarray(offset, offset + bytesPerFrame);
      // Convert mono PCM to stereo (interleaved L,R) for the 2-channel Opus encoder.
      // The SDP advertises sprop-stereo=1, so the browser expects stereo frames.
      const stereoPcm = Buffer.alloc(pcmFrame.length * 2);
      for (let i = 0; i < samplesPerFrame; i++) {
        const sample = pcmFrame.readInt16LE(i * 2);
        stereoPcm.writeInt16LE(sample, i * 4);     // L
        stereoPcm.writeInt16LE(sample, i * 4 + 2); // R
      }
      const opusFrame = this.encoder.encode(stereoPcm, samplesPerFrame);

      const rtpPacket = this.createRtpPacket(
        Buffer.from(opusFrame),
        seq,
        timestamp,
        DEFAULT_SSRC,
        OPUS_PT,
        seq === 0  // Marker bit on first packet (start of talkspurt)
      );
      packets.push(rtpPacket);

      seq++;
      timestamp += samplesPerFrame;
    }

    this.log?.info(`TTS: encoded ${packets.length} RTP packets (${(packets.length * FRAME_DURATION_MS / 1000).toFixed(1)}s)`);
    return packets;
  }

  /**
   * Like speak(), but returns raw Opus frames (no RTP headers).
   * For use with node-datachannel's media handler which adds RTP headers itself.
   */
  async speakRaw(text: string): Promise<Buffer[]> {
    // 1. Get PCM from ElevenLabs
    this.log?.info(`TTS: synthesizing (raw) "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
    const pcm = await this.fetchPcmFromElevenLabs(text);
    this.log?.info(`TTS: received ${pcm.length} bytes of PCM @ 24000Hz`);
    if (!pcm || pcm.length === 0) return [];

    // 2. Resample to 48kHz
    const pcmEven = pcm.length % 2 !== 0 ? pcm.subarray(0, pcm.length - 1) : pcm;
    const pcm48k = this.resample(pcmEven, 24000 as number, this.sampleRate);
    this.log?.info(`TTS: resampled to ${pcm48k.length} bytes @ 48000Hz (raw mode)`);

    // 3. Chunk into 20ms frames and Opus encode (no RTP wrapping)
    const samplesPerFrame = (this.sampleRate * FRAME_DURATION_MS) / 1000;
    const bytesPerFrame = samplesPerFrame * 2;
    const frames: Buffer[] = [];

    // Use a FRESH encoder per call — persistent encoder state causes Chrome decode issues.
    const OpusScript = (await import('opusscript')).default;
    const freshEncoder = new OpusScript(this.sampleRate, 2, OpusScript.Application.AUDIO);

    for (let offset = 0; offset + bytesPerFrame <= pcm48k.length; offset += bytesPerFrame) {
      const pcmFrame = pcm48k.subarray(offset, offset + bytesPerFrame);
      // Convert mono PCM to stereo (interleaved L,R) for the 2-channel Opus encoder.
      // The SDP advertises sprop-stereo=1, so the browser expects stereo frames.
      const stereoPcm = Buffer.alloc(pcmFrame.length * 2);
      for (let i = 0; i < samplesPerFrame; i++) {
        const sample = pcmFrame.readInt16LE(i * 2);
        stereoPcm.writeInt16LE(sample, i * 4);     // L
        stereoPcm.writeInt16LE(sample, i * 4 + 2); // R
      }
      const opusFrame = freshEncoder.encode(stereoPcm, samplesPerFrame);
      frames.push(Buffer.from(opusFrame));
    }
    freshEncoder.delete();

    this.log?.info(`TTS: encoded ${frames.length} raw Opus frames (${(frames.length * FRAME_DURATION_MS / 1000).toFixed(1)}s)`);

    // DIAGNOSTIC: dump resampled PCM and Opus frames for offline analysis
    try {
      const fs = await import('fs');
      fs.writeFileSync('/tmp/tts_debug_pcm48k.raw', pcm48k);
      fs.writeFileSync('/tmp/tts_debug_frames.json', JSON.stringify(frames.map(f => Buffer.from(f).toString('base64'))));
      this.log?.info(`TTS: DIAG dumped ${pcm48k.length}b PCM + ${frames.length} frames to /tmp/tts_debug_*`);
    } catch {}

    return frames;
  }

  /**
   * Fetch raw PCM 16-bit 24kHz mono audio from ElevenLabs streaming TTS API.
   */
  private async fetchPcmFromElevenLabs(text: string): Promise<Buffer> {
    // output_format is a QUERY parameter, not a body parameter.
    // Without it, ElevenLabs returns MP3 (audio/mpeg) instead of raw PCM.
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?output_format=pcm_24000`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: this.model,
        ...(this.language ? { language_code: this.language } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`);
    }

    // Accumulate response body into a single buffer
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body from ElevenLabs');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    // Concatenate all chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = Buffer.alloc(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }

    return result;
  }

  /**
   * Resample PCM 16-bit mono audio using linear interpolation.
   */
  resample(input: Buffer, fromRate: number, toRate: number): Buffer {
    if (fromRate === toRate) return input;

    // Defensive: ensure even byte count for 16-bit PCM
    const safeInput = input.length % 2 !== 0 ? input.subarray(0, input.length - 1) : input;
    const inputSamples = safeInput.length / 2; // 16-bit = 2 bytes per sample
    const ratio = fromRate / toRate;
    const outputSamples = Math.floor(inputSamples / ratio);
    const output = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
      const srcPos = i * ratio;
      const srcIndex = Math.floor(srcPos);
      const frac = srcPos - srcIndex;

      const s0 = safeInput.readInt16LE(srcIndex * 2);
      const s1 = srcIndex + 1 < inputSamples
        ? safeInput.readInt16LE((srcIndex + 1) * 2)
        : s0;

      const interpolated = Math.round(s0 + frac * (s1 - s0));
      // Clamp to Int16 range
      const clamped = Math.max(-32768, Math.min(32767, interpolated));
      output.writeInt16LE(clamped, i * 2);
    }

    return output;
  }

  /**
   * Create an RTP packet with the given Opus payload.
   *
   * RTP Header (12 bytes):
   *   Byte 0:    0x80 (V=2, no padding, no extension, CC=0)
   *   Byte 1:    payload type
   *   Bytes 2-3: sequence number (big-endian)
   *   Bytes 4-7: timestamp (big-endian, increments by 960 per 20ms frame)
   *   Bytes 8-11: SSRC (big-endian)
   */
  createRtpPacket(payload: Buffer, seq: number, timestamp: number, ssrc: number, pt: number, marker = false): Buffer {
    const header = Buffer.alloc(12);

    header[0] = 0x80;          // V=2
    header[1] = (marker ? 0x80 : 0) | (pt & 0x7f);  // Marker bit + payload type
    header.writeUInt16BE(seq & 0xffff, 2);
    header.writeUInt32BE(timestamp >>> 0, 4);
    header.writeUInt32BE(ssrc >>> 0, 8);

    return Buffer.concat([header, payload]);
  }

  /**
   * Cleanup OpusScript encoder resources.
   */
  destroy(): void {
    try {
      this.encoder.delete();
    } catch {
      // Already destroyed or not supported
    }
  }
}
