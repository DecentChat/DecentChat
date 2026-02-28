import { describe, test, expect } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';

describe('WorkspaceManager - Identity Lookup', () => {
  test('getMemberByIdentity finds member by identityId', () => {
    const mgr = new WorkspaceManager();
    const ws = mgr.createWorkspace('Test', 'owner-peer', 'Owner', 'OwnerKey');
    const wsId = ws.id;
    mgr.addMember(wsId, {
      peerId: 'peer-1',
      alias: 'Alice',
      publicKey: 'key-1',
      identityId: 'abc123def4567890',
      joinedAt: Date.now(),
      role: 'member',
    });

    const found = mgr.getMemberByIdentity(wsId, 'abc123def4567890');
    expect(found).toBeDefined();
    expect(found!.peerId).toBe('peer-1');
    expect(found!.alias).toBe('Alice');
  });

  test('getMemberByIdentity returns undefined for unknown identityId', () => {
    const mgr = new WorkspaceManager();
    const ws = mgr.createWorkspace('Test', 'owner-peer', 'Owner', 'OwnerKey');
    const wsId = ws.id;

    const found = mgr.getMemberByIdentity(wsId, 'nonexistent');
    expect(found).toBeUndefined();
  });

  test('getMember and getMemberByIdentity find same member', () => {
    const mgr = new WorkspaceManager();
    const ws = mgr.createWorkspace('Test', 'owner-peer', 'Owner', 'OwnerKey');
    const wsId = ws.id;
    mgr.addMember(wsId, {
      peerId: 'peer-2',
      alias: 'Bob',
      publicKey: 'key-2',
      identityId: 'bob-identity-0001',
      joinedAt: Date.now(),
      role: 'member',
    });

    const byPeerId = mgr.getMember(wsId, 'peer-2');
    const byIdentity = mgr.getMemberByIdentity(wsId, 'bob-identity-0001');
    expect(byPeerId).toEqual(byIdentity);
  });

  test('getMemberByIdentity works when some members lack identityId', () => {
    const mgr = new WorkspaceManager();
    const ws = mgr.createWorkspace('Test', 'owner-peer', 'Owner', 'OwnerKey');
    const wsId = ws.id;
    // Legacy member without identityId
    mgr.addMember(wsId, {
      peerId: 'legacy-peer',
      alias: 'Legacy',
      publicKey: 'key-legacy',
      joinedAt: Date.now(),
      role: 'member',
    });
    // New member with identityId
    mgr.addMember(wsId, {
      peerId: 'new-peer',
      alias: 'New',
      publicKey: 'key-new',
      identityId: 'new-id-12345678',
      joinedAt: Date.now(),
      role: 'member',
    });

    expect(mgr.getMemberByIdentity(wsId, 'new-id-12345678')?.alias).toBe('New');
    // Searching for undefined identityId should not match legacy member
    expect(mgr.getMemberByIdentity(wsId, 'undefined')).toBeUndefined();
  });
});
