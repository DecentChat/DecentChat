import type { Workspace, WorkspaceDelta, WorkspaceShell } from './types';
import { WorkspaceManager } from './WorkspaceManager';

export interface ApplyDeltaResult {
  applied: boolean;
  buffered?: boolean;
  reason?: string;
}

export class WorkspaceDeltaProtocol {
  private workspaceManager: WorkspaceManager;
  private buffered = new Map<string, WorkspaceDelta[]>();

  constructor(workspaceManager: WorkspaceManager) {
    this.workspaceManager = workspaceManager;
  }

  buildWorkspaceShell(workspaceId: string): WorkspaceShell | undefined {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return undefined;
    const version = workspace.shell?.version ?? workspace.version ?? 1;
    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      createdBy: workspace.createdBy,
      createdAt: workspace.createdAt,
      version,
      memberCount: workspace.members.length,
      channelCount: workspace.channels.length,
      capabilityFlags: workspace.shell?.capabilityFlags,
    };
  }

  applyWorkspaceShell(target: WorkspaceManager, shell: WorkspaceShell, inviteCode?: string): Workspace {
    const existing = target.getWorkspace(shell.id);
    const workspace: Workspace = existing ?? {
      id: shell.id,
      name: shell.name,
      description: shell.description,
      inviteCode: inviteCode || 'PAGED000',
      createdBy: shell.createdBy,
      createdAt: shell.createdAt,
      version: shell.version,
      members: [],
      channels: [],
      shell,
      permissions: undefined,
      bans: [],
    };

    workspace.name = shell.name;
    workspace.description = shell.description;
    workspace.version = shell.version;
    workspace.shell = shell;

    target.importWorkspace(structuredClone(workspace));
    return target.getWorkspace(shell.id)!;
  }

  applyDelta(target: WorkspaceManager, delta: WorkspaceDelta): ApplyDeltaResult {
    const workspace = target.getWorkspace(delta.workspaceId);
    if (!workspace) return { applied: false, reason: 'workspace not found' };

    const currentVersion = workspace.shell?.version ?? workspace.version ?? 0;
    if (delta.baseVersion < currentVersion) {
      return { applied: false, reason: `stale delta: base ${delta.baseVersion} < current ${currentVersion}` };
    }
    if (delta.baseVersion > currentVersion) {
      this.bufferDelta(delta);
      return { applied: false, buffered: true, reason: `missing base version ${delta.baseVersion}` };
    }

    for (const op of delta.ops) {
      switch (op.op) {
        case 'upsert-channel': {
          if (!op.channel) break;
          const idx = workspace.channels.findIndex((c) => c.id === op.channel!.id);
          if (idx >= 0) workspace.channels[idx] = op.channel;
          else workspace.channels.push(op.channel);
          break;
        }
        case 'remove-channel': {
          if (!op.channelId) break;
          workspace.channels = workspace.channels.filter((c) => c.id !== op.channelId);
          break;
        }
        case 'upsert-member': {
          if (!op.member) break;
          const idx = workspace.members.findIndex((m) => m.peerId === op.member!.peerId);
          if (idx >= 0) workspace.members[idx] = op.member;
          else workspace.members.push(op.member);
          break;
        }
        case 'remove-member': {
          const peerId = op.peerId || op.member?.peerId;
          if (!peerId) break;
          workspace.members = workspace.members.filter((m) => m.peerId !== peerId);
          break;
        }
        case 'update-shell': {
          workspace.name = op.shellPatch?.name ?? workspace.name;
          workspace.description = op.shellPatch?.description ?? workspace.description;
          workspace.shell = {
            ...(workspace.shell ?? this.buildWorkspaceShell(workspace.id) ?? this.fallbackShell(workspace)),
            ...op.shellPatch,
            id: workspace.id,
            name: op.shellPatch?.name ?? workspace.name,
            description: op.shellPatch?.description ?? workspace.description,
            version: delta.version,
            memberCount: workspace.members.length,
            channelCount: workspace.channels.length,
          };
          break;
        }
      }
    }

    workspace.version = delta.version;
    workspace.shell = {
      ...(workspace.shell ?? this.buildWorkspaceShell(workspace.id) ?? this.fallbackShell(workspace)),
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      version: delta.version,
      memberCount: workspace.members.length,
      channelCount: workspace.channels.length,
    };

    target.importWorkspace(structuredClone(workspace));
    this.flushBuffered(target, delta.workspaceId);
    return { applied: true };
  }

  private fallbackShell(workspace: Workspace): WorkspaceShell {
    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      createdBy: workspace.createdBy,
      createdAt: workspace.createdAt,
      version: workspace.version ?? 1,
      memberCount: workspace.members.length,
      channelCount: workspace.channels.length,
    };
  }

  private bufferDelta(delta: WorkspaceDelta): void {
    const list = this.buffered.get(delta.workspaceId) ?? [];
    list.push(delta);
    list.sort((a, b) => a.baseVersion - b.baseVersion || a.version - b.version);
    this.buffered.set(delta.workspaceId, list);
  }

  private flushBuffered(target: WorkspaceManager, workspaceId: string): void {
    const list = this.buffered.get(workspaceId);
    if (!list?.length) return;

    let progressed = true;
    while (progressed) {
      progressed = false;
      const workspace = target.getWorkspace(workspaceId);
      const currentVersion = workspace?.shell?.version ?? workspace?.version ?? 0;
      const idx = list.findIndex((delta) => delta.baseVersion === currentVersion);
      if (idx >= 0) {
        const [next] = list.splice(idx, 1);
        this.applyDelta(target, next);
        progressed = true;
      }
    }

    if (list.length === 0) this.buffered.delete(workspaceId);
  }
}
