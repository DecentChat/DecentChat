<svelte:options runes={true} />

<script lang="ts">
  import jsQR from 'jsqr';

  type Props = {
    active?: boolean;
    onScan?: ((value: string) => void) | undefined;
    onError?: ((message: string) => void) | undefined;
    scanHint?: string;
  };

  let {
    active = true,
    onScan,
    onError,
    scanHint = 'Point your camera at a QR code',
  }: Props = $props();

  let videoEl = $state<HTMLVideoElement | null>(null);
  let stream = $state<MediaStream | null>(null);
  let running = $state(false);
  let scanStatus = $state(scanHint);
  let hidden = $state(false);
  let cameraFailed = $state(false);

  let animationFrameId: number | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let lastValue = '';
  let lastScanTs = 0;

  function cameraErrorMessage(error: unknown): string {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return 'Camera needs a secure connection (HTTPS). Use paste instead.';
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return 'Camera API unavailable on this device. Use paste instead.';
    }

    if (error && typeof error === 'object' && 'name' in error) {
      const name = String((error as { name?: unknown }).name || '');
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return 'Camera permission denied. Enable camera access or paste the URI instead.';
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return 'No camera found on this device. Use paste instead.';
      }
      if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'Camera is in use by another app. Close it and try again.';
      }
      if (name === 'OverconstrainedError') {
        return 'Could not start the selected camera. Try again.';
      }
    }

    return 'Camera unavailable. Use paste instead.';
  }

  async function ensureCanvas(): Promise<void> {
    if (canvas) return;
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  async function startScanner(): Promise<void> {
    if (!active || running || !videoEl) return;

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      cameraFailed = true;
      scanStatus = 'Camera needs a secure connection (HTTPS). Use paste instead.';
      onError?.(scanStatus);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      cameraFailed = true;
      scanStatus = 'Camera API unavailable on this device. Use paste instead.';
      onError?.(scanStatus);
      return;
    }

    scanStatus = scanHint;
    hidden = false;
    cameraFailed = false;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      videoEl.srcObject = stream;
      await videoEl.play();

      running = true;
      await ensureCanvas();
      scanLoop();
    } catch (error) {
      cameraFailed = true;
      scanStatus = cameraErrorMessage(error);
      onError?.(scanStatus);
      stopScanner();
    }
  }

  function stopScanner(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }

    if (videoEl) {
      videoEl.pause();
      videoEl.srcObject = null;
    }

    running = false;
  }

  function retryScanner(): void {
    stopScanner();
    void startScanner();
  }

  function scanLoop(): void {
    if (!running || !videoEl || !canvas || !ctx) {
      return;
    }

    if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const width = videoEl.videoWidth;
      const height = videoEl.videoHeight;

      if (width > 0 && height > 0) {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(videoEl, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const code = jsQR(imageData.data, width, height, {
          inversionAttempts: 'dontInvert',
        });

        if (code?.data) {
          const nextValue = code.data.trim();
          const now = Date.now();
          const isDuplicate = nextValue === lastValue && now - lastScanTs < 1500;

          if (!isDuplicate) {
            lastValue = nextValue;
            lastScanTs = now;
            scanStatus = 'QR code detected';
            hidden = true;
            onScan?.(nextValue);
          }
        }
      }
    }

    animationFrameId = requestAnimationFrame(scanLoop);
  }

  $effect(() => {
    if (active) {
      void startScanner();
      return () => stopScanner();
    }

    stopScanner();
    return;
  });
</script>

<div class="scanner-shell">
  <div class="scanner-frame" data-hidden={hidden} data-camera-failed={cameraFailed}>
    <video bind:this={videoEl} autoplay playsinline muted aria-label="QR scanner camera preview"></video>
    <div class="reticle" aria-hidden="true"></div>
  </div>

  <p class="status" aria-live="polite">{scanStatus}</p>
  {#if cameraFailed}
    <button type="button" class="retry" onclick={retryScanner}>Retry camera</button>
  {/if}
  <slot></slot>
</div>

<style>
  .scanner-shell {
    display: grid;
    gap: var(--space-3);
  }

  .scanner-frame {
    position: relative;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: #0f1b22;
    overflow: hidden;
    min-height: 220px;
  }

  .scanner-frame[data-hidden='true'] {
    opacity: 0.2;
  }

  .scanner-frame[data-camera-failed='true'] {
    opacity: 0.7;
  }

  video {
    width: 100%;
    height: 260px;
    display: block;
    object-fit: cover;
    background: #0f1b22;
  }

  .reticle {
    position: absolute;
    inset: 18% 14%;
    border-radius: 18px;
    border: 2px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.32);
    pointer-events: none;
  }

  .status {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 13px;
    text-align: center;
  }

  .retry {
    justify-self: center;
    min-height: 38px;
    border-radius: var(--radius-pill);
    border: 1px solid rgba(134, 150, 160, 0.42);
    background: transparent;
    color: var(--color-text);
    font-size: 13px;
    font-weight: 650;
    padding: 0 var(--space-3);
  }
</style>
