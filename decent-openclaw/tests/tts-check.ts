import { TextToSpeech } from '../src/huddle/TextToSpeech.ts';
import { writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';

const config = JSON.parse(readFileSync(homedir() + '/.openclaw/openclaw.json', 'utf8'));
const apiKey = config?.channels?.decentchat?.env?.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || '';
if (!apiKey) { console.error('No API key'); process.exit(1); }
console.log('API key found:', apiKey.slice(0, 8) + '...');

const tts = new TextToSpeech({ apiKey, log: { info: console.log } });

async function main() {
  // Fetch raw PCM from ElevenLabs
  console.log('\n=== Direct ElevenLabs PCM fetch ===');
  const rawPcm: Buffer = await (tts as any).fetchPcmFromElevenLabs('Hello, testing one two three.');
  console.log(`Raw PCM: ${rawPcm.length} bytes (${(rawPcm.length / 2 / 24000).toFixed(2)}s at 24kHz)`);
  console.log(`Odd bytes: ${rawPcm.length % 2 !== 0}`);
  
  const even = rawPcm.length % 2 !== 0 ? rawPcm.subarray(0, rawPcm.length - 1) : rawPcm;
  const samples = new Int16Array(even.buffer, even.byteOffset, even.length / 2);
  let mx = 0, zcr = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > mx) mx = Math.abs(samples[i]);
  for (let i = 1; i < samples.length; i++) if ((samples[i]>=0) !== (samples[i-1]>=0)) zcr++;
  const zcrPerSec = zcr / (samples.length / 24000);
  console.log(`Max=${mx} ZCR=${Math.round(zcrPerSec)}/s`);
  console.log(zcrPerSec > 8000 ? '❌ RAW PCM IS NOISE' : '✅ Raw PCM is speech');
  console.log('First 20 samples:', Array.from(samples.slice(0, 20)));
  
  saveWav('/tmp/elevenlabs-raw-24k.wav', samples, 24000);
  console.log('Saved /tmp/elevenlabs-raw-24k.wav');

  // Now test the full speakRaw pipeline  
  console.log('\n=== Full speakRaw pipeline ===');
  const frames = await tts.speakRaw('Hello, testing one two three.');
  console.log(`Opus frames: ${frames.length} (${(frames.length * 0.02).toFixed(1)}s)`);
  
  // Check the resampled PCM
  const pcm48k = readFileSync('/tmp/tts_debug_pcm48k.raw');
  const s48 = new Int16Array(pcm48k.buffer, pcm48k.byteOffset, pcm48k.length / 2);
  let mx48 = 0, zcr48 = 0;
  for (let i = 0; i < s48.length; i++) if (Math.abs(s48[i]) > mx48) mx48 = Math.abs(s48[i]);
  for (let i = 1; i < s48.length; i++) if ((s48[i]>=0) !== (s48[i-1]>=0)) zcr48++;
  const zcr48PerSec = zcr48 / (s48.length / 48000);
  console.log(`Resampled 48k: Max=${mx48} ZCR=${Math.round(zcr48PerSec)}/s`);
  console.log(zcr48PerSec > 8000 ? '❌ RESAMPLED PCM IS NOISE' : '✅ Resampled PCM is speech');
  
  saveWav('/tmp/elevenlabs-resampled-48k.wav', s48, 48000);
  console.log('Saved /tmp/elevenlabs-resampled-48k.wav');
}

function saveWav(path: string, samples: Int16Array, rate: number) {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  writeFileSync(path, buf);
}

main().catch(e => { console.error(e); process.exit(1); });
