/**
 * MessageSearch — Full-text search across messages
 * Client-side, no server. Searches local message store.
 */

import type { MessageStore } from 'decent-protocol';
import type { PlaintextMessage } from 'decent-protocol';

export interface SearchResult {
  message: PlaintextMessage;
  channelId: string;
  /** Matched text with highlight markers */
  highlight: string;
  /** Relevance score */
  score: number;
}

export class MessageSearch {
  constructor(private messageStore: MessageStore) {}

  /**
   * Search messages across all channels or a specific channel
   */
  search(query: string, options?: {
    channelId?: string;
    limit?: number;
    senderId?: string;
    before?: number;
    after?: number;
  }): SearchResult[] {
    const limit = options?.limit ?? 50;
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return [];

    const results: SearchResult[] = [];
    const channels = options?.channelId
      ? [options.channelId]
      : this.messageStore.getAllChannelIds();

    for (const channelId of channels) {
      const messages = this.messageStore.getMessages(channelId);

      for (const msg of messages) {
        // Filter by sender
        if (options?.senderId && msg.senderId !== options.senderId) continue;
        // Filter by time
        if (options?.before && msg.timestamp > options.before) continue;
        if (options?.after && msg.timestamp < options.after) continue;

        const content = msg.content.toLowerCase();
        let score = 0;
        let allMatch = true;

        for (const term of terms) {
          const idx = content.indexOf(term);
          if (idx === -1) {
            allMatch = false;
            break;
          }
          score += 1;
          // Bonus for exact word match
          if (idx === 0 || content[idx - 1] === ' ') score += 0.5;
          // Bonus for longer match
          score += term.length * 0.1;
        }

        if (!allMatch) continue;

        // Recency bonus
        const ageHours = (Date.now() - msg.timestamp) / 3600000;
        score += Math.max(0, 1 - ageHours / 720); // Decay over 30 days

        const highlight = this.highlightMatches(msg.content, terms);

        results.push({ message: msg, channelId, highlight, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Highlight search terms in text
   */
  private highlightMatches(text: string, terms: string[]): string {
    let result = text;
    for (const term of terms) {
      const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
      result = result.replace(regex, '**$1**');
    }
    // Truncate long results
    if (result.length > 200) {
      // Find first match and show context around it
      const firstTerm = terms[0].toLowerCase();
      const idx = text.toLowerCase().indexOf(firstTerm);
      const start = Math.max(0, idx - 60);
      const end = Math.min(text.length, idx + 140);
      result = (start > 0 ? '...' : '') + result.slice(start, end) + (end < text.length ? '...' : '');
    }
    return result;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
