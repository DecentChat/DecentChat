/**
 * DirectConversation & DirectConversationStore Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { MemoryDirectConversationStore } from '../../src/contacts/DirectConversation'

describe('MemoryDirectConversationStore - Basic Operations', () => {
  let store: MemoryDirectConversationStore

  beforeEach(() => {
    store = new MemoryDirectConversationStore()
  })

  test('create creates new conversation', async () => {
    const conv = await store.create('peer1')

    expect(conv.id).toBeDefined()
    expect(conv.contactPeerId).toBe('peer1')
    expect(conv.createdAt).toBeGreaterThan(0)
    expect(conv.lastMessageAt).toBe(0)
  })

  test('create generates unique IDs', async () => {
    const conv1 = await store.create('peer1')
    const conv2 = await store.create('peer2')

    expect(conv1.id).not.toBe(conv2.id)
  })

  test('create returns existing conversation for same contact', async () => {
    const conv1 = await store.create('peer1')
    const conv2 = await store.create('peer1')

    expect(conv1.id).toBe(conv2.id)
    expect(conv1.contactPeerId).toBe('peer1')

    const all = await store.list()
    expect(all).toHaveLength(1)
  })

  test('get retrieves conversation by ID', async () => {
    const conv = await store.create('peer1')
    const retrieved = await store.get(conv.id)

    expect(retrieved).toBeDefined()
    expect(retrieved?.contactPeerId).toBe('peer1')
  })

  test('get returns undefined for unknown ID', async () => {
    const conv = await store.get('unknown-id')
    expect(conv).toBeUndefined()
  })

  test('getByContact retrieves conversation by contact peer ID', async () => {
    await store.create('peer1')
    const retrieved = await store.getByContact('peer1')

    expect(retrieved).toBeDefined()
    expect(retrieved?.contactPeerId).toBe('peer1')
  })

  test('getByContact returns undefined for unknown contact', async () => {
    const conv = await store.getByContact('unknown')
    expect(conv).toBeUndefined()
  })

  test('list returns all conversations', async () => {
    await store.create('peer1')
    await store.create('peer2')
    await store.create('peer3')

    const all = await store.list()
    expect(all).toHaveLength(3)
  })

  test('list returns empty array when no conversations', async () => {
    const all = await store.list()
    expect(all).toEqual([])
  })

  test('remove deletes conversation', async () => {
    const conv = await store.create('peer1')
    expect(await store.get(conv.id)).toBeDefined()

    await store.remove(conv.id)
    expect(await store.get(conv.id)).toBeUndefined()
  })

  test('remove unknown conversation is safe', async () => {
    await store.remove('unknown-id')
    expect(await store.list()).toHaveLength(0)
  })

  test('updateLastMessage updates timestamp', async () => {
    const conv = await store.create('peer1')
    expect(conv.lastMessageAt).toBe(0)

    const newTimestamp = Date.now()
    await store.updateLastMessage(conv.id, newTimestamp)

    const updated = await store.get(conv.id)
    expect(updated?.lastMessageAt).toBe(newTimestamp)
  })

  test('updateLastMessage on unknown conversation is safe', async () => {
    await store.updateLastMessage('unknown-id', Date.now())
    expect(await store.list()).toHaveLength(0)
  })
})

describe('DirectConversation - Sorting & Ordering', () => {
  let store: MemoryDirectConversationStore

  beforeEach(() => {
    store = new MemoryDirectConversationStore()
  })

  test('list sorts by lastMessageAt descending', async () => {
    const conv1 = await store.create('peer1')
    const conv2 = await store.create('peer2')
    const conv3 = await store.create('peer3')

    // Update timestamps in specific order
    await store.updateLastMessage(conv1.id, 1000)
    await store.updateLastMessage(conv2.id, 3000)
    await store.updateLastMessage(conv3.id, 2000)

    const list = await store.list()

    expect(list[0].contactPeerId).toBe('peer2') // 3000
    expect(list[1].contactPeerId).toBe('peer3') // 2000
    expect(list[2].contactPeerId).toBe('peer1') // 1000
  })

  test('conversations with no messages sort to bottom', async () => {
    const conv1 = await store.create('peer1')
    await store.create('peer2')
    await store.create('peer3')

    await store.updateLastMessage(conv1.id, Date.now())
    // conv2 and conv3 have no messages (lastMessageAt = 0)

    const list = await store.list()

    expect(list[0].contactPeerId).toBe('peer1')
    // conv2 and conv3 are below, order between them is undefined
  })

  test('multiple updates to lastMessageAt', async () => {
    const conv = await store.create('peer1')

    await store.updateLastMessage(conv.id, 1000)
    await store.updateLastMessage(conv.id, 2000)
    await store.updateLastMessage(conv.id, 3000)

    const updated = await store.get(conv.id)
    expect(updated?.lastMessageAt).toBe(3000)
  })
})

describe('DirectConversation - Edge Cases', () => {
  let store: MemoryDirectConversationStore

  beforeEach(() => {
    store = new MemoryDirectConversationStore()
  })

  test('handles many conversations', async () => {
    for (let i = 0; i < 1000; i++) {
      await store.create(`peer${i}`)
    }

    const all = await store.list()
    expect(all).toHaveLength(1000)
  })

  test('create after remove creates new conversation', async () => {
    const conv1 = await store.create('peer1')
    const firstId = conv1.id

    await store.remove(conv1.id)

    const conv2 = await store.create('peer1')
    expect(conv2.id).not.toBe(firstId) // New ID
    expect(conv2.contactPeerId).toBe('peer1')
  })

  test('remove then getByContact returns undefined', async () => {
    const conv = await store.create('peer1')
    await store.remove(conv.id)

    const retrieved = await store.getByContact('peer1')
    expect(retrieved).toBeUndefined()
  })

  test('list returns independent copy', async () => {
    await store.create('peer1')

    const list1 = await store.list()
    await store.create('peer2')
    const list2 = await store.list()

    expect(list1).toHaveLength(1)
    expect(list2).toHaveLength(2)
  })

  test('handles very old timestamps', async () => {
    const conv = await store.create('peer1')
    const oldTimestamp = 946684800000 // Jan 1, 2000

    await store.updateLastMessage(conv.id, oldTimestamp)

    const updated = await store.get(conv.id)
    expect(updated?.lastMessageAt).toBe(oldTimestamp)
  })

  test('handles future timestamps', async () => {
    const conv = await store.create('peer1')
    const futureTimestamp = Date.now() + 86400000 * 365 // 1 year from now

    await store.updateLastMessage(conv.id, futureTimestamp)

    const updated = await store.get(conv.id)
    expect(updated?.lastMessageAt).toBe(futureTimestamp)
  })
})

describe('DirectConversation - Data Integrity', () => {
  let store: MemoryDirectConversationStore

  beforeEach(() => {
    store = new MemoryDirectConversationStore()
  })

  test('preserves all conversation properties', async () => {
    const before = Date.now()
    const conv = await store.create('peer1')
    const after = Date.now()

    expect(conv.id).toBeDefined()
    expect(conv.contactPeerId).toBe('peer1')
    expect(conv.createdAt).toBeGreaterThanOrEqual(before)
    expect(conv.createdAt).toBeLessThanOrEqual(after)
    expect(conv.lastMessageAt).toBe(0)
  })

  test('createdAt is immutable after creation', async () => {
    const conv = await store.create('peer1')
    const originalCreatedAt = conv.createdAt

    await store.updateLastMessage(conv.id, Date.now())

    const updated = await store.get(conv.id)
    expect(updated?.createdAt).toBe(originalCreatedAt)
  })

  test('contactPeerId is preserved through updates', async () => {
    const conv = await store.create('peer1')

    await store.updateLastMessage(conv.id, Date.now())
    await store.updateLastMessage(conv.id, Date.now() + 1000)

    const updated = await store.get(conv.id)
    expect(updated?.contactPeerId).toBe('peer1')
  })

  test('handles unicode in contactPeerId', async () => {
    await store.create('peer-你好-🚀')

    const retrieved = await store.getByContact('peer-你好-🚀')
    expect(retrieved).toBeDefined()
    expect(retrieved?.contactPeerId).toBe('peer-你好-🚀')
  })
})

describe('DirectConversation - Multi-Contact Scenarios', () => {
  let store: MemoryDirectConversationStore

  beforeEach(() => {
    store = new MemoryDirectConversationStore()
  })

  test('separate conversations for different contacts', async () => {
    const conv1 = await store.create('peer1')
    const conv2 = await store.create('peer2')
    const conv3 = await store.create('peer3')

    expect(conv1.contactPeerId).toBe('peer1')
    expect(conv2.contactPeerId).toBe('peer2')
    expect(conv3.contactPeerId).toBe('peer3')

    expect(new Set([conv1.id, conv2.id, conv3.id]).size).toBe(3)
  })

  test('removing one conversation does not affect others', async () => {
    const conv1 = await store.create('peer1')
    const conv2 = await store.create('peer2')
    const conv3 = await store.create('peer3')

    await store.remove(conv2.id)

    expect(await store.get(conv1.id)).toBeDefined()
    expect(await store.get(conv2.id)).toBeUndefined()
    expect(await store.get(conv3.id)).toBeDefined()
  })

  test('updating one conversation does not affect others', async () => {
    const conv1 = await store.create('peer1')
    const conv2 = await store.create('peer2')

    await store.updateLastMessage(conv1.id, 1000)

    const c1 = await store.get(conv1.id)
    const c2 = await store.get(conv2.id)

    expect(c1?.lastMessageAt).toBe(1000)
    expect(c2?.lastMessageAt).toBe(0)
  })
})
