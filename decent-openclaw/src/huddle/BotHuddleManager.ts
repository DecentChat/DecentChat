/**
 * BotHuddleManager — Huddle signaling + WebRTC audio for the bot (Node.js side).
 *
 * Handles huddle-* signal types, creates real WebRTC PeerConnections via
 * node-datachannel, and wires incoming audio through AudioPipeline → STT → LLM → TTS.
 *
 * Signal types handled:
 *   huddle-announce  — someone started a huddle; auto-join if enabled
 *   huddle-join      — someone joined the huddle
 *   huddle-leave     — someone left the huddle
 *   huddle-offer     — WebRTC offer → create PC, generate answer
 *   huddle-answer    — WebRTC answer → setRemoteDescription
 *   huddle-ice       — ICE candidate → addRemoteCandidate
 *   huddle-mute      — mute state change
 */

import ndc from 'node-datachannel';
import { AudioPipeline } from './AudioPipeline.js';
import { SpeechToText } from './SpeechToText.js';
import { TextToSpeech } from './TextToSpeech.js';

export interface BotHuddleCallbacks {
  sendSignal: (peerId: string, data: object) => boolean;
  broadcastSignal: (data: object) => void;
  getDisplayName: (peerId: string) => string;
  onTranscription?: (text: string, peerId: string, channelId: string) => Promise<string | undefined>;
  log?: { info: (s: string) => void; warn?: (s: string) => void; error?: (s: string) => void };
}

export interface BotHuddleConfig {
  autoJoin?: boolean;
  sttEngine?: 'whisper-cpp' | 'whisper-python' | 'openai' | 'groq';
  whisperModel?: string;
  sttLanguage?: string;
  sttApiKey?: string;
  ttsVoice?: string;
  vadSilenceMs?: number;
  vadThreshold?: number;
}

export type BotHuddleState = 'inactive' | 'listening' | 'in-call';

export interface BotHuddleParticipant {
  peerId: string;
  displayName: string;
  muted: boolean;
}

interface PeerAudioState {
  pc: ndc.PeerConnection;
  track: ndc.Track | null;
  rtpConfig?: any; // RtpPacketizationConfig — needed for manual timestamp control
}

export class BotHuddleManager {
  private state: BotHuddleState = 'inactive';
  private activeChannelId: string | null = null;
  private readonly myPeerId: string;
  private readonly callbacks: BotHuddleCallbacks;
  private readonly participants = new Map<string, BotHuddleParticipant>();
  private readonly autoJoin: boolean;

  // WebRTC state per peer
  private readonly peerConnections = new Map<string, PeerAudioState>();
  private readonly audioTracks = new Map<string, ndc.Track>();  // receiving tracks (from onTrack)
  private readonly sendTracks = new Map<string, ndc.Track>();   // sending tracks (from addTrack)

  // Audio pipeline components
  private audioPipeline: AudioPipeline;
  private stt: SpeechToText;
  private tts: TextToSpeech | null = null;

  // Track which peer is currently speaking (for attribution)
  private currentSpeakerPeerId: string | null = null;

  // Prevent overlapping responses
  private isProcessing = false;
  // Barge-in: abort current TTS send when user starts talking
  private abortSending = false;

