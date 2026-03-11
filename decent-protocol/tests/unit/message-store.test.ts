/**
 * MessageStore Tests — Message storage with hash chain integrity
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { MessageStore } from '../../src/messages/MessageStore'
import { GENESIS_HASH } from '../../src/crypto/HashChain'
import type { PlaintextMessage } from '../../src/messages/types'
import { MAX_MESSAGE_CHARS } from '../../src/messages/messageLimits'

describe('MessageStore - Basic Operations', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new MessageStore()
  })

  test('createMessage generates valid message', async () => {
    const msg = await store.createMessage('channel1', 'alice', 'Hello')

    expect(msg.id).toBeDefined()
    expect(msg.channelId).toBe('channel1')
    expect(msg.senderId).toBe('alice')
    expect(msg.content).toBe('Hello')
    expect(msg.type).toBe('text')
    expect(msg.prevHash).toBe(GENESIS_HASH)
    expect(msg.status).toBe('pending')
  })

  test('createMessage chains to previous message', async () => {
    const msg1 = await store.createMessage('channel1', 'alice', 'First')
    await store.addMessage(msg1)

    const msg2 = await store.createMessage('channel1', 'bob', 'Second')
    expect(msg2.prevHash).not.toBe(GENESIS_HASH)
    expect(msg2.prevHash).toBeDefined()
  })

  test('addMessage accepts first message with genesis hash', async () => {
    const msg = await store.createMessage('channel1', 'alice', 'First')
    const result = await store.addMessage(msg)

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test('addMessage rejects first message with wrong prevHash', async () => {
    const msg: PlaintextMessage = {
      id: 'msg1',
      channelId: 'channel1',
      senderId: 'alice',
      timestamp: Date.now(),
      content: 'First',
      type: 'text',
      prevHash: 'wrong-hash',
      status: 'pending',
    }

    const result = await store.addMessage(msg)
    expect(result.success).toBe(false)
    expect(result.error).toContain('genesis')
  })

  test('addMessage chains multiple messages correctly', async () => {
    const msg1 = await store.createMessage('channel1', 'alice', 'First')
    await store.addMessage(msg1)

    await new Promise(resolve => setTimeout(resolve, 5)) // Ensure different timestamps

    const msg2 = await store.createMessage('channel1', 'bob', 'Second')
    const result = await store.addMessage(msg2)

    expect(result.success).toBe(true)
    expect(store.getMessages('channel1')).toHaveLength(2)
  })

  test('addMessage rejects broken hash chain', async () => {
    const msg1 = await store.createMessage('channel1', 'alice', 'First')
    await store.addMessage(msg1)

    // Create message with wrong prevHash
    const msg2: PlaintextMessage = {
      id: 'msg2',
      channelId: 'channel1',
      senderId: 'bob',
      timestamp: Date.now() + 1000,
      content: 'Second',
      type: 'text',
      prevHash: 'wrong-hash',
      status: 'pending',
    }

    const result = await store.addMessage(msg2)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Hash chain broken')
  })

  test('addMessage rejects timestamp not advancing', async () => {
    const msg1 = await store.createMessage('channel1', 'alice', 'First')
    await store.addMessage(msg1)

    const lastHash = await store.getLastHash('channel1')

    const msg2: PlaintextMessage = {
      id: 'msg2',
      channelId: 'channel1',
      senderId: 'bob',
      timestamp: msg1.timestamp, // Same timestamp!
      content: 'Second',
      type: 'text',
      prevHash: lastHash,
      status: 'pending',
    }

    const result = await store.addMessage(msg2)
    expect(result.success).toBe(false)
    expect(result.error).toContain('timestamp')
  })

  test('getMessages returns empty array for unknown channel', () => {
    const messages = store.getMessages('unknown')
    expect(messages).toEqual([])
  })

  test('getMessages returns all channel messages in order', async () => {
    const msg1 = await store.createMessage('channel1', 'alice', 'First')
    await store.addMessage(msg1)

    await new Promise(resolve => setTimeout(resolve, 5))

    const msg2 = await store.createMessage('channel1', 'bob', 'Second')
    await store.addMessage(msg2)

    await new Promise(resolve => setTimeout(resolve, 5))

    const msg3 = await store.createMessage('channel1', 'alice', 'Third')
    await store.addMessage(msg3)

    const messages = store.getMessages('channel1')
    expect(messages).toHaveLength(3)
    expect(messages[0].content).toBe('First')
    expect(messages[1].content).toBe('Second')
    expect(messages[2].content).toBe('Third')
  })

  test('getAllChannelIds returns all channels', async () => {
    await store.addMessage(await store.createMessage('channel1', 'alice', 'A'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel2', 'bob', 'B'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel3', 'charlie', 'C'))

    const ids = store.getAllChannelIds()
    expect(ids).toContain('channel1')
    expect(ids).toContain('channel2')
    expect(ids).toContain('channel3')
    expect(ids).toHaveLength(3)
  })

  test('clearChannel removes all messages', async () => {
    await store.addMessage(await store.createMessage('channel1', 'alice', 'Hello'))
    expect(store.getMessages('channel1')).toHaveLength(1)

    store.clearChannel('channel1')
    expect(store.getMessages('channel1')).toHaveLength(0)
  })
})

describe('MessageStore - Threading', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new MessageStore()
  })

  test('createMessage supports threadId', async () => {
    const msg = await store.createMessage('channel1', 'alice', 'Reply', 'text', 'thread1')
    expect(msg.threadId).toBe('thread1')
  })

  test('getThread returns only thread messages', async () => {
    // Main channel messages
    await store.addMessage(await store.createMessage('channel1', 'alice', 'Main 1'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel1', 'bob', 'Main 2'))
    await new Promise(resolve => setTimeout(resolve, 5))

    // Thread messages
    await store.addMessage(await store.createMessage('channel1', 'alice', 'Thread 1', 'text', 'thread1'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel1', 'bob', 'Thread 2', 'text', 'thread1'))
    await new Promise(resolve => setTimeout(resolve, 5))

    // Another thread
    await store.addMessage(await store.createMessage('channel1', 'charlie', 'Thread A', 'text', 'thread2'))

    const thread1 = store.getThread('channel1', 'thread1')
    expect(thread1).toHaveLength(2)
    expect(thread1[0].content).toBe('Thread 1')
    expect(thread1[1].content).toBe('Thread 2')

    const thread2 = store.getThread('channel1', 'thread2')
    expect(thread2).toHaveLength(1)
    expect(thread2[0].content).toBe('Thread A')
  })

  test('getThread returns empty for unknown thread', () => {
    const thread = store.getThread('channel1', 'unknown')
    expect(thread).toEqual([])
  })
})

describe('MessageStore - Hash Chain Verification', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new MessageStore()
  })

  test('verifyChannel passes for valid chain', async () => {
    await store.addMessage(await store.createMessage('channel1', 'alice', 'Msg 1'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel1', 'bob', 'Msg 2'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel1', 'charlie', 'Msg 3'))

    const result = await store.verifyChannel('channel1')
    expect(result.valid).toBe(true)
    expect(result.brokenAt).toBeUndefined()
    expect(result.reason).toBeUndefined()
  })

  test('verifyChannel passes for empty channel', async () => {
    const result = await store.verifyChannel('empty')
    expect(result.valid).toBe(true)
  })

  test('getLastHash returns genesis for empty channel', async () => {
    const hash = await store.getLastHash('empty')
    expect(hash).toBe(GENESIS_HASH)
  })

  test('getLastHash returns hash of last message', async () => {
    const msg = await store.createMessage('channel1', 'alice', 'Hello')
    await store.addMessage(msg)

    const hash = await store.getLastHash('channel1')
    expect(hash).toBeDefined()
    expect(hash).not.toBe(GENESIS_HASH)
  })
})

describe('MessageStore - Import Messages', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new MessageStore()
  })

  test('importMessages accepts valid chain', async () => {
    // Build valid chain elsewhere
    const tempStore = new MessageStore()
    const msg1 = await tempStore.createMessage('channel1', 'alice', 'First')
    await tempStore.addMessage(msg1)

    await new Promise(resolve => setTimeout(resolve, 5))

    const msg2 = await tempStore.createMessage('channel1', 'bob', 'Second')
    await tempStore.addMessage(msg2)

    const messages = tempStore.getMessages('channel1')

    // Import into main store
    const result = await store.importMessages('channel1', messages)
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(store.getMessages('channel1')).toHaveLength(2)
  })

  test('importMessages replaces existing channel', async () => {
    // Add local messages
    await store.addMessage(await store.createMessage('channel1', 'local', 'Old'))

    // Import new chain
    const tempStore = new MessageStore()
    const msg = await tempStore.createMessage('channel1', 'remote', 'New')
    await tempStore.addMessage(msg)

    const result = await store.importMessages('channel1', tempStore.getMessages('channel1'))
    expect(result.success).toBe(true)

    const messages = store.getMessages('channel1')
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('New')
  })

  test('importMessages rejects tampered chain', async () => {
    const tempStore = new MessageStore()
    const msg1 = await tempStore.createMessage('channel1', 'alice', 'First')
    await tempStore.addMessage(msg1)

    await new Promise(resolve => setTimeout(resolve, 5))

    const msg2 = await tempStore.createMessage('channel1', 'bob', 'Second')
    await tempStore.addMessage(msg2)

    const messages = tempStore.getMessages('channel1')

    // Tamper with prevHash (breaks chain linking)
    messages[1].prevHash = 'tampered-hash'

    const result = await store.importMessages('channel1', messages)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Tampered')
  })

  test('importMessages rejects broken prevHash chain', async () => {
    const msg1: PlaintextMessage = {
      id: 'msg1',
      channelId: 'channel1',
      senderId: 'alice',
      timestamp: Date.now(),
      content: 'First',
      type: 'text',
      prevHash: GENESIS_HASH,
      status: 'sent',
    }

    const msg2: PlaintextMessage = {
      id: 'msg2',
      channelId: 'channel1',
      senderId: 'bob',
      timestamp: Date.now() + 1000,
      content: 'Second',
      type: 'text',
      prevHash: 'wrong-hash', // Broken!
      status: 'sent',
    }

    const result = await store.importMessages('channel1', [msg1, msg2])
    expect(result.success).toBe(false)
    expect(result.error).toContain('Tampered')
  })
})

describe('MessageStore - Multiple Channels', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new MessageStore()
  })

  test('handles multiple independent channels', async () => {
    await store.addMessage(await store.createMessage('channel1', 'alice', 'C1-M1'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel2', 'bob', 'C2-M1'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel1', 'alice', 'C1-M2'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel2', 'bob', 'C2-M2'))

    expect(store.getMessages('channel1')).toHaveLength(2)
    expect(store.getMessages('channel2')).toHaveLength(2)
  })

  test('each channel has independent hash chain', async () => {
    const msg1 = await store.createMessage('channel1', 'alice', 'C1')
    await store.addMessage(msg1)

    const msg2 = await store.createMessage('channel2', 'bob', 'C2')
    await store.addMessage(msg2)

    // Both should have genesis as first prevHash
    expect(msg1.prevHash).toBe(GENESIS_HASH)
    expect(msg2.prevHash).toBe(GENESIS_HASH)
  })

  test('verifyChannel checks only specified channel', async () => {
    // Valid channel
    await store.addMessage(await store.createMessage('channel1', 'alice', 'Valid'))

    // Break another channel manually
    const badMsg: PlaintextMessage = {
      id: 'bad',
      channelId: 'channel2',
      senderId: 'eve',
      timestamp: Date.now(),
      content: 'Bad',
      type: 'text',
      prevHash: 'wrong-hash',
      status: 'sent',
    }

    // Force-add to internal store (bypass validation)
    store['channels'].set('channel2', [badMsg])

    // Channel 1 should still verify
    const result1 = await store.verifyChannel('channel1')
    expect(result1.valid).toBe(true)

    // Channel 2 should fail
    const result2 = await store.verifyChannel('channel2')
    expect(result2.valid).toBe(false)
  })
})

describe('MessageStore - Message Types', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new MessageStore()
  })

  test('supports different message types', async () => {
    await store.addMessage(await store.createMessage('channel1', 'alice', 'Text', 'text'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel1', 'bob', 'Image URL', 'file'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.addMessage(await store.createMessage('channel1', 'charlie', 'File path', 'file'))

    const messages = store.getMessages('channel1')
    expect(messages[0].type).toBe('text')
    expect(messages[1].type).toBe('file')
    expect(messages[2].type).toBe('file')
  })

  test('message type defaults to text', async () => {
    const msg = await store.createMessage('channel1', 'alice', 'Default')
    expect(msg.type).toBe('text')
  })
})

describe('MessageStore - Edge Cases', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new MessageStore()
  })

  test('handles empty content', async () => {
    const msg = await store.createMessage('channel1', 'alice', '')
    const result = await store.addMessage(msg)

    expect(result.success).toBe(true)
    expect(msg.content).toBe('')
  })

  test('rejects over-limit content', async () => {
    const longContent = 'x'.repeat(MAX_MESSAGE_CHARS + 1)
    await expect(store.createMessage('channel1', 'alice', longContent)).rejects.toThrow(/too long/i)
  })

  test('handles unicode content', async () => {
    const msg = await store.createMessage('channel1', 'alice', '🚀 你好 مرحبا')
    const result = await store.addMessage(msg)

    expect(result.success).toBe(true)
    expect(msg.content).toBe('🚀 你好 مرحبا')
  })

  test('handles rapid message creation', async () => {
    for (let i = 0; i < 100; i++) {
      const msg = await store.createMessage('channel1', 'alice', `Message ${i}`)
      await store.addMessage(msg)
      await new Promise(resolve => setTimeout(resolve, 1)) // Tiny delay for timestamps
    }

    expect(store.getMessages('channel1')).toHaveLength(100)

    const verification = await store.verifyChannel('channel1')
    expect(verification.valid).toBe(true)
  })

  test('generates unique message IDs', async () => {
    const msg1 = await store.createMessage('channel1', 'alice', 'A')
    const msg2 = await store.createMessage('channel1', 'alice', 'B')

    expect(msg1.id).not.toBe(msg2.id)
  })
})

describe('MessageStore - Thread Roots', () => {
  let store: MessageStore

  beforeEach(() => {
    store = new MessageStore()
  })

  test('setThreadRoot stores a snapshot', () => {
    const snapshot: PlaintextMessage = {
      id: 'parent1',
      channelId: 'channel1',
      senderId: 'alice',
      timestamp: Date.now(),
      content: 'Original message',
      type: 'text',
      prevHash: '',
      status: 'sent',
    }

    store.setThreadRoot('parent1', snapshot)
    const retrieved = store.getThreadRoot('parent1')

    expect(retrieved).toBeDefined()
    expect(retrieved!.content).toBe('Original message')
    expect(retrieved!.senderId).toBe('alice')
  })

  test('setThreadRoot is a no-op if root already exists', () => {
    const snapshot1: PlaintextMessage = {
      id: 'parent1',
      channelId: 'channel1',
      senderId: 'alice',
      timestamp: Date.now(),
      content: 'First version',
      type: 'text',
      prevHash: '',
      status: 'sent',
    }

    const snapshot2: PlaintextMessage = {
      id: 'parent1',
      channelId: 'channel1',
      senderId: 'alice',
      timestamp: Date.now(),
      content: 'Second version',
      type: 'text',
      prevHash: '',
      status: 'sent',
    }

    store.setThreadRoot('parent1', snapshot1)
    store.setThreadRoot('parent1', snapshot2)

    const retrieved = store.getThreadRoot('parent1')
    expect(retrieved!.content).toBe('First version')
  })

  test('getThreadRoot returns undefined for unknown thread', () => {
    const result = store.getThreadRoot('nonexistent')
    expect(result).toBeUndefined()
  })

  test('getAllThreadRoots returns all stored roots', () => {
    const snap1: PlaintextMessage = {
      id: 'p1', channelId: 'c1', senderId: 'alice',
      timestamp: Date.now(), content: 'Msg 1', type: 'text',
      prevHash: '', status: 'sent',
    }
    const snap2: PlaintextMessage = {
      id: 'p2', channelId: 'c1', senderId: 'bob',
      timestamp: Date.now(), content: 'Msg 2', type: 'text',
      prevHash: '', status: 'sent',
    }

    store.setThreadRoot('p1', snap1)
    store.setThreadRoot('p2', snap2)

    const all = store.getAllThreadRoots()
    expect(all.size).toBe(2)
    expect(all.get('p1')!.content).toBe('Msg 1')
    expect(all.get('p2')!.content).toBe('Msg 2')
  })

  test('getAllThreadRoots returns a copy (mutations do not affect store)', () => {
    const snap: PlaintextMessage = {
      id: 'p1', channelId: 'c1', senderId: 'alice',
      timestamp: Date.now(), content: 'Original', type: 'text',
      prevHash: '', status: 'sent',
    }

    store.setThreadRoot('p1', snap)
    const copy = store.getAllThreadRoots()
    copy.delete('p1')

    // Original store should be unaffected
    expect(store.getThreadRoot('p1')).toBeDefined()
    expect(store.getThreadRoot('p1')!.content).toBe('Original')
  })

  test('thread root is independent of hash chain', async () => {
    // Add normal messages with valid hash chain
    const msg1 = await store.createMessage('channel1', 'alice', 'Hello')
    await store.addMessage(msg1)

    // Store thread root (bypasses hash chain entirely)
    store.setThreadRoot(msg1.id, {
      id: msg1.id,
      channelId: msg1.channelId,
      senderId: msg1.senderId,
      timestamp: msg1.timestamp,
      content: msg1.content,
      type: msg1.type,
      prevHash: '',
      status: 'sent',
    })

    // Hash chain should still be valid
    const verification = await store.verifyChannel('channel1')
    expect(verification.valid).toBe(true)

    // Thread root should be retrievable
    expect(store.getThreadRoot(msg1.id)!.content).toBe('Hello')
  })

  test('thread root survives channel clear', () => {
    const snap: PlaintextMessage = {
      id: 'p1', channelId: 'channel1', senderId: 'alice',
      timestamp: Date.now(), content: 'Preserved', type: 'text',
      prevHash: '', status: 'sent',
    }

    store.setThreadRoot('p1', snap)
    store.clearChannel('channel1')

    // Thread root should still exist after channel clear
    expect(store.getThreadRoot('p1')).toBeDefined()
    expect(store.getThreadRoot('p1')!.content).toBe('Preserved')
  })
})
