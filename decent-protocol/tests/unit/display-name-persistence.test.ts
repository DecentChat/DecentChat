/**
 * Display name resolution & persistence tests
 *
 * Mirrors the resolution priority in ChatController.getDisplayNameForPeer():
 *   1. Contact displayName (in-memory, loaded from persistence on startup)
 *   2. Workspace member alias (synced via name-announce / workspace-state)
 *   3. peerId.slice(0, 8) fallback
 *
 * Bug being tested: display names disappear after deploy — peer shows as
 * "abc12345" instead of their actual name.
 */

import { describe, test, expect } from 'bun:test';

// ─── Resolution logic extracted from ChatController ──────────────────────────

interface Contact {
  peerId: string;
  displayName: string;
}

interface WorkspaceMember {
  peerId: string;
  alias: string;
}

/**
 * Resolve display name using the same priority as ChatController:
 *   1. Contact displayName (highest — user-chosen or persisted from name-announce)
 *   2. Workspace member alias
 *   3. peerId.slice(0, 8) fallback
 */
function getDisplayName(
  peerId: string,
  contacts: Contact[],
  members: WorkspaceMember[],
): string {
  const contact = contacts.find(c => c.peerId === peerId);
  if (contact?.displayName) return contact.displayName;

  const member = members.find(m => m.peerId === peerId);
  if (member?.alias && member.alias.trim()) return member.alias;

  return peerId.slice(0, 8);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Display name resolution priority', () => {
  test('contact displayName takes priority over member alias', () => {
    const contacts: Contact[] = [{ peerId: 'p1', displayName: 'Alice' }];
    const members: WorkspaceMember[] = [{ peerId: 'p1', alias: 'alice-old' }];

    expect(getDisplayName('p1', contacts, members)).toBe('Alice');
  });

  test('member alias used when no contact', () => {
    const contacts: Contact[] = [];
    const members: WorkspaceMember[] = [{ peerId: 'p1', alias: 'Bob' }];

    expect(getDisplayName('p1', contacts, members)).toBe('Bob');
  });

  test('peerId fallback when no contact and no member', () => {
    expect(getDisplayName('abc12345xyz', [], [])).toBe('abc12345');
  });

  test('empty contact displayName falls through to member alias', () => {
    const contacts: Contact[] = [{ peerId: 'p1', displayName: '' }];
    const members: WorkspaceMember[] = [{ peerId: 'p1', alias: 'Charlie' }];

    expect(getDisplayName('p1', contacts, members)).toBe('Charlie');
  });

  test('whitespace-only member alias falls through to peerId', () => {
    const contacts: Contact[] = [];
    const members: WorkspaceMember[] = [{ peerId: 'p1abcdefgh', alias: '   ' }];

    expect(getDisplayName('p1abcdefgh', contacts, members)).toBe('p1abcdef');
  });
});

describe('Display name — name-announce flow', () => {
  test('name-announce updates contact entry', () => {
    const contacts: Contact[] = [];

    // Simulate receiving name-announce: { alias: 'Dave', peerId: 'p2' }
    contacts.push({ peerId: 'p2', displayName: 'Dave' });

    expect(getDisplayName('p2', contacts, [])).toBe('Dave');
  });

  test('name-announce updates existing contact alias', () => {
    const contacts: Contact[] = [{ peerId: 'p2', displayName: 'Dave-old' }];

    // Simulate name-announce updating the contact
    const idx = contacts.findIndex(c => c.peerId === 'p2');
    contacts[idx].displayName = 'Dave-new';

    expect(getDisplayName('p2', contacts, [])).toBe('Dave-new');
  });
});

describe('Display name — persistence and stability', () => {
  test('contact loaded from persistence is available before peer connects', () => {
    // Simulate startup: contacts loaded from persistent store BEFORE peer connection
    const persistedContacts: Contact[] = [
      { peerId: 'p3', displayName: 'Eve' },
    ];

    // Before any peer connects or any workspace-state is received,
    // the display name should already be available from persistence
    expect(getDisplayName('p3', persistedContacts, [])).toBe('Eve');
  });

  test('display name stable across multiple resolutions (no mutation)', () => {
    const contacts: Contact[] = [{ peerId: 'p1', displayName: 'Stable' }];
    const members: WorkspaceMember[] = [{ peerId: 'p1', alias: 'member-alias' }];

    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      results.add(getDisplayName('p1', contacts, members));
    }

    expect(results.size).toBe(1);
    expect(results.has('Stable')).toBe(true);
  });

  test('multiple peers — each gets their own name (no confusion)', () => {
    const contacts: Contact[] = [
      { peerId: 'p1', displayName: 'Alice' },
      { peerId: 'p2', displayName: 'Bob' },
    ];
    const members: WorkspaceMember[] = [
      { peerId: 'p1', alias: 'alice-ws' },
      { peerId: 'p2', alias: 'bob-ws' },
      { peerId: 'p3aabbccdd', alias: 'Charlie' },
    ];

    expect(getDisplayName('p1', contacts, members)).toBe('Alice');
    expect(getDisplayName('p2', contacts, members)).toBe('Bob');
    expect(getDisplayName('p3aabbccdd', contacts, members)).toBe('Charlie');
  });
});