  constructor(myPeerId: string, callbacks: BotHuddleCallbacks, opts?: BotHuddleConfig) {
    this.myPeerId = myPeerId;
    this.callbacks = callbacks;
    this.autoJoin = opts?.autoJoin ?? true;

    // Initialize audio pipeline
    this.audioPipeline = new AudioPipeline({
      sampleRate: 48000,
      channels: 1,
      vadThreshold: opts?.vadThreshold ?? 0.02,
      vadSilenceMs: opts?.vadSilenceMs ?? 500,
      onSpeechStart: () => {
        if (this.isProcessing) {
          this.log('info', '[bot-huddle] barge-in detected — aborting current response');
          this.abortSending = true;
          this.emitStatus('interrupted');
        } else {
          this.emitStatus('hearing');
        }
      },
      onSpeechEnd: (pcm) => this.handleSpeechEnd(pcm),
      log: callbacks.log,
    });

    // Initialize STT
    this.stt = new SpeechToText({
      engine: opts?.sttEngine ?? 'whisper-cpp',
      model: opts?.whisperModel ?? 'medium',
      language: opts?.sttLanguage,
      apiKey: opts?.sttApiKey,
      log: callbacks.log,
    });

    // Initialize TTS (needs API key from env)
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (elevenLabsKey) {
      this.tts = new TextToSpeech({
        apiKey: elevenLabsKey,
        voiceId: this.resolveVoiceId(opts?.ttsVoice),
        language: opts?.sttLanguage,  // same language for TTS pronunciation
        log: callbacks.log,
      });
    } else {
      this.log('warn', '[bot-huddle] ELEVENLABS_API_KEY not set — TTS disabled');
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────

  getState(): BotHuddleState {
    return this.state;
  }

  getActiveChannelId(): string | null {
    return this.activeChannelId;
  }

  getParticipants(): BotHuddleParticipant[] {
    return Array.from(this.participants.values());
  }

  // ── Signal dispatch ────────────────────────────────────────────────

  async handleSignal(fromPeerId: string, data: any): Promise<void> {
    const type = data?.type as string | undefined;
    if (!type) return;

    switch (type) {
      case 'huddle-announce':
        this.handleAnnounce(fromPeerId, data);
        break;
      case 'huddle-join':
        this.handleJoin(fromPeerId, data);
        break;
      case 'huddle-leave':
        this.handleLeave(fromPeerId, data);
        break;
      case 'huddle-offer':
        this.handleOffer(fromPeerId, data);
        break;
      case 'huddle-answer':
        this.handleAnswer(fromPeerId, data);
        break;
      case 'huddle-ice':
        this.handleIce(fromPeerId, data);
        break;
      case 'huddle-stats':
        this.log('info', `[bot-huddle] stats from ${fromPeerId.slice(0, 8)}: ${JSON.stringify(data.stats).slice(0, 200)}`);
        break;
      case 'huddle-mute':
        this.handleMute(fromPeerId, data);
        break;
      default:
        this.log('warn', `[bot-huddle] unknown huddle signal: ${type}`);
    }
  }

  // ── Manual join/leave ──────────────────────────────────────────────

  join(channelId: string): void {
    if (this.state === 'in-call') return;

    this.activeChannelId = channelId;
    this.state = 'in-call';

    this.callbacks.broadcastSignal({
      type: 'huddle-join',
      channelId,
      peerId: this.myPeerId,
    });

    this.log('info', `[bot-huddle] joined huddle in ${channelId}`);
    this.emitStatus('listening');
  }

  leave(): void {
    if (this.state === 'inactive') return;

    const channelId = this.activeChannelId;

    // Cleanup all peer connections
    for (const [peerId] of this.peerConnections) {
      this.cleanupPeer(peerId);
    }

    this.participants.clear();
    this.state = 'inactive';
    this.activeChannelId = null;
    this.audioPipeline.reset();

    if (channelId) {
      this.callbacks.broadcastSignal({
        type: 'huddle-leave',
        channelId,
        peerId: this.myPeerId,
      });
    }

    this.log('info', `[bot-huddle] left huddle in ${channelId ?? '(none)'}`);
  }

  // ── Signal handlers ────────────────────────────────────────────────

  private handleAnnounce(fromPeerId: string, data: any): void {
    const channelId = data.channelId as string;
    this.log('info', `[bot-huddle] huddle-announce from ${fromPeerId} in ${channelId}`);

    this.participants.set(fromPeerId, {
      peerId: fromPeerId,
      displayName: this.callbacks.getDisplayName(fromPeerId),
      muted: false,
    });

    if (this.autoJoin && this.state === 'inactive') {
      this.activeChannelId = channelId;
      this.state = 'in-call';

      this.callbacks.broadcastSignal({
        type: 'huddle-join',
        channelId,
        peerId: this.myPeerId,
      });

      this.log('info', `[bot-huddle] auto-joined huddle in ${channelId}`);
      this.emitStatus('listening');
    } else if (this.state === 'in-call' && this.activeChannelId === channelId) {
      // Already in a huddle — notify the announcing peer so they send us an offer
      this.log('info', `[bot-huddle] already in-call, notifying announcer ${fromPeerId}`);
      this.callbacks.sendSignal(fromPeerId, {
        type: 'huddle-join',
        channelId,
        peerId: this.myPeerId,
      });
    }


  }

  private handleJoin(fromPeerId: string, data: any): void {
    const channelId = data.channelId as string;
    this.log('info', `[bot-huddle] huddle-join from ${fromPeerId} in ${channelId}`);

    this.participants.set(fromPeerId, {
      peerId: fromPeerId,
      displayName: this.callbacks.getDisplayName(fromPeerId),
      muted: false,
    });

    if (this.state === 'in-call' && this.activeChannelId === channelId) {
      // Send a targeted huddle-join to the new peer so they discover us
      // and send us an offer. This avoids SDP glare (both sides sending
      // offers simultaneously) which kills the connection.
      this.log('info', `[bot-huddle] notifying new peer ${fromPeerId} of our presence`);
      this.callbacks.sendSignal(fromPeerId, {
        type: 'huddle-join',
        channelId,
        peerId: this.myPeerId,
      });
    }



  }

  private handleLeave(fromPeerId: string, data: any): void {
    const channelId = data.channelId as string;
    this.log('info', `[bot-huddle] huddle-leave from ${fromPeerId} in ${channelId}`);

    this.participants.delete(fromPeerId);
    this.cleanupPeer(fromPeerId);

    // If no participants left and we're in a call, go inactive
    if (this.state === 'in-call' && this.participants.size === 0) {
      this.state = 'inactive';
      this.activeChannelId = null;
      this.audioPipeline.reset();
      this.log('info', `[bot-huddle] all participants left, going inactive`);
    }
  }

  private handleOffer(fromPeerId: string, data: any): void {
    this.log('info', `[bot-huddle] received offer from ${fromPeerId}`);

    // Cleanup any existing PC for this peer
    this.cleanupPeer(fromPeerId);

    try {
      const pc = new ndc.PeerConnection('bot-huddle', {
        iceServers: ['stun:stun.l.google.com:19302'],
        // AUTO-NEGOTIATION enabled so that SRTP sender is fully initialized.
        // onLocalDescription filters out the spurious re-offer from addTrack.
      });

      // Store peer state (track set via onTrack)
      const peerState: PeerAudioState = { pc, track: null };
      this.peerConnections.set(fromPeerId, peerState);

      // Extract Opus payload type from the browser's offer SDP.
      // Chrome uses PT=111, Firefox/Zen uses PT=109. We MUST match.
      const offerSdp = typeof data.sdp === 'object' ? data.sdp.sdp : data.sdp;
      const opusPt = this.extractOpusPayloadType(offerSdp);
      this.log('info', `[bot-huddle] browser Opus PT = ${opusPt}`);

      // Single bidirectional track for both SEND and RECEIVE.
      // addTrack with mid='0' matches the browser's offer m-line.
      // node-datachannel uses this ONE track for both directions (onTrack won't fire).
      const audio = new ndc.Audio('0', 'SendRecv');
      audio.addOpusCodec(opusPt);
      audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
      const track = pc.addTrack(audio);

      // Media handler chain: RTCP Sender Reports + Receiving Session.
      // Chrome requires RTCP SR to synchronize RTP timing and start decoding.
      // Without this, Chrome receives SRTP packets but plays silence because
      // it has no timing reference. We still construct RTP headers manually
      // and send via sendMessageBinary — the media handler chain handles RTCP.
      const rtpCfg = new ndc.RtpPacketizationConfig(1234, 'bot-audio', opusPt, 48000);
      const srReporter = new ndc.RtcpSrReporter(rtpCfg);
      srReporter.addToChain(new ndc.RtcpReceivingSession());
      track.setMediaHandler(srReporter);

      const manualRtp = {
        ssrc: 1234,
        payloadType: opusPt,
        sequenceNumber: Math.floor(Math.random() * 65535),
        timestamp: Math.floor(Math.random() * 0xFFFFFFFF),
      };
      peerState.rtpConfig = manualRtp as any;

      peerState.track = track;
      this.audioTracks.set(fromPeerId, track);
      this.sendTracks.set(fromPeerId, track);  // same track for sending

      let msgCount = 0;
      track.onMessage((buf: Buffer) => {
        // CRITICAL: copy the buffer and defer processing to Node.js event loop.
        // node-datachannel calls this from a native thread; doing work here
        // (Opus decode, PCM conversion) can cause segfaults.
        const copy = Buffer.from(buf);
        msgCount++;
        const n = msgCount;
        setImmediate(() => {
          try {
            if (n <= 3 || n % 500 === 0) {
              this.log('info', `[bot-huddle] track.onMessage #${n} from ${fromPeerId}, ${copy.length} bytes`);
            }
            this.currentSpeakerPeerId = fromPeerId;
            this.audioPipeline.feedRtpPacket(copy);
          } catch (err) {
            this.log('error', `[bot-huddle] feedRtpPacket error: ${String(err)}`);
          }
        });
      });

      track.onOpen(() => {
        this.log('info', `[bot-huddle] audio track opened for ${fromPeerId}`);
        this.sendTracks.set(fromPeerId, track);
      });

      track.onClosed(() => {
        this.log('info', `[bot-huddle] audio track closed for ${fromPeerId}`);
      });

      track.onError((err: string) => {
        this.log('error', `[bot-huddle] audio track error for ${fromPeerId}: ${err}`);
      });

      // Only send the answer SDP
      pc.onLocalDescription((sdp: string, type: string) => {
        const lowerType = type.toLowerCase();
        this.log('info', `[bot-huddle] onLocalDescription type=${lowerType} for ${fromPeerId} (${sdp.length} chars)\n${sdp}`);
        if (lowerType !== 'answer') {
          this.log('warn', `[bot-huddle] unexpected non-answer SDP (type=${lowerType}), ignoring`);
          return;
        }
        this.callbacks.sendSignal(fromPeerId, {
          type: 'huddle-answer',
          sdp: { sdp, type: lowerType },
          channelId: this.activeChannelId,
          fromPeerId: this.myPeerId,
        });
      });

      // Forward ICE candidates
      pc.onLocalCandidate((candidate: string, mid: string) => {
        this.callbacks.sendSignal(fromPeerId, {
          type: 'huddle-ice',
          candidate: { candidate, sdpMid: mid },
          channelId: this.activeChannelId,
          fromPeerId: this.myPeerId,
        });
      });

      pc.onStateChange((state: string) => {
        this.log('info', `[bot-huddle] PC state for ${fromPeerId}: ${state}`);
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          this.cleanupPeer(fromPeerId);
        }
      });

      // Extract SDP from the offer - handle both formats:
      // Browser sends: { sdp: { sdp: 'v=0...', type: 'offer' } } OR { sdp: 'v=0...' }
      let sdpString: string;
      let sdpType: string;

      if (typeof data.sdp === 'object' && data.sdp !== null) {
        sdpString = data.sdp.sdp;
        sdpType = data.sdp.type || 'offer';
      } else if (typeof data.sdp === 'string') {
        sdpString = data.sdp;
        sdpType = 'offer';
      } else {
        this.log('error', `[bot-huddle] invalid SDP in offer from ${fromPeerId}`);
        return;
      }

      // Normalize type to node-datachannel's DescriptionType format (e.g. 'Offer')
      const normalizedType = sdpType.charAt(0).toUpperCase() + sdpType.slice(1).toLowerCase();

      this.log('info', `[bot-huddle] setting remote description (type=${normalizedType}, sdp=${sdpString.length} chars)\n${sdpString}`);
      pc.setRemoteDescription(sdpString, normalizedType as any);

      // Auto-negotiation generates the answer automatically after setRemoteDescription.
      // The onLocalDescription callback filters to only send the answer.

    } catch (err) {
      this.log('error', `[bot-huddle] failed to handle offer from ${fromPeerId}: ${String(err)}`);
      this.cleanupPeer(fromPeerId);
    }
  }

  private handleAnswer(fromPeerId: string, data: any): void {
    this.log('info', `[bot-huddle] received answer from ${fromPeerId}`);

    const peerState = this.peerConnections.get(fromPeerId);
    if (!peerState) {
      this.log('warn', `[bot-huddle] no PC found for answer from ${fromPeerId}`);
      return;
    }

    try {
      let sdpString: string;
      let sdpType: string;

      if (typeof data.sdp === 'object' && data.sdp !== null) {
        sdpString = data.sdp.sdp;
        sdpType = data.sdp.type || 'answer';
      } else if (typeof data.sdp === 'string') {
        sdpString = data.sdp;
        sdpType = 'answer';
      } else {
        this.log('error', `[bot-huddle] invalid SDP in answer from ${fromPeerId}`);
        return;
      }

      const normalizedType = sdpType.charAt(0).toUpperCase() + sdpType.slice(1).toLowerCase();
      peerState.pc.setRemoteDescription(sdpString, normalizedType as any);
    } catch (err) {
      this.log('error', `[bot-huddle] failed to set answer from ${fromPeerId}: ${String(err)}`);
    }
  }

  private handleIce(fromPeerId: string, data: any): void {
    const peerState = this.peerConnections.get(fromPeerId);
    if (!peerState) {
      this.log('warn', `[bot-huddle] no PC found for ICE from ${fromPeerId}`);
      return;
    }

    try {
      // Browser sends: { candidate: { candidate: 'candidate:...', sdpMid: '0' } }
      // OR: { candidate: 'candidate:...', sdpMid: '0' }
      let candidateStr: string;
      let mid: string;

      if (typeof data.candidate === 'object' && data.candidate !== null) {
        candidateStr = data.candidate.candidate;
        mid = data.candidate.sdpMid ?? '0';
      } else if (typeof data.candidate === 'string') {
        candidateStr = data.candidate;
        mid = data.sdpMid ?? '0';
      } else {
        this.log('warn', `[bot-huddle] invalid ICE candidate from ${fromPeerId}`);
        return;
      }

      peerState.pc.addRemoteCandidate(candidateStr, mid);
    } catch (err) {
      this.log('error', `[bot-huddle] failed to add ICE from ${fromPeerId}: ${String(err)}`);
    }
  }

  private handleMute(fromPeerId: string, data: any): void {
    const muted = data.muted as boolean;
    const participant = this.participants.get(fromPeerId);
    if (participant) {
      participant.muted = muted;
      this.participants.set(fromPeerId, participant);
      this.log('info', `[bot-huddle] ${fromPeerId} ${muted ? 'muted' : 'unmuted'}`);
    }
  }


  // ── Initiate WebRTC connection to a peer (bot as offerer) ────────

  private initiateConnectionTo(peerId: string): void {
    // Skip if we already have a connection to this peer
    const existing = this.peerConnections.get(peerId);
    if (existing) {
      this.log('info', `[bot-huddle] already have PC for ${peerId}, skipping initiation`);
      return;
    }

    this.log('info', `[bot-huddle] initiating WebRTC connection to ${peerId}`);

    try {
      const pc = new ndc.PeerConnection('bot-huddle-init', {
        iceServers: ['stun:stun.l.google.com:19302'],
      });

      const peerState: PeerAudioState = { pc, track: null };
      this.peerConnections.set(peerId, peerState);

      // Use default Opus PT=111 (Chrome standard).
      // The browser's answer will confirm compatibility.
      const opusPt = 111;

      const audio = new ndc.Audio('0', 'SendRecv');
      audio.addOpusCodec(opusPt);
      audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');
      const track = pc.addTrack(audio);

      // Media handler chain for RTCP Sender Reports
      const rtpCfg = new ndc.RtpPacketizationConfig(1234, 'bot-audio', opusPt, 48000);
      const srReporter = new ndc.RtcpSrReporter(rtpCfg);
      srReporter.addToChain(new ndc.RtcpReceivingSession());
      track.setMediaHandler(srReporter);

      const manualRtp = {
        ssrc: 1234,
        payloadType: opusPt,
        sequenceNumber: Math.floor(Math.random() * 65535),
        timestamp: Math.floor(Math.random() * 0xFFFFFFFF),
      };
      peerState.rtpConfig = manualRtp as any;
      peerState.track = track;
      this.audioTracks.set(peerId, track);
      this.sendTracks.set(peerId, track);

      // Wire incoming audio
      let msgCount = 0;
      track.onMessage((buf: Buffer) => {
        const copy = Buffer.from(buf);
        msgCount++;
        const n = msgCount;
        setImmediate(() => {
          try {
            if (n <= 3 || n % 500 === 0) {
              this.log('info', `[bot-huddle] track.onMessage #${n} from ${peerId}, ${copy.length} bytes`);
            }
            this.currentSpeakerPeerId = peerId;
            this.audioPipeline.feedRtpPacket(copy);
          } catch (err) {
            this.log('error', `[bot-huddle] feedRtpPacket error: ${String(err)}`);
          }
        });
      });

      track.onOpen(() => {
        this.log('info', `[bot-huddle] audio track opened for ${peerId} (initiated)`);
        this.sendTracks.set(peerId, track);
      });

      track.onClosed(() => {
        this.log('info', `[bot-huddle] audio track closed for ${peerId} (initiated)`);
      });

      track.onError((err: string) => {
        this.log('error', `[bot-huddle] audio track error for ${peerId}: ${err}`);
      });

      // Send the OFFER (not answer) — this is the key difference from handleOffer
      pc.onLocalDescription((sdp: string, type: string) => {
        const lowerType = type.toLowerCase();
        this.log('info', `[bot-huddle] onLocalDescription (initiate) type=${lowerType} for ${peerId} (${sdp.length} chars)`);
        if (lowerType !== 'offer') {
          this.log('info', `[bot-huddle] ignoring non-offer SDP (type=${lowerType}) during initiation`);
          return;
        }
        this.callbacks.sendSignal(peerId, {
          type: 'huddle-offer',
          sdp: { sdp, type: lowerType },
          channelId: this.activeChannelId,
          fromPeerId: this.myPeerId,
        });
      });

      // Forward ICE candidates
      pc.onLocalCandidate((candidate: string, mid: string) => {
        this.callbacks.sendSignal(peerId, {
          type: 'huddle-ice',
          candidate: { candidate, sdpMid: mid },
          channelId: this.activeChannelId,
          fromPeerId: this.myPeerId,
        });
      });

      pc.onStateChange((state: string) => {
        this.log('info', `[bot-huddle] PC state (initiated) for ${peerId}: ${state}`);
        if (state === 'connected') {
          this.log('info', `[bot-huddle] WebRTC connected to ${peerId} (bot-initiated)`);
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          this.cleanupPeer(peerId);
        }
      });

      // Explicitly trigger offer generation.
      // Unlike the answer path (where setRemoteDescription auto-generates the answer),
      // the offerer must call setLocalDescription to produce the offer SDP.
      pc.setLocalDescription();

    } catch (err) {
      this.log('error', `[bot-huddle] failed to initiate connection to ${peerId}: ${String(err)}`);
      this.cleanupPeer(peerId);
    }
  }
  // ── Voice Pipeline: STT → LLM → TTS (sentence-streamed) ────────

  private async handleSpeechEnd(pcm: Buffer): Promise<void> {
    if (this.isProcessing) {
      this.log('info', '[bot-huddle] already processing speech, skipping');
      return;
    }

    this.isProcessing = true;
    this.abortSending = false;
    const speakerPeerId = this.currentSpeakerPeerId ?? 'unknown';
    const channelId = this.activeChannelId ?? '';
    const pipelineStart = Date.now();

    try {
      // 1. STT
      this.emitStatus('transcribing');
      const sttStart = Date.now();
      const text = await this.stt.transcribe(pcm, 48000);
      const sttMs = Date.now() - sttStart;
      if (!text || text.length < 2) {
        this.log('info', '[bot-huddle] STT returned empty/noise, skipping');
        return;
      }
      this.log('info', `[bot-huddle] heard from ${speakerPeerId.slice(0, 8)}: "${text}" (STT: ${sttMs}ms)`);

      // 2. LLM
      this.emitStatus('thinking');
      const llmStart = Date.now();
      let response: string | undefined;
      try {
        response = await this.callbacks.onTranscription?.(text, speakerPeerId, channelId);
      } catch (llmErr) {
        this.log('error', `[bot-huddle] LLM call failed: ${String(llmErr)}`);
      }
      if (!response) {
        response = `I heard you say: ${text}`;
        this.log('info', `[bot-huddle] LLM unavailable, using echo response`);
      }
      const llmMs = Date.now() - llmStart;

      // Check speakability
      const speakableText = response.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
      if (speakableText.length < 3) {
        this.log('info', `[bot-huddle] response too short for TTS ("${response}"), skipping`);
        return;
      }

      this.log('info', `[bot-huddle] responding (LLM: ${llmMs}ms): "${response.slice(0, 100)}${response.length > 100 ? '...' : ''}"`);

      if (!this.tts) {
        this.log('warn', '[bot-huddle] TTS not available');
        return;
      }

      // 3. Split into sentences and stream TTS+send for each
      const sentences = this.splitIntoSentences(speakableText);
      this.log('info', `[bot-huddle] streaming ${sentences.length} sentence(s)`);
      this.emitStatus('speaking');

      const ttsStart = Date.now();
      let totalFrames = 0;

      for (const sentence of sentences) {
        if (sentence.length < 2) continue;
        if (this.abortSending) {
          this.log('info', `[bot-huddle] barge-in: stopped after ${totalFrames} frames`);
          break;
        }
        const frames = await this.tts.speakRaw(sentence);
        totalFrames += frames.length;
        if (this.abortSending) {
          this.log('info', `[bot-huddle] barge-in: skipping send after TTS`);
          break;
        }
        await this.sendFramesToAllPeers(frames, totalFrames === frames.length);
      }

      const ttsMs = Date.now() - ttsStart;
      const totalMs = Date.now() - pipelineStart;
      this.log('info', `[bot-huddle] pipeline done: STT=${sttMs}ms LLM=${llmMs}ms TTS+send=${ttsMs}ms total=${totalMs}ms (${totalFrames} frames, ${(totalFrames * 0.02).toFixed(1)}s audio)`);

    } catch (err) {
      this.log('error', `[bot-huddle] voice pipeline error: ${String(err)}`);
    } finally {
      this.isProcessing = false;
      this.abortSending = false;
      this.emitStatus('listening');
    }
  }

  /**
   * Split text into sentences for progressive TTS.
   * Keeps sentences together if very short (<30 chars) to reduce API calls.
   */
  private splitIntoSentences(text: string): string[] {
    // Split on sentence-ending punctuation
    const raw = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
    const sentences: string[] = [];
    let buffer = '';

    for (const s of raw) {
      buffer += s;
      // Flush when buffer is long enough (>60 chars) or it's the last segment
      if (buffer.length >= 60 || s === raw[raw.length - 1]) {
        sentences.push(buffer.trim());
        buffer = '';
      }
    }
    if (buffer.trim()) sentences.push(buffer.trim());
    return sentences;
  }

  /**
   * Send Opus frames to all connected peers with RTP pacing.
   */
  private async sendFramesToAllPeers(frames: Buffer[], isFirstBatch: boolean): Promise<void> {
    const SAMPLES_PER_FRAME = 960;

    for (const [peerId, track] of this.sendTracks) {
      if (!track.isOpen()) {
        this.log('warn', `[bot-huddle] track NOT open for ${peerId.slice(0, 8)}, skip`);
        continue;
      }

      let sentOk = 0, sentFail = 0;
      const peerState = this.peerConnections.get(peerId);
      const rtpConfig = peerState?.rtpConfig;

      for (const frame of frames) {
        if (this.abortSending) {
          this.log('info', `[bot-huddle] barge-in: stopped mid-send at frame ${sentOk}/${frames.length}`);
          break;
        }
        if (rtpConfig) {
          rtpConfig.sequenceNumber = (rtpConfig.sequenceNumber + 1) & 0xFFFF;
          rtpConfig.timestamp = (rtpConfig.timestamp + SAMPLES_PER_FRAME) >>> 0;
        }
        const rtpHeader = Buffer.alloc(12);
        const isFirst = isFirstBatch && (sentOk + sentFail === 0);
        rtpHeader[0] = 0x80;
        rtpHeader[1] = (isFirst ? 0x80 : 0x00) | (rtpConfig?.payloadType ?? 111);
        rtpHeader.writeUInt16BE(rtpConfig?.sequenceNumber ?? 0, 2);
        rtpHeader.writeUInt32BE(rtpConfig?.timestamp ?? 0, 4);
        rtpHeader.writeUInt32BE(rtpConfig?.ssrc ?? 1234, 8);

        const ok = track.sendMessageBinary(Buffer.concat([rtpHeader, frame]));
        if (ok) sentOk++; else sentFail++;

        if (sentOk + sentFail <= 2 && isFirstBatch) {
          this.log('info', `[bot-huddle] send #${sentOk+sentFail}: seq=${rtpConfig?.sequenceNumber}, ts=${rtpConfig?.timestamp}`);
        }
        await new Promise(r => setTimeout(r, 18));
      }
      this.log('info', `[bot-huddle] sent ${sentOk}/${frames.length} frames to ${peerId.slice(0, 8)}`);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  private cleanupPeer(peerId: string): void {
    const peerState = this.peerConnections.get(peerId);
    if (peerState) {
      try {
        peerState.track?.close();
      } catch { /* already closed */ }
      try {
        peerState.pc.close();
      } catch { /* already closed */ }
      this.peerConnections.delete(peerId);
      this.audioTracks.delete(peerId);
      this.sendTracks.delete(peerId);
      this.log('info', `[bot-huddle] cleaned up PC for ${peerId}`);
    }
  }

  destroy(): void {
    this.leave();
    this.audioPipeline.destroy();
    this.tts?.destroy();
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private resolveVoiceId(voiceName?: string): string | undefined {
    if (!voiceName) return undefined;
    const voiceMap: Record<string, string> = {
      'rachel': 'EXAVITQu4vr4xnSDxMaL',
      'domi': 'AZnzlk1XvdvUeBnXmlld',
      'bella': 'EXAVITQu4vr4xnSDxMaL',
      'antoni': 'ErXwobaYiN019PkySvjV',
      'elli': 'MF3mGyEYCl7XYWbV9V6O',
      'josh': 'TxGEqnHWrfWFTfGW9XjX',
      'arnold': 'VR6AewLTigWG4xSOukaG',
      'adam': 'pNInz6obpgDQGcFmaJgB',
      'sam': 'yoZ06aMxZJJ28mfd3POQ',
    };
    return voiceMap[voiceName.toLowerCase()] ?? voiceName;
  }

  /**
   * Extract the Opus payload type from an SDP offer.
   * Chrome typically uses 111, Firefox/Zen uses 109.
   * Falls back to 111 if not found.
   */
  private extractOpusPayloadType(sdp: string): number {
    if (!sdp) return 111;
    // Match: a=rtpmap:<PT> opus/48000/2
    const match = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    if (match) return parseInt(match[1], 10);
    return 111; // Default fallback
  }

  /**
   * Broadcast a status indicator to all peers in the huddle.
   * States: listening, hearing, transcribing, thinking, speaking, interrupted
   */
  private emitStatus(status: 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking' | 'interrupted'): void {
    this.callbacks.broadcastSignal({
      type: 'huddle-status',
      channelId: this.activeChannelId,
      peerId: this.myPeerId,
      status,
    });
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    if (level === 'info') {
      this.callbacks.log?.info(msg);
    } else if (level === 'warn') {
      (this.callbacks.log?.warn ?? this.callbacks.log?.info)?.(msg);
    } else {
      (this.callbacks.log?.error ?? this.callbacks.log?.info)?.(msg);
    }
  }
}
