<script lang="ts" module>
  import { mount, unmount } from 'svelte';
  import type { ContactURIData } from 'decent-protocol';

  export interface QRFlowCallbacks {
    onContactScanned: (data: ContactURIData) => void;
    onSeedRestored?: (mnemonic: string) => void;
    validateSeed?: (mnemonic: string) => string | null;
    showToast: (message: string, type?: 'info' | 'error' | 'success') => void;
  }

  export interface QRFlowController {
    showMyQR(data: { publicKey: string; displayName: string; peerId: string }): Promise<void>;
    showScanQR(): Promise<void>;
    showSeedQR(mnemonic: string, options?: { sourcePeerId?: string }): Promise<void>;
    showRestoreSeed(): Promise<void>;
    close(): void;
  }

  type StartMode = 'my-qr' | 'scan' | 'seed-qr' | 'restore';

  interface OpenPayload {
    mode: StartMode;
    myQRData?: { publicKey: string; displayName: string; peerId: string };
    seedMnemonic?: string;
    recoverySourcePeerId?: string;
  }

  export function createQRFlow(callbacks: QRFlowCallbacks): QRFlowController {
    let instance: Record<string, any> | null = null;
    let target: HTMLDivElement | null = null;

    const cleanup = () => {
      if (instance) {
        unmount(instance);
        instance = null;
      }
      target?.remove();
      target = null;
    };

    const open = async (payload: OpenPayload): Promise<void> => {
      cleanup();
      target = document.createElement('div');
      document.body.appendChild(target);
      instance = mount(QRFlowModal, {
        target,
        props: {
          callbacks,
          initialMode: payload.mode,
          myQRData: payload.myQRData || null,
          seedMnemonic: payload.seedMnemonic || '',
          recoverySourcePeerId: payload.recoverySourcePeerId || '',
          onClose: cleanup,
        },
      });
    };

    return {
      showMyQR: async (data) => open({ mode: 'my-qr', myQRData: data }),
      showScanQR: async () => open({ mode: 'scan' }),
      showSeedQR: async (mnemonic, options) => open({
        mode: 'seed-qr',
        seedMnemonic: mnemonic,
        recoverySourcePeerId: options?.sourcePeerId || '',
      }),
      showRestoreSeed: async () => open({ mode: 'restore' }),
      close: () => cleanup(),
    };
  }

  const SEED_QR_PREFIX = 'decent-seed://v1?m=';

  import QRFlowModal from './QRFlowModal.svelte';
</script>

