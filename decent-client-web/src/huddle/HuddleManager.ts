/**
 * HuddleManager — Slack-style voice huddles over WebRTC
 *
 * Signaling is done through the existing P2P data channel.
 * No PeerJS changes needed — just send special message objects.
 *
 * Message types (sent via transport.send):
 *   huddle-announce  { type, channelId, peerId }         — broadcast "I started a huddle here"
 *   huddle-join      { type, channelId, peerId }         — join request broadcast to huddle members
 *   huddle-leave     { type, channelId, peerId }         — leaving huddle
 *   huddle-offer     { type, channelId, sdp, fromPeerId } — WebRTC offer to new joiner
 *   huddle-answer    { type, channelId, sdp, fromPeerId } — WebRTC answer
 *   huddle-ice       { type, channelId, candidate, fromPeerId } — ICE candidate
 *   huddle-mute      { type, channelId, peerId, muted }  — mute state change broadcast
 */

export type BotStatus = 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking' | 'interrupted';

export interface HuddleParticipant {
  peerId: string;
  displayName: string;
  muted: boolean;
  speaking?: boolean;
  audioLevel?: number; // 0..1
  botStatus?: BotStatus; // AI bot pipeline status indicator
}

export type HuddleState = 'inactive' | 'available' | 'in-call';
// inactive = no huddle in this channel
// available = others are in a huddle, you can join
// in-call = you are in the huddle

export interface HuddleCallbacks {
  onStateChange: (state: HuddleState, channelId: string | null) => void;
  onParticipantsChange: (participants: HuddleParticipant[]) => void;
  onError: (message: string) => void;
  sendSignal: (peerId: string, data: object) => void;
  broadcastSignal: (data: object) => void;
  getConnectedPeers: () => string[];
  getDisplayName: (peerId: string) => string;
}

export class HuddleManager {
  private state: HuddleState = 'inactive';
  private activeChannelId: string | null = null;
  private myPeerId: string;
  private localStream: MediaStream | null = null;
  private connections = new Map<string, RTCPeerConnection>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private participants = new Map<string, HuddleParticipant>();
  private reconnectCleanupTimers = new Map<string, number>();
  private audioContexts = new Map<string, AudioContext>();
  private analysers = new Map<string, AnalyserNode>();
  private analyserData = new Map<string, Uint8Array>();
  private speechLastActiveAt = new Map<string, number>();
  private localAudioContext: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localAnalyserData: Uint8Array | null = null;
  private speechAnimationFrame: number | null = null;
  private statsTimer: number | null = null;
  private statsIntervalMs = 2000; // Send stats every 2 seconds
  private myMuted = false;
  private callbacks: HuddleCallbacks;

  private static ICE_SERVERS: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  constructor(myPeerId: string, callbacks: HuddleCallbacks) {
    this.myPeerId = myPeerId;
    this.callbacks = callbacks;
  }

  getState(): HuddleState { return this.state; }
  getActiveChannelId(): string | null { return this.activeChannelId; }
  getParticipants(): HuddleParticipant[] { return Array.from(this.participants.values()); }
  isMyMuted(): boolean { return this.myMuted; }

  async startHuddle(channelId: string): Promise<void> {
    if (this.state !== 'inactive') {
      await this.leaveHuddle();
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('[Huddle] startHuddle: got mic, tracks:', this.localStream.getTracks().map(t => `${t.kind}(enabled=${t.enabled},readyState=${t.readyState})`));
    } catch (err) {
      console.error('[Huddle] startHuddle: getUserMedia failed', err);
      this.callbacks.onError('Microphone access denied. Please allow microphone in browser settings.');
      return;
    }

    this.activeChannelId = channelId;
    this.state = 'in-call';

    this.participants.set(this.myPeerId, {
      peerId: this.myPeerId,
      displayName: 'You',
      muted: false,
      speaking: false,
      audioLevel: 0,
    });

    this.callbacks.onStateChange('in-call', channelId);
    this.callbacks.onParticipantsChange(this.getParticipants());
    this.startSpeechMonitoring();
    this.startStatsCollection();

    this.callbacks.broadcastSignal({
      type: 'huddle-announce' ,
      channelId,
      peerId: this.myPeerId,
    });
  }

