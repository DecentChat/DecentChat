/**
 * PresenceManager — Typing indicators + online presence
 *
 * Ephemeral state — NOT stored, NOT in hash chain.
 * Sent as lightweight P2P signals.
 */

export interface PresenceState {
  peerId: string;
  typing: boolean;
  lastSeen: number;
  online: boolean;
}

export interface PresenceSubscriptionScope {
  workspaceId: string;
  channelId: string;
}

export interface PresenceAggregateSnapshot {
  workspaceId: string;
  onlineCount: number;
  awayCount?: number;
  activeChannelId?: string;
  updatedAt: number;
}

export interface PresencePeerSlice {
  peerId: string;
  status: 'online' | 'away' | 'offline';
  lastSeen?: number;
  typing?: boolean;
}

export interface PresencePageResponse {
  type: 'presence-page-response';
  workspaceId: string;
  channelId: string;
  pageSize: number;
  cursor?: string;
  nextCursor?: string;
  peers: PresencePeerSlice[];
  updatedAt: number;
}

export interface PresencePageScopeSnapshot {
  workspaceId: string;
  channelId: string;
  loadedPeerCount: number;
  onlinePeerCount: number;
  loadedPageCount: number;
  hasMore: boolean;
  nextCursor?: string;
  updatedAt: number;
  pageSize: number;
}

export interface TypingEvent {
  type: 'typing';
  channelId: string;
  peerId: string;
  typing: boolean;
  workspaceId?: string;
}

export interface ReadReceipt {
  type: 'read-receipt';
  channelId: string;
  messageId: string;
  peerId: string;
  timestamp: number;
}

/** Typing indicator timeout (stop showing after 3s of no update) */
const TYPING_TIMEOUT_MS = 3000;
/** How often to send typing updates */
const TYPING_THROTTLE_MS = 2000;

interface PresenceScopePageState {
  peerIds: Set<string>;
  seenCursorKeys: Set<string>;
  loadedPageCount: number;
  nextCursor?: string;
  updatedAt: number;
  pageSize: number;
}

