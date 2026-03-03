import { writeFileSync } from 'fs';

const apiKey = 'sk_bc59717df28d0f540eb418fd31d59863aff938c1c00dda3c';
const voiceId = 'EXAVITQu4vr4xnSDxMaL';

async function main() {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
  
  console.log('Fetching from ElevenLabs...');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: 'Hello, testing one two three.',
      model_id: 'eleven_turbo_v2',
      output_format: 'pcm_24000',
    }),
  });

  console.log('Status:', response.status);
  console.log('Content-Type:', response.headers.get('content-type'));
  console.log('Content-Length:', response.headers.get('content-length'));

  const chunks: Uint8Array[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No body');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const buf = Buffer.alloc(total);
  let pos = 0;
  for (const c of chunks) { buf.set(c, pos); pos += c.length; }

  console.log(`Total bytes: ${total}`);
  console.log(`First 32 bytes (hex): ${buf.subarray(0, 32).toString('hex')}`);
  console.log(`First 32 bytes (ascii): ${buf.subarray(0, 32).toString('ascii').replace(/[^\x20-\x7e]/g, '.')}`);
  
  // Check if it's mp3 (starts with ID3 or 0xFFE or 0xFFF)
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    console.log('❌ Response is MP3 (ID3 header), not PCM!');
  } else if ((buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0)) {
    console.log('❌ Response is MP3 (sync word), not PCM!');
  } else if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    console.log('❌ Response is OGG, not PCM!');
  } else if (buf.subarray(0, 4).toString('ascii') === 'RIFF') {
    console.log('⚠️ Response is WAV (RIFF header), not raw PCM!');
  } else if (buf.subarray(0, 4).toString('ascii') === 'fLaC') {
    console.log('❌ Response is FLAC, not PCM!');
  } else {
    // Check if it looks like PCM
    const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
    const first10 = Array.from(samples.slice(0, 10));
    console.log('First 10 as Int16LE:', first10);
    
    // Check for patterns that indicate wrong format
    const zeros = first10.filter(s => s === 0).length;
    console.log(`Zeros in first 10: ${zeros}`);
    
    if (zeros > 5) {
      console.log('⚠️ Too many zeros — might be wrong byte interpretation');
    }
  }
  
  // Save raw bytes for manual inspection
  writeFileSync('/tmp/elevenlabs-raw-bytes.bin', buf);
  console.log('Saved raw bytes to /tmp/elevenlabs-raw-bytes.bin');
  
  // Also try interpreting as unsigned 8-bit to see the byte distribution
  const byteHist: number[] = new Array(256).fill(0);
  for (let i = 0; i < Math.min(1000, buf.length); i++) {
    byteHist[buf[i]]++;
  }
  const topBytes = byteHist.map((c, i) => ({ byte: i, count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  console.log('Most common bytes (first 1000):', topBytes.map(b => `0x${b.byte.toString(16).padStart(2,'0')}:${b.count}`).join(' '));
}

main().catch(e => { console.error(e); process.exit(1); });
