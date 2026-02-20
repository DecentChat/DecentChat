/**
 * StorageQuotaManager — monitors IndexedDB usage and prunes old messages when needed.
 *
 * Uses navigator.storage.estimate() to track storage usage.
 * When usage crosses a threshold, prunes the oldest messages (keeps last N per channel).
 *
 * Strategy:
 *   - > 70%: warn the user
 *   - > 85%: auto-prune (oldest messages first, per channel)
 */

export interface QuotaConfig {
  /** Warn when storage usage exceeds this fraction (default: 0.70 = 70%) */
  warnThreshold?: number;
  /** Auto-prune when storage usage exceeds this fraction (default: 0.85 = 85%) */
  pruneThreshold?: number;
  /** Messages to keep per channel after pruning (default: 500) */
  keepMessagesPerChannel?: number;
}

export interface QuotaStatus {
  /** Estimated bytes in use */
  usageBytes: number;
  /** Total quota available in bytes */
  quotaBytes: number;
  /** usageBytes / quotaBytes (0.0–1.0) */
  usageFraction: number;
  /** True when usageFraction > warnThreshold */
  isWarning: boolean;
  /** True when usageFraction > pruneThreshold */
  isPruneNeeded: boolean;
}

export interface PruneResult {
  /** Number of channels where old messages were removed */
  channelsPruned: number;
  /** Total messages deleted across all channels */
  messagesDeleted: number;
}

export class StorageQuotaManager {
  private readonly warnThreshold: number;
  private readonly pruneThreshold: number;
  private readonly keepMessagesPerChannel: number;

  constructor(config: QuotaConfig = {}) {
    this.warnThreshold = config.warnThreshold ?? 0.70;
    this.pruneThreshold = config.pruneThreshold ?? 0.85;
    this.keepMessagesPerChannel = config.keepMessagesPerChannel ?? 500;
  }

  /**
   * Check current storage usage via navigator.storage.estimate().
   * Returns a safe default (0/0 fractions) if the Storage API is unavailable.
   */
  async check(): Promise<QuotaStatus> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return {
        usageBytes: 0,
        quotaBytes: 0,
        usageFraction: 0,
        isWarning: false,
        isPruneNeeded: false,
      };
    }

    let estimate: StorageEstimate;
    try {
      estimate = await navigator.storage.estimate();
    } catch {
      return { usageBytes: 0, quotaBytes: 0, usageFraction: 0, isWarning: false, isPruneNeeded: false };
    }

    const usageBytes = estimate.usage ?? 0;
    const quotaBytes = estimate.quota ?? 0;
    const usageFraction = quotaBytes > 0 ? usageBytes / quotaBytes : 0;

    return {
      usageBytes,
      quotaBytes,
      usageFraction,
      isWarning: usageFraction > this.warnThreshold,
      isPruneNeeded: usageFraction > this.pruneThreshold,
    };
  }

  /**
   * Prune old messages across all workspaces.
   * For each channel, deletes the oldest messages, keeping the last `keepMessagesPerChannel`.
   *
   * @param persistentStore  PersistentStore instance (for message CRUD)
   * @param workspaceManager WorkspaceManager instance (for channel list)
   */
  async prune(persistentStore: any, workspaceManager: any): Promise<PruneResult> {
    let channelsPruned = 0;
    let messagesDeleted = 0;

    const workspaces: any[] = workspaceManager.getAllWorkspaces?.() ?? [];

    for (const workspace of workspaces) {
      const channels: any[] = workspace.channels ?? [];

      for (const channel of channels) {
        const channelId: string = channel.id;

        // Get message count first (cheap)
        const count: number = await persistentStore.getMessageCount(channelId);
        if (count <= this.keepMessagesPerChannel) continue;

        // Need to prune — fetch all messages for this channel
        const messages: any[] = await persistentStore.getChannelMessages(channelId);
        if (messages.length <= this.keepMessagesPerChannel) continue;

        // Sort oldest first (getChannelMessages already sorts by timestamp, but be safe)
        messages.sort((a: any, b: any) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

        // Delete oldest messages, keep the last N
        const toDelete = messages.slice(0, messages.length - this.keepMessagesPerChannel);
        const idsToDelete: string[] = toDelete.map((m: any) => m.id);

        await persistentStore.deleteMessages(idsToDelete);

        channelsPruned++;
        messagesDeleted += idsToDelete.length;

        console.log(
          `[StorageQuota] Pruned ${idsToDelete.length} messages from channel ${channelId.slice(0, 8)} ` +
          `(kept ${this.keepMessagesPerChannel} of ${messages.length})`,
        );
      }
    }

    return { channelsPruned, messagesDeleted };
  }

  /** Format bytes as human-readable string (e.g. "42.3 MB") */
  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i > 0 ? 1 : 0)} ${units[Math.min(i, units.length - 1)]}`;
  }
}
