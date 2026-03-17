import { beforeEach, describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { CallManager, type HuddleSignal } from '../src/app/CallManager';
import { activeHuddle, callConnectionQuality, incomingCall, recentCalls } from '../src/stores/huddleState';

type SentSignal = { peerId: string; signal: HuddleSignal };

function installWindowStubs(): void {
  let timerId = 1;

  const fakeWindow = {
    setTimeout: () => timerId++,
    clearTimeout: () => {},
    setInterval: () => timerId++,
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  (globalThis as { window?: unknown }).window = fakeWindow;
}

function setGetUserMedia(impl: () => Promise<MediaStream>): void {
  const nav = ((globalThis as { navigator?: Record<string, unknown> }).navigator ?? {}) as Record<string, unknown>;

  try {
    Object.defineProperty(nav, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: impl,
      },
    });
  } catch {
    nav.mediaDevices = { getUserMedia: impl };
  }

  if (!(globalThis as { navigator?: unknown }).navigator) {
    (globalThis as { navigator?: unknown }).navigator = nav;
  }
}

function setGetUserMediaAllowed(): void {
  const track = {
    enabled: true,
    stop: () => {},
  } as unknown as MediaStreamTrack;

  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;

  setGetUserMedia(async () => stream);
}

function installWebRtcStubs(): void {
  class FakeRTCPeerConnection {
    localDescription: RTCSessionDescriptionInit | null = null;
    remoteDescription: RTCSessionDescriptionInit | null = null;
    onicecandidate: ((event: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
    ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;
    connectionState: RTCPeerConnectionState = 'connected';

    addTrack(): void {}
    createOffer = async (): Promise<RTCSessionDescriptionInit> => ({ type: 'offer', sdp: 'fake-offer' });
    createAnswer = async (): Promise<RTCSessionDescriptionInit> => ({ type: 'answer', sdp: 'fake-answer' });
    setLocalDescription = async (description: RTCSessionDescriptionInit): Promise<void> => {
      this.localDescription = description;
      this.onicecandidate?.({ candidate: null });
    };
    setRemoteDescription = async (description: RTCSessionDescriptionInit): Promise<void> => {
      this.remoteDescription = description;
    };
    addIceCandidate = async (): Promise<void> => {};
    close = (): void => {
      this.connectionState = 'closed';
    };
  }

  (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = FakeRTCPeerConnection;
  (globalThis as { RTCSessionDescription?: unknown }).RTCSessionDescription = class {
    constructor(init: RTCSessionDescriptionInit) {
      Object.assign(this, init);
    }
  };
  (globalThis as { RTCIceCandidate?: unknown }).RTCIceCandidate = class {
    constructor(init: RTCIceCandidateInit) {
      Object.assign(this, init);
    }
  };
}

function directChannel(a: string, b: string): string {
  return `dm:${[a, b].sort().join(':')}`;
}

function createManager(myPeerId = 'mobile-peer'): { manager: CallManager; sent: SentSignal[] } {
  const sent: SentSignal[] = [];

  const manager = new CallManager({
    getMyPeerId: () => myPeerId,
    getDisplayName: (peerId) => `Peer ${peerId}`,
    sendSignal: (peerId, signal) => {
      sent.push({ peerId, signal });
      return true;
    },
    broadcastSignal: () => {},
    getConnectedPeers: () => [],
  });

  return { manager, sent };
}

beforeEach(() => {
  installWindowStubs();
  installWebRtcStubs();
  setGetUserMedia(async () => {
    throw Object.assign(new Error('mic denied'), { name: 'NotAllowedError' });
  });
  activeHuddle.set(null);
  incomingCall.set(null);
  recentCalls.set([]);
  callConnectionQuality.set('connecting');
});

describe('CallManager signaling hardening', () => {
  test('ignores stale call-busy with mismatched channel and keeps active ring attempt', async () => {
    const myPeerId = 'mobile-peer';
    const remotePeerId = 'web-peer';
    const channelId = directChannel(myPeerId, remotePeerId);
    const { manager } = createManager(myPeerId);

    await manager.ring(remotePeerId);
    await manager.handleSignal(remotePeerId, { type: 'call-busy', channelId: 'dm:old-channel' });
    expect(get(recentCalls)).toHaveLength(0);

    await manager.handleSignal(remotePeerId, { type: 'call-busy', channelId });
    expect(get(recentCalls)).toHaveLength(1);
    expect(get(recentCalls)[0]?.type).toBe('missed');
  });

  test('acceptIncomingCall sends call-decline when microphone access fails', async () => {
    const myPeerId = 'mobile-peer';
    const remotePeerId = 'web-peer';
    const channelId = directChannel(myPeerId, remotePeerId);
    const { manager, sent } = createManager(myPeerId);

    await manager.handleSignal(remotePeerId, { type: 'call-ring', channelId });
    expect(get(incomingCall)?.fromPeerId).toBe(remotePeerId);

    await manager.acceptIncomingCall();

    const decline = sent.find((entry) => entry.peerId === remotePeerId && entry.signal.type === 'call-decline');
    expect(decline).toBeTruthy();
    expect(decline?.signal.channelId).toBe(channelId);
    expect(get(incomingCall)).toBeNull();
    expect(get(activeHuddle)).toBeNull();
  });

  test('call-accept sends call-decline when caller cannot open microphone', async () => {
    const myPeerId = 'mobile-peer';
    const remotePeerId = 'web-peer';
    const channelId = directChannel(myPeerId, remotePeerId);
    const { manager, sent } = createManager(myPeerId);

    await manager.ring(remotePeerId);
    sent.length = 0;

    await manager.handleSignal(remotePeerId, { type: 'call-accept', channelId });

    const decline = sent.find((entry) => entry.peerId === remotePeerId && entry.signal.type === 'call-decline');
    expect(decline).toBeTruthy();
    expect(decline?.signal.channelId).toBe(channelId);
    expect(get(activeHuddle)).toBeNull();
  });

  test('duplicate ring from same peer/channel is treated idempotently (no busy response)', async () => {
    const myPeerId = 'mobile-peer';
    const remotePeerId = 'web-peer';
    const channelId = directChannel(myPeerId, remotePeerId);
    const { manager, sent } = createManager(myPeerId);

    await manager.handleSignal(remotePeerId, { type: 'call-ring', channelId });
    sent.length = 0;

    await manager.handleSignal(remotePeerId, { type: 'call-ring', channelId });

    const busySignals = sent.filter((entry) => entry.signal.type === 'call-busy');
    expect(busySignals).toHaveLength(0);
    expect(get(incomingCall)?.fromPeerId).toBe(remotePeerId);
  });
});

describe('Mixed-client direct call interop matrix (mobile ↔ web)', () => {
  test('web -> mobile: ring -> accept sends call-accept and enters active call state', async () => {
    setGetUserMediaAllowed();

    const myPeerId = 'mobile-peer';
    const webPeerId = 'web-peer';
    const channelId = directChannel(myPeerId, webPeerId);
    const { manager, sent } = createManager(myPeerId);

    await manager.handleSignal(webPeerId, { type: 'call-ring', channelId });
    expect(get(incomingCall)?.fromPeerId).toBe(webPeerId);

    await manager.acceptIncomingCall();

    const accept = sent.find((entry) => entry.peerId === webPeerId && entry.signal.type === 'call-accept');
    expect(accept).toBeTruthy();
    expect(accept?.signal.channelId).toBe(channelId);
    expect(get(incomingCall)).toBeNull();

    const active = get(activeHuddle);
    expect(active?.channelId).toBe(channelId);
    expect(active?.participants).toContain(myPeerId);
    expect(active?.participants).toContain(webPeerId);
  });

  test('web -> mobile: ring -> decline sends call-decline and records missed incoming call', async () => {
    const myPeerId = 'mobile-peer';
    const webPeerId = 'web-peer';
    const channelId = directChannel(myPeerId, webPeerId);
    const { manager, sent } = createManager(myPeerId);

    await manager.handleSignal(webPeerId, { type: 'call-ring', channelId });
    manager.declineIncomingCall();

    const decline = sent.find((entry) => entry.peerId === webPeerId && entry.signal.type === 'call-decline');
    expect(decline).toBeTruthy();
    expect(decline?.signal.channelId).toBe(channelId);

    const calls = get(recentCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.peerId).toBe(webPeerId);
    expect(calls[0]?.type).toBe('missed');
  });

  test('web -> mobile: ring -> busy when mobile is already in call', async () => {
    const myPeerId = 'mobile-peer';
    const webPeerId = 'web-peer';
    const channelId = directChannel(myPeerId, webPeerId);
    const { manager, sent } = createManager(myPeerId);

    activeHuddle.set({
      huddleId: 'huddle:existing',
      channelId: 'dm:other-peer',
      participants: [myPeerId, 'other-peer'],
      isMuted: false,
    });

    await manager.handleSignal(webPeerId, { type: 'call-ring', channelId });

    const busy = sent.find((entry) => entry.peerId === webPeerId && entry.signal.type === 'call-busy');
    expect(busy).toBeTruthy();
    expect(busy?.signal.channelId).toBe(channelId);
  });

  test('mobile -> web: ring -> accept transitions caller into active call', async () => {
    setGetUserMediaAllowed();

    const myPeerId = 'mobile-peer';
    const webPeerId = 'web-peer';
    const channelId = directChannel(myPeerId, webPeerId);
    const { manager, sent } = createManager(myPeerId);

    await manager.ring(webPeerId);
    const ringSignals = sent.filter((entry) => entry.peerId === webPeerId && entry.signal.type === 'call-ring');
    expect(ringSignals).toHaveLength(1);

    await manager.handleSignal(webPeerId, { type: 'call-accept', channelId });

    const active = get(activeHuddle);
    expect(active?.channelId).toBe(channelId);
    expect(active?.participants).toContain(myPeerId);
    expect(active?.participants).toContain(webPeerId);

    const offers = sent.filter((entry) => entry.peerId === webPeerId && entry.signal.type === 'huddle-offer');
    expect(offers).toHaveLength(1);
  });

  test('mobile -> web: ring -> decline records missed caller-side call and allows re-ring', async () => {
    const myPeerId = 'mobile-peer';
    const webPeerId = 'web-peer';
    const channelId = directChannel(myPeerId, webPeerId);
    const { manager, sent } = createManager(myPeerId);

    await manager.ring(webPeerId);
    await manager.handleSignal(webPeerId, { type: 'call-decline', channelId });

    const calls = get(recentCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.peerId).toBe(webPeerId);
    expect(calls[0]?.type).toBe('missed');

    await manager.ring(webPeerId);
    const ringSignals = sent.filter((entry) => entry.peerId === webPeerId && entry.signal.type === 'call-ring');
    expect(ringSignals).toHaveLength(2);
  });

  test('mobile -> web: ring -> busy records missed caller-side call and allows re-ring', async () => {
    const myPeerId = 'mobile-peer';
    const webPeerId = 'web-peer';
    const channelId = directChannel(myPeerId, webPeerId);
    const { manager, sent } = createManager(myPeerId);

    await manager.ring(webPeerId);
    await manager.handleSignal(webPeerId, { type: 'call-busy', channelId });

    const calls = get(recentCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.peerId).toBe(webPeerId);
    expect(calls[0]?.type).toBe('missed');

    await manager.ring(webPeerId);
    const ringSignals = sent.filter((entry) => entry.peerId === webPeerId && entry.signal.type === 'call-ring');
    expect(ringSignals).toHaveLength(2);
  });
});

describe('Call reliability edge paths', () => {
  test('timeout/no-answer path cleans up outgoing attempt and allows retry', async () => {
    const myPeerId = 'mobile-alice';
    const remotePeerId = 'web-bob';
    const { manager, sent } = createManager(myPeerId);

    let timeoutCallback: (() => void) | null = null;
    (globalThis as { window?: any }).window = {
      ...(globalThis as { window?: any }).window,
      setTimeout: (callback: () => void) => {
        timeoutCallback = callback;
        return 1;
      },
      clearTimeout: () => {},
    };

    await manager.ring(remotePeerId);
    expect(timeoutCallback).toBeTruthy();

    timeoutCallback?.();

    const calls = get(recentCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.peerId).toBe(remotePeerId);
    expect(calls[0]?.type).toBe('missed');

    await manager.ring(remotePeerId);
    const ringSignals = sent.filter((entry) => entry.peerId === remotePeerId && entry.signal.type === 'call-ring');
    expect(ringSignals).toHaveLength(2);
  });

  test('reconnect/disconnect during ringing and handshake cleans state deterministically', async () => {
    setGetUserMediaAllowed();

    const myPeerId = 'mobile-peer';
    const webPeerId = 'web-peer';
    const channelId = directChannel(myPeerId, webPeerId);
    const { manager, sent } = createManager(myPeerId);

    // Ringing phase disconnect cleanup
    await manager.ring(webPeerId);
    await manager.handlePeerDisconnect(webPeerId);

    await manager.ring(webPeerId);
    const ringSignals = sent.filter((entry) => entry.peerId === webPeerId && entry.signal.type === 'call-ring');
    expect(ringSignals).toHaveLength(2);

    // Handshake/in-call phase disconnect cleanup
    await manager.handleSignal(webPeerId, { type: 'call-accept', channelId });
    expect(get(activeHuddle)?.channelId).toBe(channelId);

    await manager.handlePeerDisconnect(webPeerId);
    expect(get(activeHuddle)).toBeNull();
  });

  test('duplicate or out-of-order call signals are ignored safely', async () => {
    setGetUserMediaAllowed();

    const myPeerId = 'mobile-peer';
    const webPeerId = 'web-peer';
    const channelId = directChannel(myPeerId, webPeerId);
    const { manager, sent } = createManager(myPeerId);

    // Out-of-order: accept without an active ring attempt.
    await manager.handleSignal(webPeerId, { type: 'call-accept', channelId });
    expect(get(activeHuddle)).toBeNull();

    await manager.ring(webPeerId);
    await manager.handleSignal(webPeerId, { type: 'call-accept', channelId });

    const offersAfterFirstAccept = sent.filter((entry) => entry.peerId === webPeerId && entry.signal.type === 'huddle-offer');
    expect(offersAfterFirstAccept).toHaveLength(1);

    // Duplicate accept should not create another offer/session.
    await manager.handleSignal(webPeerId, { type: 'call-accept', channelId });
    const offersAfterDuplicate = sent.filter((entry) => entry.peerId === webPeerId && entry.signal.type === 'huddle-offer');
    expect(offersAfterDuplicate).toHaveLength(1);
  });
});
