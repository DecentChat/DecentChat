import { get } from 'svelte/store';
import {
  activeHuddle,
  addRecentCall,
  callConnectionQuality,
  incomingCall,
  type ConnectionQuality,
  type IncomingCall,
  type RecentCallType,
} from '../stores/huddleState';

type HuddleSignalType =
  | 'huddle-announce'
  | 'huddle-join'
  | 'huddle-leave'
  | 'huddle-offer'
  | 'huddle-answer'
  | 'huddle-ice'
  | 'huddle-mute';

type CallSignalType =
  | 'call-ring'
  | 'call-accept'
  | 'call-decline'
  | 'call-busy';

type SignalType = HuddleSignalType | CallSignalType;

export type HuddleSignal = {
  type: SignalType;
  channelId?: string;
  peerId?: string;
  fromPeerId?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  muted?: boolean;
};

interface CallManagerOptions {
  getMyPeerId: () => string | null;
  getDisplayName: (peerId: string) => string;
  sendSignal: (peerId: string, signal: HuddleSignal) => boolean;
  broadcastSignal: (signal: HuddleSignal) => void;
  getConnectedPeers: () => string[];
}

export class CallManager {
  private readonly options: CallManagerOptions;

  private localStream: MediaStream | null = null;
  private readonly connections = new Map<string, RTCPeerConnection>();
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private readonly pendingAudioPlayback = new Set<HTMLAudioElement>();
  private playbackUnlockBound = false;

  private participants = new Set<string>();
  private currentHuddleId: string | null = null;
  private currentChannelId: string | null = null;
  private currentDirection: 'incoming' | 'outgoing' | null = null;
  private currentPeerId: string | null = null;
  private startedAt: number | null = null;
  private connectedAt: number | null = null;
  private myMuted = false;
  private qualityTimer: number | null = null;

  private incoming: IncomingCall | null = null;
  private incomingTimeout: number | null = null;
  private outgoingRing: { peerId: string; channelId: string; startedAt: number } | null = null;
  private ringTimeout: number | null = null;

  private static readonly ICE_SERVERS: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  private static readonly CALL_RING_TIMEOUT_MS = 30_000;

  constructor(options: CallManagerOptions) {
    this.options = options;
  }

  isHuddleSignal(data: Record<string, unknown>): data is HuddleSignal {
    const type = data.type;
    if (typeof type !== 'string') return false;
    return (
      type === 'huddle-announce'
      || type === 'huddle-join'
      || type === 'huddle-leave'
      || type === 'huddle-offer'
      || type === 'huddle-answer'
      || type === 'huddle-ice'
      || type === 'huddle-mute'
      || type === 'call-ring'
      || type === 'call-accept'
      || type === 'call-decline'
      || type === 'call-busy'
    );
  }

  async startCall(peerId: string): Promise<void> {
    const normalizedPeerId = peerId.trim();
    if (!normalizedPeerId) return;

    if (get(activeHuddle)) {
      await this.endCall();
    }

    const myPeerId = this.options.getMyPeerId();
    if (!myPeerId || normalizedPeerId === myPeerId) return;

    const hasMic = await this.ensureLocalAudio();
    if (!hasMic) return;

    const channelId = this.buildDirectChannelId(myPeerId, normalizedPeerId);

    this.currentDirection = 'outgoing';
    this.currentPeerId = normalizedPeerId;
    this.startedAt = Date.now();
    this.connectedAt = null;

    this.clearIncomingCall();
    this.clearOutgoingRing();

    this.beginSession(channelId, [myPeerId, normalizedPeerId]);
    await this.initiateConnectionTo(normalizedPeerId, channelId);
  }

