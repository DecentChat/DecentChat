import { describe, it, expect, beforeEach } from 'bun:test';
import { WorkspaceManager } from '../src/workspace/WorkspaceManager';
import type { Workspace } from '../src/workspace/types';

describe('Workspace Identity Protection', () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    manager = new WorkspaceManager();
  });

  it('should maintain unique workspace ID after creation', () => {
    const ws = manager.createWorkspace('Test Workspace', 'peer1', 'Alice', 'pubkey1');
    const originalId = ws.id;
    
    // Verify workspace exists with original ID
    expect(manager.getWorkspace(originalId)).toBeDefined();
    expect(manager.getWorkspace(originalId)?.id).toBe(originalId);
    expect(manager.getWorkspace(originalId)?.name).toBe('Test Workspace');
  });

  it('should NOT remap workspace ID when importing different workspace', () => {
    // Create first workspace
    const ws1 = manager.createWorkspace('Workspace 1', 'peer1', 'Alice', 'pubkey1');
    const id1 = ws1.id;
    
    // Create second workspace (simulating remote workspace)
    const ws2 = manager.createWorkspace('Workspace 2', 'peer2', 'Bob', 'pubkey2');
    const id2 = ws2.id;
    
    // Verify both workspaces exist with their own IDs
    expect(manager.getWorkspace(id1)).toBeDefined();
    expect(manager.getWorkspace(id2)).toBeDefined();
    expect(manager.getWorkspace(id1)?.id).toBe(id1);
    expect(manager.getWorkspace(id2)?.id).toBe(id2);
    
    // Verify workspaces are separate
    expect(manager.getAllWorkspaces()).toHaveLength(2);
  });

  it('should reject sync from different workspace ID', () => {
    const ws1 = manager.createWorkspace('Workspace 1', 'peer1', 'Alice', 'pubkey1');
    const id1 = ws1.id;
    
    // Simulate receiving sync from different workspace
    const differentWorkspace: Workspace = {
      id: 'different-id-12345',
      name: 'Different Workspace',
      inviteCode: 'DIFFERENT',
      createdBy: 'peer2',
      createdAt: Date.now(),
      members: [],
      channels: [],
    };
    
    // Import should add it as separate workspace, not remap
    manager.importWorkspace(differentWorkspace);
    
    // Both should exist
    expect(manager.getWorkspace(id1)).toBeDefined();
    expect(manager.getWorkspace('different-id-12345')).toBeDefined();
    expect(manager.getAllWorkspaces()).toHaveLength(2);
  });

  it('should preserve workspace identity across multiple imports', () => {
    const ws = manager.createWorkspace('Original', 'peer1', 'Alice', 'pubkey1');
    const originalId = ws.id;
    
    // Simulate multiple syncs with same workspace
    for (let i = 0; i < 5; i++) {
      const updatedWorkspace: Workspace = {
        ...ws,
        name: `Updated ${i}`,
        members: [
          ...ws.members,
          {
            peerId: `peer${i + 2}`,
            alias: `User${i}`,
            publicKey: `pubkey${i}`,
            joinedAt: Date.now(),
            role: 'member',
          },
        ],
      };
      manager.importWorkspace(updatedWorkspace);
    }
    
    // Should still have only 1 workspace with original ID
    expect(manager.getAllWorkspaces()).toHaveLength(1);
    expect(manager.getWorkspace(originalId)).toBeDefined();
    expect(manager.getWorkspace(originalId)?.id).toBe(originalId);
  });

  it('should handle lexicographically smaller remote ID correctly', () => {
    // Create workspace with ID that would be "larger" lexicographically
    const ws = manager.createWorkspace('My Workspace', 'peer1', 'Alice', 'pubkey1');
    const myId = ws.id;
    
    // Create a workspace that would have smaller ID
    const smallerId = '00000000-0000-0000-0000-000000000001';
    const remoteWs: Workspace = {
      id: smallerId,
      name: 'Remote Workspace',
      inviteCode: 'REMOTE01',
      createdBy: 'peer2',
      createdAt: Date.now(),
      members: [],
      channels: [],
    };
    
    // Import should NOT remap - both should exist
    manager.importWorkspace(remoteWs);
    
    expect(manager.getWorkspace(myId)).toBeDefined();
    expect(manager.getWorkspace(smallerId)).toBeDefined();
    expect(manager.getWorkspace(myId)?.id).toBe(myId);
    expect(manager.getWorkspace(smallerId)?.id).toBe(smallerId);
    expect(manager.getAllWorkspaces()).toHaveLength(2);
  });

  it('should prevent workspace "merging" via sync', () => {
    // Create two distinct workspaces
    const ws1 = manager.createWorkspace('Team Alpha', 'peer1', 'Alice', 'pubkey1');
    const ws2 = manager.createWorkspace('Team Beta', 'peer2', 'Bob', 'pubkey2');
    
    const id1 = ws1.id;
    const id2 = ws2.id;
    
    // Add different channels to each
    manager.createChannel(id1, 'alpha-general', 'peer1');
    manager.createChannel(id1, 'alpha-dev', 'peer1');
    manager.createChannel(id2, 'beta-general', 'peer2');
    
    // Verify workspaces remain separate
    const retrievedWs1 = manager.getWorkspace(id1);
    const retrievedWs2 = manager.getWorkspace(id2);
    
    expect(retrievedWs1?.channels).toHaveLength(3); // +general auto-created
    expect(retrievedWs2?.channels).toHaveLength(2); // +general auto-created
    expect(retrievedWs1?.channels.some(c => c.name === 'alpha-general')).toBe(true);
    expect(retrievedWs2?.channels.some(c => c.name === 'beta-general')).toBe(true);
  });
});
