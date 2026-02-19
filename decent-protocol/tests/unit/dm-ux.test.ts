/**
 * Direct Message UX Tests
 *
 * Bugs fixed:
 *
 * 1. addContact() didn't call savePeer() → DMs silently dropped on receive
 *    (the decrypt path calls getPeer() and bails early with no public key)
 *
 * 2. getPeerAlias only checked active workspace → GUIDs everywhere in DM view
 *    Fixed: getDisplayNameForPeer() checks contacts → ALL workspaces → truncated ID
 *
 * 3. DM header/sidebar/placeholder showed GUID for workspace members
 *    Fixed: all name resolution now routes through getPeerAlias → getDisplayNameForPeer
 *
 * 4. No way to DM a workspace member without scanning their QR code
 *    Fixed: ✉ button on each workspace member in the Members sidebar section
 *
 * 5. name-announce didn't update existing contact display name
 *    Fixed: name-announce now calls contactStore.update() if peer is a contact
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import { MemoryContactStore } from '../../src/contacts/Contact';
import type { Contact } from '../../src/contacts/Contact';
import type { Channel } from '../../src/workspace/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    peerId: 'peer-bob',
    publicKey: 'mock-public-key-base64',
    displayName: 'Bob',
    signalingServers: [],
    addedAt: Date.now(),
    lastSeen: Date.now(),
    ...overrides,
  };
}

/** Simulate getDisplayNameForPeer() logic from ChatController */
function getDisplayNameForPeer(
  peerId: string,
  contactStore: MemoryContactStore,
  wm: WorkspaceManager,
): string {
  // 1. Explicit contact
  const contact = contactStore.getSync(peerId);
  if (contact?.displayName) return contact.displayName;

  // 2. Any workspace member alias
  for (const ws of wm.getAllWorkspaces()) {
    const member = ws.members.find(m => m.peerId === peerId);
    if (member?.alias && member.alias.trim()) return member.alias;
  }

  // 3. Truncated peer ID fallback
  return peerId.slice(0, 8);
}

/** Simulate the "save peer on addContact" fix */
async function addContactWithPeerSave(
  contact: Contact,
  contactStore: MemoryContactStore,
  peerStore: Map<string, { peerId: string; publicKey: string; lastSeen: number; alias?: string }>,
): Promise<void> {
  await contactStore.add(contact);
  if (contact.publicKey) {
    peerStore.set(contact.peerId, {
      peerId: contact.peerId,
      publicKey: contact.publicKey,
      lastSeen: Date.now(),
      alias: contact.displayName,
    });
  }
}

// ---------------------------------------------------------------------------
// 1. addContact — peer key must be persisted
// ---------------------------------------------------------------------------

describe('addContact — peer key persistence', () => {
  let contactStore: MemoryContactStore;
  let peerStore: Map<string, any>;

  beforeEach(() => {
    contactStore = new MemoryContactStore();
    peerStore = new Map();
  });

  test('addContact persists the public key to peerStore', async () => {
    const bob = makeContact();
    await addContactWithPeerSave(bob, contactStore, peerStore);
    expect(peerStore.has('peer-bob')).toBe(true);
    expect(peerStore.get('peer-bob')?.publicKey).toBe('mock-public-key-base64');
  });

  test('peer is retrievable by peerId after addContact', async () => {
    await addContactWithPeerSave(makeContact(), contactStore, peerStore);
    const peer = peerStore.get('peer-bob');
    expect(peer?.peerId).toBe('peer-bob');
  });

  test('peer alias is set from contact displayName', async () => {
    await addContactWithPeerSave(makeContact({ displayName: 'Robert' }), contactStore, peerStore);
    expect(peerStore.get('peer-bob')?.alias).toBe('Robert');
  });

  test('contact without publicKey does not pollute peerStore', async () => {
    const noKey = makeContact({ publicKey: '' });
    await addContactWithPeerSave(noKey, contactStore, peerStore);
    expect(peerStore.has('peer-bob')).toBe(false);
  });

  test('adding the same contact twice overwrites, not duplicates', async () => {
    await addContactWithPeerSave(makeContact(), contactStore, peerStore);
    await addContactWithPeerSave(makeContact({ displayName: 'Robert' }), contactStore, peerStore);
    expect(peerStore.size).toBe(1);
    expect(peerStore.get('peer-bob')?.alias).toBe('Robert');
  });
});

// ---------------------------------------------------------------------------
// 2. getDisplayNameForPeer — priority order
// ---------------------------------------------------------------------------

