/**
 * Workspace, Channel, and Member types
 */

export interface Workspace {
  id: string;
  name: string;
  inviteCode: string;
  createdBy: string; // PeerId
  createdAt: number;
  members: WorkspaceMember[];
  channels: Channel[];
}

export interface WorkspaceMember {
  peerId: string;
  alias: string;
  publicKey: string; // Base64 ECDH public key
  joinedAt: number;
  role: 'owner' | 'member';
}

export interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  type: 'channel' | 'dm';
  members: string[]; // PeerIds (for DMs: exactly 2; for channels: all workspace members or subset)
  createdBy: string;
  createdAt: number;
}

export interface WorkspaceInvite {
  workspaceId: string;
  workspaceName: string;
  inviteCode: string;
  invitedBy: string;
}

/**
 * Signaling server info for Peer Exchange (PEX) - DEP-002
 */
export interface PEXServer {
  url: string;
  lastSeen: number;
  successRate: number;
  latency?: number;
}

// P2P sync messages
export type SyncMessage =
  | { type: 'join-request'; inviteCode: string; member: WorkspaceMember; pexServers?: PEXServer[] }
  // `messageHistory` intentionally omits plaintext message content during sync.
  | { type: 'join-accepted'; workspace: Workspace; messageHistory: Record<string, any[]>; pexServers?: PEXServer[] }
  | { type: 'join-rejected'; reason: string }
  | { type: 'member-joined'; member: WorkspaceMember }
  | { type: 'member-left'; peerId: string }
  | { type: 'channel-created'; channel: Channel }
  | { type: 'channel-message'; channelId: string; message: any }
  | { type: 'sync-request'; workspaceId: string }
  // `messageHistory` intentionally omits plaintext message content during sync.
  | { type: 'sync-response'; workspace: Workspace; messageHistory: Record<string, any[]> }
  | { type: 'peer-exchange'; servers: PEXServer[] };
