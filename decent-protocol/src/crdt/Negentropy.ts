/**
 * Negentropy - set reconciliation primitive.
 *
 * This implementation follows the upstream negentropy strategy:
 * - Canonical item ordering
 * - Range fingerprint comparison
 * - Recursive partitioning of divergent ranges
 * - Enumeration when ranges are small
 */

export interface NegentropyItem {
  id: string;
  timestamp: number;
}

/**
 * Ordered-key range [start, end), where null denotes an open bound.
 */
export interface NegentropyRange {
  start: string | null;
  end: string | null;
  fingerprint: string;
  count: number;
}

export interface NegentropyQuery {
  ranges: NegentropyRange[];
}

export interface NegentropyResponse {
  /** IDs that responder has in mismatching/enumerated ranges. */
  have: string[];
  /** Reserved for future bidirectional-on-wire use. */
  need: string[];
  /** Additional subranges the initiator should compare next. */
  continueWith?: NegentropyRange[];
  /** Ranges that were fully enumerated (divergent + small enough). */
  enumeratedRanges?: Array<{ start: string | null; end: string | null }>;
}

const EMPTY_FINGERPRINT = '0'.repeat(64);
const DEFAULT_MAX_ROUNDS = 24;
const ENUMERATE_THRESHOLD = 256;
const SPLIT_BUCKETS = 16;

interface Entry {
  key: string;
  item: NegentropyItem;
  hash: Uint8Array;
}

export class Negentropy {
  private items: NegentropyItem[] = [];
  private entries: Entry[] = [];
  private itemMap: Map<string, NegentropyItem> = new Map();

