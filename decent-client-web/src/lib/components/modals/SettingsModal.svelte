<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  export interface AppSettings {
    myPeerId?: string;
    myAlias?: string;
    activeWorkspaceId?: string;
    workspaceAlias?: string;
    seedPhrase?: string;
    deviceIndex?: number;
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

  export interface SettingsModalConfig {
    getSettings: () => Promise<AppSettings>;
    saveSetting: (key: string, value: any) => Promise<void>;
    onAction?: (action: string) => void | Promise<void>;
  }

  export async function showSettingsModal(config: SettingsModalConfig): Promise<void> {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const initial = { ...DEFAULT_SETTINGS, ...(await config.getSettings()) };

    let instance: Record<string, any> | null = null;
    const cleanup = () => {
      if (instance) {
        unmount(instance);
        instance = null;
      }
      target.remove();
    };

    instance = mount(SettingsModal, {
      target,
      props: {
        settings: initial,
        getSettings: config.getSettings,
        saveSetting: config.saveSetting,
        onAction: config.onAction,
        onClose: cleanup,
      },
    });
  }

  async function clearAllData(): Promise<void> {
    try {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }

      localStorage.clear();
      sessionStorage.clear();

      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
      }

      location.reload();
    } catch (err) {
      alert('Failed to clear data: ' + (err as Error).message);
    }
  }

  async function applySettingImmediately(key: string, value: any): Promise<void> {
    if (key === 'notifications' && value === true) {
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
      const enabled = value === true;
      document.body.classList.toggle('show-reconnect-activity', enabled);
      (window as any).__DECENT_SHOW_RECONNECT_ACTIVITY = enabled;
    }

    if (key === 'debug') {
      document.body.classList.toggle('debug-mode', value);
      (window as any).__DECENT_DEBUG = value === true;
    }
  }

  import SettingsModal from './SettingsModal.svelte';
</script>

