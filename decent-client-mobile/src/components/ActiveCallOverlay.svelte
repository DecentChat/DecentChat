<svelte:options runes={true} />

<script lang="ts">
  import { activeHuddle, callConnectionQuality } from '../stores/huddleState';
  import { myPeerId, workspaces } from '../stores/appState';
  import type { MobileController } from '../app/MobileController';

  type Props = {
    controller: MobileController | null;
  };

  let { controller }: Props = $props();

  let speakerEnabled = $state(false);
  let elapsedSeconds = $state(0);

  const remotePeerId = $derived.by(() => {
    const huddle = $activeHuddle;
    if (!huddle) return '';

    return huddle.participants.find((peerId) => peerId !== $myPeerId) ?? '';
  });

  const remotePeerName = $derived.by(() => {
    if (!remotePeerId) return 'Huddle';

    const preferred = controller?.getPeerDisplayName(remotePeerId);
    if (preferred?.trim()) return preferred;

    for (const workspace of $workspaces) {
      const member = workspace.members.find((item) => item.peerId === remotePeerId);
      if (member?.alias?.trim()) return member.alias;
    }

    return remotePeerId.slice(0, 8);
  });

  const avatarLabel = $derived(
    remotePeerName.trim() ? remotePeerName.trim().slice(0, 1).toUpperCase() : 'H',
  );

  const qualityLabel = $derived(
    $callConnectionQuality === 'good'
      ? 'Good'
      : $callConnectionQuality === 'poor'
        ? 'Poor'
        : 'Connecting',
  );

  $effect(() => {
    const huddleId = $activeHuddle?.huddleId;
    if (!huddleId) return;

    elapsedSeconds = 0;

    const start = Date.now();
    const timer = window.setInterval(() => {
      elapsedSeconds = Math.floor((Date.now() - start) / 1000);
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  });

  function formatDuration(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function toggleSpeaker(): void {
    speakerEnabled = !speakerEnabled;
  }

  function toggleMute(): void {
    controller?.callManager.toggleMute();
  }

  async function endCall(): Promise<void> {
    if (!controller) return;
    await controller.callManager.endCall();
  }
</script>

<div class="call-overlay" role="dialog" aria-label="Active call">
  <div class="header-row">
    <p class="status">{qualityLabel} connection</p>
    <p class="timer">{formatDuration(elapsedSeconds)}</p>
  </div>

  <div class="peer">
    <div class="avatar" aria-hidden="true">{avatarLabel}</div>
    <h2>{remotePeerName}</h2>
  </div>

  <div class="quality" data-quality={$callConnectionQuality}>
    <span class="dot" aria-hidden="true"></span>
    <span>{qualityLabel}</span>
  </div>

  <div class="controls">
    <button
      type="button"
      class="control"
      data-active={$activeHuddle?.isMuted ?? false}
      aria-label={$activeHuddle?.isMuted ? 'Unmute microphone' : 'Mute microphone'}
      onclick={toggleMute}
    >
      {$activeHuddle?.isMuted ? '🔇' : '🎙️'}
    </button>

    <button
      type="button"
      class="control"
      data-active={speakerEnabled}
      aria-label={speakerEnabled ? 'Disable speaker' : 'Enable speaker'}
      onclick={toggleSpeaker}
    >
      🔊
    </button>

    <button type="button" class="control end" aria-label="End call" onclick={endCall}>
      ⏹
    </button>
  </div>
</div>

<style>
  .call-overlay {
    position: absolute;
    inset: 0;
    z-index: 120;
    background: radial-gradient(circle at 30% 20%, #223844 0%, #0a1116 62%);
    padding:
      calc(var(--safe-top) + var(--space-6))
      var(--space-5)
      calc(var(--safe-bottom) + var(--tabbar-height) + var(--space-6));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
  }

  .header-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #aab7be;
    font-size: 13px;
    letter-spacing: 0.01em;
  }

  .status,
  .timer {
    margin: 0;
  }

  .peer {
    margin-top: auto;
    margin-bottom: auto;
    text-align: center;
  }

  .avatar {
    width: 152px;
    height: 152px;
    border-radius: 50%;
    background: linear-gradient(155deg, #33525f, #1f343e);
    color: #eaf1f3;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 56px;
    font-weight: 700;
    text-transform: uppercase;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
  }

  h2 {
    margin: var(--space-5) 0 0;
    font-size: 34px;
    letter-spacing: -0.03em;
    color: var(--color-text);
  }

  .quality {
    margin-bottom: var(--space-4);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #b7c3ca;
    font-size: 14px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #f1bf47;
  }

  .quality[data-quality='good'] .dot {
    background: var(--color-accent);
  }

  .quality[data-quality='poor'] .dot {
    background: #e06d65;
  }

  .controls {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--space-5);
  }

  .control {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.08);
    color: #e9edef;
    font-size: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .control[data-active='true'] {
    background: rgba(108, 92, 231, 0.2);
    border-color: rgba(108, 92, 231, 0.44);
  }

  .control.end {
    background: rgba(224, 109, 101, 0.28);
    border-color: rgba(224, 109, 101, 0.45);
  }
</style>
