<svelte:options runes={true} />

<script lang="ts">
  import { hapticMediumImpact } from '../native/plugins';

  type Props = {
    onBack?: (() => void) | undefined;
    edgeWidth?: number;
    triggerDistance?: number;
    maxDistance?: number;
  };

  let {
    onBack,
    edgeWidth = 28,
    triggerDistance = 86,
    maxDistance = 150,
  }: Props = $props();

  let tracking = $state(false);
  let startX = $state(0);
  let startY = $state(0);
  let pullX = $state(0);

  const progress = $derived(Math.min(pullX / triggerDistance, 1));
  const indicatorOpacity = $derived((tracking || pullX > 0 ? Math.max(0.1, progress) : 0));
  const indicatorOffset = $derived(-14 + progress * 14);

  function handleTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    if (touch.clientX > edgeWidth) {
      tracking = false;
      pullX = 0;
      return;
    }

    tracking = true;
    startX = touch.clientX;
    startY = touch.clientY;
    pullX = 0;
  }

  function handleTouchMove(event: TouchEvent): void {
    if (!tracking || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = Math.abs(touch.clientY - startY);

    if (deltaX <= 0) {
      pullX = 0;
      return;
    }

    if (deltaY > deltaX * 0.85) {
      tracking = false;
      pullX = 0;
      return;
    }

    pullX = Math.min(maxDistance, deltaX);
  }

  function endGesture(): void {
    const shouldGoBack = pullX >= triggerDistance;
    tracking = false;
    pullX = 0;

    if (shouldGoBack) {
      void hapticMediumImpact();
      onBack?.();
    }
  }
</script>

<div
  class="swipe-back-shell"
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={endGesture}
  ontouchcancel={endGesture}
>
  <div class="back-indicator" style:opacity={indicatorOpacity} style:transform={`translate3d(${indicatorOffset}px, 0, 0)`}>
    <span aria-hidden="true">‹</span>
  </div>

  <div
    class="content"
    data-tracking={tracking}
    style:transform={`translate3d(${Math.min(pullX, 34)}px, 0, 0)`}
  >
    <slot />
  </div>
</div>

<style>
  .swipe-back-shell {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .content {
    width: 100%;
    height: 100%;
    transition: transform 0.18s ease-out;
    will-change: transform;
  }

  .content[data-tracking='true'] {
    transition: none;
  }

  .back-indicator {
    position: absolute;
    top: calc(var(--safe-top) + 12px);
    left: 0;
    z-index: 30;
    width: 34px;
    height: 34px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: rgba(233, 237, 239, 0.9);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(10px);
    pointer-events: none;
    transition: opacity 0.15s ease;
  }

  .back-indicator span {
    font-size: 23px;
    line-height: 1;
    transform: translateX(-1px);
  }
</style>
