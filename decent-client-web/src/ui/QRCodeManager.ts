/**
 * QRCodeManager — QR code generation and scanning for contact sharing.
 *
 * "Show My QR" displays the user's identity as a scannable QR code.
 * "Scan QR" opens the camera to scan a contact's QR code.
 */

import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import { ContactURI } from 'decent-protocol';
import type { ContactURIData } from 'decent-protocol';

export interface QRCallbacks {
  /** Called when a contact is scanned and confirmed by the user */
  onContactScanned: (data: ContactURIData) => void;
  /** Show a toast notification */
  showToast: (message: string, type?: 'info' | 'error' | 'success') => void;
}

export class QRCodeManager {
  private overlay: HTMLElement | null = null;
  private qrScanner: QrScanner | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private callbacks: QRCallbacks) {}

  /**
   * Show the "My QR Code" modal — displays user's identity as a QR code.
   */
  async showMyQR(data: {
    publicKey: string;
    displayName: string;
    peerId: string;
  }): Promise<void> {
    this.close();

    const uri = ContactURI.encode({
      publicKey: data.publicKey,
      displayName: data.displayName,
      peerId: data.peerId,
    });

    // Generate QR code as data URL
    let qrDataUrl: string;
    try {
      qrDataUrl = await QRCode.toDataURL(uri, {
        width: 280,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    } catch (err) {
      this.callbacks.showToast('Failed to generate QR code', 'error');
      return;
    }

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.innerHTML = `
      <div class="modal qr-modal">
        <div class="settings-header">
          <h2>My QR Code</h2>
          <button class="thread-close" id="qr-close">✕</button>
        </div>
        <div class="qr-content">
          <div class="qr-image-container">
            <img src="${qrDataUrl}" alt="QR Code" class="qr-image" />
          </div>
          <p class="qr-name">${this.escapeHtml(data.displayName)}</p>
          <p class="qr-hint">Scan this code to add me as a contact</p>
          <div class="qr-uri-container">
            <code class="qr-uri" id="qr-uri-text">${this.escapeHtml(uri)}</code>
            <button class="btn-secondary qr-copy-btn" id="qr-copy-btn">Copy</button>
          </div>
          <div class="qr-actions">
            <button class="btn-primary" id="qr-switch-scan">Scan a QR Code</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.bindCloseHandlers();

    // Copy button
    this.overlay.querySelector('#qr-copy-btn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(uri).catch(() => {
        this.callbacks.showToast('Failed to copy — try selecting the text manually', 'error');
      });
      this.callbacks.showToast('Contact URI copied!', 'success');
    });

    // Switch to scan mode
    this.overlay.querySelector('#qr-switch-scan')?.addEventListener('click', () => {
      this.showScanQR();
    });
  }

  /**
   * Show the "Scan QR Code" modal — opens camera to scan a contact's QR.
   */
  async showScanQR(): Promise<void> {
    this.close();

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.innerHTML = `
      <div class="modal qr-modal qr-scan-modal">
        <div class="settings-header">
          <h2>Scan QR Code</h2>
          <button class="thread-close" id="qr-close">✕</button>
        </div>
        <div class="qr-content">
          <div class="qr-video-container" id="qr-video-container">
            <video id="qr-video" class="qr-video"></video>
            <div class="qr-scan-overlay">
              <div class="qr-scan-frame"></div>
            </div>
          </div>
          <p class="qr-hint" id="qr-scan-status">Point your camera at a DecentChat QR code</p>
          <div class="qr-actions">
            <button class="btn-secondary" id="qr-paste-btn">Paste URI instead</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.bindCloseHandlers();

    // Paste fallback
    this.overlay.querySelector('#qr-paste-btn')?.addEventListener('click', () => {
      this.showPasteInput();
    });

    // Start camera scanner
    const video = this.overlay.querySelector('#qr-video') as HTMLVideoElement;
    if (!video) return;

    try {
      this.qrScanner = new QrScanner(
        video,
        (result) => this.handleScanResult(result.data),
        {
          preferredCamera: 'environment',
          highlightScanRegion: false,
          highlightCodeOutline: false,
        },
      );
      await this.qrScanner.start();
    } catch (err) {
      const status = this.overlay?.querySelector('#qr-scan-status');
      if (status) {
        status.textContent = 'Camera not available — paste a URI instead';
      }
      // Hide video container on camera failure
      const container = this.overlay?.querySelector('#qr-video-container') as HTMLElement;
      if (container) container.style.display = 'none';
    }
  }

  /**
   * Handle a scanned QR code result.
   */
  private handleScanResult(data: string): void {
    // Stop scanning
    this.qrScanner?.stop();

    if (!ContactURI.isValid(data)) {
      const status = this.overlay?.querySelector('#qr-scan-status');
      if (status) {
        status.textContent = 'Not a valid DecentChat QR code. Try again.';
        status.classList.add('qr-error');
      }
      // Resume scanning after a pause
      setTimeout(() => {
        if (status) {
          status.textContent = 'Point your camera at a DecentChat QR code';
          status.classList.remove('qr-error');
        }
        this.qrScanner?.start();
      }, 2000);
      return;
    }

    const contactData = ContactURI.decode(data);
    this.showContactConfirmation(contactData);
  }

  /**
   * Show confirmation dialog before adding a scanned contact.
   */
  private showContactConfirmation(data: ContactURIData): void {
    this.close();

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.innerHTML = `
      <div class="modal qr-modal">
        <div class="settings-header">
          <h2>Add Contact</h2>
          <button class="thread-close" id="qr-close">✕</button>
        </div>
        <div class="qr-content">
          <div class="qr-contact-card">
            <div class="qr-contact-avatar" style="background: ${this.peerColor(data.publicKey)}">
              ${this.escapeHtml(data.displayName.slice(0, 2).toUpperCase())}
            </div>
            <div class="qr-contact-info">
              <span class="qr-contact-name">${this.escapeHtml(data.displayName)}</span>
              ${data.peerId ? `<code class="qr-contact-peer">${this.escapeHtml(data.peerId.slice(0, 16))}...</code>` : ''}
            </div>
          </div>
          <div class="qr-actions">
            <button class="btn-secondary" id="qr-cancel">Cancel</button>
            <button class="btn-primary" id="qr-confirm">Add Contact</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.bindCloseHandlers();

    this.overlay.querySelector('#qr-cancel')?.addEventListener('click', () => this.close());
    this.overlay.querySelector('#qr-confirm')?.addEventListener('click', () => {
      this.callbacks.onContactScanned(data);
      this.close();
      this.callbacks.showToast(`Added ${data.displayName} as a contact!`, 'success');
    });
  }

  /**
   * Show paste input as fallback when camera is not available.
   */
  private showPasteInput(): void {
    this.close();

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.innerHTML = `
      <div class="modal qr-modal">
        <div class="settings-header">
          <h2>Add Contact</h2>
          <button class="thread-close" id="qr-close">✕</button>
        </div>
        <div class="qr-content">
          <div class="form-group">
            <label>Paste Contact URI</label>
            <input type="text" id="qr-paste-input" placeholder="decent://contact?pub=...&name=..." style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg-secondary); color:var(--text); font-size:14px; font-family:monospace;" />
            <small style="color:var(--text-muted); margin-top:4px; display:block;">
              Ask your contact to share their URI from the "My QR Code" screen
            </small>
          </div>
          <div class="qr-actions">
            <button class="btn-secondary" id="qr-cancel">Cancel</button>
            <button class="btn-primary" id="qr-paste-confirm">Add Contact</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.bindCloseHandlers();

    const input = this.overlay.querySelector('#qr-paste-input') as HTMLInputElement;
    setTimeout(() => input?.focus(), 50);

    this.overlay.querySelector('#qr-cancel')?.addEventListener('click', () => this.close());
    this.overlay.querySelector('#qr-paste-confirm')?.addEventListener('click', () => {
      const uri = input?.value.trim();
      if (!uri) return;

      if (!ContactURI.isValid(uri)) {
        this.callbacks.showToast('Invalid contact URI', 'error');
        return;
      }

      const contactData = ContactURI.decode(uri);
      this.showContactConfirmation(contactData);
    });

    // Allow Enter to submit
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        (this.overlay?.querySelector('#qr-paste-confirm') as HTMLButtonElement)?.click();
      }
    });
  }

  /**
   * Close and clean up any open QR modal.
   */
  close(): void {
    this.qrScanner?.stop();
    this.qrScanner?.destroy();
    this.qrScanner = null;
    this.overlay?.remove();
    this.overlay = null;
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
  }

  private bindCloseHandlers(): void {
    if (!this.overlay) return;

    this.overlay.querySelector('#qr-close')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', this.escHandler);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private peerColor(key: string): string {
    const colors = [
      '#e01e5a', '#2eb67d', '#ecb22e', '#36c5f0',
      '#611f69', '#1264a3', '#e57373', '#4fc3f7',
    ];
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }
}
