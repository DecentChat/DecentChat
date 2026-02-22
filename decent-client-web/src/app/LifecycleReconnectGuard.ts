type AddRemoveTarget = {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

type VisibilityTarget = AddRemoveTarget & {
  visibilityState?: string;
};

export interface LifecycleReconnectGuardDeps {
  windowTarget: AddRemoveTarget;
  documentTarget: VisibilityTarget;
  getExpectedPeers: () => number;
  getConnectedPeers: () => number;
  runPeerMaintenanceNow: (reason: string) => number;
  reinitializeTransportIfStuck: (reason: string) => Promise<boolean>;
  isOnline?: () => boolean;
}

export interface LifecycleReconnectGuardConfig {
  debounceMs?: number;
  initGraceMs?: number;
  initForceRecheckMs?: number;
  reinitBackoffMs?: number[];
}

const DEFAULT_BACKOFF_MS = [0, 4_000, 10_000, 20_000, 30_000];

export class LifecycleReconnectGuard {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private initGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private initForceTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectRun = 0;
  private reconnecting = false;
  private reinitAttempt = 0;
  private nextAllowedReinitAt = 0;
  private started = false;

  private readonly debounceMs: number;
  private readonly initGraceMs: number;
  private readonly initForceRecheckMs: number;
  private readonly reinitBackoffMs: number[];

  private readonly onPageshow = (event: Event) => {
    const persisted = !!(event as PageTransitionEvent).persisted;
    this.scheduleCheck('pageshow', persisted);
  };

  private readonly onVisibilityChange = () => {
    if (this.deps.documentTarget.visibilityState === 'visible') {
      this.scheduleCheck('visibility-visible');
    }
  };

  private readonly onOnline = () => {
    this.scheduleCheck('online');
  };

  private readonly onOffline = () => {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  };

  constructor(
    private readonly deps: LifecycleReconnectGuardDeps,
    config: LifecycleReconnectGuardConfig = {},
  ) {
    this.debounceMs = config.debounceMs ?? 1_200;
    this.initGraceMs = config.initGraceMs ?? 3_500;
    this.initForceRecheckMs = config.initForceRecheckMs ?? 12_000;
    this.reinitBackoffMs = config.reinitBackoffMs ?? DEFAULT_BACKOFF_MS;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.deps.windowTarget.addEventListener('pageshow', this.onPageshow);
    this.deps.documentTarget.addEventListener('visibilitychange', this.onVisibilityChange);
    this.deps.windowTarget.addEventListener('online', this.onOnline);
    this.deps.windowTarget.addEventListener('offline', this.onOffline);

    this.initGraceTimer = setTimeout(() => {
      this.scheduleCheck('startup-grace');
    }, this.initGraceMs);
    this.initForceTimer = setTimeout(() => {
      this.scheduleCheck('startup-force', true);
    }, this.initForceRecheckMs);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.deps.windowTarget.removeEventListener('pageshow', this.onPageshow);
    this.deps.documentTarget.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.deps.windowTarget.removeEventListener('online', this.onOnline);
    this.deps.windowTarget.removeEventListener('offline', this.onOffline);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.initGraceTimer) {
      clearTimeout(this.initGraceTimer);
      this.initGraceTimer = null;
    }
    if (this.initForceTimer) {
      clearTimeout(this.initForceTimer);
      this.initForceTimer = null;
    }
  }

  scheduleCheck(reason: string, force = false): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runCheck(reason, force);
    }, this.debounceMs);
  }

  private async runCheck(reason: string, force: boolean): Promise<void> {
    if (this.reconnecting) return;

    const expectedPeers = this.deps.getExpectedPeers();
    const connectedPeers = this.deps.getConnectedPeers();

    if (connectedPeers > 0) {
      this.reinitAttempt = 0;
      this.nextAllowedReinitAt = 0;
      return;
    }
    if (!force && expectedPeers === 0) return;

    this.reconnecting = true;
    this.reconnectRun += 1;
    const tag = `${reason}#${this.reconnectRun}`;
    try {
      const attempted = this.deps.runPeerMaintenanceNow(tag);
      if (attempted > 0) return;

      const online = this.deps.isOnline ? this.deps.isOnline() : true;
      if (!online) return;

      const now = Date.now();
      if (!force && now < this.nextAllowedReinitAt) return;

      const didReinit = await this.deps.reinitializeTransportIfStuck(tag);
      if (!didReinit) return;

      const delay = this.reinitBackoffMs[
        Math.min(this.reinitAttempt, this.reinitBackoffMs.length - 1)
      ];
      this.reinitAttempt += 1;
      this.nextAllowedReinitAt = Date.now() + delay;
    } finally {
      this.reconnecting = false;
    }
  }
}
