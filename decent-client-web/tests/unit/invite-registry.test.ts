import { describe, expect, test } from 'bun:test';
import {
  buildWorkspaceInviteLists,
  markInviteRevokedInRegistry,
  normalizeWorkspaceInviteRegistry,
  recordGeneratedInvite,
  type WorkspaceInviteRegistry,
} from '../../src/app/inviteRegistry';

describe('inviteRegistry helpers', () => {
  test('normalizeWorkspaceInviteRegistry filters invalid entries and deduplicates by inviteId', () => {
    const now = Date.now();
    const raw = {
      'ws-1': [
        { inviteId: 'inv-a', createdAt: now - 10, url: 'https://decentchat.app/join/A' },
        { inviteId: 'inv-a', createdAt: now, url: 'https://decentchat.app/join/B' },
        { inviteId: '   ' },
        null,
      ],
      'ws-2': 'invalid',
    };

    const normalized = normalizeWorkspaceInviteRegistry(raw);

    expect(Object.keys(normalized)).toEqual(['ws-1']);
    expect(normalized['ws-1']).toHaveLength(1);
    expect(normalized['ws-1'][0].inviteId).toBe('inv-a');
    expect(normalized['ws-1'][0].url).toBe('https://decentchat.app/join/B');
  });

  test('recordGeneratedInvite stores expiring invite metadata', () => {
    const createdAt = 1700000000000;
    const registry: WorkspaceInviteRegistry = {};

    const next = recordGeneratedInvite(registry, 'ws-1', {
      host: 'localhost',
      port: 9000,
      inviteCode: 'ABCD1234',
      secure: false,
      path: '/peerjs',
      fallbackServers: [],
      turnServers: [],
      inviteId: 'inv-exp',
      inviterId: 'peer-alex',
      expiresAt: createdAt + 7 * 24 * 60 * 60 * 1000,
    }, 'http://localhost:5173/join/ABCD1234?i=inv-exp', createdAt);

    expect(next['ws-1']).toHaveLength(1);
    expect(next['ws-1'][0]).toMatchObject({
      inviteId: 'inv-exp',
      inviteCode: 'ABCD1234',
      inviterId: 'peer-alex',
      permanent: false,
      createdAt,
    });
  });

  test('markInviteRevokedInRegistry marks existing invite and creates tombstone when missing', () => {
    const now = 1700000100000;
    const registry: WorkspaceInviteRegistry = {
      'ws-1': [
        { inviteId: 'inv-a', createdAt: now - 1000, permanent: true, url: 'https://decentchat.app/join/PERM' },
      ],
    };

    const once = markInviteRevokedInRegistry(registry, 'ws-1', 'inv-a', now);
    expect(once['ws-1'][0].inviteId).toBe('inv-a');
    expect(once['ws-1'][0].revokedAt).toBe(now);

    const twice = markInviteRevokedInRegistry(once, 'ws-1', 'inv-missing', now + 1000);
    expect(twice['ws-1'].find((entry) => entry.inviteId === 'inv-missing')).toMatchObject({
      inviteId: 'inv-missing',
      revokedAt: now + 1000,
    });
  });

  test('buildWorkspaceInviteLists splits active and revoked invites, including legacy revoked IDs', () => {
    const registry: WorkspaceInviteRegistry = {
      'ws-1': [
        {
          inviteId: 'inv-active',
          inviteCode: 'AAA11111',
          url: 'https://decentchat.app/join/AAA11111?i=inv-active',
          createdAt: 200,
          expiresAt: 500,
          inviterId: 'peer-1',
          permanent: false,
        },
        {
          inviteId: 'inv-local-revoked',
          inviteCode: 'BBB22222',
          url: 'https://decentchat.app/join/BBB22222?i=inv-local-revoked',
          createdAt: 100,
          inviterId: 'peer-2',
          permanent: true,
          revokedAt: 300,
        },
      ],
    };

    const lists = buildWorkspaceInviteLists(registry, 'ws-1', ['inv-local-revoked', 'inv-legacy']);

    expect(lists.active.map((i) => i.inviteId)).toEqual(['inv-active']);
    expect(lists.revoked.map((i) => i.inviteId)).toEqual(['inv-local-revoked', 'inv-legacy']);

    const legacy = lists.revoked.find((i) => i.inviteId === 'inv-legacy');
    expect(legacy).toBeDefined();
    expect(legacy!.permanent).toBeNull();
    expect(legacy!.revoked).toBe(true);
  });
});