<script lang="ts">
  import type { AppSettings } from './SettingsModal.svelte';

  interface Props {
    settings: AppSettings;
    getSettings: () => Promise<AppSettings>;
    saveSetting: (key: string, value: any) => Promise<void>;
    onAction?: (action: string) => void | Promise<void>;
    onClose: () => void;
  }

  let { settings: initialSettings, getSettings, saveSetting, onAction, onClose }: Props = $props();

  let settings = $state<AppSettings>({ ...initialSettings });
  let seedVisible = $state(false);
  let generatingSeed = $state(false);

  let showDangerConfirm = $state(false);
  let dangerInput = $state('');
  let dangerBusy = $state(false);

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDangerConfirm) {
          showDangerConfirm = false;
          dangerInput = '';
          return;
        }
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  async function persistSetting(key: string, value: any): Promise<void> {
    await saveSetting(key, value);
    await applySettingImmediately(key, value);
  }

  async function handleSeedPrimary(): Promise<void> {
    if (settings.seedPhrase) {
      seedVisible = !seedVisible;
      return;
    }

    generatingSeed = true;
    try {
      await onAction?.('generateSeed');
      const latest = await getSettings();
      if (latest.seedPhrase) {
        settings = { ...settings, seedPhrase: latest.seedPhrase };
        seedVisible = true;
      }
    } finally {
      generatingSeed = false;
    }
  }

  function handleOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  function handleDangerOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) {
      showDangerConfirm = false;
      dangerInput = '';
    }
  }

  async function confirmDangerClear(): Promise<void> {
    if (dangerInput.trim() !== 'DELETE' || dangerBusy) return;
    dangerBusy = true;
    await clearAllData();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleOverlayClick}>
  <div class="modal settings-modal">
    <div class="settings-header">
      <h2>⚙️ Settings</h2>
      <button class="thread-close" id="settings-close" onclick={onClose}>✕</button>
    </div>

    <div class="settings-body">
      <div class="settings-section">
        <h3>Identity</h3>

        <div class="setting-row">
          <span class="setting-label">Peer ID</span>
          <code style="font-size:12px; color:var(--text-muted); user-select:all">{settings.myPeerId || 'N/A'}</code>
        </div>

        <div class="setting-row">
          <label for="settings-my-alias">Global display name</label>
          <input
            id="settings-my-alias"
            type="text"
            data-key="myAlias"
            value={settings.myAlias || ''}
            placeholder="Your name"
            style="width:160px; padding:4px 8px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-secondary); color:var(--text); font-size:13px;"
            onchange={(e) => {
              const value = (e.currentTarget as HTMLInputElement).value.trim();
              settings = { ...settings, myAlias: value };
              void persistSetting('myAlias', value);
            }}
          />
        </div>

        {#if settings.activeWorkspaceId}
          <div class="setting-row">
            <label for="settings-workspace-alias">Name in this workspace</label>
            <input
              id="settings-workspace-alias"
              type="text"
              data-key="workspaceAlias"
              value={settings.workspaceAlias || ''}
              placeholder={settings.myAlias || 'Same as global'}
              style="width:160px; padding:4px 8px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-secondary); color:var(--text); font-size:13px;"
              onchange={(e) => {
                const value = (e.currentTarget as HTMLInputElement).value.trim();
                settings = { ...settings, workspaceAlias: value };
                void persistSetting('workspaceAlias', value);
              }}
            />
          </div>
        {/if}

        <div class="setting-row">
          <span class="setting-label">Seed phrase</span>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn-secondary" id="seed-phrase-btn" style="font-size:12px; padding:4px 12px;" onclick={handleSeedPrimary}>
              {#if generatingSeed}Generating...{:else if settings.seedPhrase}{seedVisible ? '🙈 Hide' : '👁️ Show'}{:else}🔑 Generate{/if}
            </button>

            {#if settings.seedPhrase}
              <button class="btn-secondary" id="seed-transfer-btn" style="font-size:12px; padding:4px 12px;" title="Transfer identity to another device via QR code" onclick={() => onAction?.('seed-transfer')}>
                📲 Transfer
              </button>
            {/if}
          </div>
        </div>

        <div id="seed-phrase-display" style={`display:${seedVisible ? 'block' : 'none'}; margin-top:8px; padding:12px; background:var(--bg-secondary); border-radius:var(--radius); font-family:monospace; font-size:13px; word-spacing:4px; line-height:1.8; user-select:all;`}>
          {settings.seedPhrase || ''}
        </div>

        <div class="setting-row">
          <span class="setting-label">Device index</span>
          <div style="display:flex; align-items:center; gap:8px;">
            <code style="font-size:12px; color:var(--text-muted);">{settings.deviceIndex ?? 0}</code>
            <span style="font-size:11px; color:var(--text-muted);">({(settings.deviceIndex ?? 0) === 0 ? 'primary device' : `device ${settings.deviceIndex ?? 0}`})</span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Appearance</h3>

        <div class="setting-row">
          <label for="settings-theme">Theme</label>
          <select id="settings-theme" data-key="theme" onchange={(e) => {
            const value = (e.currentTarget as HTMLSelectElement).value as AppSettings['theme'];
            settings = { ...settings, theme: value };
            void persistSetting('theme', value);
          }}>
            <option value="auto" selected={settings.theme === 'auto'}>System</option>
            <option value="light" selected={settings.theme === 'light'}>Light</option>
            <option value="dark" selected={settings.theme === 'dark'}>Dark</option>
          </select>
        </div>

        <div class="setting-row">
          <label for="settings-font-size">Font size</label>
          <select id="settings-font-size" data-key="fontSize" onchange={(e) => {
            const value = (e.currentTarget as HTMLSelectElement).value as AppSettings['fontSize'];
            settings = { ...settings, fontSize: value };
            void persistSetting('fontSize', value);
          }}>
            <option value="small" selected={settings.fontSize === 'small'}>Small</option>
            <option value="medium" selected={settings.fontSize === 'medium'}>Medium</option>
            <option value="large" selected={settings.fontSize === 'large'}>Large</option>
          </select>
        </div>

        <div class="setting-row">
          <label for="settings-compact-mode">Compact mode</label>
          <input id="settings-compact-mode" type="checkbox" data-key="compactMode" checked={!!settings.compactMode} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, compactMode: value };
            void persistSetting('compactMode', value);
          }} />
        </div>

        <div class="setting-row">
          <label for="settings-show-timestamps">Show timestamps</label>
          <input id="settings-show-timestamps" type="checkbox" data-key="showTimestamps" checked={!!settings.showTimestamps} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, showTimestamps: value };
            void persistSetting('showTimestamps', value);
          }} />
        </div>

        <div class="setting-row">
          <label for="settings-24-hour-time">24-hour time</label>
          <input id="settings-24-hour-time" type="checkbox" data-key="use24HourTime" checked={!!settings.use24HourTime} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, use24HourTime: value };
            void persistSetting('use24HourTime', value);
          }} />
        </div>
      </div>

      <div class="settings-section">
        <h3>Notifications</h3>
        <div class="setting-row">
          <label for="settings-notifications">Desktop notifications</label>
          <input id="settings-notifications" type="checkbox" data-key="notifications" checked={!!settings.notifications} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, notifications: value };
            void persistSetting('notifications', value);
          }} />
        </div>
        <div class="setting-row">
          <label for="settings-notification-sound">Notification sounds</label>
          <input id="settings-notification-sound" type="checkbox" data-key="notificationSound" checked={!!settings.notificationSound} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, notificationSound: value };
            void persistSetting('notificationSound', value);
          }} />
        </div>
      </div>

      <div class="settings-section">
        <h3>Privacy</h3>
        <div class="setting-row">
          <label for="settings-show-typing-indicators">Show typing indicators</label>
          <input id="settings-show-typing-indicators" type="checkbox" data-key="showTypingIndicators" checked={!!settings.showTypingIndicators} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, showTypingIndicators: value };
            void persistSetting('showTypingIndicators', value);
          }} />
        </div>
        <div class="setting-row">
          <label for="settings-show-read-receipts">Send read receipts</label>
          <input id="settings-show-read-receipts" type="checkbox" data-key="showReadReceipts" checked={!!settings.showReadReceipts} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, showReadReceipts: value };
            void persistSetting('showReadReceipts', value);
          }} />
        </div>
      </div>

      <div class="settings-section">
        <h3>Media &amp; Storage</h3>
        <div class="setting-row">
          <label for="settings-auto-download-images">Auto-download images</label>
          <input id="settings-auto-download-images" type="checkbox" data-key="autoDownloadImages" checked={!!settings.autoDownloadImages} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, autoDownloadImages: value };
            void persistSetting('autoDownloadImages', value);
          }} />
        </div>
        <div class="setting-row">
          <label for="settings-auto-download-voice">Auto-download voice</label>
          <input id="settings-auto-download-voice" type="checkbox" data-key="autoDownloadVoice" checked={!!settings.autoDownloadVoice} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, autoDownloadVoice: value };
            void persistSetting('autoDownloadVoice', value);
          }} />
        </div>
        <div class="setting-row">
          <label for="settings-auto-download-video">Auto-download video</label>
          <input id="settings-auto-download-video" type="checkbox" data-key="autoDownloadVideo" checked={!!settings.autoDownloadVideo} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, autoDownloadVideo: value };
            void persistSetting('autoDownloadVideo', value);
          }} />
        </div>
        <div class="setting-row">
          <label for="settings-media-retention-days">Keep media for (days)</label>
          <input
            id="settings-media-retention-days"
            type="number"
            data-key="mediaRetentionDays"
            value={settings.mediaRetentionDays ?? 30}
            min="1"
            max="365"
            style="width:80px"
            onchange={(e) => {
              const value = parseInt((e.currentTarget as HTMLInputElement).value, 10) || 30;
              settings = { ...settings, mediaRetentionDays: value };
              void persistSetting('mediaRetentionDays', value);
            }}
          />
        </div>
      </div>

      <div class="settings-section">
        <h3>Advanced</h3>
        <div class="setting-row">
          <label for="settings-show-live-reconnect-activity">Show live reconnect activity</label>
          <input id="settings-show-live-reconnect-activity" type="checkbox" data-key="showLiveReconnectActivity" checked={!!settings.showLiveReconnectActivity} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, showLiveReconnectActivity: value };
            void persistSetting('showLiveReconnectActivity', value);
          }} />
        </div>
        <div class="setting-row">
          <label for="settings-debug-mode">Debug mode</label>
          <input id="settings-debug-mode" type="checkbox" data-key="debug" checked={!!settings.debug} onchange={(e) => {
            const value = (e.currentTarget as HTMLInputElement).checked;
            settings = { ...settings, debug: value };
            void persistSetting('debug', value);
          }} />
        </div>
      </div>

      <div class="settings-section" style="border:2px solid #e74c3c; border-radius:var(--radius); padding:16px; margin-top:12px;">
        <h3 style="color:#e74c3c; margin-top:0;">⚠️ Danger Zone</h3>
        <p style="font-size:13px; color:var(--text-muted); margin:0 0 12px 0;">These actions are irreversible. Proceed with caution.</p>
        <button id="danger-clear-all-btn" style="padding:10px 20px; background:#e74c3c; color:#fff; border:none; border-radius:var(--radius-sm); cursor:pointer; font-size:14px; font-weight:600;" onclick={() => { showDangerConfirm = true; dangerInput = ''; }}>
          Clear All Data &amp; Start Fresh
        </button>
      </div>
    </div>
  </div>
