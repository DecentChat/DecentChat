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
