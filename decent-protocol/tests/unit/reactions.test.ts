/**
 * Reaction Tests
 *
 * Covers the ReactionManager used in the DecentChat client.
 * Key bug: handleReactionEvent was passing notify=false, so received reactions
 * were stored in memory but onReactionsChanged was never called → DOM never updated.
 */

import { describe, test, expect, beforeEach } from 'bun:test';

// ── Inline the ReactionManager logic so tests stay in the protocol package ──
// This mirrors the exact logic in decent-client-web/src/ui/ReactionManager.ts

interface Reaction {
  emoji: string;
  userId: string;
  timestamp: number;
}

interface ReactionEvent {
  type: 'reaction';
  messageId: string;
  channelId: string;
  workspaceId?: string;
  emoji: string;
  userId: string;
  action: 'add' | 'remove';
}

class ReactionManager {
  private reactions = new Map<string, Reaction[]>();
  onReactionsChanged?: (messageId: string, reactions: Map<string, string[]>) => void;

  handleReactionEvent(event: ReactionEvent): void {
    if (event.action === 'add') {
      this.addReaction(event.messageId, event.emoji, event.userId);
    } else {
      this.removeReaction(event.messageId, event.emoji, event.userId);
    }
  }

  addReaction(messageId: string, emoji: string, userId: string, notify = true): ReactionEvent | null {
    if (!this.reactions.has(messageId)) this.reactions.set(messageId, []);
    const reactions = this.reactions.get(messageId)!;
    if (reactions.some(r => r.emoji === emoji && r.userId === userId)) return null;
    reactions.push({ emoji, userId, timestamp: Date.now() });
    if (notify) this.notifyChanged(messageId);
    return { type: 'reaction', messageId, channelId: '', emoji, userId, action: 'add' };
  }

  removeReaction(messageId: string, emoji: string, userId: string, notify = true): ReactionEvent | null {
    const reactions = this.reactions.get(messageId);
    if (!reactions) return null;
    const idx = reactions.findIndex(r => r.emoji === emoji && r.userId === userId);
    if (idx === -1) return null;
    reactions.splice(idx, 1);
    if (reactions.length === 0) this.reactions.delete(messageId);
    if (notify) this.notifyChanged(messageId);
    return { type: 'reaction', messageId, channelId: '', emoji, userId, action: 'remove' };
  }

  toggleReaction(messageId: string, emoji: string, userId: string): ReactionEvent | null {
    const reactions = this.reactions.get(messageId) || [];
    const existing = reactions.find(r => r.emoji === emoji && r.userId === userId);
    return existing
      ? this.removeReaction(messageId, emoji, userId)
      : this.addReaction(messageId, emoji, userId);
  }

