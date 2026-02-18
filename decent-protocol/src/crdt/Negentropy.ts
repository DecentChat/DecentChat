/**
 * Negentropy - Set reconciliation protocol
 * DEP-001 implementation
 *
 * Achieves O(differences) complexity instead of Merkle tree's O(log n).
 * Based on: https://github.com/hoytech/negentropy
 *
 * How it works:
 * 1. Split message set into ranges by timestamp/ID
 * 2. Each range gets a fingerprint (XOR of all item hashes)
 * 3. Recursively subdivide ranges where fingerprints differ
 * 4. Only transfer items in differing leaf ranges
 *
 * Example:
 *   Alice has messages 1-1000
 *   Bob has messages 1-995, 1001-1005
 *   
 *   Ranges: [1-500], [501-1000], [1001-1005]
 *   [1-500]: fingerprints match ✓ (skip)
 *   [501-1000]: fingerprints differ → subdivide
 *     [501-750]: match ✓
 *     [751-1000]: differ → subdivide
 *       [751-875]: match ✓
 *       [876-1000]: differ → subdivide
 *         [876-937]: match ✓
 *         [938-1000]: differ → transfer (5 messages: 996-1000)
 *   [1001-1005]: Alice doesn't have → Bob sends (5 messages)
 *
 * Result: 10 messages transferred instead of 1005
 */

export interface NegentropyItem {
  /** Unique identifier (message ID) */
  id: string;
  /** Timestamp (for ordering) */
  timestamp: number;
}

export interface NegentropyRange {
  /** Range start (inclusive, timestamp) */
  start: number;
  /** Range end (exclusive, timestamp) */
  end: number;
  /** XOR fingerprint of all items in range */
  fingerprint: string;
  /** Number of items in range */
  count: number;
}

export interface NegentropyQuery {
  ranges: NegentropyRange[];
}

export interface NegentropyResponse {
  /** Items initiator has but responder doesn't */
  have: string[];
  /** Items responder has but initiator doesn't */
  need: string[];
  /** If non-empty, initiator should send another query with these ranges */
  continueWith?: NegentropyRange[];
}

/** Minimum items per range before subdivision (tunable) */
const MIN_RANGE_SIZE = 16;

/** Maximum recursion depth (prevent infinite loops) */
const MAX_DEPTH = 20;

export class Negentropy {
  private items: NegentropyItem[] = [];
  private itemMap: Map<string, NegentropyItem> = new Map();