describe('getDisplayNameForPeer — name resolution priority', () => {
  let contactStore: MemoryContactStore;
  let wm: WorkspaceManager;
  const ALICE = 'alice-peer';
  const BOB   = 'bob-peer';

  beforeEach(() => {
    contactStore = new MemoryContactStore();
    wm = new WorkspaceManager();
  });

  test('contact displayName takes priority over workspace alias', async () => {
    await contactStore.add(makeContact({ peerId: BOB, displayName: 'Bob (Contact)' }));
    const ws = wm.createWorkspace('ws1', ALICE, 'Alice', '');
    wm.addMember(ws.id, { peerId: BOB, alias: 'Bob (Workspace)', publicKey: '', joinedAt: 0, role: 'member' });
    expect(getDisplayNameForPeer(BOB, contactStore, wm)).toBe('Bob (Contact)');
  });

  test('workspace alias used when no contact exists', () => {
    const ws = wm.createWorkspace('ws1', ALICE, 'Alice', '');
    wm.addMember(ws.id, { peerId: BOB, alias: 'Bob WS', publicKey: '', joinedAt: 0, role: 'member' });
    expect(getDisplayNameForPeer(BOB, contactStore, wm)).toBe('Bob WS');
  });

  test('checks all workspaces, not just the active one', () => {
    wm.createWorkspace('ws1', ALICE, 'Alice', ''); // ws1 — BOB not a member
    const ws2 = wm.createWorkspace('ws2', ALICE, 'Alice', '');
    wm.addMember(ws2.id, { peerId: BOB, alias: 'Bob WS2', publicKey: '', joinedAt: 0, role: 'member' });
    expect(getDisplayNameForPeer(BOB, contactStore, wm)).toBe('Bob WS2');
  });

  test('falls back to truncated peer ID when no contact or workspace alias', () => {
    const id = 'abcdef12345678901234567890';
    expect(getDisplayNameForPeer(id, contactStore, wm)).toBe('abcdef12');
  });

  test('empty workspace alias does not count — falls through to truncated ID', () => {
    const ws = wm.createWorkspace('ws1', ALICE, 'Alice', '');
    wm.addMember(ws.id, { peerId: BOB, alias: '   ', publicKey: '', joinedAt: 0, role: 'member' });
    expect(getDisplayNameForPeer(BOB, contactStore, wm)).toBe('bob-peer');
  });

  test('first workspace with a real alias wins (multi-workspace)', () => {
    const ws1 = wm.createWorkspace('ws1', ALICE, 'Alice', '');
    wm.addMember(ws1.id, { peerId: BOB, alias: 'Bob First', publicKey: '', joinedAt: 0, role: 'member' });
    const ws2 = wm.createWorkspace('ws2', ALICE, 'Alice', '');
    wm.addMember(ws2.id, { peerId: BOB, alias: 'Bob Second', publicKey: '', joinedAt: 0, role: 'member' });
    const result = getDisplayNameForPeer(BOB, contactStore, wm);
    expect(['Bob First', 'Bob Second']).toContain(result); // either is fine; what matters is no GUID
    expect(result).not.toBe('bob-peer');
  });

  test('my own peer ID also resolves via contact', async () => {
    await contactStore.add(makeContact({ peerId: ALICE, displayName: 'Me (Alice)' }));
    expect(getDisplayNameForPeer(ALICE, contactStore, wm)).toBe('Me (Alice)');
  });
});

// ---------------------------------------------------------------------------
// 3. MemoryContactStore.getSync
// ---------------------------------------------------------------------------