  getReactions(messageId: string): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const r of this.reactions.get(messageId) || []) {
      if (!grouped.has(r.emoji)) grouped.set(r.emoji, []);
      grouped.get(r.emoji)!.push(r.userId);
    }
    return grouped;
  }

  getReactionCount(messageId: string): number {
    return this.reactions.get(messageId)?.length || 0;
  }

  private notifyChanged(messageId: string): void {
    this.onReactionsChanged?.(messageId, this.getReactions(messageId));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReactionManager — core behavior', () => {
  let rm: ReactionManager;

  beforeEach(() => {
    rm = new ReactionManager();
  });

  test('adds a reaction and returns an event', () => {
    const event = rm.addReaction('msg1', '👍', 'alice');
    expect(event).not.toBeNull();
    expect(event!.action).toBe('add');
    expect(event!.emoji).toBe('👍');
    expect(event!.userId).toBe('alice');
  });

  test('ignores duplicate reactions from the same user', () => {
    rm.addReaction('msg1', '👍', 'alice');
    const duplicate = rm.addReaction('msg1', '👍', 'alice');
    expect(duplicate).toBeNull(); // Duplicate → null
    expect(rm.getReactionCount('msg1')).toBe(1);
  });

  test('allows same emoji from different users', () => {
    rm.addReaction('msg1', '👍', 'alice');
    rm.addReaction('msg1', '👍', 'bob');
    const grouped = rm.getReactions('msg1');
    expect(grouped.get('👍')).toHaveLength(2);
    expect(grouped.get('👍')).toContain('alice');
    expect(grouped.get('👍')).toContain('bob');
  });

  test('removes a reaction', () => {
    rm.addReaction('msg1', '👍', 'alice');
    const event = rm.removeReaction('msg1', '👍', 'alice');
    expect(event).not.toBeNull();
    expect(event!.action).toBe('remove');
    expect(rm.getReactionCount('msg1')).toBe(0);
  });

  test('removeReaction returns null when reaction does not exist', () => {
    const event = rm.removeReaction('msg1', '👍', 'alice');
    expect(event).toBeNull();
  });

  test('toggleReaction adds when not present', () => {
    const event = rm.toggleReaction('msg1', '❤️', 'alice');
    expect(event?.action).toBe('add');
    expect(rm.getReactions('msg1').get('❤️')).toContain('alice');
  });

  test('toggleReaction removes when already present', () => {
    rm.addReaction('msg1', '❤️', 'alice');
    const event = rm.toggleReaction('msg1', '❤️', 'alice');
    expect(event?.action).toBe('remove');
    expect(rm.getReactions('msg1').get('❤️')).toBeUndefined();
  });

  test('groups reactions by emoji correctly', () => {
    rm.addReaction('msg1', '👍', 'alice');
    rm.addReaction('msg1', '👍', 'bob');
    rm.addReaction('msg1', '😂', 'carol');
    const grouped = rm.getReactions('msg1');
    expect(grouped.size).toBe(2);
    expect(grouped.get('👍')!.sort()).toEqual(['alice', 'bob'].sort());
    expect(grouped.get('😂')).toEqual(['carol']);
  });

  test('reactions are isolated per message', () => {
    rm.addReaction('msg1', '👍', 'alice');
    rm.addReaction('msg2', '❤️', 'bob');
    expect(rm.getReactions('msg1').has('❤️')).toBe(false);
    expect(rm.getReactions('msg2').has('👍')).toBe(false);
  });
});

describe('ReactionManager — onReactionsChanged callback (the bug fix)', () => {
  let rm: ReactionManager;
  let notifiedMessages: string[];

  beforeEach(() => {
    rm = new ReactionManager();
    notifiedMessages = [];
    rm.onReactionsChanged = (messageId) => {
      notifiedMessages.push(messageId);
    };
  });

  test('[BUG FIX] handleReactionEvent triggers onReactionsChanged', () => {
    // Before the fix: notify=false was passed, so this callback was never fired
    // for reactions received from peers.
    rm.handleReactionEvent({
      type: 'reaction',
      messageId: 'msg1',
      channelId: 'ch1',
      emoji: '👍',
      userId: 'bob',
      action: 'add',
    });

    expect(notifiedMessages).toContain('msg1'); // Must be called!
  });

  test('[BUG FIX] remove reaction from peer also triggers onReactionsChanged', () => {
    rm.addReaction('msg1', '👍', 'bob');
    notifiedMessages = []; // Reset after setup

    rm.handleReactionEvent({
      type: 'reaction',
      messageId: 'msg1',
      channelId: 'ch1',
      emoji: '👍',
      userId: 'bob',
      action: 'remove',
    });

    expect(notifiedMessages).toContain('msg1');
  });

  test('addReaction (own reaction) triggers onReactionsChanged', () => {
    rm.addReaction('msg1', '❤️', 'alice');
    expect(notifiedMessages).toContain('msg1');
  });

  test('removeReaction triggers onReactionsChanged', () => {
    rm.addReaction('msg1', '❤️', 'alice');
    notifiedMessages = []; // Reset

    rm.removeReaction('msg1', '❤️', 'alice');
    expect(notifiedMessages).toContain('msg1');
  });

  test('duplicate addReaction does NOT trigger onReactionsChanged', () => {
    rm.addReaction('msg1', '👍', 'alice');
    notifiedMessages = [];

    rm.addReaction('msg1', '👍', 'alice'); // Duplicate
    expect(notifiedMessages).toHaveLength(0); // No spurious notification
  });

  test('reactions contain correct data when callback fires', () => {
    let lastReactions: Map<string, string[]> | null = null;
    rm.onReactionsChanged = (_id, reactions) => { lastReactions = reactions; };

    rm.handleReactionEvent({
      type: 'reaction',
      messageId: 'msg1',
      channelId: 'ch1',
      emoji: '🎉',
      userId: 'bob',
      action: 'add',
    });

    expect(lastReactions).not.toBeNull();
    expect(lastReactions!.get('🎉')).toContain('bob');
  });
});

