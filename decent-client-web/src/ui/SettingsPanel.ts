/**
 * SettingsPanel — User preferences UI
 */

export interface AppSettings {
  myPeerId?: string;
  myAlias?: string;
  /** ID of active workspace (used to show/hide workspace-specific settings) */
  activeWorkspaceId?: string;
  /** Per-workspace display name override */
  workspaceAlias?: string;
  /** BIP39 seed phrase for identity derivation */
  seedPhrase?: string;
  theme?: 'auto' | 'light' | 'dark';
  notifications?: boolean;
  notificationSound?: boolean;
  compactMode?: boolean;
  fontSize?: 'small' | 'medium' | 'large';
  autoDownloadImages?: boolean;
  autoDownloadVoice?: boolean;
  autoDownloadVideo?: boolean;
  autoDownloadFiles?: boolean;
  mediaRetentionDays?: number;
  showTimestamps?: boolean;
  use24HourTime?: boolean;
  showReadReceipts?: boolean;
  showTypingIndicators?: boolean;
  debug?: boolean;
  showLiveReconnectActivity?: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'auto',
  notifications: true,
  notificationSound: true,
  compactMode: false,
  fontSize: 'medium',
  autoDownloadImages: true,
  autoDownloadVoice: true,
  autoDownloadVideo: false,
  autoDownloadFiles: false,
  mediaRetentionDays: 30,
  showTimestamps: true,
  use24HourTime: false,
  showReadReceipts: true,
  showTypingIndicators: true,
  debug: false,
  showLiveReconnectActivity: false,
};

export class SettingsPanel {
  private overlay: HTMLElement | null = null;

  constructor(
    private getSettings: () => Promise<AppSettings>,
    private saveSetting: (key: string, value: any) => Promise<void>,
    private onAction?: (action: string) => void | Promise<void>,
  ) {}