  async ring(peerId: string): Promise<void> {
    const normalizedPeerId = peerId.trim();
    if (!normalizedPeerId) return;

    const myPeerId = this.options.getMyPeerId();
    if (!myPeerId || normalizedPeerId === myPeerId) return;

    if (get(activeHuddle) || this.incoming || this.outgoingRing) {
      return;
    }

    const channelId = this.buildDirectChannelId(myPeerId, normalizedPeerId);
    const startedAt = Date.now();

    this.currentDirection = 'outgoing';
    this.currentPeerId = normalizedPeerId;
    this.startedAt = startedAt;
    this.connectedAt = null;

    this.outgoingRing = {
      peerId: normalizedPeerId,
      channelId,
      startedAt,
    };

    this.options.sendSignal(normalizedPeerId, {
      type: 'call-ring',
      channelId,
      fromPeerId: myPeerId,
      peerId: myPeerId,
    });

    this.clearRingTimeout();
    this.ringTimeout = window.setTimeout(() => {
      const ring = this.outgoingRing;
      if (!ring || ring.peerId !== normalizedPeerId) return;

      addRecentCall({
        peerId: normalizedPeerId,
        peerName: this.options.getDisplayName(normalizedPeerId),
        timestamp: ring.startedAt,
        duration: 0,
        type: 'missed',
      });

      this.clearOutgoingRing();
      this.resetCallAttemptState();
    }, CallManager.CALL_RING_TIMEOUT_MS);
  }

  async acceptIncomingCall(): Promise<void> {
    const incoming = this.incoming;
    if (!incoming) return;

    const myPeerId = this.options.getMyPeerId();
    if (!myPeerId) return;

    const hasMic = await this.ensureLocalAudio();
    if (!hasMic) {
      this.options.sendSignal(incoming.fromPeerId, {
        type: 'call-decline',
        channelId: incoming.channelId,
        fromPeerId: myPeerId,
        peerId: myPeerId,
      });
      this.clearIncomingCall();
      this.resetCallAttemptState();
      return;
    }

    this.currentDirection = 'incoming';
    this.currentPeerId = incoming.fromPeerId;
    this.startedAt = Date.now();
    this.connectedAt = null;

    this.beginSession(incoming.channelId, [myPeerId, incoming.fromPeerId]);

    this.options.sendSignal(incoming.fromPeerId, {
      type: 'call-accept',
      channelId: incoming.channelId,
      fromPeerId: myPeerId,
      peerId: myPeerId,
    });

    this.clearIncomingCall();
  }

  declineIncomingCall(): void {
    const incoming = this.incoming;
    if (!incoming) return;

    const myPeerId = this.options.getMyPeerId();
    if (myPeerId) {
      this.options.sendSignal(incoming.fromPeerId, {
        type: 'call-decline',
        channelId: incoming.channelId,
        fromPeerId: myPeerId,
        peerId: myPeerId,
      });
    }

    addRecentCall({
      peerId: incoming.fromPeerId,
      peerName: this.options.getDisplayName(incoming.fromPeerId),
      timestamp: Date.now(),
      duration: 0,
      type: 'missed',
    });

    this.clearIncomingCall();
  }

  async joinHuddle(channelId: string): Promise<void> {
    const normalizedChannelId = channelId.trim();
    if (!normalizedChannelId) return;

    if (get(activeHuddle)) {
      await this.endCall();
    }

    const myPeerId = this.options.getMyPeerId();
    if (!myPeerId) return;

    const hasMic = await this.ensureLocalAudio();
    if (!hasMic) return;

    const peers = this.options.getConnectedPeers().filter((peerId) => peerId !== myPeerId);

    this.currentDirection = 'outgoing';
    this.currentPeerId = peers[0] ?? null;
    this.startedAt = Date.now();
    this.connectedAt = null;

    this.beginSession(normalizedChannelId, [myPeerId, ...peers]);

    this.options.broadcastSignal({
      type: 'huddle-announce',
      channelId: normalizedChannelId,
      peerId: myPeerId,
    });

    this.options.broadcastSignal({
      type: 'huddle-join',
      channelId: normalizedChannelId,
      peerId: myPeerId,
    });

    for (const peerId of peers) {
      await this.initiateConnectionTo(peerId, normalizedChannelId);
    }
  }

