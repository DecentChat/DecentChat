<svelte:options runes={true} />

<script lang="ts">
  import { onDestroy } from 'svelte';
  import jsQR from 'jsqr';
  import { RecoveryURI, SeedPhraseManager } from 'decent-protocol';
  import ScreenHeader from '../../components/ScreenHeader.svelte';

  type RecoveryPayload = {
    seedPhrase: string;
    alias: string;
    isRecovered?: boolean;
    sourcePeerId?: string;
    signalingServers?: string[];
  };

  type Props = {
    onBack?: (() => void) | undefined;
    onContinue?: ((payload: RecoveryPayload) => void | Promise<void>) | undefined;
  };

  let { onBack, onContinue }: Props = $props();

  const seedPhraseManager = new SeedPhraseManager();

  let alias = $state('');
  let manualSeedInput = $state('');
  let manualExpanded = $state(false);
  let submitting = $state(false);

  let scannerVisible = $state(false);
  let scannerError = $state<string | null>(null);
  let scannerStatus = $state('Ready to scan a recovery QR code.');
  let scannedUriInput = $state('');

  let videoElement = $state<HTMLVideoElement | null>(null);

  let cameraStream: MediaStream | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let scanCanvas: HTMLCanvasElement | null = null;
  let scanInFlight = false;
  let lastAutoScannedUri = '';

  const normalizedManualSeed = $derived(manualSeedInput.trim().toLowerCase().replace(/\s+/g, ' '));
  const manualValidation = $derived.by(() => {
    if (!manualExpanded || !normalizedManualSeed) return null;
    return seedPhraseManager.validate(normalizedManualSeed);
  });

  const manualIsValid = $derived(manualValidation?.valid === true);
  const manualValidationMessage = $derived.by(() => {
    if (!manualExpanded || !normalizedManualSeed) return 'Enter your 12-word seed phrase.';
    if (manualIsValid) return 'Seed phrase looks valid.';
    return manualValidation?.error || 'Invalid seed phrase.';
  });

  const canContinueManually = $derived(manualExpanded && manualIsValid && !submitting);

  function writeLocalStorage(key: string, value: string): void {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Best effort only.
    }
  }

  function removeLocalStorage(key: string): void {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.removeItem(key);
    } catch {
      // Best effort only.
    }
  }

  function cameraErrorMessage(error: unknown): string {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return 'Camera needs a secure connection (HTTPS). Paste the recovery URI below.';
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return 'Camera API unavailable. Paste the recovery URI below.';
    }

    if (error && typeof error === 'object' && 'name' in error) {
      const name = String((error as { name?: unknown }).name || '');
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return 'Camera permission denied. Allow camera access or paste the recovery URI below.';
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return 'No camera found on this device. Paste the recovery URI below.';
      }
      if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'Camera is in use by another app. Close it and try again.';
      }
      if (name === 'OverconstrainedError') {
        return 'Could not start the selected camera. Try again or paste the recovery URI.';
      }
    }

    return 'Camera unavailable. Paste the recovery URI below.';
  }

  async function finalizeRecovery(payload: {
    seedPhrase: string;
    sourcePeerId?: string;
    signalingServers?: string[];
  }): Promise<void> {
    const normalizedAlias = alias.trim();

    writeLocalStorage('decentchat-is-recovered', 'true');
    writeLocalStorage('decentchat-seed-backed-up', 'true');

    if (payload.sourcePeerId) {
      writeLocalStorage('decentchat-recovery-source-peer', payload.sourcePeerId);
    } else {
      removeLocalStorage('decentchat-recovery-source-peer');
    }

    if (payload.signalingServers && payload.signalingServers.length > 0) {
      writeLocalStorage('decentchat-recovery-signaling', JSON.stringify(payload.signalingServers));
    } else {
      removeLocalStorage('decentchat-recovery-signaling');
    }

    await onContinue?.({
      seedPhrase: payload.seedPhrase,
      alias: normalizedAlias,
      isRecovered: true,
      sourcePeerId: payload.sourcePeerId,
      signalingServers: payload.signalingServers,
    });
  }

  async function handleManualContinue(): Promise<void> {
    if (!canContinueManually) return;

    submitting = true;
    try {
      await finalizeRecovery({ seedPhrase: normalizedManualSeed });
    } finally {
      submitting = false;
    }
  }

  async function importRecoveryUri(): Promise<void> {
    if (scanInFlight) return;

    const uri = scannedUriInput.trim();
    if (!uri) {
      scannerError = 'Paste a recovery URI or scan a QR code first.';
      return;
    }

    submitting = true;
    scanInFlight = true;
    scannerError = null;

    try {
      const decoded = RecoveryURI.decode(uri);
      scannedUriInput = '';
      lastAutoScannedUri = '';
      await finalizeRecovery({
        seedPhrase: decoded.seedPhrase,
        sourcePeerId: decoded.sourcePeerId,
        signalingServers: decoded.signalingServers,
      });
      stopScanner();
    } catch (error) {
      scannerError = (error as Error).message || 'Failed to parse recovery URI.';
      lastAutoScannedUri = '';
    } finally {
      submitting = false;
      scanInFlight = false;
    }
  }

  async function beginScanner(): Promise<void> {
    scannerVisible = true;
    scannerError = null;
    scannerStatus = 'Requesting camera access…';
    lastAutoScannedUri = '';

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      scannerStatus = 'Camera needs a secure connection (HTTPS). Use manual URI paste below.';
      scannerError = scannerStatus;
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      scannerStatus = 'Camera API unavailable. Use manual URI paste below.';
      scannerError = scannerStatus;
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      if (videoElement) {
        videoElement.srcObject = cameraStream;
        await videoElement.play();
      }

      scannerStatus = 'Point the camera at a DecentChat recovery QR code.';
      startScanLoop();
    } catch (error) {
      scannerStatus = cameraErrorMessage(error);
      scannerError = scannerStatus;
    }
  }

  function startScanLoop(): void {
    if (typeof window === 'undefined' || !videoElement) return;

    if (!scanCanvas) {
      scanCanvas = document.createElement('canvas');
    }

    scannerStatus = 'Point the camera at a DecentChat recovery QR code.';

    scanTimer = setInterval(() => {
      if (!scannerVisible || !videoElement || !scanCanvas) return;
      if (videoElement.readyState < videoElement.HAVE_ENOUGH_DATA) return;

      const w = videoElement.videoWidth;
      const h = videoElement.videoHeight;
      if (!w || !h) return;

      scanCanvas.width = w;
      scanCanvas.height = h;
      const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(videoElement, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);

      const result = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
      if (result?.data && RecoveryURI.isValid(result.data)) {
        const nextUri = result.data.trim();
        if (!nextUri || nextUri === lastAutoScannedUri || scanInFlight || submitting) {
          return;
        }

        lastAutoScannedUri = nextUri;
        scannedUriInput = nextUri;
        void importRecoveryUri();
      }
    }, 250);
  }

  function stopScanner(): void {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }

    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }

    if (cameraStream) {
      for (const track of cameraStream.getTracks()) {
        track.stop();
      }
      cameraStream = null;
    }

    scanInFlight = false;
    scannerVisible = false;
  }

  function retryScanner(): void {
    stopScanner();
    void beginScanner();
  }

  function toggleScanner(): void {
    if (scannerVisible) {
      stopScanner();
      return;
    }

    void beginScanner();
  }

  onDestroy(() => {
    stopScanner();
  });