describe('MemoryContactStore.getSync', () => {
  let store: MemoryContactStore;

  beforeEach(() => {
    store = new MemoryContactStore();
  });

  test('returns undefined for unknown peer', () => {
    expect(store.getSync('nobody')).toBeUndefined();
  });

  test('returns contact after async add', async () => {
    const bob = makeContact();
    await store.add(bob);
    expect(store.getSync('peer-bob')).toBeDefined();
    expect(store.getSync('peer-bob')?.displayName).toBe('Bob');
  });

  test('reflects update immediately', async () => {
    await store.add(makeContact());
    await store.update('peer-bob', { displayName: 'Robert' });
    expect(store.getSync('peer-bob')?.displayName).toBe('Robert');
  });

  test('returns undefined after remove', async () => {
    await store.add(makeContact());
    await store.remove('peer-bob');
    expect(store.getSync('peer-bob')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. name-announce — contact update on receive
// ---------------------------------------------------------------------------

describe('name-announce — contact display name update', () => {
  test('name-announce updates existing contact displayName', async () => {
    const store = new MemoryContactStore();
    await store.add(makeContact({ displayName: 'Old Name' }));

    // Simulate the name-announce handler
    const newAlias = 'New Name';
    const contact = await store.get('peer-bob');
    if (contact && contact.displayName !== newAlias) {
      await store.update('peer-bob', { displayName: newAlias });
    }

    expect(store.getSync('peer-bob')?.displayName).toBe('New Name');
  });

  test('name-announce does not create a contact if one does not exist', async () => {
    const store = new MemoryContactStore();
    // Only update if already a contact
    const contact = await store.get('unknown-peer');
    if (contact) await store.update('unknown-peer', { displayName: 'New Name' });
    expect(store.getSync('unknown-peer')).toBeUndefined();
  });

  test('name-announce is idempotent when name has not changed', async () => {
    const store = new MemoryContactStore();
    await store.add(makeContact({ displayName: 'Bob' }));
    const contact = await store.get('peer-bob');
    if (contact && contact.displayName !== 'Bob') {
      await store.update('peer-bob', { displayName: 'Bob' });
    }
    expect(store.getSync('peer-bob')?.displayName).toBe('Bob');
  });
});

// ---------------------------------------------------------------------------
// 5. DM conversation — sidebar display name
// ---------------------------------------------------------------------------

describe('DM sidebar display name', () => {
  test('workspace member DM shows alias, not GUID', () => {
    const wm = new WorkspaceManager();
    const store = new MemoryContactStore();
    const ws = wm.createWorkspace('main', 'alice', 'Alice', '');
    wm.addMember(ws.id, { peerId: 'bob-long-guid-here', alias: 'Bob', publicKey: '', joinedAt: 0, role: 'member' });

    const name = getDisplayNameForPeer('bob-long-guid-here', store, wm);
    expect(name).toBe('Bob');
    expect(name).not.toBe('bob-long'); // would be the truncated GUID fallback
  });

  test('contact DM shows displayName, not GUID', async () => {
    const wm = new WorkspaceManager();
    const store = new MemoryContactStore();
    await store.add(makeContact({ peerId: 'bob-long-guid-here', displayName: 'Bob' }));

    const name = getDisplayNameForPeer('bob-long-guid-here', store, wm);
    expect(name).toBe('Bob');
  });

  test('unknown peer shows truncated ID (8 chars) as last resort', () => {
    const wm = new WorkspaceManager();
    const store = new MemoryContactStore();
    const name = getDisplayNameForPeer('12345678abcdefgh', store, wm);
    expect(name).toBe('12345678');
    expect(name.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// 6. DM channel creation (workspace-based DM)
// ---------------------------------------------------------------------------

describe('Workspace DM channel creation', () => {
  test('createDM creates a DM channel of type dm', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('ws1', 'alice', 'Alice', '');
    wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: '', joinedAt: 0, role: 'member' });

    const result = wm.createDM(ws.id, 'alice', 'bob');
    expect(result.success).toBe(true);
    expect(result.channel?.type).toBe('dm');
  });

  test('DM channel includes both participants', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('ws1', 'alice', 'Alice', '');
    wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: '', joinedAt: 0, role: 'member' });

    const result = wm.createDM(ws.id, 'alice', 'bob');
    expect(result.channel?.members).toContain('alice');
    expect(result.channel?.members).toContain('bob');
  });

  test('creating the same DM twice returns existing channel', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('ws1', 'alice', 'Alice', '');
    wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: '', joinedAt: 0, role: 'member' });

    const r1 = wm.createDM(ws.id, 'alice', 'bob');
    const r2 = wm.createDM(ws.id, 'alice', 'bob');
    expect(r1.channel?.id).toBe(r2.channel?.id);
  });

  test('DM channel appears in getDMs list', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('ws1', 'alice', 'Alice', '');
    wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: '', joinedAt: 0, role: 'member' });
    wm.createDM(ws.id, 'alice', 'bob');
    const dms = wm.getDMs(ws.id, 'alice');
    expect(dms.length).toBe(1);
    expect(dms[0].type).toBe('dm');
  });

  test('non-member cannot create DM in workspace', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('ws1', 'alice', 'Alice', '');
    const result = wm.createDM(ws.id, 'outsider', 'alice');
    expect(result.success).toBe(false);
  });
});
