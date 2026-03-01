import { describe, it, expect, afterAll } from 'bun:test';
import { TextToSpeech } from '../src/huddle/TextToSpeech';

const API_KEY = process.env.ELEVENLABS_API_KEY ?? 'sk_bc59717df28d0f540eb418fd31d59863aff938c1c00dda3c';

describe('TextToSpeech', () => {
  const tts = new TextToSpeech({
    apiKey: API_KEY,
    log: { info: (s: string) => console.log(s) },
  });

  afterAll(() => {
    tts.destroy();
  });

  it('should convert text to RTP packets with correct structure', async () => {
    const packets = await tts.speak('Hello, this is a test');

    // Should produce an array of buffers
    expect(Array.isArray(packets)).toBe(true);
    expect(packets.length).toBeGreaterThan(0);

    // Each packet should be a Buffer
    for (const pkt of packets) {
      expect(Buffer.isBuffer(pkt)).toBe(true);
      // Minimum size: 12 byte RTP header + at least 1 byte payload
      expect(pkt.length).toBeGreaterThan(12);
    }

    // Verify RTP V=2 marker (first byte should be 0x80)
    for (const pkt of packets) {
      expect(pkt[0]).toBe(0x80);
    }

    // Verify payload type is 111 (Opus)
    for (const pkt of packets) {
      expect(pkt[1]).toBe(111);
    }

    // Verify sequence numbers are sequential starting from 0
    for (let i = 0; i < packets.length; i++) {
      const seq = packets[i].readUInt16BE(2);
      expect(seq).toBe(i);
    }

    // Verify timestamps increment by 960 (20ms at 48kHz)
    for (let i = 0; i < packets.length; i++) {
      const ts = packets[i].readUInt32BE(4);
      expect(ts).toBe(i * 960);
    }

    // Verify SSRC is 1234
    for (const pkt of packets) {
      const ssrc = pkt.readUInt32BE(8);
      expect(ssrc).toBe(1234);
    }

    // Verify total duration is reasonable for a short phrase
    // ~1-2 seconds = ~50-100 packets at 20ms each
    const durationMs = packets.length * 20;
    console.log(`Total packets: ${packets.length}, duration: ${durationMs}ms`);
    expect(packets.length).toBeGreaterThanOrEqual(20);  // At least 0.4s
    expect(packets.length).toBeLessThanOrEqual(200);     // At most 4s
  }, 30_000); // 30 second timeout for API call

  it('should resample 24kHz to 48kHz correctly', () => {
    // Create a simple 24kHz sine wave buffer (100 samples)
    const numSamples = 100;
    const input = Buffer.alloc(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      const value = Math.round(Math.sin(2 * Math.PI * i / numSamples) * 16000);
      input.writeInt16LE(value, i * 2);
    }

    const output = tts.resample(input, 24000, 48000);

    // Output should have 2x samples (48000/24000 = 2)
    const expectedSamples = Math.floor(numSamples * (48000 / 24000));
    expect(output.length / 2).toBe(expectedSamples);

    // Output should be valid Int16 values
    for (let i = 0; i < output.length / 2; i++) {
      const sample = output.readInt16LE(i * 2);
      expect(sample).toBeGreaterThanOrEqual(-32768);
      expect(sample).toBeLessThanOrEqual(32767);
    }
  });

  it('should create valid RTP packets', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03]);
    const packet = tts.createRtpPacket(payload, 42, 40320, 1234, 111);

    expect(packet.length).toBe(12 + 3); // 12 header + 3 payload
    expect(packet[0]).toBe(0x80);
    expect(packet[1]).toBe(111);
    expect(packet.readUInt16BE(2)).toBe(42);
    expect(packet.readUInt32BE(4)).toBe(40320);
    expect(packet.readUInt32BE(8)).toBe(1234);
    expect(packet.subarray(12)).toEqual(payload);
  });
});
