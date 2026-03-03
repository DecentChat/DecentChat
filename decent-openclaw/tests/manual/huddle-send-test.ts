import * as ndc from 'node-datachannel';

async function main() {
  console.log('=== Huddle Send Test ===\n');

  const bot = new ndc.PeerConnection('bot', {
    iceServers: ['stun:stun.l.google.com:19302'],
    disableAutoNegotiation: true,  // like our real code
  });
  const browser = new ndc.PeerConnection('browser', {
    iceServers: ['stun:stun.l.google.com:19302'],
  });

  let botTrackOpen = false;
  let browserMsgs = 0;
  const pendingBotCand: {c:string,m:string}[] = [];
  const pendingBrCand: {c:string,m:string}[] = [];
  let botRemSet = false, brRemSet = false;

  bot.onLocalCandidate((c,m) => { if(brRemSet) browser.addRemoteCandidate(c,m); else pendingBotCand.push({c,m}); });
  browser.onLocalCandidate((c,m) => { if(botRemSet) bot.addRemoteCandidate(c,m); else pendingBrCand.push({c,m}); });
  bot.onStateChange(s => console.log(`[bot] PC: ${s}`));
  browser.onStateChange(s => console.log(`[browser] PC: ${s}`));

  // BROWSER: offer
  const brAudio = new ndc.Audio('0','SendRecv');
  brAudio.addOpusCodec(111);
  brAudio.addSSRC(5678,'br','br','br');
  const brTrack = browser.addTrack(brAudio);
  brTrack.onOpen(() => console.log('[browser] track opened'));
  brTrack.onMessage(buf => {
    browserMsgs++;
    if(browserMsgs<=5) console.log(`[browser] msg #${browserMsgs}: ${buf.length}b`);
  });

  const offer = await new Promise<string>(res => {
    browser.onLocalDescription((sdp,type) => {
      console.log(`[browser] ${type} (${sdp.length}c)`);
      if(type.toLowerCase()==='offer') res(sdp);
    });
    browser.setLocalDescription('Offer');
  });

  // BOT: addTrack + media handler + answer
  const botAudio = new ndc.Audio('0','SendRecv');
  botAudio.addOpusCodec(111);
  botAudio.addSSRC(1234,'bot-audio','bot-stream','audio-track');
  const botTrack = bot.addTrack(botAudio);

  const rtpCfg = new ndc.RtpPacketizationConfig(1234,'bot-audio',111,48000);
  const sr = new ndc.RtcpSrReporter(rtpCfg);
  sr.addToChain(new ndc.RtcpReceivingSession());
  botTrack.setMediaHandler(sr);

  botTrack.onOpen(() => { console.log('[bot] track opened'); botTrackOpen = true; });

  const answer = await new Promise<string>((res, rej) => {
    const t = setTimeout(() => rej(new Error('no answer')), 5000);
    bot.onLocalDescription((sdp,type) => {
      console.log(`[bot] ${type} (${sdp.length}c)`);
      if(type.toLowerCase()==='answer') { clearTimeout(t); res(sdp); }
    });
    bot.setRemoteDescription(offer, 'Offer');
    botRemSet = true;
    pendingBrCand.forEach(({c,m}) => bot.addRemoteCandidate(c,m));
    bot.setLocalDescription('Answer');
  });

  browser.setRemoteDescription(answer, 'Answer');
  brRemSet = true;
  pendingBotCand.forEach(({c,m}) => browser.addRemoteCandidate(c,m));

  await new Promise<void>(r => {
    const iv = setInterval(() => { if(botTrackOpen){clearInterval(iv);r();} },50);
    setTimeout(()=>{clearInterval(iv);r();},5000);
  });
  if(!botTrackOpen){console.log('❌ track never opened');process.exit(1);}

  const opus = Buffer.alloc(80, 0xAA);

  console.log('\n--- Test 1: Raw Opus ---');
  for(let i=0;i<10;i++){botTrack.sendMessageBinary(opus);await new Promise(r=>setTimeout(r,20));}
  await new Promise(r=>setTimeout(r,1000));
  console.log(`  Browser: ${browserMsgs}`);
  const t1=browserMsgs;

  console.log('\n--- Test 2: Full RTP ---');
  for(let i=0;i<10;i++){
    const h=Buffer.alloc(12);h[0]=0x80;h[1]=i===0?0xEF:0x6F;
    h.writeUInt16BE(i,2);h.writeUInt32BE(i*960,4);h.writeUInt32BE(1234,8);
    botTrack.sendMessageBinary(Buffer.concat([h,opus]));
    await new Promise(r=>setTimeout(r,20));
  }
  await new Promise(r=>setTimeout(r,1000));
  console.log(`  Browser: ${browserMsgs-t1}`);

  console.log(`\n=== Raw:${t1>0?'✅':'❌'}  RTP:${(browserMsgs-t1)>0?'✅':'❌'}  Total:${browserMsgs} ===`);
  bot.close();browser.close();
  setTimeout(()=>process.exit(0),500);
}
main().catch(e=>{console.error(e);process.exit(1);});
