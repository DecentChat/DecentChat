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
  sttEngine?: 'whisper-cpp' | 'whisper-python';
  whisperModel?: string;
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
  private readonly audioTracks = new Map<string, ndc.Track>();

  // Audio pipeline components
  private audioPipeline: AudioPipeline;
  private stt: SpeechToText;
  private tts: TextToSpeech | null = null;

  // Track which peer is currently speaking (for attribution)
  private currentSpeakerPeerId: string | null = null;

  // Prevent overlapping responses
  private isProcessing = false;

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
      onSpeechEnd: (pcm) => this.handleSpeechEnd(pcm),
      log: callbacks.log,
    });

    // Initialize STT
    this.stt = new SpeechToText({
      engine: opts?.sttEngine ?? 'whisper-cpp',
      model: opts?.whisperModel ?? 'base.en',
      log: callbacks.log,
    });

    // Initialize TTS (needs API key from env)
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (elevenLabsKey) {
      this.tts = new TextToSpeech({
        apiKey: elevenLabsKey,
        voiceId: this.resolveVoiceId(opts?.ttsVoice),
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
      this.log('info', `[bot-huddle] peer ${fromPeerId} joined our huddle`);
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
      // Create PeerConnection
      const pc = new ndc.PeerConnection('bot-huddle', {
        iceServers: ['stun:stun.l.google.com:19302'],
      });

      // Create Audio description with Opus codec
      const audio = new ndc.Audio('audio0', 'SendRecv');
      audio.addOpusCodec(111);
      audio.addSSRC(1234, 'bot-audio', 'bot-stream', 'audio-track');

      // Add track to PeerConnection
      const track = pc.addTrack(audio);

      // Store peer state
      const peerState: PeerAudioState = { pc, track };
      this.peerConnections.set(fromPeerId, peerState);
      this.audioTracks.set(fromPeerId, track);

      // Handle incoming audio on this track
      track.onMessage((buf: Buffer) => {
        this.currentSpeakerPeerId = fromPeerId;
        this.audioPipeline.feedRtpPacket(buf);
      });

      track.onOpen(() => {
        this.log('info', `[bot-huddle] audio track opened for ${fromPeerId}`);
      });

      track.onClosed(() => {
        this.log('info', `[bot-huddle] audio track closed for ${fromPeerId}`);
      });

      track.onError((err: string) => {
        this.log('error', `[bot-huddle] audio track error for ${fromPeerId}: ${err}`);
      });

      // Send local SDP answer back via data channel signaling
      pc.onLocalDescription((sdp: string, type: string) => {
        this.log('info', `[bot-huddle] sending huddle-answer to ${fromPeerId} (type=${type})`);
        this.callbacks.sendSignal(fromPeerId, {
          type: 'huddle-answer',
          sdp: { sdp, type: type.toLowerCase() },
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

      this.log('info', `[bot-huddle] setting remote description (type=${normalizedType}, sdp=${sdpString.length} chars)`);
      pc.setRemoteDescription(sdpString, normalizedType as any);

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

  // ── Voice Pipeline: STT → LLM → TTS ──────────────────────────────

  private async handleSpeechEnd(pcm: Buffer): Promise<void> {
    // Don't overlap responses
    if (this.isProcessing) {
      this.log('info', '[bot-huddle] already processing speech, skipping');
      return;
    }

    this.isProcessing = true;
    const speakerPeerId = this.currentSpeakerPeerId ?? 'unknown';
    const channelId = this.activeChannelId ?? '';

    try {
      // 1. STT — transcribe the speech
      const text = await this.stt.transcribe(pcm, 48000);
      if (!text || text.length < 2) {
        this.log('info', '[bot-huddle] STT returned empty/noise, skipping');
        return;
      }

      this.log('info', `[bot-huddle] heard from ${speakerPeerId.slice(0, 8)}: "${text}"`);

      // 2. Get LLM response via callback
      const response = await this.callbacks.onTranscription?.(text, speakerPeerId, channelId);
      if (!response) {
        this.log('info', '[bot-huddle] no LLM response, skipping TTS');
        return;
      }

      this.log('info', `[bot-huddle] responding: "${response.slice(0, 100)}${response.length > 100 ? '...' : ''}"`);

      // 3. TTS → send audio back to all connected peers
      if (!this.tts) {
        this.log('warn', '[bot-huddle] TTS not available, cannot speak response');
        return;
      }

      const packets = await this.tts.speak(response);
      this.log('info', `[bot-huddle] TTS generated ${packets.length} RTP packets`);

      // Send packets to all open tracks
      for (const [peerId, track] of this.audioTracks) {
        if (track.isOpen()) {
          for (const rtp of packets) {
            track.sendMessageBinary(rtp);
            // ~20ms pacing between frames for real-time playback
            await new Promise(r => setTimeout(r, 18));
          }
          this.log('info', `[bot-huddle] sent ${packets.length} audio packets to ${peerId.slice(0, 8)}`);
        }
      }
    } catch (err) {
      this.log('error', `[bot-huddle] voice pipeline error: ${String(err)}`);
    } finally {
      this.isProcessing = false;
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
