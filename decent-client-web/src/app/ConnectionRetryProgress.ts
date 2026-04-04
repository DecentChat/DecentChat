/**
 * ConnectionRetryProgress — pure state machine for splash-screen retry feedback.
 *
 * Extracted from main.ts boot loop so the state transitions are unit-testable.
 * The caller provides callbacks for updating the loading hint and recording
 * whether the app fell through to offline mode.
 *
 * State transitions:
 *   attempt 0  → no hint change (happy path, avoid flicker)
 *   attempt N>0 → "Connecting to network… attempt N/totalAttempts"
 *   success     → hints stop, wentOffline = false
 *   exhausted   → "Offline mode — messages will sync when connected", wentOffline = true
 *
 * @see ALE-686
 */

export interface RetryProgressCallbacks {
  /** Update the splash-screen loading hint text. */
  setLoadingHint: (message: string) => void;
}

export interface RetryProgressResult {
  /** Whether the app exhausted all retries and entered offline mode. */
  wentOffline: boolean;
  /** All hint messages that were set, in order. */
  hints: string[];
}

export class ConnectionRetryProgress {
  private readonly totalAttempts: number;
  private readonly callbacks: RetryProgressCallbacks;
  private readonly hints: string[] = [];
  private _wentOffline = false;

  constructor(totalAttempts: number, callbacks: RetryProgressCallbacks) {
    if (totalAttempts < 1) throw new Error('totalAttempts must be >= 1');
    this.totalAttempts = totalAttempts;
    this.callbacks = callbacks;
  }

  /** Whether the app entered offline mode after exhausting retries. */
  get wentOffline(): boolean {
    return this._wentOffline;
  }

  /**
   * Called before each connection attempt.
   * On attempt 0 (first try), does nothing to keep the happy path clean.
   * On subsequent attempts, updates the loading hint with retry progress.
   */
  beforeAttempt(attempt: number): void {
    if (attempt > 0) {
      const msg = `Connecting to network\u2026 attempt ${attempt + 1}/${this.totalAttempts}`;
      this.callbacks.setLoadingHint(msg);
      this.hints.push(msg);
    }
  }

  /**
   * Called when a connection attempt succeeds.
   * Clears offline state — no further hints are shown.
   */
  onSuccess(): void {
    this._wentOffline = false;
  }

  /**
   * Called when all retry attempts have been exhausted.
   * Sets the loading hint to offline messaging and flags offline mode.
   */
  onExhausted(): void {
    const msg = 'Offline mode \u2014 messages will sync when connected';
    this.callbacks.setLoadingHint(msg);
    this.hints.push(msg);
    this._wentOffline = true;
  }

  /** Snapshot of all hints emitted so far (useful for testing). */
  getResult(): RetryProgressResult {
    return {
      wentOffline: this._wentOffline,
      hints: [...this.hints],
    };
  }
}
