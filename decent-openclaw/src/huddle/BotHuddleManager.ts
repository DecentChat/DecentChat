/**
 * BotHuddleManager — Huddle signaling for the bot (Node.js side).
 *
 * Handles the same signal types as the browser HuddleManager but without
 * WebRTC media — that comes in Task 2. For now, offer/answer/ice are stubs.
 *
 * Signal types handled:
 *   huddle-announce  — someone started a huddle; auto-join if enabled
 *   huddle-join      — someone joined the huddle
 *   huddle-leave     — someone left the huddle
 *   huddle-offer     — WebRTC offer (stub — logged only)
 *   huddle-answer    — WebRTC answer (stub — logged only)
 *   huddle-ice       — ICE candidate (stub — logged only)
 *   huddle-mute      — mute state change
 */

export interface BotHuddleCallbacks {
  sendSignal: (peerId: string, data: object) => boolean;
  broadcastSignal: (data: object) => void;
  getDisplayName: (peerId: string) => string;
  onTranscription?: (text: string, peerId: string, channelId: string) => void;
  log?: { info: (s: string) => void; warn?: (s: string) => void; error?: (s: string) => void };
}

export type BotHuddleState = 'inactive' | 'listening' | 'in-call';

export interface BotHuddleParticipant {
  peerId: string;
  displayName: string;
  muted: boolean;
}

export class BotHuddleManager {
  private state: BotHuddleState = 'inactive';
  private activeChannelId: string | null = null;
  private readonly myPeerId: string;
  private readonly callbacks: BotHuddleCallbacks;
  private readonly participants = new Map<string, BotHuddleParticipant>();
  private readonly autoJoin: boolean;

  constructor(myPeerId: string, callbacks: BotHuddleCallbacks, opts?: { autoJoin?: boolean }) {
    this.myPeerId = myPeerId;
    this.callbacks = callbacks;
    this.autoJoin = opts?.autoJoin ?? true;
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
    if (this.state === 'in-call') return; // already in a call

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

    this.participants.clear();
    this.state = 'inactive';
    this.activeChannelId = null;

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

    // Track the announcer as a participant
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

    // If we're in a call in the same channel, acknowledge — future tasks will
    // initiate WebRTC here.
    if (this.state === 'in-call' && this.activeChannelId === channelId) {
      this.log('info', `[bot-huddle] peer ${fromPeerId} joined our huddle`);
    }
  }

  private handleLeave(fromPeerId: string, data: any): void {
    const channelId = data.channelId as string;
    this.log('info', `[bot-huddle] huddle-leave from ${fromPeerId} in ${channelId}`);

    this.participants.delete(fromPeerId);

    // If no participants left and we're in a call, go inactive
    if (this.state === 'in-call' && this.participants.size === 0) {
      this.state = 'inactive';
      this.activeChannelId = null;
      this.log('info', `[bot-huddle] all participants left, going inactive`);
    }
  }

  private handleOffer(fromPeerId: string, _data: any): void {
    // Stub — actual PeerConnection handling comes in Task 2
    this.log('info', `[bot-huddle] received offer from ${fromPeerId}`);
  }

  private handleAnswer(fromPeerId: string, _data: any): void {
    // Stub — actual PeerConnection handling comes in Task 2
    this.log('info', `[bot-huddle] received answer from ${fromPeerId}`);
  }

  private handleIce(fromPeerId: string, _data: any): void {
    // Stub — actual ICE handling comes in Task 2
    this.log('info', `[bot-huddle] received ICE candidate from ${fromPeerId}`);
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

  // ── Helpers ────────────────────────────────────────────────────────

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