  async build(items: NegentropyItem[]): Promise<void> {
    this.items = [...items].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id);
    });

    // Pre-compute SHA-256 hashes for all items during build so that
    // fingerprintEntries only needs synchronous XOR operations.
    const hashes = await Promise.all(
      this.items.map((item) => this.hashItem(item)),
    );

    this.entries = this.items.map((item, i) => ({
      key: this.makeKey(item),
      item,
      hash: hashes[i],
    }));

    this.itemMap = new Map(this.items.map((item) => [item.id, item]));
  }

  async createQuery(): Promise<NegentropyQuery> {
    if (this.entries.length === 0) {
      return { ranges: [] };
    }

    return {
      ranges: [{
        start: null,
        end: null,
        fingerprint: this.fingerprintEntries(this.entries),
        count: this.entries.length,
      }],
    };
  }

  async processQuery(query: NegentropyQuery): Promise<NegentropyResponse> {
    const have = new Set<string>();
    const continueWith: NegentropyRange[] = [];
    const enumeratedRanges: Array<{ start: string | null; end: string | null }> = [];

    if (query.ranges.length === 0) {
      for (const entry of this.entries) {
        have.add(entry.item.id);
      }
      return { have: [...have], need: [], enumeratedRanges: [{ start: null, end: null }] };
    }

    for (const remoteRange of query.ranges) {
      const localEntries = this.getEntriesInRange(remoteRange.start, remoteRange.end);
      const localFingerprint = this.fingerprintEntries(localEntries);

      if (remoteRange.count === localEntries.length && remoteRange.fingerprint === localFingerprint) {
        continue;
      }

      const smallerSide = Math.min(remoteRange.count, localEntries.length);
      if (smallerSide <= ENUMERATE_THRESHOLD || localEntries.length <= 1 || remoteRange.count <= 1) {
        for (const entry of localEntries) {
          have.add(entry.item.id);
        }
        enumeratedRanges.push({ start: remoteRange.start, end: remoteRange.end });
        continue;
      }

      const partitions = this.partitionRange(remoteRange, localEntries);
      for (const partition of partitions) {
        const partEntries = this.getEntriesInRange(partition.start, partition.end);
        continueWith.push({
          start: partition.start,
          end: partition.end,
          count: partEntries.length,
          fingerprint: this.fingerprintEntries(partEntries),
        });
      }
    }

    return {
      have: [...have],
      need: [],
      continueWith: continueWith.length > 0 ? continueWith : undefined,
      enumeratedRanges: enumeratedRanges.length > 0 ? enumeratedRanges : undefined,
    };
  }

  async reconcile(
    remoteProcessQuery: (query: NegentropyQuery) => Promise<NegentropyResponse>,
    maxRounds: number = DEFAULT_MAX_ROUNDS,
  ): Promise<{ need: string[]; excess: string[] }> {
    const localIds = new Set(this.items.map((item) => item.id));
    const need = new Set<string>();
    const remoteHave = new Set<string>();
    const excess = new Set<string>();

    let query = await this.createQuery();

    for (let round = 0; round < maxRounds; round++) {
      const response = await remoteProcessQuery(query);

      for (const id of response.have) {
        remoteHave.add(id);
        if (!localIds.has(id)) {
          need.add(id);
        }
      }

      // Compute excess: local IDs in enumerated ranges that remote doesn't have
      if (response.enumeratedRanges) {
        for (const range of response.enumeratedRanges) {
          for (const entry of this.getEntriesInRange(range.start, range.end)) {
            if (!remoteHave.has(entry.item.id)) {
              excess.add(entry.item.id);
            }
          }
        }
      }

      if (!response.continueWith || response.continueWith.length === 0) {
        break;
      }

      const nextRanges: NegentropyRange[] = [];
      for (const requestedRange of response.continueWith) {
        const localEntries = this.getEntriesInRange(requestedRange.start, requestedRange.end);
        nextRanges.push({
          start: requestedRange.start,
          end: requestedRange.end,
          count: localEntries.length,
          fingerprint: this.fingerprintEntries(localEntries),
        });
      }

      query = { ranges: nextRanges };
    }

    return { need: [...need], excess: [...excess] };
  }

  getItem(id: string): NegentropyItem | undefined {
    return this.itemMap.get(id);
  }

  getItems(): NegentropyItem[] {
    return [...this.items];
  }

  size(): number {
    return this.items.length;
  }

  private makeKey(item: NegentropyItem): string {
    // Fixed-width timestamp keeps lexical ordering aligned with numeric ordering.
    return `${item.timestamp.toString().padStart(16, '0')}:${item.id}`;
  }

  private getEntriesInRange(start: string | null, end: string | null): Entry[] {
    if (this.entries.length === 0) return [];

    const startIdx = start === null ? 0 : this.lowerBound(start);
    const endIdx = end === null ? this.entries.length : this.lowerBound(end);
    if (startIdx >= endIdx) return [];
    return this.entries.slice(startIdx, endIdx);
  }

  private lowerBound(key: string): number {
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.entries[mid].key < key) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  private partitionRange(range: NegentropyRange, localEntries: Entry[]): Array<{ start: string | null; end: string | null }> {
    if (localEntries.length === 0) {
      return [{ start: range.start, end: range.end }];
    }

    const segments = Math.min(SPLIT_BUCKETS, localEntries.length);
    if (segments <= 1) {
      return [{ start: range.start, end: range.end }];
    }

    const boundaries: Array<string | null> = [range.start];
    for (let i = 1; i < segments; i++) {
      const idx = Math.floor((i * localEntries.length) / segments);
      boundaries.push(localEntries[idx].key);
    }
    boundaries.push(range.end);

    const ranges: Array<{ start: string | null; end: string | null }> = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      if (start !== null && end !== null && start >= end) continue;
      ranges.push({ start, end });
    }

    return ranges.length > 0 ? ranges : [{ start: range.start, end: range.end }];
  }

  private fingerprintEntries(entries: Entry[]): string {
    if (entries.length === 0) return EMPTY_FINGERPRINT;

    const xor = new Uint8Array(32);
    for (const entry of entries) {
      const hash = entry.hash;
      for (let i = 0; i < xor.length; i++) {
        xor[i] ^= hash[i];
      }
    }

    let hex = '';
    for (let i = 0; i < xor.length; i++) {
      hex += xor[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  private async hashItem(item: NegentropyItem): Promise<Uint8Array> {
    const payload = new TextEncoder().encode(`${item.id}:${item.timestamp}`);
    const digest = await crypto.subtle.digest('SHA-256', payload);
    return new Uint8Array(digest);
  }
}