export class PresenceManager {
  /** Who's currently typing in each scope: (workspaceId+channelId) → peerId → expiry */
  private typingState = new Map<string, Map<string, number>>();
  /** Last time we sent a typing event */
  private lastTypingSent = 0;
  /** Read receipts: channelId → peerId → last read messageId */
  private readReceipts = new Map<string, Map<string, string>>();
  /** Scoped presence subscriptions: (workspaceId+channelId) -> subscribed peerIds */
  private subscriptionsByScope = new Map<string, Set<string>>();
  /** Reverse index for fast unsubscribe/cleanup on disconnect */
  private scopeByPeerId = new Map<string, string>();
  /** Local currently-viewed subscription scope */
  private activeScope: PresenceSubscriptionScope | null = null;
  /** Latest aggregate snapshot per workspace */
  private aggregatesByWorkspace = new Map<string, PresenceAggregateSnapshot>();
  /** Sparse peer presence pages merged per workspace */
  private peerPresenceByWorkspace = new Map<string, Map<string, PresenceState>>();
  /** Scope-level page snapshots for requester-side cursor advancement */
  private pageStateByScope = new Map<string, PresenceScopePageState>();
  /** Callbacks */
  onTypingChanged?: (channelId: string, typingPeers: string[], workspaceId?: string) => void;
  onReadReceiptChanged?: (channelId: string, peerId: string, messageId: string) => void;
  onAggregateChanged?: (workspaceId: string, aggregate: PresenceAggregateSnapshot) => void;
  /** Timer for cleanup */
  private cleanupInterval: any;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 1000);
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.typingState.clear();
    this.readReceipts.clear();
    this.subscriptionsByScope.clear();
    this.scopeByPeerId.clear();
    this.aggregatesByWorkspace.clear();
    this.peerPresenceByWorkspace.clear();
    this.pageStateByScope.clear();
    this.activeScope = null;
  }

  /**
   * Handle incoming typing event from a peer
   */
  handleTypingEvent(event: TypingEvent): void {
    const scopeKey = this.buildScopeKey(event.channelId, event.workspaceId);
    if (!this.typingState.has(scopeKey)) {
      this.typingState.set(scopeKey, new Map());
    }
    const channelTyping = this.typingState.get(scopeKey)!;

    if (event.typing) {
      channelTyping.set(event.peerId, Date.now() + TYPING_TIMEOUT_MS);
    } else {
      channelTyping.delete(event.peerId);
    }

    this.notifyTypingChanged(event.channelId, event.workspaceId);
  }

  /**
   * Handle incoming read receipt
   */
  handleReadReceipt(receipt: ReadReceipt): void {
    if (!this.readReceipts.has(receipt.channelId)) {
      this.readReceipts.set(receipt.channelId, new Map());
    }
    this.readReceipts.get(receipt.channelId)!.set(receipt.peerId, receipt.messageId);
    this.onReadReceiptChanged?.(receipt.channelId, receipt.peerId, receipt.messageId);
  }

  /**
   * Keep track of the local active subscription scope and return transition actions.
   */
  setActiveScope(
    workspaceId: string | null,
    channelId: string | null,
  ): { subscribe?: PresenceSubscriptionScope; unsubscribe?: PresenceSubscriptionScope } {
    const next = workspaceId && channelId ? { workspaceId, channelId } : null;
    const prev = this.activeScope;

    if (prev && next && prev.workspaceId === next.workspaceId && prev.channelId === next.channelId) {
      return {};
    }

    this.activeScope = next;
    return {
      unsubscribe: prev || undefined,
      subscribe: next || undefined,
    };
  }

  getActiveScope(): PresenceSubscriptionScope | null {
    return this.activeScope ? { ...this.activeScope } : null;
  }

  /**
   * Track remote peer subscriptions for a specific scope.
   */
  trackPeerSubscription(peerId: string, workspaceId: string, channelId: string): boolean {
    const scopeKey = this.buildScopeKey(channelId, workspaceId);
    const existingScope = this.scopeByPeerId.get(peerId);

    if (existingScope === scopeKey) return false;

    if (existingScope) {
      const previousSet = this.subscriptionsByScope.get(existingScope);
      previousSet?.delete(peerId);
      if (previousSet && previousSet.size === 0) {
        this.subscriptionsByScope.delete(existingScope);
      }
    }

    let scopeSet = this.subscriptionsByScope.get(scopeKey);
    if (!scopeSet) {
      scopeSet = new Set<string>();
      this.subscriptionsByScope.set(scopeKey, scopeSet);
    }

    scopeSet.add(peerId);
    this.scopeByPeerId.set(peerId, scopeKey);
    return true;
  }

  untrackPeerSubscription(peerId: string, workspaceId?: string, channelId?: string): boolean {
    const expectedScope = workspaceId && channelId ? this.buildScopeKey(channelId, workspaceId) : undefined;
    const currentScope = this.scopeByPeerId.get(peerId);
    if (!currentScope) return false;
    if (expectedScope && expectedScope !== currentScope) return false;

    const scopeSet = this.subscriptionsByScope.get(currentScope);
    scopeSet?.delete(peerId);
    if (scopeSet && scopeSet.size === 0) {
      this.subscriptionsByScope.delete(currentScope);
    }

    this.scopeByPeerId.delete(peerId);
    return true;
  }

  clearPeerSubscriptions(peerId: string): void {
    this.untrackPeerSubscription(peerId);
  }

  getSubscribedPeers(workspaceId: string, channelId: string): string[] {
    return Array.from(this.subscriptionsByScope.get(this.buildScopeKey(channelId, workspaceId)) ?? []);
  }

  /**
   * Merge newest aggregate snapshot for a workspace.
   * Older snapshots are ignored.
   */
  handlePresenceAggregate(aggregate: PresenceAggregateSnapshot): void {
    const current = this.aggregatesByWorkspace.get(aggregate.workspaceId);
    if (current && current.updatedAt > aggregate.updatedAt) return;

    this.aggregatesByWorkspace.set(aggregate.workspaceId, { ...aggregate });
    this.onAggregateChanged?.(aggregate.workspaceId, { ...aggregate });
  }

  getPresenceAggregate(workspaceId: string): PresenceAggregateSnapshot | undefined {
    const aggregate = this.aggregatesByWorkspace.get(workspaceId);
    return aggregate ? { ...aggregate } : undefined;
  }

  handlePresencePageResponse(page: PresencePageResponse): void {
    if (!this.peerPresenceByWorkspace.has(page.workspaceId)) {
      this.peerPresenceByWorkspace.set(page.workspaceId, new Map());
    }

    const scopeKey = this.buildScopeKey(page.channelId, page.workspaceId);
    const isRootPage = !page.cursor;
    let scopeState = this.pageStateByScope.get(scopeKey);

    if (!scopeState || (isRootPage && page.updatedAt >= scopeState.updatedAt)) {
      scopeState = {
        peerIds: new Set<string>(),
        seenCursorKeys: new Set<string>(),
        loadedPageCount: 0,
        nextCursor: undefined,
        updatedAt: 0,
        pageSize: page.pageSize,
      };
      this.pageStateByScope.set(scopeKey, scopeState);
    }

    const cursorKey = page.cursor || '__root__';
    if (!scopeState.seenCursorKeys.has(cursorKey)) {
      scopeState.seenCursorKeys.add(cursorKey);
      scopeState.loadedPageCount += 1;
    }

    const workspacePresence = this.peerPresenceByWorkspace.get(page.workspaceId)!;
    for (const peer of page.peers ?? []) {
      scopeState.peerIds.add(peer.peerId);
      workspacePresence.set(peer.peerId, {
        peerId: peer.peerId,
        typing: peer.typing === true,
        online: peer.status === 'online',
        lastSeen: peer.lastSeen ?? page.updatedAt,
      });
    }

    scopeState.nextCursor = page.nextCursor;
    scopeState.updatedAt = Math.max(scopeState.updatedAt, page.updatedAt);
    scopeState.pageSize = page.pageSize || scopeState.pageSize;
  }

  getPeerPresence(workspaceId: string, peerId: string): PresenceState | undefined {
    return this.peerPresenceByWorkspace.get(workspaceId)?.get(peerId);
  }

  getPresencePageSnapshot(workspaceId: string, channelId: string): PresencePageScopeSnapshot | undefined {
    const scopeState = this.pageStateByScope.get(this.buildScopeKey(channelId, workspaceId));
    if (!scopeState) return undefined;

    const workspacePresence = this.peerPresenceByWorkspace.get(workspaceId);
    let onlinePeerCount = 0;
    for (const peerId of scopeState.peerIds) {
      if (workspacePresence?.get(peerId)?.online) onlinePeerCount += 1;
    }

    return {
      workspaceId,
      channelId,
      loadedPeerCount: scopeState.peerIds.size,
      onlinePeerCount,
      loadedPageCount: scopeState.loadedPageCount,
      hasMore: Boolean(scopeState.nextCursor),
      nextCursor: scopeState.nextCursor,
      updatedAt: scopeState.updatedAt,
      pageSize: scopeState.pageSize,
    };
  }

  resetPresencePageSnapshot(workspaceId: string, channelId: string): void {
    this.pageStateByScope.delete(this.buildScopeKey(channelId, workspaceId));
  }

  /**
   * Create a typing event to send to peers (throttled)
   */
  createTypingEvent(channelId: string, peerId: string, workspaceId?: string): TypingEvent | null {
    const now = Date.now();
    if (now - this.lastTypingSent < TYPING_THROTTLE_MS) return null;
    this.lastTypingSent = now;
    return { type: 'typing', channelId, peerId, typing: true, workspaceId };
  }

  /**
   * Create a stop-typing event
   */
  createStopTypingEvent(channelId: string, peerId: string, workspaceId?: string): TypingEvent {
    return { type: 'typing', channelId, peerId, typing: false, workspaceId };
  }

  /**
   * Create a read receipt
   */
  createReadReceipt(channelId: string, messageId: string, peerId: string): ReadReceipt {
    return { type: 'read-receipt', channelId, messageId, peerId, timestamp: Date.now() };
  }

  /**
   * Get currently typing peers for a channel scope
   */
  getTypingPeers(channelId: string, workspaceId?: string): string[] {
    const channelTyping = this.typingState.get(this.buildScopeKey(channelId, workspaceId));
    if (!channelTyping) return [];

    const now = Date.now();
    const active: string[] = [];
    for (const [peerId, expiry] of channelTyping) {
      if (expiry > now) active.push(peerId);
    }
    return active;
  }

  /**
   * Get last read message for a peer in a channel
   */
  getLastRead(channelId: string, peerId: string): string | undefined {
    return this.readReceipts.get(channelId)?.get(peerId);
  }

  /**
   * Format typing indicator text
   */
  formatTypingText(typingPeers: string[], getAlias: (peerId: string) => string): string {
    if (typingPeers.length === 0) return '';
    if (typingPeers.length === 1) return `${getAlias(typingPeers[0])} is typing...`;
    if (typingPeers.length === 2) return `${getAlias(typingPeers[0])} and ${getAlias(typingPeers[1])} are typing...`;
    return `${typingPeers.length} people are typing...`;
  }

  // === Internal ===

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [scopeKey, channelTyping] of this.typingState) {
      let changed = false;
      for (const [peerId, expiry] of channelTyping) {
        if (expiry <= now) {
          channelTyping.delete(peerId);
          changed = true;
        }
      }

      if (!changed) continue;
      const scope = this.parseScopeKey(scopeKey);
      this.notifyTypingChanged(scope.channelId, scope.workspaceId);
    }
  }

  private notifyTypingChanged(channelId: string, workspaceId?: string): void {
    const peers = this.getTypingPeers(channelId, workspaceId);
    this.onTypingChanged?.(channelId, peers, workspaceId);
  }

  private buildScopeKey(channelId: string, workspaceId?: string): string {
    return `${workspaceId || ''}::${channelId}`;
  }

  private parseScopeKey(scopeKey: string): { workspaceId?: string; channelId: string } {
    const separatorIndex = scopeKey.indexOf('::');
    if (separatorIndex < 0) return { channelId: scopeKey };

    const workspaceId = scopeKey.slice(0, separatorIndex);
    const channelId = scopeKey.slice(separatorIndex + 2);
    return {
      workspaceId: workspaceId || undefined,
      channelId,
    };
  }
}