</script>

<section class="screen">
  <ScreenHeader title="Recover your account" onBack={onBack} backLabel="Welcome" />

  <div class="content">
    <button type="button" class="scan-primary" onclick={toggleScanner}>
      {scannerVisible ? 'Close scanner' : 'Scan QR code'}
    </button>

    {#if scannerVisible}
      <div class="scanner-panel">
        <div class="viewfinder" aria-label="Camera preview">
          <video bind:this={videoElement} autoplay muted playsinline></video>
        </div>

        <p class="status">{scannerStatus}</p>

        <label class="field" for="recovery-uri-input">
          <span>Recovery URI (fallback)</span>
          <textarea
            id="recovery-uri-input"
            bind:value={scannedUriInput}
            rows="3"
            placeholder="decent://recover?seed=..."
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          ></textarea>
        </label>

        <label class="field" for="recover-scan-alias-input">
          <span>Alias (optional)</span>
          <input
            id="recover-scan-alias-input"
            type="text"
            placeholder="Optional display name"
            bind:value={alias}
            maxlength="32"
          />
        </label>

        <button type="button" class="scan-import" disabled={submitting || !scannedUriInput.trim()} onclick={() => void importRecoveryUri()}>
          Continue with scanned URI
        </button>

        {#if scannerError}
          <p class="error" role="status">{scannerError}</p>
          <button type="button" class="scan-retry" onclick={retryScanner}>Retry camera</button>
        {/if}
      </div>
    {/if}

    <button type="button" class="manual-toggle" onclick={() => (manualExpanded = !manualExpanded)}>
      {manualExpanded ? 'Hide manual entry' : 'Enter seed phrase manually'}
    </button>

    {#if manualExpanded}
      <div class="manual-panel">
        <label class="field" for="manual-seed-input">
          <span>Seed phrase</span>
          <textarea
            id="manual-seed-input"
            placeholder="twelve words separated by spaces"
            bind:value={manualSeedInput}
            rows="4"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          ></textarea>
        </label>

        <label class="field" for="recover-manual-alias-input">
          <span>Alias (optional)</span>
          <input
            id="recover-manual-alias-input"
            type="text"
            placeholder="Optional display name"
            bind:value={alias}
            maxlength="32"
          />
        </label>

        <p class="validation" data-valid={manualIsValid}>{manualValidationMessage}</p>

        <button type="button" class="continue" disabled={!canContinueManually} onclick={() => void handleManualContinue()}>
          Continue
        </button>
      </div>
    {/if}
  </div>
</section>

<style>
  .screen {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }

  .field {
    display: grid;
    gap: var(--space-2);
    font-size: 13px;
    color: var(--color-text-muted);
  }

  input,
  textarea {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 15px;
    padding: 10px var(--space-3);
    font-family: var(--font-system);
  }

  input {
    min-height: 44px;
  }

  textarea {
    resize: vertical;
    min-height: 96px;
    line-height: 1.45;
  }

  .scan-primary,
  .continue,
  .scan-import,
  .scan-retry {
    min-height: 48px;
    border-radius: var(--radius-md);
    border: none;
    background: #6c5ce7;
    color: #ffffff !important;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .scan-primary {
    min-height: 56px;
    font-size: 17px;
    box-shadow: 0 8px 20px rgba(108, 92, 231, 0.3);
  }

  .scan-import {
    min-height: 44px;
    font-size: 14px;
  }

  .scan-retry {
    min-height: 42px;
    font-size: 13px;
    background: transparent;
    color: var(--color-text) !important;
    border: 1px solid rgba(134, 150, 160, 0.42);
  }

  .scan-import:disabled,
  .continue:disabled {
    opacity: 0.45;
  }

  .manual-toggle {
    min-height: 42px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(134, 150, 160, 0.38);
    background: transparent;
    color: var(--color-text);
    font-size: 14px;
    font-weight: 650;
  }

  .scanner-panel,
  .manual-panel {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-3);
  }

  .viewfinder {
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    overflow: hidden;
    aspect-ratio: 4 / 3;
    background: rgba(0, 0, 0, 0.3);
  }

  .viewfinder video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .status {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--color-text-muted);
  }

  .validation {
    margin: 0;
    font-size: 13px;
    line-height: 1.35;
    color: #ff7f7f;
  }

  .validation[data-valid='true'] {
    color: #79d6bf;
  }

  .error {
    margin: 0;
    font-size: 13px;
    line-height: 1.35;
    color: #ff9891;
  }
</style>