<script lang="ts">
  import type { ContactURIData } from 'decent-protocol';
  import QRCode from 'qrcode';
  import QrScanner from 'qr-scanner';
  import { ContactURI, RecoveryURI } from 'decent-protocol';
  import type { QRFlowCallbacks } from './QRFlowModal.svelte';

  const SEED_QR_PREFIX = 'decent-seed://v1?m=';

  type Mode = 'my-qr' | 'scan' | 'paste' | 'contact-confirm' | 'seed-qr' | 'restore' | 'seed-confirm';
  type RestoreTab = 'phrase' | 'scan';

  interface Props {
    callbacks: QRFlowCallbacks;
    initialMode: 'my-qr' | 'scan' | 'seed-qr' | 'restore';
    myQRData: { publicKey: string; displayName: string; peerId: string } | null;
    seedMnemonic: string;
    recoverySourcePeerId: string;
    onClose: () => void;
  }

  let { callbacks, initialMode, myQRData, seedMnemonic, recoverySourcePeerId, onClose }: Props = $props();

  let mode = $state<Mode>(initialMode);

  let qrDataUrl = $state('');
  let myContactUri = $state('');

  let scanStatus = $state('Point your camera at a DecentChat QR code');
  let scanIsError = $state(false);
  let scanVideoHidden = $state(false);

  let pasteUri = $state('');

  let contactData = $state<ContactURIData | null>(null);

  let restoreTab = $state<RestoreTab>('phrase');
  let restoreInput = $state('');
  let restoreStatus = $state('');
  let restoreStatusClass = $state<'restore-seed-status' | 'restore-seed-status valid' | 'restore-seed-status error'>('restore-seed-status');
  let restoreCanConfirm = $state(false);
  let restoreScanStatus = $state('Point your camera at the identity QR from your other device');
  let restoreVideoHidden = $state(false);

  let pendingSeed = $state('');

  let scanVideoEl: HTMLVideoElement | null = null;
  let restoreVideoEl: HTMLVideoElement | null = null;
  let pasteInputEl: HTMLInputElement | null = null;

  let scanner: QrScanner | null = null;
  let restoreScanner: QrScanner | null = null;

  function closeModal(): void {
    stopScanner();
    stopRestoreScanner();
    onClose();
  }

  function handleOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) closeModal();
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  $effect(() => {
    const currentMode = mode;

    if (currentMode === 'my-qr' && myQRData) {
      void prepareMyQR(myQRData);
    }

    if (currentMode === 'seed-qr' && seedMnemonic) {
      void prepareSeedQR(seedMnemonic);
    }

    if (currentMode === 'scan') {
      void startScanner();
      return () => stopScanner();
    }

    stopScanner();
    return;
  });

  $effect(() => {
    const currentMode = mode;
    const currentTab = restoreTab;

    if (currentMode === 'restore' && currentTab === 'scan') {
      void startRestoreScanner();
      return () => stopRestoreScanner();
    }

    stopRestoreScanner();
    return;
  });

  $effect(() => {
    if (mode === 'paste') {
      setTimeout(() => pasteInputEl?.focus(), 50);
    }
  });

  async function prepareMyQR(data: { publicKey: string; displayName: string; peerId: string }): Promise<void> {
    const uri = ContactURI.encode({
      publicKey: data.publicKey,
      displayName: data.displayName,
      peerId: data.peerId,
    });

    myContactUri = uri;
    try {
      qrDataUrl = await QRCode.toDataURL(uri, {
        width: 280,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    } catch {
      callbacks.showToast('Failed to generate QR code', 'error');
      closeModal();
    }
  }

  async function prepareSeedQR(mnemonic: string): Promise<void> {
    // Recovery seed transfer should also include the source peer ID so the
    // recovered device can immediately connect back and sync.
    const peerId = (recoverySourcePeerId || myQRData?.peerId || '').trim();
    const recoveryUri = RecoveryURI.encode({
      seedPhrase: mnemonic,
      sourcePeerId: peerId || undefined,
    });

    // Also keep legacy format as fallback comment
    const uri = recoveryUri;
    try {
      qrDataUrl = await QRCode.toDataURL(uri, {
        width: 280,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    } catch {
      callbacks.showToast('Failed to generate QR code', 'error');
      closeModal();
    }
  }

  async function startScanner(): Promise<void> {
    if (!scanVideoEl || scanner) return;

    scanStatus = 'Point your camera at a DecentChat QR code';
    scanIsError = false;
    scanVideoHidden = false;

    try {
      scanner = new QrScanner(
        scanVideoEl,
        (result) => {
          void handleScanResult(result.data, 'any');
        },
        {
          preferredCamera: 'environment',
          highlightScanRegion: false,
          highlightCodeOutline: false,
        },
      );
      await scanner.start();
    } catch {
      scanStatus = 'Camera not available — paste a URI instead';
      scanIsError = false;
      scanVideoHidden = true;
      stopScanner();
    }
  }

  function stopScanner(): void {
    scanner?.stop();
    scanner?.destroy();
    scanner = null;
  }

  async function startRestoreScanner(): Promise<void> {
    if (!restoreVideoEl || restoreScanner) return;

    restoreScanStatus = 'Point your camera at the identity QR from your other device';
    restoreVideoHidden = false;

    try {
      restoreScanner = new QrScanner(
        restoreVideoEl,
        (result) => {
          void handleScanResult(result.data, 'seed');
        },
        {
          preferredCamera: 'environment',
          highlightScanRegion: false,
          highlightCodeOutline: false,
        },
      );
      await restoreScanner.start();
    } catch {
      restoreScanStatus = 'Camera not available — use the "Enter phrase" tab instead';
      restoreVideoHidden = true;
      stopRestoreScanner();
    }
  }

  function stopRestoreScanner(): void {
    restoreScanner?.stop();
    restoreScanner?.destroy();
    restoreScanner = null;
  }

  async function handleScanResult(data: string, expected: 'contact' | 'seed' | 'any'): Promise<void> {
    stopScanner();
    stopRestoreScanner();

    // Handle new RecoveryURI format (decent://recover?seed=...&peer=...)
    if (RecoveryURI.isValid(data)) {
      if (expected === 'contact') {
        await resumeScanWithError('Not a contact QR code');
        return;
      }

      const decoded = RecoveryURI.decode(data);
      openSeedConfirmation(decoded.seedPhrase);
      return;
    }

    // Handle legacy seed QR format
    if (data.startsWith(SEED_QR_PREFIX)) {
      if (expected === 'contact') {
        await resumeScanWithError('Not a contact QR code');
        return;
      }

      const mnemonic = decodeURIComponent(data.slice(SEED_QR_PREFIX.length));
      openSeedConfirmation(mnemonic);
      return;
    }

    if (ContactURI.isValid(data)) {
      if (expected === 'seed') {
        if (mode === 'restore') {
          restoreScanStatus = 'Not an identity QR code. Try again.';
          setTimeout(() => {
            if (mode === 'restore' && restoreTab === 'scan') {
              restoreScanStatus = 'Point your camera at the identity QR from your other device';
              void startRestoreScanner();
            }
          }, 2000);
        } else {
          await resumeScanWithError('Not an identity QR code');
        }
        return;
      }

      contactData = ContactURI.decode(data);
      mode = 'contact-confirm';
      return;
    }

    if (mode === 'restore') {
      restoreScanStatus = 'Not a valid DecentChat QR code. Try again.';
      setTimeout(() => {
        if (mode === 'restore' && restoreTab === 'scan') {
          restoreScanStatus = 'Point your camera at the identity QR from your other device';
          void startRestoreScanner();
        }
      }, 2000);
      return;
    }

    await resumeScanWithError('Not a valid DecentChat QR code');
  }

  async function resumeScanWithError(message: string): Promise<void> {
    scanStatus = `${message}. Try again.`;
    scanIsError = true;
    setTimeout(() => {
      if (mode !== 'scan') return;
      scanStatus = 'Point your camera at a DecentChat QR code';
      scanIsError = false;
      void startScanner();
    }, 2000);
  }

  function peerColor(key: string): string {
    const colors = ['#e01e5a', '#2eb67d', '#ecb22e', '#36c5f0', '#611f69', '#1264a3', '#e57373', '#4fc3f7'];
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  function openSeedConfirmation(mnemonic: string): void {
    const error = callbacks.validateSeed?.(mnemonic);
    if (error) {
      callbacks.showToast(`Invalid phrase: ${error}`, 'error');
      if (mode === 'scan') {
        mode = 'scan';
        void startScanner();
      }
      return;
    }

    pendingSeed = mnemonic;
    mode = 'seed-confirm';
  }

  function handleRestoreInput(input: string): void {
    restoreInput = input;
    const words = input.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      restoreStatus = '';
      restoreStatusClass = 'restore-seed-status';
      restoreCanConfirm = false;
      return;
    }

    const normalized = words.join(' ');
    const error = callbacks.validateSeed?.(normalized);

    if (error) {
      restoreStatus = `✗ ${error}`;
      restoreStatusClass = 'restore-seed-status error';
      restoreCanConfirm = false;
      return;
    }

    restoreStatus = '✓ Valid 12-word phrase';
    restoreStatusClass = 'restore-seed-status valid';
    restoreCanConfirm = true;
  }

  function confirmRestoreFromInput(): void {
    const mnemonic = restoreInput.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
    openSeedConfirmation(mnemonic);
  }

  async function copyMyURI(): Promise<void> {
    try {
      await navigator.clipboard.writeText(myContactUri);
      callbacks.showToast('Contact URI copied!', 'success');
    } catch {
      callbacks.showToast('Failed to copy — try selecting the text manually', 'error');
    }
  }

  async function copySeedPhrase(phrase: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(phrase);
      callbacks.showToast('Seed phrase copied!', 'success');
    } catch {
      callbacks.showToast('Failed to copy seed phrase', 'error');
    }
  }

  function submitPastedUri(): void {
    const uri = pasteUri.trim();
    if (!uri) return;

    if (!ContactURI.isValid(uri)) {
      callbacks.showToast('Invalid contact URI', 'error');
      return;
    }

    contactData = ContactURI.decode(uri);
    mode = 'contact-confirm';
  }
</script>

{#if mode === 'my-qr' && myQRData}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal qr-modal">
      <div class="settings-header">
        <h2>My QR Code</h2>
        <button class="thread-close" id="qr-close" onclick={closeModal}>✕</button>
      </div>
      <div class="qr-content">
        <div class="qr-image-container">
          {#if qrDataUrl}
            <img src={qrDataUrl} alt="QR Code" class="qr-image" />
          {/if}
        </div>
        <p class="qr-name">{myQRData.displayName}</p>
        <p class="qr-hint">Scan this code to add me as a contact</p>
        <div class="qr-uri-container">
          <code class="qr-uri" id="qr-uri-text">{myContactUri}</code>
          <button class="btn-secondary qr-copy-btn" id="qr-copy-btn" onclick={copyMyURI}>Copy</button>
        </div>
        <div class="qr-actions">
          <button class="btn-primary" id="qr-switch-scan" onclick={() => { mode = 'scan'; }}>Scan a QR Code</button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if mode === 'scan'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal qr-modal qr-scan-modal">
      <div class="settings-header">
        <h2>Scan QR Code</h2>
        <button class="thread-close" id="qr-close" onclick={closeModal}>✕</button>
      </div>
      <div class="qr-content">
        <div class="qr-video-container" id="qr-video-container" style={`display:${scanVideoHidden ? 'none' : 'block'}`}>
          <video id="qr-video" class="qr-video" bind:this={scanVideoEl}></video>
          <div class="qr-scan-overlay">
            <div class="qr-scan-frame"></div>
          </div>
        </div>

        <p class={`qr-hint ${scanIsError ? 'qr-error' : ''}`} id="qr-scan-status">{scanStatus}</p>

        <div class="qr-actions">
          <button class="btn-secondary" id="qr-paste-btn" onclick={() => { pasteUri = ''; mode = 'paste'; }}>Paste URI instead</button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if mode === 'paste'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal qr-modal">
      <div class="settings-header">
        <h2>Add Contact</h2>
        <button class="thread-close" id="qr-close" onclick={closeModal}>✕</button>
      </div>
      <div class="qr-content">
        <div class="form-group" style="width:100%">
          <label>Paste Contact URI</label>
          <input
            type="text"
            id="qr-paste-input"
            placeholder="https://decentchat.app/contact?pub=...&name=..."
            style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-secondary); color:var(--text); font-size:14px; font-family:monospace;"
            bind:value={pasteUri}
            bind:this={pasteInputEl}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitPastedUri();
              }
            }}
          />
          <small style="color:var(--text-muted); margin-top:4px; display:block;">
            Ask your contact to share their URI from the "My QR Code" screen
          </small>
        </div>
        <div class="qr-actions">
          <button class="btn-secondary" id="qr-cancel" onclick={closeModal}>Cancel</button>
          <button class="btn-primary" id="qr-paste-confirm" onclick={submitPastedUri}>Add Contact</button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if mode === 'contact-confirm' && contactData}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal qr-modal">
      <div class="settings-header">
        <h2>Add Contact</h2>
        <button class="thread-close" id="qr-close" onclick={closeModal}>✕</button>
      </div>
      <div class="qr-content">
        <div class="qr-contact-card">
          <div class="qr-contact-avatar" style={`background:${peerColor(contactData.publicKey)}`}>
            {contactData.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div class="qr-contact-info">
            <span class="qr-contact-name">{contactData.displayName}</span>
            {#if contactData.peerId}
              <code class="qr-contact-peer">{contactData.peerId.slice(0, 16)}...</code>
            {/if}
          </div>
        </div>
        <div class="qr-actions">
          <button class="btn-secondary" id="qr-cancel" onclick={closeModal}>Cancel</button>
          <button class="btn-primary" id="qr-confirm" onclick={() => {
            callbacks.onContactScanned(contactData!);
            callbacks.showToast(`Added ${contactData!.displayName} as a contact!`, 'success');
            closeModal();
          }}>Add Contact</button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if mode === 'seed-qr' && seedMnemonic}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal qr-modal">
      <div class="settings-header">
        <h2>📲 Transfer to Another Device</h2>
        <button class="thread-close" id="qr-close" onclick={closeModal}>✕</button>
      </div>
      <div class="qr-content">
        <div class="seed-qr-warning">
          ⚠️ <strong>Keep this private.</strong> Anyone who scans this QR can access your account.
        </div>
        <div class="qr-image-container">
          {#if qrDataUrl}
            <img src={qrDataUrl} alt="Identity QR Code" class="qr-image" />
          {/if}
        </div>
        <p class="qr-hint">Scan this on your other device</p>
        <details class="seed-phrase-details">
          <summary>Show seed phrase instead</summary>
          <div class="seed-phrase-reveal">
            <code id="seed-qr-words">{seedMnemonic}</code>
            <button class="btn-secondary" id="seed-copy-btn" style="margin-top:8px;" onclick={() => copySeedPhrase(seedMnemonic)}>Copy phrase</button>
          </div>
        </details>
      </div>
    </div>
  </div>
{/if}

{#if mode === 'restore'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal qr-modal restore-modal">
      <div class="settings-header">
        <h2>Restore Your Account</h2>
        <button class="thread-close" id="qr-close" onclick={closeModal}>✕</button>
      </div>

      <div class="restore-tabs">
        <button class={`restore-tab ${restoreTab === 'phrase' ? 'active' : ''}`} data-tab="phrase" onclick={() => { restoreTab = 'phrase'; }}>
          📝 Enter phrase
        </button>
        <button class={`restore-tab ${restoreTab === 'scan' ? 'active' : ''}`} data-tab="scan" onclick={() => { restoreTab = 'scan'; }}>
          📷 Scan QR
        </button>
      </div>

      <div class="restore-pane" id="restore-pane-phrase" style={`display:${restoreTab === 'phrase' ? '' : 'none'}`}>
        <p class="qr-hint" style="margin-bottom:12px;">Enter your 12-word seed phrase to restore your identity on this device.</p>
        <textarea
          id="restore-seed-input"
          class="restore-seed-textarea"
          placeholder="apple banana cherry door ..."
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          rows="3"
          value={restoreInput}
          oninput={(e) => handleRestoreInput((e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <div id="restore-seed-status" class={restoreStatusClass}>{restoreStatus}</div>
        <div class="qr-actions">
          <button class="btn-primary" id="restore-confirm-btn" disabled={!restoreCanConfirm} onclick={confirmRestoreFromInput}>
            Restore Identity
          </button>
        </div>
      </div>

      <div class="restore-pane" id="restore-pane-scan" style={`display:${restoreTab === 'scan' ? '' : 'none'}`}>
        <div class="qr-video-container" id="restore-video-container" style={`display:${restoreVideoHidden ? 'none' : 'block'}`}>
          <video id="restore-video" class="qr-video" bind:this={restoreVideoEl}></video>
          <div class="qr-scan-overlay">
            <div class="qr-scan-frame"></div>
          </div>
        </div>
        <p class="qr-hint" id="restore-scan-status">{restoreScanStatus}</p>
      </div>
    </div>
  </div>
{/if}

{#if mode === 'seed-confirm' && pendingSeed}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal qr-modal">
      <div class="settings-header">
        <h2>Restore Identity?</h2>
        <button class="thread-close" id="qr-close" onclick={closeModal}>✕</button>
      </div>
      <div class="qr-content">
        <div class="seed-qr-warning" style="background:rgba(231,76,60,0.1); border-color:rgba(231,76,60,0.3);">
          ⚠️ This will <strong>replace your current identity</strong> on this device and reload the app.
          Any data not backed up by your current seed phrase will be lost.
        </div>
        <div class="seed-confirm-phrase">
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">Phrase to restore:</p>
          <code>{pendingSeed}</code>
        </div>
        <div class="qr-actions">
          <button class="btn-secondary" id="qr-cancel" onclick={closeModal}>Cancel</button>
          <button class="btn-primary" id="seed-restore-btn" style="background:var(--danger,#e74c3c);" onclick={() => {
            const phrase = pendingSeed;
            closeModal();
            callbacks.onSeedRestored?.(phrase);
          }}>
            Yes, Restore
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
