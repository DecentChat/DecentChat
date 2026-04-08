import OpusScript from 'opusscript';

export interface AudioPipelineOptions {
  sampleRate?: number;       // 48000 (default)
  channels?: number;         // 1 mono (default)
  frameDuration?: number;    // 20ms (default)
  vadThreshold?: number;     // 0.02 RMS (default)
  vadSilenceMs?: number;     // 500ms (default)
  onSpeechStart?: () => void;
  onSpeechEnd?: (pcmBuffer: Buffer) => void;
  log?: { info: (s: string) => void };
}

/**
 * AudioPipeline — decodes incoming Opus RTP packets to PCM
 * and detects when the human stops speaking via energy-based VAD.
 */
export class AudioPipeline {
  private decoder: OpusScript;
  private sampleRate: number;
  private channels: number;
  private frameDuration: number;
  private vadThreshold: number;
  private vadSilenceMs: number;
  private onSpeechStart?: () => void;
  private onSpeechEnd?: (pcmBuffer: Buffer) => void;
  private log?: { info: (s: string) => void };

  // VAD state
  private isSpeaking = false;
  private pcmChunks: Buffer[] = [];
  private silenceStart: number | null = null;

  constructor(opts: AudioPipelineOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.channels = opts.channels ?? 1;
    this.frameDuration = opts.frameDuration ?? 20;
    this.vadThreshold = opts.vadThreshold ?? 0.02;
    this.vadSilenceMs = opts.vadSilenceMs ?? 500;
    this.onSpeechStart = opts.onSpeechStart;
    this.onSpeechEnd = opts.onSpeechEnd;
    this.log = opts.log;

    this.decoder = new OpusScript(this.sampleRate, this.channels, OpusScript.Application.AUDIO);
  }

  /**
   * Main entry point — called with raw RTP packet from WebRTC Track.
   */
  feedRtpPacket(buf: Buffer): void {
    const opusPayload = this.stripRtpHeader(buf);
    if (!opusPayload || opusPayload.length === 0) return;

    // Decode Opus → PCM Int16
    const pcm = this.decoder.decode(opusPayload);
    if (!pcm || pcm.length === 0) return;

    const pcmBuf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);

    // Convert to Int16Array for RMS computation
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
    const rms = this.computeRMS(samples);

    const now = Date.now();

    if (rms >= this.vadThreshold) {
      // Speech detected
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.log?.info(`[AudioPipeline] Speech started (RMS=${rms.toFixed(4)})`);
        this.onSpeechStart?.();
      }
      this.silenceStart = null;
      this.pcmChunks.push(pcmBuf);
    } else {
      // Silence
      if (this.isSpeaking) {
        // Still accumulate PCM during silence gap (for continuity)
        this.pcmChunks.push(pcmBuf);

        if (this.silenceStart === null) {
          this.silenceStart = now;
        } else if (now - this.silenceStart >= this.vadSilenceMs) {
          // Silence threshold reached — emit speech
          this.log?.info(`[AudioPipeline] Speech ended after ${this.vadSilenceMs}ms silence`);
          const fullPcm = Buffer.concat(this.pcmChunks);
          this.isSpeaking = false;
          this.pcmChunks = [];
          this.silenceStart = null;
          this.onSpeechEnd?.(fullPcm);
        }
      }
      // If not speaking, ignore silence frames
    }
  }

  /**
   * Parse RTP header and return the Opus payload after the header.
   *
   * RTP header format:
   *   Byte 0:  V(2)|P(1)|X(1)|CC(4)
   *   Byte 1:  M(1)|PT(7)
   *   Bytes 2-3:  sequence number
   *   Bytes 4-7:  timestamp
   *   Bytes 8-11: SSRC
   *   Then CC*4 bytes of CSRC
   *   If X bit set: 4 bytes extension header + extension data
   */
  stripRtpHeader(buf: Buffer): Buffer | null {
    if (buf.length < 12) return null;

    const byte0 = buf[0];
    const cc = byte0 & 0x0F;           // CSRC count
    const hasExtension = (byte0 >> 4) & 0x01;  // X bit
    const hasPadding = (byte0 >> 5) & 0x01;    // P bit

    let offset = 12 + cc * 4;  // Fixed header + CSRC list

    if (offset > buf.length) return null;

    // Handle extension header
    if (hasExtension) {
      if (offset + 4 > buf.length) return null;
      // Extension header: 2 bytes profile-specific, 2 bytes length (in 32-bit words)
      const extLength = buf.readUInt16BE(offset + 2);
      offset += 4 + extLength * 4;
    }

    if (offset > buf.length) return null;

    let payloadEnd = buf.length;

    // Handle padding
    if (hasPadding && buf.length > offset) {
      const paddingLength = buf[buf.length - 1];
      payloadEnd -= paddingLength;
    }

    if (payloadEnd <= offset) return null;

    return buf.subarray(offset, payloadEnd);
  }

  /**
   * Compute root-mean-square energy level.
   * Normalizes Int16 samples to -1..1 range first.
   */
  computeRMS(pcm: Int16Array): number {
    if (pcm.length === 0) return 0;
    let sumSquares = 0;
    for (let i = 0; i < pcm.length; i++) {
      const normalized = pcm[i] / 32768;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / pcm.length);
  }

  /**
   * Reset VAD state (e.g. when peer disconnects).
   */
  reset(): void {
    this.isSpeaking = false;
    this.pcmChunks = [];
    this.silenceStart = null;
  }

  /**
   * Clean up decoder resources.
   */
  destroy(): void {
    this.reset();
    this.decoder.delete();
  }
}