  async endCall(): Promise<void> {
    const current = get(activeHuddle);
    if (!current) {
      this.clearIncomingCall();
      this.clearOutgoingRing();
      this.resetCallAttemptState();
      return;
    }

    const channelId = this.currentChannelId;
    const myPeerId = this.options.getMyPeerId();

    if (channelId && myPeerId) {
      this.options.broadcastSignal({
        type: 'huddle-leave',
        channelId,
        peerId: myPeerId,
      });
    }

    this.recordRecentCall();
    this.cleanupRuntime();
  }

  toggleMute(): boolean {
    this.myMuted = !this.myMuted;

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !this.myMuted;
      }
    }

    if (this.currentChannelId) {
      const myPeerId = this.options.getMyPeerId();
      if (myPeerId) {
        this.options.broadcastSignal({
          type: 'huddle-mute',
          channelId: this.currentChannelId,
          peerId: myPeerId,
          muted: this.myMuted,
        });
      }
    }

    this.syncActiveHuddle();
    return this.myMuted;
  }

  async handleSignal(fromPeerId: string, signal: HuddleSignal): Promise<void> {
    if (!fromPeerId) return;

    switch (signal.type) {
      case 'call-ring': {
        const myPeerId = this.options.getMyPeerId();
        if (!myPeerId || fromPeerId === myPeerId) break;

        const channelId = this.buildRingChannelId(myPeerId, fromPeerId, signal.channelId);

        if (this.incoming && this.incoming.fromPeerId === fromPeerId && this.incoming.channelId === channelId) {
          this.clearIncomingTimeout();
          this.incomingTimeout = window.setTimeout(() => {
            if (!this.incoming || this.incoming.fromPeerId !== fromPeerId) return;

            addRecentCall({
              peerId: fromPeerId,
              peerName: this.options.getDisplayName(fromPeerId),
              timestamp: Date.now(),
              duration: 0,
              type: 'missed',
            });

            this.clearIncomingCall();
          }, CallManager.CALL_RING_TIMEOUT_MS);
          break;
        }

        if (get(activeHuddle) || this.incoming || this.outgoingRing) {
          this.options.sendSignal(fromPeerId, {
            type: 'call-busy',
            fromPeerId: myPeerId,
            peerId: myPeerId,
            channelId,
          });
          break;
        }

        this.incoming = {
          fromPeerId,
          channelId,
        };
        incomingCall.set(this.incoming);

        this.clearIncomingTimeout();
        this.incomingTimeout = window.setTimeout(() => {
          if (!this.incoming || this.incoming.fromPeerId !== fromPeerId) return;

          addRecentCall({
            peerId: fromPeerId,
            peerName: this.options.getDisplayName(fromPeerId),
            timestamp: Date.now(),
            duration: 0,
            type: 'missed',
          });

          this.clearIncomingCall();
        }, CallManager.CALL_RING_TIMEOUT_MS);
        break;
      }

      case 'call-accept': {
        const ring = this.outgoingRing;
        if (!ring || !this.matchesOutgoingRingResponse(ring, fromPeerId, signal.channelId)) break;

        const hasMic = await this.ensureLocalAudio();
        if (!hasMic) {
          const myPeerId = this.options.getMyPeerId();
          if (myPeerId) {
            this.options.sendSignal(fromPeerId, {
              type: 'call-decline',
              channelId: ring.channelId,
              fromPeerId: myPeerId,
              peerId: myPeerId,
            });
          }
          this.clearOutgoingRing();
          this.resetCallAttemptState();
          break;
        }

        const myPeerId = this.options.getMyPeerId();
        if (!myPeerId) break;

        this.currentDirection = 'outgoing';
        this.currentPeerId = fromPeerId;
        this.startedAt = ring.startedAt;
        this.connectedAt = null;

        this.beginSession(ring.channelId, [myPeerId, fromPeerId]);
        this.clearOutgoingRing();
        await this.initiateConnectionTo(fromPeerId, ring.channelId);
        break;
      }

      case 'call-decline':
      case 'call-busy': {
        const ring = this.outgoingRing;
        if (!ring || !this.matchesOutgoingRingResponse(ring, fromPeerId, signal.channelId)) break;

        addRecentCall({
          peerId: fromPeerId,
          peerName: this.options.getDisplayName(fromPeerId),
          timestamp: ring.startedAt,
          duration: 0,
          type: 'missed',
        });

        this.clearOutgoingRing();
        this.resetCallAttemptState();
        break;
      }

      case 'huddle-announce': {
        if (this.currentChannelId && signal.channelId === this.currentChannelId) {
          this.addParticipant(fromPeerId);
        }
        break;
      }

      case 'huddle-join': {
        if (!signal.channelId || this.currentChannelId !== signal.channelId) break;
        this.addParticipant(fromPeerId);
        await this.initiateConnectionTo(fromPeerId, signal.channelId);
        break;
      }

      case 'huddle-leave': {
        if (!signal.channelId || this.currentChannelId !== signal.channelId) break;
        this.cleanupPeer(fromPeerId);
        this.removeParticipant(fromPeerId);
        if (this.remoteParticipantCount() === 0) {
          await this.endCall();
        }
        break;
      }

      case 'huddle-offer': {
        const myPeerId = this.options.getMyPeerId();
        if (!myPeerId) break;

        if (this.currentChannelId && signal.channelId && this.currentChannelId !== signal.channelId) {
          addRecentCall({
            peerId: fromPeerId,
            peerName: this.options.getDisplayName(fromPeerId),
            timestamp: Date.now(),
            duration: 0,
            type: 'missed',
          });
          break;
        }

        if (!this.currentChannelId) {
          const hasMic = await this.ensureLocalAudio();
          if (!hasMic) break;

          this.currentDirection = 'incoming';
          this.currentPeerId = fromPeerId;
          this.startedAt = Date.now();
          this.connectedAt = null;

          this.beginSession(signal.channelId || this.buildDirectChannelId(myPeerId, fromPeerId), [
            myPeerId,
            fromPeerId,
          ]);
          this.clearIncomingCall();
        } else {
          this.addParticipant(fromPeerId);
        }

        if (!signal.sdp || !this.currentChannelId) break;

        const pc = this.getOrCreatePeerConnection(fromPeerId, this.currentChannelId);
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.options.sendSignal(fromPeerId, {
          type: 'huddle-answer',
          channelId: this.currentChannelId,
          sdp: answer,
          fromPeerId: myPeerId,
        });

        break;
      }

      case 'huddle-answer': {
        if (!signal.sdp) break;
        const pc = this.connections.get(fromPeerId);
        if (!pc) break;
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        break;
      }

      case 'huddle-ice': {
        if (!signal.candidate) break;
        const pc = this.connections.get(fromPeerId);
        if (!pc) break;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch {
          // ignore invalid/transient ICE errors
        }
        break;
      }

      case 'huddle-mute': {
        // mute state is currently only reflected on local controls
        break;
      }
    }
  }

  async handlePeerDisconnect(peerId: string): Promise<void> {
    this.cleanupPeer(peerId);
    this.removeParticipant(peerId);

    if (this.incoming?.fromPeerId === peerId) {
      this.clearIncomingCall();
    }

    if (this.outgoingRing?.peerId === peerId) {
      this.clearOutgoingRing();
      this.resetCallAttemptState();
    }

    if (get(activeHuddle) && this.remoteParticipantCount() === 0) {
      await this.endCall();
    }
  }

  private async ensureLocalAudio(): Promise<boolean> {
    if (this.localStream) return true;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      return true;
    } catch (error) {
      console.warn('[CallManager] microphone access denied:', (error as Error).message);
      return false;
    }
  }

  private beginSession(channelId: string, participants: string[]): void {
    this.currentHuddleId = `huddle:${Date.now()}`;
    this.currentChannelId = channelId;
    this.participants = new Set(participants);
    this.myMuted = false;

    this.syncActiveHuddle();
    this.startQualityTimer();
  }

  private syncActiveHuddle(): void {
    if (!this.currentHuddleId || !this.currentChannelId) {
      activeHuddle.set(null);
      return;
    }

    activeHuddle.set({
      huddleId: this.currentHuddleId,
      channelId: this.currentChannelId,
      participants: Array.from(this.participants),
      isMuted: this.myMuted,
    });
  }

  private addParticipant(peerId: string): void {
    if (!peerId) return;
    this.participants.add(peerId);
    this.syncActiveHuddle();
  }

  private removeParticipant(peerId: string): void {
    if (!peerId) return;
    this.participants.delete(peerId);
    this.syncActiveHuddle();
  }

  private remoteParticipantCount(): number {
    const myPeerId = this.options.getMyPeerId();
    let count = 0;

    for (const peerId of this.participants) {
      if (peerId !== myPeerId) count += 1;
    }

    return count;
  }

  private async initiateConnectionTo(peerId: string, channelId: string): Promise<void> {
    const myPeerId = this.options.getMyPeerId();
    if (!myPeerId || !this.localStream) return;

    this.addParticipant(peerId);

    const pc = this.getOrCreatePeerConnection(peerId, channelId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.options.sendSignal(peerId, {
      type: 'huddle-offer',
      channelId,
      sdp: offer,
      fromPeerId: myPeerId,
    });
  }

  private getOrCreatePeerConnection(peerId: string, channelId: string): RTCPeerConnection {
    const existing = this.connections.get(peerId);
    if (existing && existing.connectionState !== 'closed') {
      return existing;
    }

    const pc = new RTCPeerConnection({ iceServers: CallManager.ICE_SERVERS });
    this.connections.set(peerId, pc);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      const myPeerId = this.options.getMyPeerId();
      if (!myPeerId) return;

      this.options.sendSignal(peerId, {
        type: 'huddle-ice',
        channelId,
        candidate: event.candidate.toJSON(),
        fromPeerId: myPeerId,
      });
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      let audio = this.audioElements.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        document.body.appendChild(audio);
        this.audioElements.set(peerId, audio);
      }

      audio.srcObject = remoteStream;
      void audio.play().catch(() => {
        this.pendingAudioPlayback.add(audio);
        this.bindPlaybackUnlock();
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && !this.connectedAt) {
        this.connectedAt = Date.now();
      }

      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.cleanupPeer(peerId);
        this.removeParticipant(peerId);
      }

      this.updateConnectionQuality();
    };

    return pc;
  }

  private cleanupPeer(peerId: string): void {
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }

    const audio = this.audioElements.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      this.audioElements.delete(peerId);
      this.pendingAudioPlayback.delete(audio);
      if (this.pendingAudioPlayback.size === 0) {
        this.unbindPlaybackUnlock();
      }
    }

    this.updateConnectionQuality();
  }

  private cleanupRuntime(): void {
    this.stopQualityTimer();

    for (const pc of this.connections.values()) {
      pc.close();
    }
    this.connections.clear();

    for (const audio of this.audioElements.values()) {
      audio.srcObject = null;
      audio.remove();
    }
    this.audioElements.clear();
    this.pendingAudioPlayback.clear();
    this.unbindPlaybackUnlock();

    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;

    this.participants.clear();
    this.currentHuddleId = null;
    this.currentChannelId = null;
    this.currentDirection = null;
    this.currentPeerId = null;
    this.startedAt = null;
    this.connectedAt = null;
    this.myMuted = false;

    this.clearIncomingCall();
    this.clearOutgoingRing();

    activeHuddle.set(null);
    callConnectionQuality.set('connecting');
  }

  private recordRecentCall(): void {
    const myPeerId = this.options.getMyPeerId();
    const remotePeerId = this.currentPeerId
      || Array.from(this.participants).find((peerId) => peerId !== myPeerId)
      || null;

    if (!remotePeerId) return;

    const durationSeconds = this.connectedAt ? Math.max(1, Math.floor((Date.now() - this.connectedAt) / 1000)) : 0;

    let type: RecentCallType = this.currentDirection ?? 'outgoing';
    if (durationSeconds === 0) {
      type = 'missed';
    }

    addRecentCall({
      peerId: remotePeerId,
      peerName: this.options.getDisplayName(remotePeerId),
      timestamp: this.startedAt ?? Date.now(),
      duration: durationSeconds,
      type,
    });
  }

  private startQualityTimer(): void {
    if (this.qualityTimer != null) return;

    this.updateConnectionQuality();

    this.qualityTimer = window.setInterval(() => {
      this.updateConnectionQuality();
    }, 1500);
  }

  private stopQualityTimer(): void {
    if (this.qualityTimer != null) {
      window.clearInterval(this.qualityTimer);
      this.qualityTimer = null;
    }
  }

  private updateConnectionQuality(): void {
    const quality = this.computeConnectionQuality();
    callConnectionQuality.set(quality);
  }

  private computeConnectionQuality(): ConnectionQuality {
    if (!this.currentChannelId) return 'connecting';
    if (this.connections.size === 0) return 'connecting';

    const states = Array.from(this.connections.values()).map((pc) => pc.connectionState);

    if (states.some((state) => state === 'failed' || state === 'disconnected')) {
      return 'poor';
    }

    if (states.every((state) => state === 'connected')) {
      return 'good';
    }

    return 'connecting';
  }

  private buildDirectChannelId(a: string, b: string): string {
    return `dm:${[a, b].sort().join(':')}`;
  }

  private buildRingChannelId(myPeerId: string, fromPeerId: string, channelId?: string): string {
    const normalized = channelId?.trim();
    return normalized ? normalized : this.buildDirectChannelId(myPeerId, fromPeerId);
  }

  private matchesOutgoingRingResponse(
    ring: { peerId: string; channelId: string },
    fromPeerId: string,
    channelId?: string,
  ): boolean {
    if (ring.peerId !== fromPeerId) return false;
    const normalized = channelId?.trim();
    if (!normalized) return true;
    return normalized === ring.channelId;
  }

  private bindPlaybackUnlock(): void {
    if (this.playbackUnlockBound || typeof window === 'undefined') return;
    this.playbackUnlockBound = true;
    window.addEventListener('pointerdown', this.handlePlaybackUnlock, { passive: true });
    window.addEventListener('touchstart', this.handlePlaybackUnlock, { passive: true });
    window.addEventListener('keydown', this.handlePlaybackUnlock);
  }

  private unbindPlaybackUnlock(): void {
    if (!this.playbackUnlockBound || typeof window === 'undefined') return;
    this.playbackUnlockBound = false;
    window.removeEventListener('pointerdown', this.handlePlaybackUnlock);
    window.removeEventListener('touchstart', this.handlePlaybackUnlock);
    window.removeEventListener('keydown', this.handlePlaybackUnlock);
  }

  private readonly handlePlaybackUnlock = (): void => {
    if (this.pendingAudioPlayback.size === 0) {
      this.unbindPlaybackUnlock();
      return;
    }

    const pending = Array.from(this.pendingAudioPlayback);
    for (const audio of pending) {
      void audio.play().then(() => {
        this.pendingAudioPlayback.delete(audio);
        if (this.pendingAudioPlayback.size === 0) {
          this.unbindPlaybackUnlock();
        }
      }).catch(() => {
        // keep pending until a later gesture succeeds
      });
    }
  };

  private clearIncomingCall(): void {
    this.incoming = null;
    this.clearIncomingTimeout();
    incomingCall.set(null);
  }

  private clearOutgoingRing(): void {
    this.outgoingRing = null;
    this.clearRingTimeout();
  }

  private clearRingTimeout(): void {
    if (this.ringTimeout != null) {
      window.clearTimeout(this.ringTimeout);
      this.ringTimeout = null;
    }
  }

  private clearIncomingTimeout(): void {
    if (this.incomingTimeout != null) {
      window.clearTimeout(this.incomingTimeout);
      this.incomingTimeout = null;
    }
  }

  private resetCallAttemptState(): void {
    this.currentDirection = null;
    this.currentPeerId = null;
    this.startedAt = null;
    this.connectedAt = null;
  }
}
