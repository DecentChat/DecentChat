/**
 * Contact & ContactStore Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { MemoryContactStore } from '../../src/contacts/Contact'
import type { Contact } from '../../src/contacts/Contact'

describe('MemoryContactStore - Basic Operations', () => {
  let store: MemoryContactStore

  beforeEach(() => {
    store = new MemoryContactStore()
  })

  const createSampleContact = (peerId: string, name: string): Contact => ({
    peerId,
    publicKey: `pubkey-${peerId}`,
    displayName: name,
    signalingServers: ['wss://signal.example.com'],
    addedAt: Date.now(),
    lastSeen: Date.now(),
  })

  test('add adds contact to store', async () => {
    const contact = createSampleContact('peer1', 'Alice')
    await store.add(contact)

    const retrieved = await store.get('peer1')
    expect(retrieved).toBeDefined()
    expect(retrieved?.displayName).toBe('Alice')
  })

  test('add multiple contacts', async () => {
    await store.add(createSampleContact('peer1', 'Alice'))
    await store.add(createSampleContact('peer2', 'Bob'))
    await store.add(createSampleContact('peer3', 'Charlie'))

    const all = await store.list()
    expect(all).toHaveLength(3)
  })

  test('get returns undefined for unknown peer', async () => {
    const contact = await store.get('unknown')
    expect(contact).toBeUndefined()
  })

  test('remove deletes contact', async () => {
    const contact = createSampleContact('peer1', 'Alice')
    await store.add(contact)
    expect(await store.get('peer1')).toBeDefined()

    await store.remove('peer1')
    expect(await store.get('peer1')).toBeUndefined()
  })

  test('remove unknown peer is safe', async () => {
    await store.remove('unknown')
    expect(await store.list()).toHaveLength(0)
  })

  test('list returns all contacts', async () => {
    await store.add(createSampleContact('peer1', 'Alice'))
    await store.add(createSampleContact('peer2', 'Bob'))
    await store.add(createSampleContact('peer3', 'Charlie'))

    const all = await store.list()
    expect(all).toHaveLength(3)
    expect(all.map(c => c.displayName).sort()).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  test('list returns empty array when no contacts', async () => {
    const all = await store.list()
    expect(all).toEqual([])
  })

  test('update modifies contact properties', async () => {
    const contact = createSampleContact('peer1', 'Alice')
    await store.add(contact)

    await store.update('peer1', { displayName: 'Alice Smith' })

    const updated = await store.get('peer1')
    expect(updated?.displayName).toBe('Alice Smith')
  })

  test('update multiple properties', async () => {
    const contact = createSampleContact('peer1', 'Alice')
    await store.add(contact)

    await store.update('peer1', {
      displayName: 'Alice Updated',
      signalingServers: ['wss://new-server.com'],
      lastSeen: Date.now() + 1000,
    })

    const updated = await store.get('peer1')
    expect(updated?.displayName).toBe('Alice Updated')
    expect(updated?.signalingServers).toEqual(['wss://new-server.com'])
  })

  test('update unknown peer is safe', async () => {
    await store.update('unknown', { displayName: 'Ghost' })
    expect(await store.get('unknown')).toBeUndefined()
  })

  test('update preserves other properties', async () => {
    const contact = createSampleContact('peer1', 'Alice')
    await store.add(contact)

    const originalKey = contact.publicKey
    await store.update('peer1', { displayName: 'Alice Updated' })

    const updated = await store.get('peer1')
    expect(updated?.publicKey).toBe(originalKey)
    expect(updated?.peerId).toBe('peer1')
  })
})

describe('Contact - Data Integrity', () => {
  let store: MemoryContactStore

  beforeEach(() => {
    store = new MemoryContactStore()
  })

  test('stores public key correctly', async () => {
    const contact: Contact = {
      peerId: 'peer1',
      publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
      displayName: 'Alice',
      signalingServers: ['wss://signal.example.com'],
      addedAt: Date.now(),
      lastSeen: Date.now(),
    }

    await store.add(contact)
    const retrieved = await store.get('peer1')
    expect(retrieved?.publicKey).toBe(contact.publicKey)
  })

  test('handles multiple signaling servers', async () => {
    const contact: Contact = {
      peerId: 'peer1',
      publicKey: 'pubkey',
      displayName: 'Alice',
      signalingServers: [
        'wss://signal1.example.com',
        'wss://signal2.example.com',
        'wss://signal3.example.com',
      ],
      addedAt: Date.now(),
      lastSeen: Date.now(),
    }

    await store.add(contact)
    const retrieved = await store.get('peer1')
    expect(retrieved?.signalingServers).toHaveLength(3)
  })

  test('preserves timestamps', async () => {
    const addedAt = Date.now() - 86400000 // 1 day ago
    const lastSeen = Date.now() - 3600000 // 1 hour ago

    const contact: Contact = {
      peerId: 'peer1',
      publicKey: 'pubkey',
      displayName: 'Alice',
      signalingServers: ['wss://signal.example.com'],
      addedAt,
      lastSeen,
    }

    await store.add(contact)
    const retrieved = await store.get('peer1')
    expect(retrieved?.addedAt).toBe(addedAt)
    expect(retrieved?.lastSeen).toBe(lastSeen)
  })

  test('handles unicode in displayName', async () => {
    const contact: Contact = {
      peerId: 'peer1',
      publicKey: 'pubkey',
      displayName: '🚀 Alice 你好',
      signalingServers: ['wss://signal.example.com'],
      addedAt: Date.now(),
      lastSeen: Date.now(),
    }

    await store.add(contact)
    const retrieved = await store.get('peer1')
    expect(retrieved?.displayName).toBe('🚀 Alice 你好')
  })

  test('handles empty signaling servers array', async () => {
    const contact: Contact = {
      peerId: 'peer1',
      publicKey: 'pubkey',
      displayName: 'Alice',
      signalingServers: [],
      addedAt: Date.now(),
      lastSeen: Date.now(),
    }

    await store.add(contact)
    const retrieved = await store.get('peer1')
    expect(retrieved?.signalingServers).toEqual([])
  })
})

describe('Contact - Edge Cases', () => {
  let store: MemoryContactStore

  beforeEach(() => {
    store = new MemoryContactStore()
  })

  test('overwrites contact with same peerId', async () => {
    const contact1: Contact = {
      peerId: 'peer1',
      publicKey: 'key1',
      displayName: 'Alice',
      signalingServers: ['wss://signal1.example.com'],
      addedAt: Date.now(),
      lastSeen: Date.now(),
    }

    const contact2: Contact = {
      peerId: 'peer1',
      publicKey: 'key2',
      displayName: 'Alice Updated',
      signalingServers: ['wss://signal2.example.com'],
      addedAt: Date.now() + 1000,
      lastSeen: Date.now() + 1000,
    }

    await store.add(contact1)
    await store.add(contact2)

    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0].displayName).toBe('Alice Updated')
    expect(all[0].publicKey).toBe('key2')
  })

  test('handles many contacts', async () => {
    for (let i = 0; i < 1000; i++) {
      await store.add({
        peerId: `peer${i}`,
        publicKey: `key${i}`,
        displayName: `User ${i}`,
        signalingServers: ['wss://signal.example.com'],
        addedAt: Date.now(),
        lastSeen: Date.now(),
      })
    }

    const all = await store.list()
    expect(all).toHaveLength(1000)
  })

  test('remove then re-add same contact', async () => {
    const contact: Contact = {
      peerId: 'peer1',
      publicKey: 'key1',
      displayName: 'Alice',
      signalingServers: ['wss://signal.example.com'],
      addedAt: Date.now(),
      lastSeen: Date.now(),
    }

    await store.add(contact)
    await store.remove('peer1')
    await store.add(contact)

    const retrieved = await store.get('peer1')
    expect(retrieved).toBeDefined()
    expect(retrieved?.displayName).toBe('Alice')
  })

  test('list returns independent copy', async () => {
    const contact: Contact = {
      peerId: 'peer1',
      publicKey: 'key1',
      displayName: 'Alice',
      signalingServers: ['wss://signal.example.com'],
      addedAt: Date.now(),
      lastSeen: Date.now(),
    }

    await store.add(contact)
    const list1 = await store.list()
    await store.add({
      peerId: 'peer2',
      publicKey: 'key2',
      displayName: 'Bob',
      signalingServers: ['wss://signal.example.com'],
      addedAt: Date.now(),
      lastSeen: Date.now(),
    })
    const list2 = await store.list()

    expect(list1).toHaveLength(1)
    expect(list2).toHaveLength(2)
  })
})
