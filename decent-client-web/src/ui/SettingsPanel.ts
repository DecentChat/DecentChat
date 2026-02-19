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
};

export class SettingsPanel {
  private overlay: HTMLElement | null = null;

  constructor(
    private getSettings: () => Promise<AppSettings>,
    private saveSetting: (key: string, value: any) => Promise<void>,
    private onAction?: (action: string) => void,
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
              <label>Debug mode</label>
              <input type="checkbox" data-key="debug" ${settings.debug ? 'checked' : ''} />
            </div>
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
          // Generate new seed phrase
          this.onAction?.('generateSeed');
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
        }

        this.saveSetting(key, value);
        this.applySettingImmediately(key, value);
      });
    });
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
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
