/**
 * ReactionManager — Emoji reactions on messages
 * 
 * Reactions are synced via P2P but NOT part of the hash chain
 * (they're mutable — you can add/remove reactions).
 * They're synced as lightweight events similar to typing indicators.
 */

export interface Reaction {
  emoji: string;
  userId: string;
  timestamp: number;
}

export interface ReactionEvent {
  type: 'reaction';
  messageId: string;
  channelId: string;
  workspaceId?: string;
  emoji: string;
  userId: string;
  action: 'add' | 'remove';
}

/** Quick reaction emoji shown on message hover */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🎉', '🤔'];

export class ReactionManager {
  /** messageId → reactions[] */
  private reactions = new Map<string, Reaction[]>();
  /** Callback when reactions change */
  onReactionsChanged?: (messageId: string, reactions: Map<string, string[]>) => void;

  /**
   * Handle incoming reaction event from peer.
   * Always triggers onReactionsChanged so the DOM re-renders.
   */
  handleReactionEvent(event: ReactionEvent): void {
    if (event.action === 'add') {
      this.addReaction(event.messageId, event.emoji, event.userId); // notify=true (default)
    } else {
      this.removeReaction(event.messageId, event.emoji, event.userId); // notify=true (default)
    }
  }

  /**
   * Add a reaction
   */
  addReaction(messageId: string, emoji: string, userId: string, notify = true): ReactionEvent | null {
    if (!this.reactions.has(messageId)) {
      this.reactions.set(messageId, []);
    }
    const reactions = this.reactions.get(messageId)!;

    // Don't add duplicate
    if (reactions.some(r => r.emoji === emoji && r.userId === userId)) return null;

    reactions.push({ emoji, userId, timestamp: Date.now() });
    if (notify) this.notifyChanged(messageId);

    return {
      type: 'reaction',
      messageId,
      channelId: '', // Caller fills this in
      emoji,
      userId,
      action: 'add',
    };
  }

  /**
   * Remove a reaction
   */
  removeReaction(messageId: string, emoji: string, userId: string, notify = true): ReactionEvent | null {
    const reactions = this.reactions.get(messageId);
    if (!reactions) return null;

    const idx = reactions.findIndex(r => r.emoji === emoji && r.userId === userId);
    if (idx === -1) return null;

    reactions.splice(idx, 1);
    if (reactions.length === 0) this.reactions.delete(messageId);
    if (notify) this.notifyChanged(messageId);

    return {
      type: 'reaction',
      messageId,
      channelId: '',
      emoji,
      userId,
      action: 'remove',
    };
  }

  /**
   * Toggle a reaction (add if not present, remove if present)
   */
  toggleReaction(messageId: string, emoji: string, userId: string): ReactionEvent | null {
    const reactions = this.reactions.get(messageId) || [];
    const existing = reactions.find(r => r.emoji === emoji && r.userId === userId);

    if (existing) {
      return this.removeReaction(messageId, emoji, userId);
    } else {
      return this.addReaction(messageId, emoji, userId);
    }
  }

  /**
   * Get reactions for a message, grouped by emoji
   * Returns: Map<emoji, userId[]>
   */
  getReactions(messageId: string): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    const reactions = this.reactions.get(messageId) || [];

    for (const r of reactions) {
      if (!grouped.has(r.emoji)) grouped.set(r.emoji, []);
      grouped.get(r.emoji)!.push(r.userId);
    }

    return grouped;
  }

  /**
   * Get reaction count for a message
   */
  getReactionCount(messageId: string): number {
    return this.reactions.get(messageId)?.length || 0;
  }

  /**
   * Render reactions HTML for a message
   */
  renderReactions(messageId: string, myUserId: string): string {
    const grouped = this.getReactions(messageId);
    if (grouped.size === 0) return '';

    const pills = Array.from(grouped.entries()).map(([emoji, users]) => {
      const isMine = users.includes(myUserId);
      const count = users.length;
      return `<button class="reaction-pill${isMine ? ' mine' : ''}" data-msg-id="${messageId}" data-emoji="${emoji}" title="${users.join(', ')}">${emoji} ${count}</button>`;
    });

    return `<div class="reactions-row">${pills.join('')}</div>`;
  }

  private notifyChanged(messageId: string): void {
    this.onReactionsChanged?.(messageId, this.getReactions(messageId));
  }
}
