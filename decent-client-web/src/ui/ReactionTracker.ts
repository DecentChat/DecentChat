/**
 * ReactionTracker — Manages frequent/recent emoji reaction tracking.
 * Extracted from UIRenderer for reuse in Svelte components.
 */

import { QUICK_REACTIONS } from './ReactionManager';

export class ReactionTracker {
  private myPeerId: string;
  private reactionUsage: Record<string, number>;
  private frequentReactions: string[];

  constructor(myPeerId: string) {
    this.myPeerId = myPeerId;
    this.reactionUsage = this.loadReactionUsage();
    this.frequentReactions = this.loadFrequentReactions();
  }

  reload(myPeerId?: string): void {
    if (myPeerId) this.myPeerId = myPeerId;
    this.reactionUsage = this.loadReactionUsage();
    this.frequentReactions = this.loadFrequentReactions();
  }

  getFrequentReactions(): string[] {
    if (!this.frequentReactions.length) {
      this.frequentReactions = this.loadFrequentReactions();
    }
    return this.frequentReactions.slice(0, 3);
  }

  rememberReaction(emoji: string): void {
    if (!emoji) return;
    this.reactionUsage[emoji] = (this.reactionUsage[emoji] || 0) + 1;
    this.saveReactionUsage();

    const ranked = Object.entries(this.reactionUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([e]) => e);

    for (const fallback of [...this.frequentReactions, ...QUICK_REACTIONS]) {
      if (!ranked.includes(fallback)) ranked.push(fallback);
      if (ranked.length >= 3) break;
    }

    this.frequentReactions = ranked.slice(0, 3);
    this.saveFrequentReactions();
  }

  private frequentReactionsKey(): string {
    return `decentchat:frequentReactions:${this.myPeerId || 'anon'}`;
  }

  private reactionUsageKey(): string {
    return `decentchat:reactionUsage:${this.myPeerId || 'anon'}`;
  }

  private loadReactionUsage(): Record<string, number> {
    try {
      const raw = localStorage.getItem(this.reactionUsageKey());
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const normalized: Record<string, number> = {};
        for (const [emoji, count] of Object.entries(parsed || {})) {
          if (typeof emoji === 'string' && emoji.length > 0 && typeof count === 'number' && count > 0) {
            normalized[emoji] = Math.floor(count);
          }
        }
        return normalized;
      }
    } catch {}
    return {};
  }

  private saveReactionUsage(): void {
    try {
      localStorage.setItem(this.reactionUsageKey(), JSON.stringify(this.reactionUsage));
    } catch {}
  }

  private loadFrequentReactions(): string[] {
    const fromUsage = Object.entries(this.reactionUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji]) => emoji);
    if (fromUsage.length > 0) {
      for (const fallback of QUICK_REACTIONS) {
        if (!fromUsage.includes(fallback)) fromUsage.push(fallback);
        if (fromUsage.length >= 3) break;
      }
      return fromUsage.slice(0, 3);
    }

    try {
      const raw = localStorage.getItem(this.frequentReactionsKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const normalized = parsed.filter((e: unknown) => typeof e === 'string' && (e as string).length > 0);
          if (normalized.length > 0) return normalized.slice(0, 3);
        }
      }
    } catch {}

    return QUICK_REACTIONS.slice(0, 3);
  }

  private saveFrequentReactions(): void {
    try {
      localStorage.setItem(this.frequentReactionsKey(), JSON.stringify(this.frequentReactions.slice(0, 3)));
    } catch {}
  }
}
