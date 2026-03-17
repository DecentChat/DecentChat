<svelte:options runes={true} />

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { incomingCall } from '../stores/huddleState';
  import type { MobileController } from '../app/MobileController';

  type Props = {
    controller: MobileController | null;
  };

  let { controller }: Props = $props();

  const callerPeerId = $derived($incomingCall?.fromPeerId ?? '');
  const callerName = $derived(
    callerPeerId ? (controller?.getPeerDisplayName(callerPeerId) || callerPeerId.slice(0, 8)) : 'Incoming call',
  );
  const avatarLabel = $derived(callerName.trim() ? callerName.trim().slice(0, 1).toUpperCase() : '?');

  async function acceptCall(): Promise<void> {
    if (!controller) return;
    await controller.callManager.acceptIncomingCall();
  }

  function declineCall(): void {
    controller?.callManager.declineIncomingCall();
  }

  let ringtoneContext: AudioContext | null = null;
  let ringtoneInterval: number | null = null;
  let ringtoneNotice = $state<string | null>(null);
  let ringtoneUnlockBound = false;

  function playTone(context: AudioContext, offsetSeconds: number, frequency: number, durationSeconds: number): void {
    const now = context.currentTime + offsetSeconds;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.03);
  }

  function unbindRingtoneUnlock(): void {
    if (!ringtoneUnlockBound || typeof window === 'undefined') return;
    ringtoneUnlockBound = false;
    window.removeEventListener('pointerdown', handleRingtoneUnlock);
    window.removeEventListener('touchstart', handleRingtoneUnlock);
    window.removeEventListener('keydown', handleRingtoneUnlock);
  }

  function bindRingtoneUnlock(): void {
    if (ringtoneUnlockBound || typeof window === 'undefined') return;
    ringtoneUnlockBound = true;
    window.addEventListener('pointerdown', handleRingtoneUnlock, { passive: true });
    window.addEventListener('touchstart', handleRingtoneUnlock, { passive: true });
    window.addEventListener('keydown', handleRingtoneUnlock);
  }

  async function disposeRingtoneRuntime(): Promise<void> {
    if (ringtoneInterval != null) {
      window.clearInterval(ringtoneInterval);
      ringtoneInterval = null;
    }

    if (ringtoneContext) {
      await ringtoneContext.close().catch(() => {});
      ringtoneContext = null;
    }
  }

  async function stopRingtone(): Promise<void> {
    unbindRingtoneUnlock();
    ringtoneNotice = null;
    await disposeRingtoneRuntime();
  }

  async function startRingtone(fromUserGesture = false): Promise<void> {
    if (typeof window === 'undefined' || ringtoneInterval != null) return;

    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      ringtoneNotice = 'Ringtone not supported on this device. You can still accept or decline.';
      return;
    }

    try {
      ringtoneContext = new AudioCtx();
      if (ringtoneContext.state === 'suspended') {
        await ringtoneContext.resume();
      }

      if (ringtoneContext.state !== 'running') {
        throw new Error('audio-context-not-running');
      }

      const playPattern = () => {
        if (!ringtoneContext) return;
        playTone(ringtoneContext, 0, 960, 0.14);
        playTone(ringtoneContext, 0.23, 880, 0.14);
      };

      playPattern();
      ringtoneInterval = window.setInterval(playPattern, 1400);
      ringtoneNotice = null;
      unbindRingtoneUnlock();
    } catch {
      await disposeRingtoneRuntime();
      ringtoneNotice = fromUserGesture
        ? 'Ringtone unavailable on this device. You can still accept or decline.'
        : 'Ringtone is blocked until you interact. Tap anywhere to enable sound.';
      bindRingtoneUnlock();
    }
  }

  const handleRingtoneUnlock = () => {
    void startRingtone(true);
  };

  onMount(() => {
    void startRingtone();
  });

  onDestroy(() => {
    void stopRingtone();
  });
</script>

<div class="incoming-call" role="dialog" aria-label="Incoming call">
  <p class="status">Incoming call</p>

  <div class="caller">
    <div class="avatar-wrap">
      <span class="pulse pulse-a" aria-hidden="true"></span>
      <span class="pulse pulse-b" aria-hidden="true"></span>
      <div class="avatar" aria-hidden="true">{avatarLabel}</div>
    </div>
    <h2>{callerName}</h2>
    {#if ringtoneNotice}
      <p class="ringtone-notice" role="status">{ringtoneNotice}</p>
    {/if}
  </div>

  <div class="controls">
    <button type="button" class="control accept" aria-label="Accept call" onclick={() => void acceptCall()}>
      Accept
    </button>
    <button type="button" class="control decline" aria-label="Decline call" onclick={declineCall}>
      Decline
    </button>
  </div>
</div>

<style>
  .incoming-call {
    position: absolute;
    inset: 0;
    z-index: 130;
    background: radial-gradient(circle at 30% 20%, #243f49 0%, #0b141a 68%);
    padding:
      calc(var(--safe-top) + var(--space-6))
      var(--space-5)
      calc(var(--safe-bottom) + var(--tabbar-height) + var(--space-6));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
  }

  .status {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 14px;
    letter-spacing: 0.02em;
  }

  .caller {
    margin-top: auto;
    margin-bottom: auto;
    text-align: center;
  }

  .avatar-wrap {
    position: relative;
    width: 164px;
    height: 164px;
    display: grid;
    place-items: center;
  }

  .pulse {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1px solid rgba(108, 92, 231, 0.44);
    animation: pulse 2.2s ease-out infinite;
  }

  .pulse-b {
    animation-delay: 0.8s;
  }

  .avatar {
    width: 148px;
    height: 148px;
    border-radius: 50%;
    background: linear-gradient(155deg, #33525f, #1f343e);
    color: var(--color-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 54px;
    font-weight: 700;
    text-transform: uppercase;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
    position: relative;
    z-index: 2;
  }

  h2 {
    margin: var(--space-5) 0 0;
    color: var(--color-text);
    font-size: 34px;
    letter-spacing: -0.03em;
  }

  .ringtone-notice {
    margin: var(--space-3) auto 0;
    max-width: 280px;
    color: #d5c9ff;
    font-size: 12px;
    line-height: 1.4;
  }

  .controls {
    width: 100%;
    display: flex;
    justify-content: center;
    gap: var(--space-4);
  }

  .control {
    min-width: 124px;
    min-height: 48px;
    border-radius: var(--radius-pill);
    border: none;
    color: var(--color-badge-text);
    font-size: 16px;
    font-weight: 700;
    padding: 0 var(--space-4);
  }

  .accept {
    background: var(--color-success);
  }

  .decline {
    background: #e06d65;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.9);
      opacity: 0.65;
    }

    100% {
      transform: scale(1.25);
      opacity: 0;
    }
  }
</style>
