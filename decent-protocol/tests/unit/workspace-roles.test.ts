/**
 * Workspace Roles & Permissions — Comprehensive Tests
 *
 * Covers: WorkspaceRole enum, permission checks, role changes,
 * backward compatibility, edge cases, and permission policies.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import { WorkspaceRole, DEFAULT_WORKSPACE_PERMISSIONS } from '../../src/workspace/types';
import type { Workspace, WorkspacePermissions } from '../../src/workspace/types';

// Helper to create a workspace with specific members
function setupWorkspace(wm: WorkspaceManager, opts?: {
  ownerPeerId?: string;
  extraMembers?: Array<{ peerId: string; role: 'owner' | 'admin' | 'member'; alias?: string }>;
  permissions?: Partial<WorkspacePermissions>;
}) {
  const ownerPeerId = opts?.ownerPeerId ?? 'owner-peer';
  const ws = wm.createWorkspace('Test Workspace', ownerPeerId, 'OwnerAlias', 'owner-pub-key');

  if (opts?.extraMembers) {
    for (const m of opts.extraMembers) {
      wm.addMember(ws.id, {
        peerId: m.peerId,
        alias: m.alias ?? m.peerId,
        publicKey: `${m.peerId}-pub`,
        joinedAt: Date.now(),
        role: 'member', // addMember always adds as member initially
      });
      // If a non-member role is requested, promote via direct mutation (for test setup)
      if (m.role === 'admin') {
        wm.promoteMember(ws.id, ownerPeerId, m.peerId, 'admin');
      }
    }
  }

  if (opts?.permissions) {
    wm.updatePermissions(ws.id, ownerPeerId, opts.permissions);
  }

  return ws;
}

describe('WorkspaceRole enum', () => {
  it('has correct values', () => {
    expect(WorkspaceRole.Owner).toBe('owner' as WorkspaceRole);
    expect(WorkspaceRole.Admin).toBe('admin' as WorkspaceRole);
    expect(WorkspaceRole.Member).toBe('member' as WorkspaceRole);
  });
});

describe('DEFAULT_WORKSPACE_PERMISSIONS', () => {
  it('defaults to everyone for both policies', () => {
    expect(DEFAULT_WORKSPACE_PERMISSIONS.whoCanCreateChannels).toBe('everyone');
    expect(DEFAULT_WORKSPACE_PERMISSIONS.whoCanInviteMembers).toBe('everyone');
    expect(DEFAULT_WORKSPACE_PERMISSIONS.revokedInviteIds).toEqual([]);
  });
});

describe('Workspace creation', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  it('creator becomes owner', () => {
    const ws = wm.createWorkspace('My WS', 'peer-1', 'Alice', 'pub-key');
    const member = ws.members.find(m => m.peerId === 'peer-1');
    expect(member).toBeDefined();
    expect(member!.role).toBe('owner');
  });

  it('workspace has default permissions', () => {
    const ws = wm.createWorkspace('My WS', 'peer-1', 'Alice', 'pub-key');
    expect(ws.permissions).toBeDefined();
    expect(ws.permissions!.whoCanCreateChannels).toBe('everyone');
    expect(ws.permissions!.whoCanInviteMembers).toBe('everyone');
  });

  it('new members get member role', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'member-1', role: 'member' }],
    });
    const member = ws.members.find(m => m.peerId === 'member-1');
    expect(member).toBeDefined();
    expect(member!.role).toBe('member');
  });
});

describe('isOwner / isAdmin', () => {
  let wm: WorkspaceManager;
  let ws: Workspace;

  beforeEach(() => {
    wm = new WorkspaceManager();
    ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
  });

  it('isOwner returns true for owner', () => {
    expect(wm.isOwner(ws.id, 'owner-peer')).toBe(true);
  });

  it('isOwner returns false for admin', () => {
    expect(wm.isOwner(ws.id, 'admin-1')).toBe(false);
  });

  it('isOwner returns false for member', () => {
    expect(wm.isOwner(ws.id, 'member-1')).toBe(false);
  });

  it('isOwner returns false for non-existent peer', () => {
    expect(wm.isOwner(ws.id, 'non-existent')).toBe(false);
  });

  it('isAdmin returns true for owner (owner is also admin)', () => {
    expect(wm.isAdmin(ws.id, 'owner-peer')).toBe(true);
  });

  it('isAdmin returns true for admin', () => {
    expect(wm.isAdmin(ws.id, 'admin-1')).toBe(true);
  });

  it('isAdmin returns false for member', () => {
    expect(wm.isAdmin(ws.id, 'member-1')).toBe(false);
  });

  it('isAdmin returns false for non-existent peer', () => {
    expect(wm.isAdmin(ws.id, 'non-existent')).toBe(false);
  });

  it('isAdmin returns false for non-existent workspace', () => {
    expect(wm.isAdmin('bogus-ws', 'owner-peer')).toBe(false);
  });
});

describe('promoteMember', () => {
  let wm: WorkspaceManager;
  let ws: Workspace;

  beforeEach(() => {
    wm = new WorkspaceManager();
    ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
        { peerId: 'member-2', role: 'member' },
      ],
    });
  });

  it('owner can promote member to admin', () => {
    const res = wm.promoteMember(ws.id, 'owner-peer', 'member-1', 'admin');
    expect(res.success).toBe(true);
    expect(wm.isAdmin(ws.id, 'member-1')).toBe(true);
  });

  it('admin cannot promote anyone', () => {
    const res = wm.promoteMember(ws.id, 'admin-1', 'member-1', 'admin');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Only the owner');
  });

  it('member cannot promote anyone', () => {
    const res = wm.promoteMember(ws.id, 'member-1', 'member-2', 'admin');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Only the owner');
  });

  it('cannot promote to owner', () => {
    const res = wm.promoteMember(ws.id, 'owner-peer', 'member-1', 'owner');
    expect(res.success).toBe(false);
    expect(res.error).toContain('owner');
  });

  it('cannot promote someone already admin', () => {
    const res = wm.promoteMember(ws.id, 'owner-peer', 'admin-1', 'admin');
    expect(res.success).toBe(false);
    expect(res.error).toContain('already');
  });

  it('cannot promote the owner', () => {
    const res = wm.promoteMember(ws.id, 'owner-peer', 'owner-peer', 'admin');
    expect(res.success).toBe(false);
    expect(res.error).toContain('already');
  });

  it('fails for non-existent workspace', () => {
    const res = wm.promoteMember('bogus', 'owner-peer', 'member-1', 'admin');
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });

  it('fails for non-existent target', () => {
    const res = wm.promoteMember(ws.id, 'owner-peer', 'non-existent', 'admin');
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });
});

describe('demoteMember', () => {
  let wm: WorkspaceManager;
  let ws: Workspace;

  beforeEach(() => {
    wm = new WorkspaceManager();
    ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'admin-2', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
  });

  it('owner can demote admin to member', () => {
    const res = wm.demoteMember(ws.id, 'owner-peer', 'admin-1');
    expect(res.success).toBe(true);
    expect(wm.isAdmin(ws.id, 'admin-1')).toBe(false);
    const member = ws.members.find(m => m.peerId === 'admin-1');
    expect(member!.role).toBe('member');
  });

  it('admin cannot demote other admin', () => {
    const res = wm.demoteMember(ws.id, 'admin-1', 'admin-2');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Only the owner');
  });

  it('member cannot demote anyone', () => {
    const res = wm.demoteMember(ws.id, 'member-1', 'admin-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Only the owner');
  });

  it('cannot demote the owner', () => {
    const res = wm.demoteMember(ws.id, 'owner-peer', 'owner-peer');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Cannot demote the owner');
  });

  it('cannot demote a regular member further', () => {
    const res = wm.demoteMember(ws.id, 'owner-peer', 'member-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('already a regular member');
  });

  it('fails for non-existent workspace', () => {
    const res = wm.demoteMember('bogus', 'owner-peer', 'admin-1');
    expect(res.success).toBe(false);
  });
});

describe('canRemoveMember', () => {
  let wm: WorkspaceManager;
  let ws: Workspace;

  beforeEach(() => {
    wm = new WorkspaceManager();
    ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
  });

  it('owner can remove member', () => {
    expect(wm.canRemoveMember(ws.id, 'owner-peer', 'member-1')).toBe(true);
  });

  it('owner can remove admin', () => {
    expect(wm.canRemoveMember(ws.id, 'owner-peer', 'admin-1')).toBe(true);
  });

  it('admin can remove member', () => {
    expect(wm.canRemoveMember(ws.id, 'admin-1', 'member-1')).toBe(true);
  });

  it('admin cannot remove owner', () => {
    expect(wm.canRemoveMember(ws.id, 'admin-1', 'owner-peer')).toBe(false);
  });

  it('member cannot remove anyone', () => {
    expect(wm.canRemoveMember(ws.id, 'member-1', 'admin-1')).toBe(false);
    expect(wm.canRemoveMember(ws.id, 'member-1', 'member-1')).toBe(false);
  });

  it('nobody can remove the owner', () => {
    expect(wm.canRemoveMember(ws.id, 'owner-peer', 'owner-peer')).toBe(false);
    expect(wm.canRemoveMember(ws.id, 'admin-1', 'owner-peer')).toBe(false);
  });

  it('returns false for non-existent workspace', () => {
    expect(wm.canRemoveMember('bogus', 'owner-peer', 'member-1')).toBe(false);
  });

  it('returns false for non-existent peers', () => {
    expect(wm.canRemoveMember(ws.id, 'non-existent', 'member-1')).toBe(false);
    expect(wm.canRemoveMember(ws.id, 'owner-peer', 'non-existent')).toBe(false);
  });
});

describe('removeMember with roles', () => {
  let wm: WorkspaceManager;
  let ws: Workspace;

  beforeEach(() => {
    wm = new WorkspaceManager();
    ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
  });

  it('owner can remove a member', () => {
    const res = wm.removeMember(ws.id, 'member-1', 'owner-peer');
    expect(res.success).toBe(true);
    expect(ws.members.find(m => m.peerId === 'member-1')).toBeUndefined();
  });

  it('admin can remove a member', () => {
    const res = wm.removeMember(ws.id, 'member-1', 'admin-1');
    expect(res.success).toBe(true);
  });

  it('admin cannot remove owner', () => {
    const res = wm.removeMember(ws.id, 'owner-peer', 'admin-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Cannot remove owner');
  });

  it('member cannot remove anyone', () => {
    const res = wm.removeMember(ws.id, 'admin-1', 'member-1');
    expect(res.success).toBe(false);
  });
});

describe('canCreateChannel', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  it('only owner/admin can create channels (policy)', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
    expect(wm.canCreateChannel(ws.id, 'owner-peer')).toBe(true);
    expect(wm.canCreateChannel(ws.id, 'admin-1')).toBe(true);
    expect(wm.canCreateChannel(ws.id, 'member-1')).toBe(false);
  });

  it('non-member cannot create channels', () => {
    const ws = setupWorkspace(wm);
    expect(wm.canCreateChannel(ws.id, 'stranger')).toBe(false);
  });

  it('returns false for non-existent workspace', () => {
    expect(wm.canCreateChannel('bogus', 'owner-peer')).toBe(false);
  });
});

describe('canInviteMembers', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  it('everyone can invite with default permissions', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'member-1', role: 'member' }],
    });
    expect(wm.canInviteMembers(ws.id, 'owner-peer')).toBe(true);
    expect(wm.canInviteMembers(ws.id, 'member-1')).toBe(true);
  });

  it('only admins can invite when restricted', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
      permissions: { whoCanInviteMembers: 'admins' },
    });
    expect(wm.canInviteMembers(ws.id, 'owner-peer')).toBe(true);
    expect(wm.canInviteMembers(ws.id, 'admin-1')).toBe(true);
    expect(wm.canInviteMembers(ws.id, 'member-1')).toBe(false);
  });
});

describe('createChannel with permission guard', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  it('member cannot create channel', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'member-1', role: 'member' }],
    });
    const res = wm.createChannel(ws.id, 'new-channel', 'member-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('admin');
  });

  it('admin can create channel', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'admin-1', role: 'admin' }],
    });
    const res = wm.createChannel(ws.id, 'new-channel', 'admin-1');
    expect(res.success).toBe(true);
  });

  it('owner can create channel', () => {
    const ws = setupWorkspace(wm);
    const res = wm.createChannel(ws.id, 'new-channel', 'owner-peer');
    expect(res.success).toBe(true);
  });
});

describe('removeChannel with permission guard', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  it('member cannot remove channel', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'member-1', role: 'member' }],
    });
    const created = wm.createChannel(ws.id, 'to-remove', 'owner-peer');
    expect(created.success).toBe(true);

    const res = wm.removeChannel(ws.id, created.channel!.id, 'member-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('admin');
  });

  it('admin can remove channel', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'admin-1', role: 'admin' }],
    });
    const created = wm.createChannel(ws.id, 'to-remove', 'owner-peer');
    expect(created.success).toBe(true);

    const res = wm.removeChannel(ws.id, created.channel!.id, 'admin-1');
    expect(res.success).toBe(true);
    expect(wm.getChannel(ws.id, created.channel!.id)).toBeUndefined();
  });

  it('owner can remove channel', () => {
    const ws = setupWorkspace(wm);
    const created = wm.createChannel(ws.id, 'to-remove', 'owner-peer');
    expect(created.success).toBe(true);

    const res = wm.removeChannel(ws.id, created.channel!.id, 'owner-peer');
    expect(res.success).toBe(true);
  });

  it('cannot remove #general channel', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'admin-1', role: 'admin' }],
    });
    const general = ws.channels.find(c => c.name === 'general');
    expect(general).toBeDefined();

    const res = wm.removeChannel(ws.id, general!.id, 'admin-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('general');
  });
});

describe('updatePermissions', () => {
  let wm: WorkspaceManager;
  let ws: Workspace;

  beforeEach(() => {
    wm = new WorkspaceManager();
    ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
  });

  it('owner can update permissions', () => {
    const res = wm.updatePermissions(ws.id, 'owner-peer', { whoCanCreateChannels: 'admins' });
    expect(res.success).toBe(true);
    expect(wm.getPermissions(ws.id).whoCanCreateChannels).toBe('admins');
  });

  it('admin can update permissions', () => {
    const res = wm.updatePermissions(ws.id, 'admin-1', { whoCanInviteMembers: 'admins' });
    expect(res.success).toBe(true);
    expect(wm.getPermissions(ws.id).whoCanInviteMembers).toBe('admins');
  });

  it('member cannot update permissions', () => {
    const res = wm.updatePermissions(ws.id, 'member-1', { whoCanCreateChannels: 'admins' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('admins and owners');
  });

  it('partial update preserves other settings', () => {
    wm.updatePermissions(ws.id, 'owner-peer', { whoCanCreateChannels: 'admins' });
    wm.updatePermissions(ws.id, 'owner-peer', { whoCanInviteMembers: 'admins' });
    const perms = wm.getPermissions(ws.id);
    expect(perms.whoCanCreateChannels).toBe('admins');
    expect(perms.whoCanInviteMembers).toBe('admins');
  });

  it('can persist revoked invite ids and dedupe values', () => {
    const res = wm.updatePermissions(ws.id, 'owner-peer', {
      revokedInviteIds: ['inv-a', 'inv-b', 'inv-a', '  inv-c  ', ''],
    });
    expect(res.success).toBe(true);
    expect(wm.getPermissions(ws.id).revokedInviteIds).toEqual(['inv-a', 'inv-b', 'inv-c']);
  });

  it('isInviteRevoked returns true only for revoked ids', () => {
    wm.updatePermissions(ws.id, 'owner-peer', { revokedInviteIds: ['inv-x'] });
    expect(wm.isInviteRevoked(ws.id, 'inv-x')).toBe(true);
    expect(wm.isInviteRevoked(ws.id, 'inv-y')).toBe(false);
    expect(wm.isInviteRevoked(ws.id, undefined)).toBe(false);
  });

  it('fails for non-existent workspace', () => {
    const res = wm.updatePermissions('bogus', 'owner-peer', { whoCanCreateChannels: 'admins' });
    expect(res.success).toBe(false);
  });
});

describe('updateWorkspaceInfo', () => {
  let wm: WorkspaceManager;
  let ws: Workspace;

  beforeEach(() => {
    wm = new WorkspaceManager();
    ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
  });

  it('owner can update name', () => {
    const res = wm.updateWorkspaceInfo(ws.id, 'owner-peer', { name: 'New Name' });
    expect(res.success).toBe(true);
    expect(wm.getWorkspace(ws.id)!.name).toBe('New Name');
  });

  it('admin can update description', () => {
    const res = wm.updateWorkspaceInfo(ws.id, 'admin-1', { description: 'Hello world' });
    expect(res.success).toBe(true);
    expect(wm.getWorkspace(ws.id)!.description).toBe('Hello world');
  });

  it('member cannot update workspace info', () => {
    const res = wm.updateWorkspaceInfo(ws.id, 'member-1', { name: 'Hacked' });
    expect(res.success).toBe(false);
  });

  it('can update both name and description', () => {
    const res = wm.updateWorkspaceInfo(ws.id, 'owner-peer', { name: 'WS', description: 'Desc' });
    expect(res.success).toBe(true);
    const updated = wm.getWorkspace(ws.id)!;
    expect(updated.name).toBe('WS');
    expect(updated.description).toBe('Desc');
  });
});

describe('deleteWorkspace', () => {
  let wm: WorkspaceManager;
  let ws: Workspace;

  beforeEach(() => {
    wm = new WorkspaceManager();
    ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
  });

  it('owner can delete workspace', () => {
    expect(wm.deleteWorkspace(ws.id, 'owner-peer')).toBe(true);
    expect(wm.getWorkspace(ws.id)).toBeUndefined();
  });

  it('admin cannot delete workspace', () => {
    expect(wm.deleteWorkspace(ws.id, 'admin-1')).toBe(false);
    expect(wm.getWorkspace(ws.id)).toBeDefined();
  });

  it('member cannot delete workspace', () => {
    expect(wm.deleteWorkspace(ws.id, 'member-1')).toBe(false);
    expect(wm.getWorkspace(ws.id)).toBeDefined();
  });
});

describe('canPromoteMember', () => {
  let wm: WorkspaceManager;
  let ws: Workspace;

  beforeEach(() => {
    wm = new WorkspaceManager();
    ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
  });

  it('owner can promote', () => {
    expect(wm.canPromoteMember(ws.id, 'owner-peer')).toBe(true);
  });

  it('admin cannot promote', () => {
    expect(wm.canPromoteMember(ws.id, 'admin-1')).toBe(false);
  });

  it('member cannot promote', () => {
    expect(wm.canPromoteMember(ws.id, 'member-1')).toBe(false);
  });
});

describe('Backward compatibility', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  it('importWorkspace adds default permissions if missing', () => {
    const legacyWs: any = {
      id: 'legacy-1',
      name: 'Legacy WS',
      inviteCode: 'abc123',
      createdBy: 'peer-1',
      createdAt: Date.now(),
      members: [
        { peerId: 'peer-1', alias: 'Alice', publicKey: 'pk', joinedAt: Date.now(), role: 'owner' },
      ],
      channels: [],
      // No permissions field
    };

    wm.importWorkspace(legacyWs);
    const imported = wm.getWorkspace('legacy-1');
    expect(imported).toBeDefined();
    expect(imported!.permissions).toBeDefined();
    expect(imported!.permissions!.whoCanCreateChannels).toBe('everyone');
    expect(imported!.permissions!.whoCanInviteMembers).toBe('everyone');
  });

  it('importWorkspace normalizes invalid roles to member', () => {
    const legacyWs: any = {
      id: 'legacy-2',
      name: 'Legacy WS 2',
      inviteCode: 'abc456',
      createdBy: 'peer-1',
      createdAt: Date.now(),
      members: [
        { peerId: 'peer-1', alias: 'Alice', publicKey: 'pk', joinedAt: Date.now(), role: 'owner' },
        { peerId: 'peer-2', alias: 'Bob', publicKey: 'pk2', joinedAt: Date.now(), role: 'bogus-role' },
      ],
      channels: [],
    };

    wm.importWorkspace(legacyWs);
    const imported = wm.getWorkspace('legacy-2');
    const bob = imported!.members.find(m => m.peerId === 'peer-2');
    expect(bob!.role).toBe('member');
  });

  it('importWorkspace preserves valid admin role', () => {
    const ws: any = {
      id: 'ws-3',
      name: 'WS 3',
      inviteCode: 'abc789',
      createdBy: 'peer-1',
      createdAt: Date.now(),
      members: [
        { peerId: 'peer-1', alias: 'Alice', publicKey: 'pk', joinedAt: Date.now(), role: 'owner' },
        { peerId: 'peer-2', alias: 'Bob', publicKey: 'pk2', joinedAt: Date.now(), role: 'admin' },
      ],
      channels: [],
      permissions: { whoCanCreateChannels: 'admins', whoCanInviteMembers: 'everyone' },
    };

    wm.importWorkspace(ws);
    const imported = wm.getWorkspace('ws-3');
    const bob = imported!.members.find(m => m.peerId === 'peer-2');
    expect(bob!.role).toBe('admin');
    expect(imported!.permissions!.whoCanCreateChannels).toBe('admins');
  });

  it('getPermissions returns defaults for workspace without permissions', () => {
    const legacyWs: any = {
      id: 'legacy-no-perms',
      name: 'No Perms',
      inviteCode: 'nop',
      createdBy: 'peer-1',
      createdAt: Date.now(),
      members: [
        { peerId: 'peer-1', alias: 'A', publicKey: 'pk', joinedAt: Date.now(), role: 'owner' },
      ],
      channels: [],
    };
    // Bypass importWorkspace to test getPermissions with missing permissions
    (wm as any).workspaces.set('legacy-no-perms', legacyWs);
    const perms = wm.getPermissions('legacy-no-perms');
    expect(perms.whoCanCreateChannels).toBe('everyone');
    expect(perms.whoCanInviteMembers).toBe('everyone');
  });
});

describe('Complex role scenarios', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  it('promote then demote restores member role', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'peer-1', role: 'member' }],
    });

    wm.promoteMember(ws.id, 'owner-peer', 'peer-1', 'admin');
    expect(wm.isAdmin(ws.id, 'peer-1')).toBe(true);

    wm.demoteMember(ws.id, 'owner-peer', 'peer-1');
    expect(wm.isAdmin(ws.id, 'peer-1')).toBe(false);
    expect(ws.members.find(m => m.peerId === 'peer-1')!.role).toBe('member');
  });

  it('removing an admin works', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'admin-1', role: 'admin' }],
    });
    const res = wm.removeMember(ws.id, 'admin-1', 'owner-peer');
    expect(res.success).toBe(true);
    expect(ws.members.find(m => m.peerId === 'admin-1')).toBeUndefined();
  });

  it('channel creation follows role changes immediately', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [{ peerId: 'member-1', role: 'member' }],
    });

    // Members cannot create channels
    expect(wm.canCreateChannel(ws.id, 'member-1')).toBe(false);

    // Promote member to admin
    wm.promoteMember(ws.id, 'owner-peer', 'member-1', 'admin');
    expect(wm.canCreateChannel(ws.id, 'member-1')).toBe(true);

    // Demote back
    wm.demoteMember(ws.id, 'owner-peer', 'member-1');
    expect(wm.canCreateChannel(ws.id, 'member-1')).toBe(false);
  });

  it('admin-only admin removal: admin can remove another admin\'s promoted member', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });
    // admin-1 removes member-1
    const res = wm.removeMember(ws.id, 'member-1', 'admin-1');
    expect(res.success).toBe(true);
  });

  it('multiple admins scenario', () => {
    const ws = setupWorkspace(wm, {
      extraMembers: [
        { peerId: 'admin-1', role: 'admin' },
        { peerId: 'admin-2', role: 'admin' },
        { peerId: 'member-1', role: 'member' },
      ],
    });

    // Both admins can remove members
    expect(wm.canRemoveMember(ws.id, 'admin-1', 'member-1')).toBe(true);
    expect(wm.canRemoveMember(ws.id, 'admin-2', 'member-1')).toBe(true);

    // Admins cannot remove each other (they're admins, not owners)
    // Actually, canRemoveMember checks: target is not owner, actor is admin or owner
    // So admin CAN remove other admin
    expect(wm.canRemoveMember(ws.id, 'admin-1', 'admin-2')).toBe(true);
  });
});