describe('ReactionManager — P2P sync scenario', () => {
  test('Alice and Bob reactions both appear after P2P exchange', () => {
    // Simulate Alice's ReactionManager receiving Bob's reaction
    const aliceRM = new ReactionManager();
    let aliceNotified = false;
    aliceRM.onReactionsChanged = () => { aliceNotified = true; };

    // Alice adds her own reaction (👍)
    aliceRM.addReaction('msg1', '👍', 'alice');

    // Bob's reaction event arrives from peer
    aliceRM.handleReactionEvent({
      type: 'reaction',
      messageId: 'msg1',
      channelId: 'ch1',
      emoji: '❤️',
      userId: 'bob',
      action: 'add',
    });

    const grouped = aliceRM.getReactions('msg1');
    expect(grouped.get('👍')).toContain('alice');
    expect(grouped.get('❤️')).toContain('bob'); // Bob's reaction is present
    expect(aliceNotified).toBe(true); // UI was told to re-render
  });

  test('same emoji from both peers shown with count=2', () => {
    const rm = new ReactionManager();
    rm.addReaction('msg1', '👍', 'alice'); // Alice reacts locally

    // Bob's 👍 arrives
    rm.handleReactionEvent({
      type: 'reaction', messageId: 'msg1', channelId: 'ch1',
      emoji: '👍', userId: 'bob', action: 'add',
    });

    const grouped = rm.getReactions('msg1');
    expect(grouped.get('👍')).toHaveLength(2); // Count should be 2
    expect(grouped.get('👍')).toContain('alice');
    expect(grouped.get('👍')).toContain('bob');
  });

  test('Bob removing his reaction updates Alice\'s view', () => {
    const rm = new ReactionManager();
    rm.addReaction('msg1', '👍', 'alice');
    rm.handleReactionEvent({
      type: 'reaction', messageId: 'msg1', channelId: 'ch1',
      emoji: '❤️', userId: 'bob', action: 'add',
    });

    // Bob removes his reaction
    rm.handleReactionEvent({
      type: 'reaction', messageId: 'msg1', channelId: 'ch1',
      emoji: '❤️', userId: 'bob', action: 'remove',
    });

    const grouped = rm.getReactions('msg1');
    expect(grouped.has('❤️')).toBe(false); // Bob's reaction gone
    expect(grouped.get('👍')).toContain('alice'); // Alice's stays
  });

  test('multiple peers reacting to different messages', () => {
    const rm = new ReactionManager();

    rm.handleReactionEvent({ type: 'reaction', messageId: 'msg1', channelId: 'ch1', emoji: '👍', userId: 'bob', action: 'add' });
    rm.handleReactionEvent({ type: 'reaction', messageId: 'msg2', channelId: 'ch1', emoji: '😂', userId: 'carol', action: 'add' });
    rm.handleReactionEvent({ type: 'reaction', messageId: 'msg1', channelId: 'ch1', emoji: '🎉', userId: 'dave', action: 'add' });

    const msg1 = rm.getReactions('msg1');
    const msg2 = rm.getReactions('msg2');

    expect(msg1.get('👍')).toContain('bob');
    expect(msg1.get('🎉')).toContain('dave');
    expect(msg1.has('😂')).toBe(false); // Carol's was on msg2

    expect(msg2.get('😂')).toContain('carol');
    expect(msg2.has('👍')).toBe(false);
  });

  test('handleReactionEvent with workspaceId field is accepted normally', () => {
    // workspaceId is validated by ChatController before calling this,
    // so ReactionManager itself just ignores it
    const rm = new ReactionManager();
    rm.handleReactionEvent({
      type: 'reaction',
      messageId: 'msg1',
      channelId: 'ch1',
      workspaceId: 'ws-abc',
      emoji: '👍',
      userId: 'bob',
      action: 'add',
    });
    expect(rm.getReactions('msg1').get('👍')).toContain('bob');
  });
});
