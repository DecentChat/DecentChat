/**
 * WorkspaceManager - CRUD for workspaces, channels, DMs
 * 
 * All state is local (IndexedDB) and synced P2P.
 * No server involved.
 */

import type { Workspace, WorkspaceMember, Channel, SyncMessage } from './types';

export class WorkspaceManager {
  private workspaces = new Map<string, Workspace>();

  // === Workspace CRUD ===

  createWorkspace(name: string, myPeerId: string, myAlias: string, myPublicKey: string): Workspace {
    const workspace: Workspace = {
      id: this.generateId(),
      name,
      inviteCode: this.generateInviteCode(),
      createdBy: myPeerId,
      createdAt: Date.now(),
      members: [
        {
          peerId: myPeerId,
          alias: myAlias,
          publicKey: myPublicKey,
          joinedAt: Date.now(),
          role: 'owner',
        },
      ],
      channels: [],
    };

    // Auto-create #general channel
    const general: Channel = {
      id: this.generateId(),
      workspaceId: workspace.id,
      name: 'general',
      type: 'channel',
      members: [myPeerId],
      createdBy: myPeerId,
      createdAt: Date.now(),
    };

    workspace.channels.push(general);
    this.workspaces.set(workspace.id, workspace);

    return workspace;
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  getAllWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  deleteWorkspace(id: string, requesterId: string): boolean {
    const workspace = this.workspaces.get(id);
    if (!workspace) return false;
    if (workspace.createdBy !== requesterId) return false;

    this.workspaces.delete(id);
    return true;
  }

  /** Remove a workspace by ID without ownership check (for internal sync remapping). */
  removeWorkspace(id: string): void {
    this.workspaces.delete(id);
  }

  // === Member Management ===

  addMember(workspaceId: string, member: WorkspaceMember): { success: boolean; error?: string } {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };

    if (workspace.members.find(m => m.peerId === member.peerId)) {
      return { success: false, error: 'Member already exists' };
    }

    workspace.members.push(member);

    // Add member to all public channels
    for (const channel of workspace.channels) {
      if (channel.type === 'channel' && !channel.members.includes(member.peerId)) {
        channel.members.push(member.peerId);
      }
    }

    return { success: true };
  }

  removeMember(workspaceId: string, peerId: string, requesterId: string): { success: boolean; error?: string } {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };
    if (workspace.createdBy !== requesterId) return { success: false, error: 'Only owner can remove members' };
    if (peerId === workspace.createdBy) return { success: false, error: 'Cannot remove owner' };

    workspace.members = workspace.members.filter(m => m.peerId !== peerId);

    // Remove from all channels
    for (const channel of workspace.channels) {
      channel.members = channel.members.filter(id => id !== peerId);
    }

    return { success: true };
  }

  getMember(workspaceId: string, peerId: string): WorkspaceMember | undefined {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.members.find(m => m.peerId === peerId);
  }

  // === Channel Management ===

  createChannel(
    workspaceId: string,
    name: string,
    createdBy: string,
    type: 'channel' | 'dm' = 'channel',
    members?: string[]
  ): { success: boolean; channel?: Channel; error?: string } {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };

    // Check creator is a member
    if (!workspace.members.find(m => m.peerId === createdBy)) {
      return { success: false, error: 'Not a workspace member' };
    }

    // Check channel name uniqueness (for non-DMs)
    if (type === 'channel' && workspace.channels.find(c => c.name === name && c.type === 'channel')) {
      return { success: false, error: `Channel #${name} already exists` };
    }

    const channel: Channel = {
      id: this.generateId(),
      workspaceId,
      name,
      type,
      members: members || workspace.members.map(m => m.peerId),
      createdBy,
      createdAt: Date.now(),
    };

    workspace.channels.push(channel);
    return { success: true, channel };
  }

  getChannel(workspaceId: string, channelId: string): Channel | undefined {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.channels.find(c => c.id === channelId);
  }

  getChannels(workspaceId: string): Channel[] {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.channels.filter(c => c.type === 'channel') || [];
  }

  // === DM Management ===

  createDM(workspaceId: string, peerId1: string, peerId2: string): { success: boolean; channel?: Channel; error?: string } {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };

    // Check if DM already exists between these two
    const existingDM = workspace.channels.find(c =>
      c.type === 'dm' &&
      c.members.length === 2 &&
      c.members.includes(peerId1) &&
      c.members.includes(peerId2)
    );

    if (existingDM) {
      return { success: true, channel: existingDM };
    }

    // Get aliases for DM name
    const member1 = workspace.members.find(m => m.peerId === peerId1);
    const member2 = workspace.members.find(m => m.peerId === peerId2);
    if (!member1 || !member2) return { success: false, error: 'Members not found in workspace' };

    return this.createChannel(
      workspaceId,
      `${member1.alias}, ${member2.alias}`,
      peerId1,
      'dm',
      [peerId1, peerId2]
    );
  }

  getDMs(workspaceId: string, peerId: string): Channel[] {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.channels.filter(c => c.type === 'dm' && c.members.includes(peerId)) || [];
  }

  // === Invite / Join ===

  validateInviteCode(inviteCode: string): Workspace | undefined {
    for (const workspace of this.workspaces.values()) {
      if (workspace.inviteCode === inviteCode) return workspace;
    }
    return undefined;
  }

  // === Sync ===

  /**
   * Import a full workspace (from sync)
   */
  importWorkspace(workspace: Workspace): void {
    this.workspaces.set(workspace.id, workspace);
  }

  /**
   * Export workspace for sync
   */
  exportWorkspace(workspaceId: string): Workspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  // === Helpers ===

  private generateId(): string {
    return crypto.randomUUID();
  }

  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