  async show(): Promise<void> {
    this.close();
    const settings = { ...DEFAULT_SETTINGS, ...await this.getSettings() };

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.innerHTML = `
      <div class="modal settings-modal">
        <div class="settings-header">
          <h2>⚙️ Settings</h2>
          <button class="thread-close" id="settings-close">✕</button>
        </div>
        <div class="settings-body">
          <div class="settings-section">
            <h3>Identity</h3>
            <div class="setting-row">
              <label>Peer ID</label>
              <code style="font-size:12px; color:var(--text-muted); user-select:all">${settings.myPeerId || 'N/A'}</code>
            </div>
            <div class="setting-row">
              <label>Global display name</label>
              <input type="text" data-key="myAlias" value="${settings.myAlias || ''}" placeholder="Your name" style="width:160px; padding:4px 8px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-secondary); color:var(--text); font-size:13px;" />
            </div>
            ${settings.activeWorkspaceId ? `
            <div class="setting-row">
              <label>Name in this workspace</label>
              <input type="text" data-key="workspaceAlias" value="${settings.workspaceAlias || ''}" placeholder="${settings.myAlias || 'Same as global'}" style="width:160px; padding:4px 8px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-secondary); color:var(--text); font-size:13px;" />
            </div>
            ` : ''}
            <div class="setting-row">
              <label>Seed Phrase</label>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button class="btn-secondary" id="seed-phrase-btn" style="font-size:12px; padding:4px 12px;">
                  ${settings.seedPhrase ? '👁️ Show' : '🔑 Generate'}
                </button>
                ${settings.seedPhrase ? `<button class="btn-secondary" id="seed-transfer-btn" style="font-size:12px; padding:4px 12px;" title="Transfer identity to another device via QR code">📲 Transfer</button>` : ''}
              </div>
            </div>
            <div id="seed-phrase-display" style="display:none; margin-top:8px; padding:12px; background:var(--bg-secondary); border-radius:var(--radius); font-family:monospace; font-size:13px; word-spacing:4px; line-height:1.8; user-select:all;"></div>
          </div>

          <div class="settings-section">
            <h3>Appearance</h3>
            <div class="setting-row">
              <label>Theme</label>
              <select data-key="theme">
                <option value="auto" ${settings.theme === 'auto' ? 'selected' : ''}>System</option>
                <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option>
                <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark</option>
              </select>
            </div>
            <div class="setting-row">
              <label>Font size</label>
              <select data-key="fontSize">
                <option value="small" ${settings.fontSize === 'small' ? 'selected' : ''}>Small</option>
                <option value="medium" ${settings.fontSize === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="large" ${settings.fontSize === 'large' ? 'selected' : ''}>Large</option>
              </select>
            </div>
            <div class="setting-row">
              <label>Compact mode</label>
              <input type="checkbox" data-key="compactMode" ${settings.compactMode ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <label>Show timestamps</label>
              <input type="checkbox" data-key="showTimestamps" ${settings.showTimestamps ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <label>24-hour time</label>
              <input type="checkbox" data-key="use24HourTime" ${settings.use24HourTime ? 'checked' : ''} />
            </div>
          </div>

          <div class="settings-section">
            <h3>Notifications</h3>
            <div class="setting-row">
              <label>Desktop notifications</label>
              <input type="checkbox" data-key="notifications" ${settings.notifications ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <label>Notification sounds</label>
              <input type="checkbox" data-key="notificationSound" ${settings.notificationSound ? 'checked' : ''} />
            </div>
          </div>

          <div class="settings-section">
            <h3>Privacy</h3>
            <div class="setting-row">
              <label>Show typing indicators</label>
              <input type="checkbox" data-key="showTypingIndicators" ${settings.showTypingIndicators ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <label>Send read receipts</label>
              <input type="checkbox" data-key="showReadReceipts" ${settings.showReadReceipts ? 'checked' : ''} />
            </div>
          </div>

          <div class="settings-section">
            <h3>Media & Storage</h3>
            <div class="setting-row">
              <label>Auto-download images</label>
              <input type="checkbox" data-key="autoDownloadImages" ${settings.autoDownloadImages ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <label>Auto-download voice</label>
              <input type="checkbox" data-key="autoDownloadVoice" ${settings.autoDownloadVoice ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <label>Auto-download video</label>
              <input type="checkbox" data-key="autoDownloadVideo" ${settings.autoDownloadVideo ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <label>Keep media for (days)</label>
              <input type="number" data-key="mediaRetentionDays" value="${settings.mediaRetentionDays}" min="1" max="365" style="width:80px" />
            </div>
          </div>

          <div class="settings-section">
            <h3>Advanced</h3>
            <div class="setting-row">
              <label>Show live reconnect activity</label>
              <input type="checkbox" data-key="showLiveReconnectActivity" ${settings.showLiveReconnectActivity ? 'checked' : ''} />
            </div>
            <div class="setting-row">
              <label>Debug mode</label>
              <input type="checkbox" data-key="debug" ${settings.debug ? 'checked' : ''} />
            </div>
          </div>

          <div class="settings-section" style="border:2px solid #e74c3c; border-radius:var(--radius); padding:16px; margin-top:12px;">
            <h3 style="color:#e74c3c; margin-top:0;">⚠️ Danger Zone</h3>
            <p style="font-size:13px; color:var(--text-muted); margin:0 0 12px 0;">
              These actions are irreversible. Proceed with caution.
            </p>
            <button id="danger-clear-all-btn" style="padding:10px 20px; background:#e74c3c; color:#fff; border:none; border-radius:var(--radius-sm); cursor:pointer; font-size:14px; font-weight:600;">
              Clear All Data &amp; Start Fresh
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // Close handlers
    this.overlay.querySelector('#settings-close')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Seed phrase button
    const seedBtn = this.overlay.querySelector('#seed-phrase-btn') as HTMLButtonElement;
    const seedDisplay = this.overlay.querySelector('#seed-phrase-display') as HTMLDivElement;
    if (seedBtn) {
      seedBtn.addEventListener('click', async () => {
        if (settings.seedPhrase) {
          // Toggle show/hide
          if (seedDisplay.style.display === 'none') {
            seedDisplay.textContent = settings.seedPhrase;
            seedDisplay.style.display = 'block';
            seedBtn.textContent = '🙈 Hide';
          } else {
            seedDisplay.style.display = 'none';
            seedBtn.textContent = '👁️ Show';
          }
        } else {
          // Generate new seed phrase (await so the seed is persisted before we read it back)
          await this.onAction?.('generateSeed');
          const newSettings = await this.getSettings();
          if (newSettings.seedPhrase) {
            settings.seedPhrase = newSettings.seedPhrase;
            seedDisplay.textContent = newSettings.seedPhrase;
            seedDisplay.style.display = 'block';
            seedBtn.textContent = '🙈 Hide';
          }
        }
      });
    }

    // Transfer button — opens seed QR for device transfer
    const transferBtn = this.overlay.querySelector('#seed-transfer-btn') as HTMLButtonElement | null;
    if (transferBtn) {
      transferBtn.addEventListener('click', () => {
        this.onAction?.('seed-transfer');
      });
    }

    // Danger Zone — Clear All Data
    const dangerBtn = this.overlay.querySelector('#danger-clear-all-btn') as HTMLButtonElement | null;
    if (dangerBtn) {
      dangerBtn.addEventListener('click', () => this.showClearAllConfirmation());
    }

    // Auto-save on change
    this.overlay.querySelectorAll('[data-key]').forEach(el => {
      el.addEventListener('change', () => {
        const key = (el as HTMLElement).dataset.key!;
        let value: any;

        if (el instanceof HTMLInputElement && el.type === 'checkbox') {
          value = el.checked;
        } else if (el instanceof HTMLInputElement && el.type === 'number') {
          value = parseInt(el.value) || 30;
        } else if (el instanceof HTMLSelectElement) {
          value = el.value;
        } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          value = el.value.trim();
        }

        if (value === undefined) return;
        this.saveSetting(key, value);
        this.applySettingImmediately(key, value);
      });
    });

    // (bot bridge removed — OpenClaw connects as a native P2P peer)
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  /**
   * Show confirmation dialog for clearing all data
   */
  private showClearAllConfirmation(): void {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.style.zIndex = '10001';
    dialog.innerHTML = `
      <div class="modal" style="max-width:440px; padding:24px;">
        <h2 style="color:#e74c3c; margin:0 0 12px 0;">⚠️ Delete Everything?</h2>
        <p style="font-size:14px; line-height:1.6; margin:0 0 8px 0;">
          This will <strong>permanently delete</strong> all your:
        </p>
        <ul style="font-size:13px; line-height:1.8; margin:0 0 16px 0; padding-left:20px; color:var(--text-muted);">
          <li>Messages and chat history</li>
          <li>Channels and workspaces</li>
          <li>Contacts and peer connections</li>
          <li>Your identity and seed phrase</li>
          <li>All cached data and service workers</li>
        </ul>
        <p style="font-size:13px; color:var(--text-muted); margin:0 0 16px 0;">
          You will need to create a new identity to use DecentChat again.
        </p>
        <div style="margin-bottom:16px;">
          <label style="font-size:13px; font-weight:600; display:block; margin-bottom:6px;">
            Type <code style="background:var(--bg-secondary); padding:2px 6px; border-radius:3px;">DELETE</code> to confirm:
          </label>
          <input id="danger-confirm-input" type="text" autocomplete="off" spellcheck="false"
            style="width:100%; padding:8px 12px; border:2px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-secondary); color:var(--text); font-size:14px; font-family:monospace; box-sizing:border-box;"
            placeholder="Type DELETE here" />
        </div>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button id="danger-cancel-btn" style="padding:8px 20px; background:var(--bg-secondary); color:var(--text); border:1px solid var(--border); border-radius:var(--radius-sm); cursor:pointer; font-size:14px;">
            Cancel
          </button>
          <button id="danger-confirm-btn" disabled
            style="padding:8px 20px; background:#999; color:#fff; border:none; border-radius:var(--radius-sm); cursor:not-allowed; font-size:14px; font-weight:600;">
            I understand, delete everything
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const input = dialog.querySelector('#danger-confirm-input') as HTMLInputElement;
    const confirmBtn = dialog.querySelector('#danger-confirm-btn') as HTMLButtonElement;
    const cancelBtn = dialog.querySelector('#danger-cancel-btn') as HTMLButtonElement;

    // Enable confirm button only when user types DELETE
    input.addEventListener('input', () => {
      const match = input.value.trim() === 'DELETE';
      confirmBtn.disabled = !match;
      confirmBtn.style.background = match ? '#e74c3c' : '#999';
      confirmBtn.style.cursor = match ? 'pointer' : 'not-allowed';
    });

    cancelBtn.addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });

    confirmBtn.addEventListener('click', async () => {
      if (input.value.trim() !== 'DELETE') return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Clearing...';
      await SettingsPanel.clearAllData();
    });

    input.focus();
  }

  /**
   * Nuclear option: wipe IndexedDB, localStorage, sessionStorage, caches, service workers, then reload.
   */
  private static async clearAllData(): Promise<void> {
    try {
      // Clear IndexedDB
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }

      // Clear localStorage & sessionStorage
      localStorage.clear();
      sessionStorage.clear();

      // Unregister service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }

      // Clear Cache API
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
      }

      // Reload page
      location.reload();
    } catch (err) {
      alert('Failed to clear data: ' + (err as Error).message);
    }
  }

  /**
   * Apply setting that has immediate visual effect
   */
  private async applySettingImmediately(key: string, value: any): Promise<void> {
    if (key === 'notifications' && value === true) {
      // Request notification permission when user enables notifications
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    }
    
    if (key === 'theme') {
      if (value === 'auto') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', value);
      }
    }
    if (key === 'fontSize') {
      const sizes = { small: '13px', medium: '15px', large: '17px' };
      document.body.style.fontSize = sizes[value as keyof typeof sizes] || '15px';
    }
    if (key === 'compactMode') {
      document.body.classList.toggle('compact', value);
    }
    if (key === 'showLiveReconnectActivity') {
      document.body.classList.toggle('show-reconnect-activity', value);
    }
    if (key === 'debug') {
      document.body.classList.toggle('debug-mode', value);
      if (value) {
        console.log('[DecentChat] Debug mode enabled');
        (window as any).__DECENT_DEBUG = true;
      } else {
        (window as any).__DECENT_DEBUG = false;
      }
    }
  }
}