  async joinHuddle(channelId: string): Promise<void> {
    if (this.state === 'in-call') {
      await this.leaveHuddle();
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('[Huddle] joinHuddle: got mic, tracks:', this.localStream.getTracks().map(t => `${t.kind}(enabled=${t.enabled},readyState=${t.readyState})`));
    } catch (err) {
      console.error('[Huddle] joinHuddle: getUserMedia failed', err);
      this.callbacks.onError('Microphone access denied. Please allow microphone in browser settings.');
      return;
    }

    this.activeChannelId = channelId;
    this.state = 'in-call';

    this.participants.set(this.myPeerId, {
      peerId: this.myPeerId,
      displayName: 'You',
      muted: false,
    });

    this.callbacks.onStateChange('in-call', channelId);
    this.callbacks.onParticipantsChange(this.getParticipants());
    this.startSpeechMonitoring();
    this.startStatsCollection();

    this.callbacks.broadcastSignal({
      type: 'huddle-join' ,
      channelId,
      peerId: this.myPeerId,
    });
  }

  async leaveHuddle(): Promise<void> {
    if (this.state === 'inactive') return;

    const channelId = this.activeChannelId;

    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.stopSpeechMonitoring();
    this.stopStatsCollection();

    for (const [peerId, pc] of this.connections) {
      pc.close();
      this.connections.delete(peerId);
    }

    for (const [_peerId, el] of this.audioElements) {
      el.srcObject = null;
      el.remove();
    }
    this.audioElements.clear();

    this.participants.clear();
    this.state = 'inactive';
    this.activeChannelId = null;
    this.myMuted = false;

    this.callbacks.onStateChange('inactive', channelId);
    this.callbacks.onParticipantsChange([]);

    if (channelId) {
      this.callbacks.broadcastSignal({
        type: 'huddle-leave',
        channelId,
        peerId: this.myPeerId,
      });
    }
  }

