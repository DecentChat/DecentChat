/**
 * VectorClock - Logical ordering without trusting timestamps
 * 
 * Each peer maintains a counter. On every event:
 * 1. Increment own counter
 * 2. Send full clock with message
 * 3. On receive: merge (take max of each entry) + increment own
 * 
 * This gives us causality: if A happened before B, we KNOW.
 * If neither happened before the other, they're concurrent.
 */

export class VectorClock {
  private clock: Map<string, number>;

  constructor(initial?: Record<string, number>) {
    this.clock = new Map(initial ? Object.entries(initial) : []);
  }

  /**
   * Increment this peer's counter (call before sending)
   */
  increment(peerId: string): VectorClock {
    const newClock = this.clone();
    newClock.clock.set(peerId, (newClock.clock.get(peerId) || 0) + 1);
    return newClock;
  }

  /**
   * Merge with another clock (call on receive)
   * Takes max of each peer's counter
   */
  merge(other: VectorClock): VectorClock {
    const merged = this.clone();
    for (const [peerId, count] of other.clock) {
      merged.clock.set(peerId, Math.max(merged.clock.get(peerId) || 0, count));
    }
    return merged;
  }

  /**
   * Compare two clocks:
   * - 'before': this happened before other
   * - 'after': this happened after other
   * - 'concurrent': neither happened before the other (conflict!)
   * - 'equal': identical clocks
   */
  compare(other: VectorClock): 'before' | 'after' | 'concurrent' | 'equal' {
    let thisBeforeOther = false;
    let otherBeforeThis = false;

    const allPeers = new Set([...this.clock.keys(), ...other.clock.keys()]);

    for (const peerId of allPeers) {
      const thisVal = this.clock.get(peerId) || 0;
      const otherVal = other.clock.get(peerId) || 0;

      if (thisVal < otherVal) thisBeforeOther = true;
      if (thisVal > otherVal) otherBeforeThis = true;
    }

    if (!thisBeforeOther && !otherBeforeThis) return 'equal';
    if (thisBeforeOther && !otherBeforeThis) return 'before';
    if (!thisBeforeOther && otherBeforeThis) return 'after';
    return 'concurrent';
  }

  /**
   * Check if this clock happened before (or equal to) another
   */
  happenedBefore(other: VectorClock): boolean {
    const rel = this.compare(other);
    return rel === 'before' || rel === 'equal';
  }

  /**
   * Get counter for a specific peer
   */
  get(peerId: string): number {
    return this.clock.get(peerId) || 0;
  }

  /**
   * Serialize to plain object
   */
  toJSON(): Record<string, number> {
    return Object.fromEntries(this.clock);
  }

  /**
   * Deserialize from plain object
   */
  static fromJSON(data: Record<string, number>): VectorClock {
    return new VectorClock(data);
  }

  /**
   * Clone this clock
   */
  clone(): VectorClock {
    return new VectorClock(Object.fromEntries(this.clock));
  }

  /**
   * Number of peers tracked
   */
  get size(): number {
    return this.clock.size;
  }
}
