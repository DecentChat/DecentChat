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

export interface HuddleParticipant {
  peerId: string;
  displayName: string;
  muted: boolean;
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
  private myMuted = false;
  private callbacks: HuddleCallbacks;

  private static ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
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
    });

    this.callbacks.onStateChange('in-call', channelId);
    this.callbacks.onParticipantsChange(this.getParticipants());

    this.callbacks.broadcastSignal({
      type: 'huddle-announce',
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

    this.callbacks.broadcastSignal({
      type: 'huddle-join',
      channelId,
      peerId: this.myPeerId,
    });
  }

  async leaveHuddle(): Promise<void> {
    if (this.state === 'inactive') return;

    const channelId = this.activeChannelId;

    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;

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
      case 'huddle-mute':
        this.handleMuteChange(fromPeerId, data);
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
      console.log('[Huddle] ontrack fired for peer', peerId, '— track kind:', event.track.kind, 'streams:', event.streams.length, 'track.readyState:', event.track.readyState);
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      let audioEl = this.audioElements.get(peerId);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
        this.audioElements.set(peerId, audioEl);
      }
      audioEl.srcObject = remoteStream;
      // Explicit play() required — autoplay alone is blocked by Chrome's autoplay policy
      audioEl.play()
        .then(() => console.log('[Huddle] audio play() succeeded for peer', peerId))
        .catch(err => {
          console.warn('[Huddle] Audio autoplay blocked, retrying on user gesture:', err);
          // Queue a one-shot retry on the next user interaction
          const retry = () => { audioEl!.play().catch(() => {}); document.removeEventListener('click', retry); };
          document.addEventListener('click', retry, { once: true });
        });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[Huddle] ICE candidate for', peerId, ':', event.candidate.type, event.candidate.protocol);
        this.callbacks.sendSignal(peerId, {
          type: 'huddle-ice',
          channelId: this.activeChannelId,
          candidate: event.candidate,
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
        const p = this.participants.get(peerId);
        if (!p) {
          this.participants.set(peerId, {
            peerId,
            displayName: this.callbacks.getDisplayName(peerId),
            muted: false,
          });
          this.callbacks.onParticipantsChange(this.getParticipants());
        }
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // 'disconnected' is transient — WebRTC may recover from it automatically.
        // Only clean up on 'failed' (unrecoverable) or 'closed' (explicit close).
        this.connections.delete(peerId);
        this.participants.delete(peerId);
        this.callbacks.onParticipantsChange(this.getParticipants());
      }
    };

    return pc;
  }
}