  /**
   * Build Negentropy state from items
   */
  async build(items: NegentropyItem[]): Promise<void> {
    // Sort by timestamp (stable ordering is crucial)
    this.items = [...items].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id); // Tie-break by ID
    });

    this.itemMap = new Map(this.items.map(item => [item.id, item]));
  }

  /**
   * Create initial query (full range)
   */
  async createQuery(): Promise<NegentropyQuery> {
    if (this.items.length === 0) {
      return { ranges: [] };
    }

    const start = this.items[0].timestamp;
    const end = this.items[this.items.length - 1].timestamp + 1;

    const fingerprint = await this.fingerprintRange(start, end);

    return {
      ranges: [{
        start,
        end,
        fingerprint,
        count: this.items.length,
      }],
    };
  }

  /**
   * Process a query and generate response
   * 
   * When processing a query from the initiator:
   * 1. If query is empty (initiator has nothing), send ALL our items
   * 2. Compare fingerprints for each range
   * 3. If fingerprints match → skip (ranges are identical)
   * 4. If fingerprints differ and range is small → send our items
   * 5. If fingerprints differ and range is large → subdivide and send back sub-ranges
   * 6. IMPORTANT: Also send items we have OUTSIDE the query ranges (items remote doesn't know about)
   * 
   * Returns:
   * - have: message IDs that responder has (for initiator to check)
   * - need: Always empty in this implementation (initiator figures out what they need)
   * - continueWith: Sub-ranges for initiator to query next
   */
  async processQuery(query: NegentropyQuery): Promise<NegentropyResponse> {
    const have: Set<string> = new Set();
    const continueWith: NegentropyRange[] = [];

    // Special case: empty query means remote has nothing, send everything
    if (query.ranges.length === 0) {
      for (const item of this.items) {
        have.add(item.id);
      }
      return { have: Array.from(have), need: [], continueWith: undefined };
    }

    // Track all ranges covered by the query
    const queriedRanges: Array<[number, number]> = [];

    for (const remoteRange of query.ranges) {
      queriedRanges.push([remoteRange.start, remoteRange.end]);

      const localItems = this.getItemsInRange(remoteRange.start, remoteRange.end);
      const localFingerprint = await this.fingerprintItems(localItems);

      // Fingerprints match → ranges are identical
      if (localFingerprint === remoteRange.fingerprint) {
        continue;
      }

      // If range is small enough, send all our items in this range
      if (localItems.length <= MIN_RANGE_SIZE && remoteRange.count <= MIN_RANGE_SIZE) {
        for (const item of localItems) {
          have.add(item.id);
        }
        continue;
      }

      // Range is too large → subdivide
      const midpoint = Math.floor((remoteRange.start + remoteRange.end) / 2);

      const leftItems = this.getItemsInRange(remoteRange.start, midpoint);
      const rightItems = this.getItemsInRange(midpoint, remoteRange.end);

      if (leftItems.length > 0) {
        const leftFingerprint = await this.fingerprintItems(leftItems);
        continueWith.push({
          start: remoteRange.start,
          end: midpoint,
          fingerprint: leftFingerprint,
          count: leftItems.length,
        });
      }

      if (rightItems.length > 0) {
        const rightFingerprint = await this.fingerprintItems(rightItems);
        continueWith.push({
          start: midpoint,
          end: remoteRange.end,
          fingerprint: rightFingerprint,
          count: rightItems.length,
        });
      }
    }

    // Also send items we have that are OUTSIDE the queried ranges
    // (items the remote doesn't even know to ask about)
    if (queriedRanges.length > 0) {
      const minQueried = Math.min(...queriedRanges.map(r => r[0]));
      const maxQueried = Math.max(...queriedRanges.map(r => r[1]));

      // Items before the first queried range
      const beforeItems = this.items.filter(item => item.timestamp < minQueried);
      for (const item of beforeItems) {
        have.add(item.id);
      }

      // Items after the last queried range
      const afterItems = this.items.filter(item => item.timestamp >= maxQueried);
      for (const item of afterItems) {
        have.add(item.id);
      }
    }

    return {
      have: Array.from(have),
      need: [], // Initiator determines what they need based on 'have'
      continueWith: continueWith.length > 0 ? continueWith : undefined
    };
  }

  /**
   * Reconcile with a remote peer (finds what WE need)
   * 
   * This is a ONE-WAY reconciliation where we (initiator) query the remote
   * to find out what items they have that we're missing.
   * 
   * For BIDIRECTIONAL sync, run this from both sides:
   * - Alice runs reconcile() against Bob → gets what Alice needs
   * - Bob runs reconcile() against Alice → gets what Bob needs
   * 
   * Returns: { need } where need = message IDs remote has that we don't have
   */
  async reconcile(
    remoteProcessQuery: (query: NegentropyQuery) => Promise<NegentropyResponse>,
    maxRounds: number = MAX_DEPTH
  ): Promise<{ need: string[] }> {
    let query = await this.createQuery();
    const allNeed: Set<string> = new Set();
    const localIds = new Set(this.items.map(item => item.id));

    for (let round = 0; round < maxRounds; round++) {
      const response = await remoteProcessQuery(query);

      // Check which items remote has that we don't
      for (const id of response.have) {
        if (!localIds.has(id)) {
          allNeed.add(id);
        }
      }

      if (!response.continueWith || response.continueWith.length === 0) {
        break;
      }

      query = { ranges: response.continueWith };
    }

    return {
      need: Array.from(allNeed),
    };
  }

  /**
   * Get items in timestamp range [start, end)
   */
  private getItemsInRange(start: number, end: number): NegentropyItem[] {
    return this.items.filter(item => item.timestamp >= start && item.timestamp < end);
  }

  /**
   * Compute fingerprint for a range
   */
  private async fingerprintRange(start: number, end: number): Promise<string> {
    const items = this.getItemsInRange(start, end);
    return this.fingerprintItems(items);
  }

  /**
   * Compute fingerprint for items (XOR of hashes)
   */
  private async fingerprintItems(items: NegentropyItem[]): Promise<string> {
    if (items.length === 0) return '0'.repeat(64); // Empty fingerprint

    // XOR all item hashes together
    let xor = new Uint8Array(32);

    for (const item of items) {
      const hash = await this.hashItem(item);
      for (let i = 0; i < 32; i++) {
        xor[i] ^= hash[i];
      }
    }

    // Convert to hex
    return Array.from(xor).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Hash a single item
   */
  private async hashItem(item: NegentropyItem): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${item.id}:${item.timestamp}`);
    const buffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(buffer);
  }

  /**
   * Get item by ID
   */
  getItem(id: string): NegentropyItem | undefined {
    return this.itemMap.get(id);
  }

  /**
   * Get all items
   */
  getItems(): NegentropyItem[] {
    return [...this.items];
  }

  /**
   * Get item count
   */
  size(): number {
    return this.items.length;
  }
}