  toggleMute(): boolean {
    this.myMuted = !this.myMuted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !this.myMuted;
      }
    }

    const me = this.participants.get(this.myPeerId);
    if (me) {
      me.muted = this.myMuted;
      this.participants.set(this.myPeerId, me);
    }

    this.callbacks.onParticipantsChange(this.getParticipants());

    if (this.activeChannelId) {
      this.callbacks.broadcastSignal({
        type: 'huddle-mute',
        channelId: this.activeChannelId,
        peerId: this.myPeerId,
        muted: this.myMuted,
      });
    }

    return this.myMuted;
  }

  async handleSignal(fromPeerId: string, data: any): Promise<void> {
    switch (data.type) {
      case 'huddle-announce':
        await this.handleAnnounce(fromPeerId, data);
        break;
      case 'huddle-join':
        await this.handleJoin(fromPeerId, data);
        break;
      case 'huddle-leave':
        this.handleLeave(fromPeerId, data);
        break;
      case 'huddle-offer':
        await this.handleOffer(fromPeerId, data);
        break;
      case 'huddle-answer':
        await this.handleAnswer(fromPeerId, data);
        break;
      case 'huddle-ice':
        await this.handleIce(fromPeerId, data);
        break;
      case 'huddle-stats':
        console.log('[Huddle] stats from', fromPeerId.slice(0, 8), data.stats);
        break;
      case 'huddle-mute':
        this.handleMuteChange(fromPeerId, data);
        break;
      case 'huddle-status':
        this.handleStatusChange(fromPeerId, data);
        break;
    }
  }

  private async handleAnnounce(fromPeerId: string, data: any): Promise<void> {
    if (this.state === 'inactive') {
      this.activeChannelId = data.channelId;
      this.state = 'available';

      this.participants.set(fromPeerId, {
        peerId: fromPeerId,
        displayName: this.callbacks.getDisplayName(fromPeerId),
        muted: false,
      });

      this.callbacks.onStateChange('available', data.channelId);
      this.callbacks.onParticipantsChange(this.getParticipants());
    } else if (this.state === 'in-call' && this.activeChannelId === data.channelId) {
      await this.initiateConnectionTo(fromPeerId);
    }
  }

  private async handleJoin(fromPeerId: string, data: any): Promise<void> {
    if (this.state !== 'in-call' || this.activeChannelId !== data.channelId) return;

    this.participants.set(fromPeerId, {
      peerId: fromPeerId,
      displayName: this.callbacks.getDisplayName(fromPeerId),
      muted: false,
    });
    this.callbacks.onParticipantsChange(this.getParticipants());

    await this.initiateConnectionTo(fromPeerId);
  }

  private handleLeave(fromPeerId: string, data: any): void {
    if (this.activeChannelId !== data.channelId) return;

    const pc = this.connections.get(fromPeerId);
    if (pc) {
      pc.close();
      this.connections.delete(fromPeerId);
    }

    const audioEl = this.audioElements.get(fromPeerId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      this.audioElements.delete(fromPeerId);
    }

    this.participants.delete(fromPeerId);
    this.callbacks.onParticipantsChange(this.getParticipants());

    if (this.state === 'available' && this.participants.size === 0) {
      this.state = 'inactive';
      this.activeChannelId = null;
      this.callbacks.onStateChange('inactive', data.channelId);
    }
  }

  private async handleOffer(fromPeerId: string, data: any): Promise<void> {
    console.log('[Huddle] handleOffer from', fromPeerId, 'state:', this.state, 'channel match:', this.activeChannelId === data.channelId);
    if (this.state !== 'in-call' || this.activeChannelId !== data.channelId) return;

    const pc = this.getOrCreatePeerConnection(fromPeerId);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.callbacks.sendSignal(fromPeerId, {
      type: 'huddle-answer',
      channelId: data.channelId,
      sdp: answer,
      fromPeerId: this.myPeerId,
    });
  }

  private async handleAnswer(fromPeerId: string, data: any): Promise<void> {
    console.log('[Huddle] handleAnswer from', fromPeerId);
    const pc = this.connections.get(fromPeerId);
    if (!pc) { console.warn('[Huddle] handleAnswer: no PC found for', fromPeerId); return; }
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  }

  private async handleIce(fromPeerId: string, data: any): Promise<void> {
    const pc = this.connections.get(fromPeerId);
    if (!pc || !data.candidate) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch { /* ignore ICE errors */ }
  }

  private handleMuteChange(fromPeerId: string, data: any): void {
    const participant = this.participants.get(fromPeerId);
    if (participant) {
      participant.muted = data.muted;
      this.participants.set(fromPeerId, participant);
      this.callbacks.onParticipantsChange(this.getParticipants());
    }
  }

  private handleStatusChange(fromPeerId: string, data: any): void {
    const participant = this.participants.get(fromPeerId);
    if (participant) {
      participant.botStatus = data.status;
      this.participants.set(fromPeerId, participant);
      this.callbacks.onParticipantsChange(this.getParticipants());
    }
  }

  private async initiateConnectionTo(peerId: string): Promise<void> {
    if (!this.localStream) { console.warn('[Huddle] initiateConnectionTo: no localStream!'); return; }

    console.log('[Huddle] initiateConnectionTo', peerId);
    const pc = this.getOrCreatePeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    console.log('[Huddle] sending huddle-offer to', peerId, 'sdp type:', offer.type);
    this.callbacks.sendSignal(peerId, {
      type: 'huddle-offer',
      channelId: this.activeChannelId,
      sdp: offer,
      fromPeerId: this.myPeerId,
    });
  }

  private getOrCreatePeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.connections.get(peerId);
    if (existing && existing.connectionState !== 'closed' && existing.connectionState !== 'failed') {
      return existing;
    }

    const pc = new RTCPeerConnection({ iceServers: HuddleManager.ICE_SERVERS });
    this.connections.set(peerId, pc);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.ontrack = (event) => {
      console.log('[Huddle] ontrack fired for peer', peerId, '— track kind:', event.track.kind, 'streams:', event.streams.length, 'track.readyState:', event.track.readyState, 'muted:', event.track.muted);
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      let audioEl = this.audioElements.get(peerId);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
        this.audioElements.set(peerId, audioEl);
      }
      audioEl.srcObject = remoteStream;
      this.attachRemoteAnalyser(peerId, remoteStream);
      // Explicit play() required — autoplay alone is blocked by Chrome's autoplay policy
      audioEl.play()
        .then(() => console.log('[Huddle] audio play() succeeded for peer', peerId))
        .catch(err => {
          console.warn('[Huddle] Audio autoplay blocked, retrying on user gesture:', err);
          // Queue a one-shot retry on the next user interaction
          const retry = () => { audioEl!.play().catch(() => {}); document.removeEventListener('click', retry); };
          document.addEventListener('click', retry, { once: true });
        });

      // ── Audio diagnostic: capture incoming audio for analysis ──
      const diagCapture = () => {
        try {
          const diagCtx = new AudioContext({ sampleRate: 48000 });
          const diagSrc = diagCtx.createMediaStreamSource(remoteStream);
          const diagAnalyser = diagCtx.createAnalyser();
          diagAnalyser.fftSize = 4096;
          diagSrc.connect(diagAnalyser);
          const freqData = new Float32Array(diagAnalyser.frequencyBinCount);
          const tdData = new Uint8Array(diagAnalyser.frequencyBinCount);

          // Capture PCM for WAV export
          const capturedChunks: Float32Array[] = [];
          const processor = diagCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            capturedChunks.push(new Float32Array(input));
          };
          diagSrc.connect(processor);
          processor.connect(diagCtx.destination);

          let diagCount = 0;
          const diagInterval = setInterval(() => {
            diagAnalyser.getFloatFrequencyData(freqData);
            diagAnalyser.getByteTimeDomainData(tdData);

            // Peak frequency
            let peakIdx = 0, peakVal = -Infinity;
            for (let i = 1; i < freqData.length; i++) {
              if (freqData[i] > peakVal) { peakVal = freqData[i]; peakIdx = i; }
            }
            const peakHz = peakIdx * 48000 / diagAnalyser.fftSize;

            // Max amplitude
            let maxAmp = 0;
            for (let i = 0; i < tdData.length; i++) {
              const v = Math.abs(tdData[i] - 128);
              if (v > maxAmp) maxAmp = v;
            }

            if (maxAmp > 2 || diagCount < 5) {
              console.log(`[Huddle-DIAG] peer=${peerId.slice(0,8)} amp=${maxAmp}/128 peak=${Math.round(peakHz)}Hz@${peakVal.toFixed(1)}dB`);
            }
            diagCount++;
          }, 500);

          // Save WAV export function to window for manual triggering
          (window as any).__huddleDiagExport = () => {
            clearInterval(diagInterval);
            const totalSamples = capturedChunks.reduce((s, c) => s + c.length, 0);
            const merged = new Float32Array(totalSamples);
            let offset = 0;
            for (const chunk of capturedChunks) {
              merged.set(chunk, offset);
              offset += chunk.length;
            }
            // Convert to Int16 WAV blob
            const int16 = new Int16Array(merged.length);
            for (let i = 0; i < merged.length; i++) {
              const s = Math.max(-1, Math.min(1, merged[i]));
              int16[i] = s < 0 ? s * 32768 : s * 32767;
            }
            const wavSize = 44 + int16.length * 2;
            const wav = new ArrayBuffer(wavSize);
            const view = new DataView(wav);
            // RIFF header
            const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o+i, s.charCodeAt(i)); };
            writeStr(0, 'RIFF'); view.setUint32(4, 36 + int16.length*2, true); writeStr(8, 'WAVE');
            writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
            view.setUint16(22, 1, true); view.setUint32(24, 48000, true);
            view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
            writeStr(36, 'data'); view.setUint32(40, int16.length*2, true);
            for (let i = 0; i < int16.length; i++) view.setInt16(44+i*2, int16[i], true);
            const blob = new Blob([wav], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'huddle-capture.wav'; a.click();
            console.log(`[Huddle-DIAG] Exported ${(totalSamples/48000).toFixed(1)}s WAV (${totalSamples} samples)`);
            return `Exported ${(totalSamples/48000).toFixed(1)}s`;
          };
          console.log('[Huddle-DIAG] Audio capture started. Call __huddleDiagExport() in console to save WAV.');
        } catch (err) {
          console.warn('[Huddle-DIAG] capture setup failed:', err);
        }
      };

      event.track.addEventListener('unmute', diagCapture, { once: true });
      if (!event.track.muted) diagCapture();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[Huddle] ICE candidate for', peerId, ':', event.candidate.type, event.candidate.protocol);
        this.callbacks.sendSignal(peerId, {
          type: 'huddle-ice',
          channelId: this.activeChannelId,
          candidate: event.candidate.toJSON(),
          fromPeerId: this.myPeerId,
        });
      } else {
        console.log('[Huddle] ICE gathering complete for', peerId);
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log('[Huddle] ICE gathering state for', peerId, ':', pc.iceGatheringState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[Huddle] ICE connection state for', peerId, ':', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('[Huddle] connection state for', peerId, ':', pc.connectionState);
      if (pc.connectionState === 'connected') {
        this.clearReconnectCleanup(peerId);
        const p = this.participants.get(peerId);
        if (!p) {
          this.participants.set(peerId, {
            peerId,
            displayName: this.callbacks.getDisplayName(peerId),
            muted: false,
            speaking: false,
            audioLevel: 0,
          });
          this.callbacks.onParticipantsChange(this.getParticipants());
        }
      } else if (pc.connectionState === 'disconnected') {
        // transient; defer participant cleanup and allow reconnect.
        this.scheduleReconnectCleanup(peerId, 7000);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.cleanupPeer(peerId);
      }
    };

    return pc;
  }

  private scheduleReconnectCleanup(peerId: string, delayMs: number): void {
    this.clearReconnectCleanup(peerId);
    const timer = window.setTimeout(() => {
      const pc = this.connections.get(peerId);
      if (!pc || pc.connectionState !== 'connected') {
        this.cleanupPeer(peerId);
      }
    }, delayMs);
    this.reconnectCleanupTimers.set(peerId, timer);
  }

  private clearReconnectCleanup(peerId: string): void {
    const timer = this.reconnectCleanupTimers.get(peerId);
    if (timer != null) {
      window.clearTimeout(timer);
      this.reconnectCleanupTimers.delete(peerId);
    }
  }

  private cleanupPeer(peerId: string): void {
    this.clearReconnectCleanup(peerId);
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }

    const audioEl = this.audioElements.get(peerId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      this.audioElements.delete(peerId);
    }

    const ctx = this.audioContexts.get(peerId);
    if (ctx) {
      void ctx.close();
      this.audioContexts.delete(peerId);
    }
    this.analysers.delete(peerId);
    this.analyserData.delete(peerId);
    this.speechLastActiveAt.delete(peerId);

    this.participants.delete(peerId);
    this.callbacks.onParticipantsChange(this.getParticipants());
  }

  private attachRemoteAnalyser(peerId: string, stream: MediaStream): void {
    try {
      const existing = this.audioContexts.get(peerId);
      if (existing) {
        void existing.close();
      }
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      this.audioContexts.set(peerId, ctx);
      this.analysers.set(peerId, analyser);
      this.analyserData.set(peerId, new Uint8Array(analyser.frequencyBinCount));
    } catch (err) {
      console.warn('[Huddle] failed to attach remote analyser', err);
    }
  }

  private startSpeechMonitoring(): void {
    if (!this.localStream) return;

    if (!this.localAudioContext) {
      try {
        this.localAudioContext = new AudioContext();
        const source = this.localAudioContext.createMediaStreamSource(this.localStream);
        this.localAnalyser = this.localAudioContext.createAnalyser();
        this.localAnalyser.fftSize = 256;
        this.localAnalyser.smoothingTimeConstant = 0.65;
        source.connect(this.localAnalyser);
        this.localAnalyserData = new Uint8Array(this.localAnalyser.frequencyBinCount);
      } catch (err) {
        console.warn('[Huddle] local analyser init failed', err);
      }
    }

    if (this.speechAnimationFrame != null) return;

    const tick = () => {
      this.updateParticipantSpeechLevels();
      this.speechAnimationFrame = window.requestAnimationFrame(tick);
    };
    this.speechAnimationFrame = window.requestAnimationFrame(tick);
  }

  private stopSpeechMonitoring(): void {
    if (this.speechAnimationFrame != null) {
      window.cancelAnimationFrame(this.speechAnimationFrame);
      this.speechAnimationFrame = null;
    }

    for (const [peerId, timer] of this.reconnectCleanupTimers) {
      window.clearTimeout(timer);
      this.reconnectCleanupTimers.delete(peerId);
    }

    for (const [_peerId, ctx] of this.audioContexts) {
      void ctx.close();
    }
    this.audioContexts.clear();
    this.analysers.clear();
    this.analyserData.clear();
    this.speechLastActiveAt.clear();

    if (this.localAudioContext) {
      void this.localAudioContext.close();
      this.localAudioContext = null;
    }
    this.localAnalyser = null;
    this.localAnalyserData = null;
  }

  private computeLevel(analyser: AnalyserNode, data: Uint8Array): number {
    analyser.getByteTimeDomainData(data as unknown as Uint8Array<ArrayBuffer>);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i += 1) {
      const centered = (data[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    return Math.min(1, rms * 3.2);
  }

  private updateParticipantSpeechLevels(): void {
    let changed = false;
    const now = Date.now();
    const threshold = 0.06;
    const holdMs = 220;

    // Local participant (You)
    const me = this.participants.get(this.myPeerId);
    if (me) {
      let level = 0;
      if (!this.myMuted && this.localAnalyser && this.localAnalyserData) {
        level = this.computeLevel(this.localAnalyser, this.localAnalyserData);
      }
      const active = level > threshold;
      if (active) {
        this.speechLastActiveAt.set(this.myPeerId, now);
      }
      const speaking = active || ((this.speechLastActiveAt.get(this.myPeerId) ?? 0) + holdMs > now);
      if (me.speaking !== speaking || Math.abs((me.audioLevel ?? 0) - level) > 0.05) {
        me.speaking = speaking;
        me.audioLevel = level;
        this.participants.set(this.myPeerId, me);
        changed = true;
      }
    }

    for (const [peerId, participant] of this.participants) {
      if (peerId === this.myPeerId) continue;
      const analyser = this.analysers.get(peerId);
      const data = this.analyserData.get(peerId);
      if (!analyser || !data) continue;

      const level = this.computeLevel(analyser, data);
      const active = level > threshold;
      if (active) {
        this.speechLastActiveAt.set(peerId, now);
      }
      const speaking = active || ((this.speechLastActiveAt.get(peerId) ?? 0) + holdMs > now);

      if (participant.speaking !== speaking || Math.abs((participant.audioLevel ?? 0) - level) > 0.05) {
        participant.speaking = speaking;
        participant.audioLevel = level;
        this.participants.set(peerId, participant);
        changed = true;
      }
    }

    if (changed) {
      this.callbacks.onParticipantsChange(this.getParticipants());
    }
  }


  // ── Diagnostic Stats Collection ────────────────────────────────────

  private startStatsCollection(): void {
    if (this.statsTimer != null) return;
    this.statsTimer = window.setInterval(() => {
      void this.collectAndSendStats();
    }, this.statsIntervalMs);
  }

  private stopStatsCollection(): void {
    if (this.statsTimer != null) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private async collectAndSendStats(): Promise<void> {
    if (this.state !== 'in-call' || !this.activeChannelId) return;

    const allStats: Record<string, unknown> = {};

    for (const [peerId, pc] of this.connections) {
      try {
        const stats = await pc.getStats();
        const peerStats: Record<string, unknown> = {};

        stats.forEach((report) => {
          const data: Record<string, unknown> = {};

          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            data.packetsReceived = report.packetsReceived;
            data.packetsLost = report.packetsLost;
            data.jitter = report.jitter;
            data.bytesReceived = report.bytesReceived;
            data.framesDecoded = report.framesDecoded;
          }
          if (report.type === 'outbound-rtp' && report.kind === 'audio') {
            data.packetsSent = report.packetsSent;
            data.bytesSent = report.bytesSent;
            data.framesEncoded = report.framesEncoded;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            data.currentRoundTripTime = report.currentRoundTripTime;
          }
          if (report.type === 'transport') {
            data.dtlsState = report.dtlsState;
          }

          if (Object.keys(data).length > 0) {
            peerStats[`${report.type}-${report.id.slice(-8)}`] = data;
          }
        });

        allStats[peerId.slice(0, 8)] = peerStats;
      } catch (err) {
        console.warn('[Huddle] getStats failed for', peerId, err);
      }
    }

    if (Object.keys(allStats).length > 0) {
      this.callbacks.broadcastSignal({
        type: 'huddle-stats',
        channelId: this.activeChannelId,
        peerId: this.myPeerId,
        timestamp: Date.now(),
        stats: allStats,
      });
    }
  }
}