</div>

{#if showDangerConfirm}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" style="z-index:10001" onclick={handleDangerOverlayClick}>
    <div class="modal" style="max-width:440px; padding:24px;">
      <h2 style="color:#e74c3c; margin:0 0 12px 0;">⚠️ Delete Everything?</h2>
      <p style="font-size:14px; line-height:1.6; margin:0 0 8px 0;">This will <strong>permanently delete</strong> all your:</p>
      <ul style="font-size:13px; line-height:1.8; margin:0 0 16px 0; padding-left:20px; color:var(--text-muted);">
        <li>Messages and chat history</li>
        <li>Channels and workspaces</li>
        <li>Contacts and peer connections</li>
        <li>Your identity and seed phrase</li>
        <li>All cached data and service workers</li>
      </ul>
      <p style="font-size:13px; color:var(--text-muted); margin:0 0 16px 0;">You will need to create a new identity to use DecentChat again.</p>
      <div style="margin-bottom:16px;">
        <label for="danger-confirm-input" style="font-size:13px; font-weight:600; display:block; margin-bottom:6px;">
          Type <code style="background:var(--bg-secondary); padding:2px 6px; border-radius:3px;">DELETE</code> to confirm:
        </label>
        <input
          id="danger-confirm-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          value={dangerInput}
          style="width:100%; padding:8px 12px; border:2px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-secondary); color:var(--text); font-size:14px; font-family:monospace; box-sizing:border-box;"
          placeholder="Type DELETE here"
          oninput={(e) => dangerInput = (e.currentTarget as HTMLInputElement).value}
        />
      </div>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button id="danger-cancel-btn" style="padding:8px 20px; background:var(--bg-secondary); color:var(--text); border:1px solid var(--border); border-radius:var(--radius-sm); cursor:pointer; font-size:14px;" onclick={() => { showDangerConfirm = false; dangerInput = ''; }}>
          Cancel
        </button>
        <button
          id="danger-confirm-btn"
          disabled={dangerInput.trim() !== 'DELETE' || dangerBusy}
          style={`padding:8px 20px; background:${dangerInput.trim() === 'DELETE' && !dangerBusy ? '#e74c3c' : '#999'}; color:#fff; border:none; border-radius:var(--radius-sm); cursor:${dangerInput.trim() === 'DELETE' && !dangerBusy ? 'pointer' : 'not-allowed'}; font-size:14px; font-weight:600;`}
          onclick={confirmDangerClear}
        >
          {dangerBusy ? 'Clearing...' : 'I understand, delete everything'}
        </button>
      </div>
    </div>
  </div>
{/if}
