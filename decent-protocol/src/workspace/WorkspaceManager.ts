/**
 * WorkspaceManager - CRUD for workspaces, channels, DMs
 *
 * All state is local (IndexedDB) and synced P2P.
 * No server involved.
 */

import type { Workspace, WorkspaceMember, Channel, SyncMessage, WorkspacePermissions } from './types';
import { DEFAULT_WORKSPACE_PERMISSIONS } from './types';

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
      permissions: { ...DEFAULT_WORKSPACE_PERMISSIONS },
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
    if (!this.isOwner(id, requesterId)) return false;

    this.workspaces.delete(id);
    return true;
  }

  /** Remove a workspace by ID without ownership check (for internal sync remapping). */
  removeWorkspace(id: string): void {
    this.workspaces.delete(id);
  }

  // === Permission Checks ===

  /** Get the effective permissions for a workspace (with backward-compat defaults). */
  getPermissions(workspaceId: string): WorkspacePermissions {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.permissions ?? { ...DEFAULT_WORKSPACE_PERMISSIONS };
  }

  /** Update workspace permissions. Only Owner or Admin can do this. */
  updatePermissions(
    workspaceId: string,
    actorPeerId: string,
    permissions: Partial<WorkspacePermissions>,
  ): { success: boolean; error?: string } {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };
    if (!this.isAdmin(workspaceId, actorPeerId)) {
      return { success: false, error: 'Only admins and owners can change workspace settings' };
    }

    workspace.permissions = {
      ...(workspace.permissions ?? { ...DEFAULT_WORKSPACE_PERMISSIONS }),
      ...permissions,
    };
    return { success: true };
  }

  /** Update workspace name/description. Only Owner or Admin can do this. */
  updateWorkspaceInfo(
    workspaceId: string,
    actorPeerId: string,
    updates: { name?: string; description?: string },
  ): { success: boolean; error?: string } {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };
    if (!this.isAdmin(workspaceId, actorPeerId)) {
      return { success: false, error: 'Only admins and owners can change workspace info' };
    }

    if (updates.name !== undefined) workspace.name = updates.name;
    if (updates.description !== undefined) workspace.description = updates.description;
    return { success: true };
  }

  isOwner(workspaceId: string, peerId: string): boolean {
    const member = this.getMember(workspaceId, peerId);
    return member?.role === 'owner';
  }

  isAdmin(workspaceId: string, peerId: string): boolean {
    const member = this.getMember(workspaceId, peerId);
    return member?.role === 'owner' || member?.role === 'admin';
  }

  canCreateChannel(workspaceId: string, peerId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    const member = workspace.members.find(m => m.peerId === peerId);
    if (!member) return false;

    // Product policy: only owner/admin can create channels.
    return this.isAdmin(workspaceId, peerId);
  }

  canRemoveChannel(workspaceId: string, peerId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    const member = workspace.members.find(m => m.peerId === peerId);
    if (!member) return false;

    // Product policy: only owner/admin can remove channels.
    return this.isAdmin(workspaceId, peerId);
  }

  canInviteMembers(workspaceId: string, peerId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    const member = workspace.members.find(m => m.peerId === peerId);
    if (!member) return false;

    const perms = workspace.permissions ?? DEFAULT_WORKSPACE_PERMISSIONS;
    if (perms.whoCanInviteMembers === 'everyone') return true;
    return this.isAdmin(workspaceId, peerId);
  }

  canRemoveMember(workspaceId: string, actorPeerId: string, targetPeerId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;

    const actor = workspace.members.find(m => m.peerId === actorPeerId);
    const target = workspace.members.find(m => m.peerId === targetPeerId);
    if (!actor || !target) return false;

    // Cannot remove an owner
    if (target.role === 'owner') return false;
    // Owner and Admin can remove non-owners
    return actor.role === 'owner' || actor.role === 'admin';
  }

  canPromoteMember(workspaceId: string, actorPeerId: string): boolean {
    // Only owners can promote members
    return this.isOwner(workspaceId, actorPeerId);
  }

  // === Role Management ===

  promoteMember(
    workspaceId: string,
    actorPeerId: string,
    targetPeerId: string,
    newRole: 'admin' | 'owner',
  ): { success: boolean; error?: string } {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };

    const actor = workspace.members.find(m => m.peerId === actorPeerId);
    const target = workspace.members.find(m => m.peerId === targetPeerId);
    if (!actor || !target) return { success: false, error: 'Member not found' };

    // Only owner can promote
    if (actor.role !== 'owner') {
      return { success: false, error: 'Only the owner can promote members' };
    }

    // Admin cannot promote to owner
    if (newRole === 'owner') {
      return { success: false, error: 'Cannot promote to owner — use ownership transfer instead' };
    }

    // Cannot promote someone who is already that role or higher
    if (target.role === 'owner' || target.role === 'admin') {
      return { success: false, error: `Member is already ${target.role}` };
    }

    target.role = newRole;
    return { success: true };
  }

  demoteMember(
    workspaceId: string,
    actorPeerId: string,
    targetPeerId: string,
  ): { success: boolean; error?: string } {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };

    const actor = workspace.members.find(m => m.peerId === actorPeerId);
    const target = workspace.members.find(m => m.peerId === targetPeerId);
    if (!actor || !target) return { success: false, error: 'Member not found' };

    // Only owner can demote
    if (actor.role !== 'owner') {
      return { success: false, error: 'Only the owner can demote members' };
    }

    // Cannot demote an owner
    if (target.role === 'owner') {
      return { success: false, error: 'Cannot demote the owner' };
    }

    // Cannot demote a regular member further
    if (target.role === 'member') {
      return { success: false, error: 'Member is already a regular member' };
    }

    target.role = 'member';
    return { success: true };
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

    if (!this.canRemoveMember(workspaceId, requesterId, peerId)) {
      const target = workspace.members.find(m => m.peerId === peerId);
      if (target?.role === 'owner') return { success: false, error: 'Cannot remove owner' };
      return { success: false, error: 'Only owner or admin can remove members' };
    }

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

    // Check channel creation permission (skip for DMs)
    if (type === 'channel' && !this.canCreateChannel(workspaceId, createdBy)) {
      return { success: false, error: 'Only admins can create channels' };
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

  removeChannel(workspaceId: string, channelId: string, removedBy: string): { success: boolean; error?: string } {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };

    if (!this.canRemoveChannel(workspaceId, removedBy)) {
      return { success: false, error: 'Only admins can remove channels' };
    }

    const channel = workspace.channels.find(c => c.id === channelId);
    if (!channel) return { success: false, error: 'Channel not found' };

    if (channel.type !== 'channel') {
      return { success: false, error: 'Only regular channels can be removed' };
    }

    // Protect system default channel for now.
    if (channel.name === 'general') {
      return { success: false, error: 'Cannot remove #general channel' };
    }

    workspace.channels = workspace.channels.filter(c => c.id !== channelId);
    return { success: true };
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
    // Ensure backward-compat: old workspaces without permissions get defaults
    if (!workspace.permissions) {
      workspace.permissions = { ...DEFAULT_WORKSPACE_PERMISSIONS };
    }
    // Normalize legacy roles: old workspaces only had 'owner' | 'member'
    for (const member of workspace.members) {
      if (member.role !== 'owner' && member.role !== 'admin' && member.role !== 'member') {
        member.role = 'member';
      }
    }
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
