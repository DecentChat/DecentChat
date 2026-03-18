/**
 * OfflineQueue Tests — Message queuing for offline peers
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { OfflineQueue } from '../../src/messages/OfflineQueue'
import type { QueuedMessage } from '../../src/messages/OfflineQueue'

describe('OfflineQueue - Basic Operations', () => {
  let queue: OfflineQueue

  beforeEach(() => {
    queue = new OfflineQueue()
  })

  test('enqueue adds message to queue', async () => {
    await queue.enqueue('peer1', { text: 'Hello' })
    expect(queue.getQueuedCount('peer1')).toBe(1)
  })

  test('enqueue multiple messages', async () => {
    await queue.enqueue('peer1', { text: 'msg1' })
    await queue.enqueue('peer1', { text: 'msg2' })
    await queue.enqueue('peer1', { text: 'msg3' })
    expect(queue.getQueuedCount('peer1')).toBe(3)
  })

  test('separate queues for different peers', async () => {
    await queue.enqueue('peer1', { text: 'A' })
    await queue.enqueue('peer2', { text: 'B' })
    await queue.enqueue('peer2', { text: 'C' })

    expect(queue.getQueuedCount('peer1')).toBe(1)
    expect(queue.getQueuedCount('peer2')).toBe(2)
  })

  test('getQueued returns all messages for peer', async () => {
    await queue.enqueue('peer1', { text: 'msg1' })
    await queue.enqueue('peer1', { text: 'msg2' })

    const messages = await queue.getQueued('peer1')
    expect(messages).toHaveLength(2)
    expect(messages[0].data.text).toBe('msg1')
    expect(messages[1].data.text).toBe('msg2')
  })

  test('getQueued returns empty array for unknown peer', async () => {
    const messages = await queue.getQueued('unknown')
    expect(messages).toEqual([])
  })

  test('flush returns and removes all messages', async () => {
    await queue.enqueue('peer1', { text: 'msg1' })
    await queue.enqueue('peer1', { text: 'msg2' })

    const messages = await queue.flush('peer1')
    expect(messages).toHaveLength(2)
    expect(messages[0].text).toBe('msg1')
    expect(messages[1].text).toBe('msg2')

    // Queue should be empty after flush
    expect(queue.getQueuedCount('peer1')).toBe(0)
  })

  test('flush returns empty array for unknown peer', async () => {
    const messages = await queue.flush('unknown')
    expect(messages).toEqual([])
  })

  test('getTotalQueued counts across all peers', async () => {
    await queue.enqueue('peer1', { text: 'A' })
    await queue.enqueue('peer1', { text: 'B' })
    await queue.enqueue('peer2', { text: 'C' })
    await queue.enqueue('peer3', { text: 'D' })

    expect(queue.getTotalQueued()).toBe(4)
  })

  test('getPeersWithQueue returns peer IDs', async () => {
    await queue.enqueue('peer1', { text: 'A' })
    await queue.enqueue('peer2', { text: 'B' })

    const peers = queue.getPeersWithQueue()
    expect(peers).toContain('peer1')
    expect(peers).toContain('peer2')
    expect(peers).toHaveLength(2)
  })

  test('clear removes all queues', async () => {
    await queue.enqueue('peer1', { text: 'A' })
    await queue.enqueue('peer2', { text: 'B' })

    queue.clear()

    expect(queue.getTotalQueued()).toBe(0)
    expect(queue.getPeersWithQueue()).toHaveLength(0)
  })
})

describe('OfflineQueue - Expiration', () => {
  test('filters out expired messages', async () => {
    const queue = new OfflineQueue({ maxAgeMs: 1000 }) // 1 second

    await queue.enqueue('peer1', { text: 'msg1' })
    await queue.enqueue('peer1', { text: 'msg2' })

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 1100))

    const messages = await queue.getQueued('peer1')
    expect(messages).toHaveLength(0) // All expired
  })

  test('flush filters expired messages', async () => {
    const queue = new OfflineQueue({ maxAgeMs: 500 })

    await queue.enqueue('peer1', { text: 'old' })
    await new Promise(resolve => setTimeout(resolve, 600)) // Expire first
    await queue.enqueue('peer1', { text: 'new' })

    const messages = await queue.flush('peer1')
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('new')
  })

  test('respects custom maxAgeMs config', async () => {
    const queue = new OfflineQueue({ maxAgeMs: 2000 })

    await queue.enqueue('peer1', { text: 'msg' })
    await new Promise(resolve => setTimeout(resolve, 1000))

    const messages = await queue.getQueued('peer1')
    expect(messages).toHaveLength(1) // Not expired yet
  })
})

describe('OfflineQueue - Persistence Integration', () => {
  let savedMessages: Map<string, QueuedMessage[]>
  let nextId = 1

  beforeEach(() => {
    savedMessages = new Map()
    nextId = 1
  })

  const mockPersistence = () => ({
    save: async (peerId: string, data: any) => {
      const msg: QueuedMessage = {
        id: nextId++,
        targetPeerId: peerId,
        data,
        createdAt: Date.now(),
        attempts: 0,
      }
      if (!savedMessages.has(peerId)) {
        savedMessages.set(peerId, [])
      }
      savedMessages.get(peerId)!.push(msg)
    },
    load: async (peerId: string) => savedMessages.get(peerId) || [],
    remove: async (id: number) => {
      for (const [, messages] of savedMessages.entries()) {
        const idx = messages.findIndex(m => m.id === id)
        if (idx >= 0) {
          messages.splice(idx, 1)
          break
        }
      }
    },
    removeAll: async (peerId: string) => {
      const messages = savedMessages.get(peerId) || []
      savedMessages.delete(peerId)
      return messages
    },
  })

  test('enqueue persists messages', async () => {
    const queue = new OfflineQueue()
    const persistence = mockPersistence()
    queue.setPersistence(persistence.save, persistence.load, persistence.remove, persistence.removeAll)

    await queue.enqueue('peer1', { text: 'persisted' })

    expect(savedMessages.get('peer1')).toHaveLength(1)
    expect(savedMessages.get('peer1')![0].data.text).toBe('persisted')
  })

  test('getQueued loads from persistence', async () => {
    const queue = new OfflineQueue()
    const persistence = mockPersistence()
    queue.setPersistence(persistence.save, persistence.load, persistence.remove, persistence.removeAll)

    // Persist directly
    await persistence.save('peer1', { text: 'stored' })

    const messages = await queue.getQueued('peer1')
    expect(messages).toHaveLength(1)
    expect(messages[0].data.text).toBe('stored')
  })

  test('flush removes from persistence', async () => {
    const queue = new OfflineQueue()
    const persistence = mockPersistence()
    queue.setPersistence(persistence.save, persistence.load, persistence.remove, persistence.removeAll)

    await queue.enqueue('peer1', { text: 'msg1' })
    await queue.enqueue('peer1', { text: 'msg2' })

    const messages = await queue.flush('peer1')
    expect(messages).toHaveLength(2)

    // Should be removed from persistent store
    expect(savedMessages.get('peer1')).toBeUndefined()
  })

  test('remove deletes specific message from persistence', async () => {
    const queue = new OfflineQueue()
    const persistence = mockPersistence()
    queue.setPersistence(persistence.save, persistence.load, persistence.remove, persistence.removeAll)

    await queue.enqueue('peer1', { text: 'msg1' })
    await queue.enqueue('peer1', { text: 'msg2' })

    const messages = savedMessages.get('peer1')!
    await queue.remove('peer1', messages[0].id!)

    expect(savedMessages.get('peer1')).toHaveLength(1)
    expect(savedMessages.get('peer1')![0].data.text).toBe('msg2')
  })

  test('works without persistence (in-memory only)', async () => {
    const queue = new OfflineQueue()
    // Don't call setPersistence

    await queue.enqueue('peer1', { text: 'in-memory' })
    expect(queue.getQueuedCount('peer1')).toBe(1)

    const messages = await queue.flush('peer1')
    expect(messages).toHaveLength(1)
  })
})

describe('OfflineQueue - Edge Cases', () => {
  test('handles null/undefined data', async () => {
    const queue = new OfflineQueue()

    await queue.enqueue('peer1', null)
    await queue.enqueue('peer1', undefined)

    expect(queue.getQueuedCount('peer1')).toBe(2)
  })

  test('handles large data payloads', async () => {
    const queue = new OfflineQueue()
    const largeData = { blob: 'x'.repeat(10000) }

    await queue.enqueue('peer1', largeData)
    const messages = await queue.flush('peer1')

    expect(messages[0].blob).toHaveLength(10000)
  })

  test('handles many peers', async () => {
    const queue = new OfflineQueue()

    for (let i = 0; i < 100; i++) {
      await queue.enqueue(`peer${i}`, { id: i })
    }

    expect(queue.getTotalQueued()).toBe(100)
    expect(queue.getPeersWithQueue()).toHaveLength(100)
  })

  test('flush on empty queue is safe', async () => {
    const queue = new OfflineQueue()
    const messages = await queue.flush('peer1')
    expect(messages).toEqual([])
  })

  test('multiple flushes on same peer', async () => {
    const queue = new OfflineQueue()

    await queue.enqueue('peer1', { text: 'msg' })
    await queue.flush('peer1')
    const messages = await queue.flush('peer1')

    expect(messages).toEqual([])
  })

  test('preserves message order', async () => {
    const queue = new OfflineQueue()

    for (let i = 0; i < 10; i++) {
      await queue.enqueue('peer1', { seq: i })
    }

    const messages = await queue.flush('peer1')
    for (let i = 0; i < 10; i++) {
      expect(messages[i].seq).toBe(i)
    }
  })
})

describe('OfflineQueue - Configuration', () => {
  test('respects maxRetries config', () => {
    const queue = new OfflineQueue({ maxRetries: 5 })
    // maxRetries is used by external retry logic, not tested here
    expect(queue).toBeDefined()
  })

  test('respects retryDelayMs config', () => {
    const queue = new OfflineQueue({ retryDelayMs: 1000 })
    expect(queue).toBeDefined()
  })

  test('uses default config values', () => {
    const queue = new OfflineQueue()
    // Should not throw, defaults should be applied
    expect(queue).toBeDefined()
  })
})

describe('OfflineQueue - Custody metadata', () => {
  test('enqueue preserves custody metadata for in-memory queue', async () => {
    const queue = new OfflineQueue()

    await queue.enqueue('peer1', { kind: 'ciphertext' }, {
      envelopeId: 'env-1',
      opId: 'op-1',
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      domain: 'channel-message',
      replicationClass: 'critical',
      deliveryState: 'stored',
      contentHash: 'hash-1',
      recipientPeerIds: ['peer1'],
      metadata: { fanout: 3 },
    })

    const queued = await queue.getQueued('peer1')
    expect(queued).toHaveLength(1)
    expect(queued[0].envelopeId).toBe('env-1')
    expect(queued[0].opId).toBe('op-1')
    expect(queued[0].domain).toBe('channel-message')
    expect(queued[0].replicationClass).toBe('critical')
    expect(queued[0].metadata).toEqual({ fanout: 3 })
  })

  test('markDeliveredEnvelope updates delivery state without removing message', async () => {
    let nextId = 1
    const persisted = new Map<string, QueuedMessage[]>()
    const queue = new OfflineQueue()
    queue.setPersistence(
      async (peerId, data, meta) => {
        const row: QueuedMessage = {
          id: nextId++,
          targetPeerId: peerId,
          data,
          createdAt: meta?.createdAt ?? Date.now(),
          attempts: meta?.attempts ?? 0,
          ...meta,
        }
        persisted.set(peerId, [...(persisted.get(peerId) || []), row])
      },
      async (peerId) => persisted.get(peerId) || [],
      async (id) => {
        for (const [peerId, rows] of persisted.entries()) {
          const idx = rows.findIndex((row) => row.id === id)
          if (idx >= 0) {
            rows.splice(idx, 1)
            persisted.set(peerId, rows)
            return
          }
        }
      },
      async (peerId) => {
        const rows = persisted.get(peerId) || []
        persisted.delete(peerId)
        return rows
      },
      async (id, patch) => {
        for (const [peerId, rows] of persisted.entries()) {
          const idx = rows.findIndex((row) => row.id === id)
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...patch }
            persisted.set(peerId, rows)
            return
          }
        }
      },
    )

    await queue.enqueue('peer1', { kind: 'ciphertext' }, {
      envelopeId: 'env-1',
      opId: 'op-1',
      domain: 'channel-message',
      deliveryState: 'stored',
    })

    const ok = await queue.markDeliveredEnvelope('peer1', 'env-1', {
      receiptId: 'r-1',
      kind: 'delivered',
      opId: 'op-1',
      envelopeId: 'env-1',
      recipientPeerId: 'peer1',
      timestamp: 123,
    })

    expect(ok).toBe(true)
    const rows = await queue.listQueued('peer1')
    expect(rows).toHaveLength(1)
    expect(rows[0].deliveryState).toBe('delivered')
    expect(rows[0].deliveredAt).toBe(123)
    expect(rows[0].receipt?.receiptId).toBe('r-1')
  })

  test('acknowledgeEnvelope removes persisted envelope', async () => {
    let nextId = 1
    const persisted = new Map<string, QueuedMessage[]>()
    const queue = new OfflineQueue()
    queue.setPersistence(
      async (peerId, data, meta) => {
        const row: QueuedMessage = {
          id: nextId++,
          targetPeerId: peerId,
          data,
          createdAt: meta?.createdAt ?? Date.now(),
          attempts: meta?.attempts ?? 0,
          ...meta,
        }
        persisted.set(peerId, [...(persisted.get(peerId) || []), row])
      },
      async (peerId) => persisted.get(peerId) || [],
      async (id) => {
        for (const [peerId, rows] of persisted.entries()) {
          const idx = rows.findIndex((row) => row.id === id)
          if (idx >= 0) {
            rows.splice(idx, 1)
            persisted.set(peerId, rows)
            return
          }
        }
      },
      async (peerId) => {
        const rows = persisted.get(peerId) || []
        persisted.delete(peerId)
        return rows
      },
      async (id, patch) => {
        for (const [peerId, rows] of persisted.entries()) {
          const idx = rows.findIndex((row) => row.id === id)
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...patch }
            persisted.set(peerId, rows)
            return
          }
        }
      },
    )

    await queue.enqueue('peer1', { kind: 'ciphertext' }, {
      envelopeId: 'env-1',
      opId: 'op-1',
      domain: 'channel-message',
      deliveryState: 'stored',
    })

    const ok = await queue.acknowledgeEnvelope('peer1', 'env-1', {
      receiptId: 'r-ack',
      kind: 'delivered',
      opId: 'op-1',
      envelopeId: 'env-1',
      recipientPeerId: 'peer1',
      timestamp: 456,
    })

    expect(ok).toBe(true)
    expect(await queue.listQueued('peer1')).toHaveLength(0)
  })

  test('expires entries using expiresAt even when maxAge would allow them', async () => {
    const queue = new OfflineQueue({ maxAgeMs: 60_000 })
    await queue.enqueue('peer1', { kind: 'ciphertext' }, {
      envelopeId: 'env-1',
      opId: 'op-1',
      expiresAt: Date.now() + 10,
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    const queued = await queue.getQueued('peer1')
    expect(queued).toHaveLength(0)
  })
})

describe('OfflineQueue - Custody Semantics', () => {
  test('acknowledges queued payloads by logical message id', async () => {
    const queue = new OfflineQueue();

    await queue.enqueue('peer1', { messageId: 'msg-1', text: 'hello' }, {
      opId: 'msg-1',
      domain: 'channel-message',
      replicationClass: 'critical',
      deliveryState: 'stored',
    });

    const acked = await queue.acknowledgeByMessageId('peer1', 'msg-1', {
      receiptId: 'r-1',
      kind: 'acknowledged',
      opId: 'msg-1',
      recipientPeerId: 'peer1',
      timestamp: Date.now(),
    });

    expect(acked).toBe(true);
    expect(await queue.listQueued('peer1')).toHaveLength(0);
  });

  test('backs off retries after markAttempt and redelivers after delay', async () => {
    const queue = new OfflineQueue({ retryDelayMs: 80, maxRetries: 3, maxAgeMs: 10_000 });

    const persisted = new Map<string, QueuedMessage[]>();
    let seq = 1;
    const save = async (peerId: string, data: any, meta: Partial<QueuedMessage> = {}) => {
      const current = persisted.get(peerId) || [];
      current.push({
        id: seq++,
        targetPeerId: peerId,
        data,
        createdAt: meta.createdAt ?? Date.now(),
        attempts: meta.attempts ?? 0,
        ...meta,
      });
      persisted.set(peerId, current);
    };
    const load = async (peerId: string) => [...(persisted.get(peerId) || [])];
    const remove = async (id: number) => {
      for (const [peerId, items] of persisted.entries()) {
        const next = items.filter((item) => item.id !== id);
        if (next.length === 0) persisted.delete(peerId);
        else persisted.set(peerId, next);
      }
    };
    const removeAll = async (peerId: string) => {
      const items = persisted.get(peerId) || [];
      persisted.delete(peerId);
      return items;
    };
    const update = async (id: number, patch: Partial<QueuedMessage>) => {
      for (const [peerId, items] of persisted.entries()) {
        const idx = items.findIndex((item) => item.id === id);
        if (idx < 0) continue;
        const next = [...items];
        next[idx] = { ...next[idx], ...patch };
        persisted.set(peerId, next);
        break;
      }
    };

    queue.setPersistence(save, load, remove, removeAll, update);
    await queue.enqueue('peer1', { messageId: 'msg-2' }, { opId: 'msg-2', domain: 'channel-message' });

    const queued = await queue.getQueued('peer1');
    expect(queued).toHaveLength(1);

    const id = (await queue.listQueued('peer1'))[0]?.id;
    expect(typeof id).toBe('number');

    await queue.markAttempt('peer1', id!);
    expect(await queue.getQueued('peer1')).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, 185));
    expect(await queue.getQueued('peer1')).toHaveLength(1);
  });

  test('tracks expiry + replication metadata in sync summary', async () => {
    const queue = new OfflineQueue({ maxAgeMs: 60_000 });

    await queue.enqueue('peer1', { messageId: 'fresh' }, {
      envelopeId: 'env-fresh',
      opId: 'fresh',
      domain: 'channel-message',
      replicationClass: 'critical',
      metadata: { replicaPeers: ['peer2', 'peer3'], minimumAcks: 2 },
      expiresAt: Date.now() + 60_000,
    });

    await queue.enqueue('peer1', { messageId: 'stale' }, {
      envelopeId: 'env-stale',
      opId: 'stale',
      domain: 'receipt',
      replicationClass: 'bulk',
      expiresAt: Date.now() - 1,
    });

    const deliverable = await queue.getQueued('peer1');
    expect(deliverable).toHaveLength(1);
    expect(deliverable[0].metadata).toEqual({ replicaPeers: ['peer2', 'peer3'], minimumAcks: 2 });

    const summary = await queue.getSyncSummary('peer1');
    expect(summary.totalEnvelopes).toBe(2);
    expect(summary.deliverableCount).toBe(1);
    expect(summary.expiredCount).toBe(1);
    expect(summary.byReplicationClass.critical).toBe(1);
    expect(summary.byReplicationClass.bulk).toBe(1);
    expect(summary.byDomain['channel-message']).toBe(1);
    expect(summary.byDomain.receipt).toBe(1);
  });

  test('applyReceipt removes envelope by envelopeId when available', async () => {
    const queue = new OfflineQueue();

    await queue.enqueue('peer1', { messageId: 'msg-3' }, {
      envelopeId: 'env-3',
      opId: 'msg-3',
      domain: 'channel-message',
    });

    const applied = await queue.applyReceipt('peer1', {
      receiptId: 'r-3',
      kind: 'acknowledged',
      opId: 'msg-3',
      envelopeId: 'env-3',
      recipientPeerId: 'peer1',
      timestamp: Date.now(),
    });

    expect(applied).toBe(true);
    expect(await queue.listQueued('peer1')).toHaveLength(0);
  });

  test('applyReceipt(kind=delivered) marks delivered and keeps queue entry', async () => {
    const queue = new OfflineQueue();

    await queue.enqueue('peer1', { messageId: 'msg-delivered' }, {
      envelopeId: 'env-delivered',
      opId: 'msg-delivered',
      domain: 'channel-message',
      deliveryState: 'stored',
    });

    const applied = await queue.applyReceipt('peer1', {
      receiptId: 'r-delivered',
      kind: 'delivered',
      opId: 'msg-delivered',
      envelopeId: 'env-delivered',
      recipientPeerId: 'peer1',
      timestamp: 111,
    });

    expect(applied).toBe(true);
    const all = await queue.listQueued('peer1');
    expect(all).toHaveLength(1);
    expect(all[0].deliveryState).toBe('delivered');
    expect(all[0].deliveredAt).toBe(111);
  });

  test('applyReceipt(kind=delivered) matches by opId when envelopeId is absent', async () => {
    const queue = new OfflineQueue();

    await queue.enqueue('peer1', { messageId: 'msg-op-only' }, {
      opId: 'msg-op-only',
      domain: 'channel-message',
      deliveryState: 'stored',
    });

    const applied = await queue.applyReceipt('peer1', {
      receiptId: 'r-op-only',
      kind: 'delivered',
      opId: 'msg-op-only',
      recipientPeerId: 'peer1',
      timestamp: 222,
    });

    expect(applied).toBe(true);
    const all = await queue.listQueued('peer1');
    expect(all).toHaveLength(1);
    expect(all[0].deliveryState).toBe('delivered');
    expect(all[0].deliveredAt).toBe(222);
  });

});
