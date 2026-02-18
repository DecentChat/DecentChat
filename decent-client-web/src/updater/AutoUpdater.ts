/**
 * AutoUpdater — Hot reload in dev, git pull in production
 * 
 * Development mode (Vite):
 *   - Vite HMR handles everything automatically
 *   - This class is mostly a no-op in dev
 * 
 * Production mode (built PWA):
 *   - Checks for updates via version.json endpoint
 *   - Uses Service Worker to cache and update
 *   - Shows "Update available" toast
 *   - User clicks → reload with new version
 * 
 * Self-hosted / git mode:
 *   - Checks git remote for new commits
 *   - Pulls + rebuilds automatically
 *   - Reloads client
 */

export interface UpdateInfo {
  version: string;
  buildTime: string;
  commitHash?: string;
  changelog?: string;
}

export interface AutoUpdaterConfig {
  /** Check interval in ms (default: 5 minutes) */
  checkIntervalMs?: number;
  /** URL to check for version info */
  versionUrl?: string;
  /** Auto-apply updates without asking */
  autoApply?: boolean;
  /** Callback when update is available */
  onUpdateAvailable?: (info: UpdateInfo) => void;
}

export class AutoUpdater {
  private config: Required<AutoUpdaterConfig>;
  private currentVersion: string;
  private checkInterval: any = null;
  private updateAvailable = false;

  constructor(currentVersion: string, config: AutoUpdaterConfig = {}) {
    this.currentVersion = currentVersion;
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 5 * 60 * 1000,
      versionUrl: config.versionUrl ?? '/version.json',
      autoApply: config.autoApply ?? false,
      onUpdateAvailable: config.onUpdateAvailable ?? (() => {}),
    };
  }

  /**
   * Start checking for updates
   */
  start(): void {
    this.check(); // Check immediately
    this.checkInterval = setInterval(() => this.check(), this.config.checkIntervalMs);
  }

  /**
   * Stop checking for updates
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check for updates now
   */
  async check(): Promise<UpdateInfo | null> {
    try {
      const response = await fetch(this.config.versionUrl, {
        cache: 'no-cache',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) return null;
      const info: UpdateInfo = await response.json();

      if (info.version !== this.currentVersion) {
        this.updateAvailable = true;
        this.config.onUpdateAvailable(info);

        if (this.config.autoApply) {
          this.apply();
        }

        return info;
      }

      return null;
    } catch {
      // Offline or version endpoint not available — that's fine
      return null;
    }
  }

  /**
   * Apply update (reload the page)
   */
  apply(): void {
    // If service worker is registered, tell it to skip waiting
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    }

    // Reload the page
    window.location.reload();
  }

  /**
   * Check if an update is available
   */
  isUpdateAvailable(): boolean {
    return this.updateAvailable;
  }

  /**
   * Get current version
   */
  getVersion(): string {
    return this.currentVersion;
  }
}

/**
 * Register service worker update listener
 * Shows toast when new SW is ready
 */
export function registerSWUpdateListener(onUpdate: () => void): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    onUpdate();
  });

  // Listen for new service worker installing
  navigator.serviceWorker.getRegistration().then(reg => {
    if (!reg) return;

    // If there's already a waiting worker, notify immediately
    if (reg.waiting) {
      onUpdate();
      return;
    }

    // Watch for new workers
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New content available
          onUpdate();
        }
      });
    });
  });
}
