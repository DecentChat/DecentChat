/**
 * DM isDirect Fallback Tests
 *
 * Mirrors ChatController receive-side routing rules:
 * - isDirect=true routes as DM
 * - missing isDirect falls back to workspace validation
 * - if no workspace can be resolved, known contact falls back to DM
 * - unknown sender without workspace/channel is dropped
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';

interface FakeEnvelope {
  isDirect?: boolean;
  workspaceId?: string | null;
  channelId?: string;
}

interface FakeRouteContext {
  wm: WorkspaceManager;
  directConversationsByPeer: Map<string, { id: string }>;
}

type RouteResult =
  | { kind: 'dm'; channelId: string; reason: string }
  | { kind: 'workspace'; channelId: string; workspaceId: string }
  | { kind: 'drop'; reason: string };

function routeIncoming(
  fromPeerId: string,
  data: FakeEnvelope,
  ctx: FakeRouteContext,
): RouteResult {
  if (data.isDirect) {
    const existing = ctx.directConversationsByPeer.get(fromPeerId);
    return { kind: 'dm', channelId: existing?.id ?? `dm-${fromPeerId}`, reason: 'isDirect' };
  }

  const allWorkspaces = ctx.wm.getAllWorkspaces();
  let targetWs;

  if (data.workspaceId) {
    targetWs = allWorkspaces.find(ws => ws.id === data.workspaceId);
    if (!targetWs) return { kind: 'drop', reason: 'unknown workspaceId' };
  } else if (data.channelId) {
    targetWs = allWorkspaces.find(ws => ws.channels.some((ch: any) => ch.id === data.channelId));
  }

  if (!targetWs) {
    const fallbackConv = ctx.directConversationsByPeer.get(fromPeerId);
    if (fallbackConv) return { kind: 'dm', channelId: fallbackConv.id, reason: 'dm fallback' };
    return { kind: 'drop', reason: 'workspace/channel not found' };
  }

  const isMember = targetWs.members.some((m: any) => m.peerId === fromPeerId);
  if (!isMember) return { kind: 'drop', reason: 'not workspace member' };

  const resolvedChannelId =
    data.channelId && targetWs.channels.some((ch: any) => ch.id === data.channelId)
      ? data.channelId
      : (targetWs.channels[0]?.id ?? data.channelId ?? 'default');

  return { kind: 'workspace', channelId: resolvedChannelId, workspaceId: targetWs.id };
}

function gossipWorkspaceIdFallback(
  envelopeWorkspaceId: string | null | undefined,
  activeWorkspaceId: string | null | undefined,
): string | null {
  return envelopeWorkspaceId ?? activeWorkspaceId ?? null;
}

describe('DM fallback when isDirect is missing', () => {
  let wm: WorkspaceManager;
  let directConversationsByPeer: Map<string, { id: string }>;
  let wsId: string;
  let wsChannelId: string;

  beforeEach(() => {
    wm = new WorkspaceManager();
    directConversationsByPeer = new Map();

    const ws = wm.createWorkspace('workspace-main', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws.id, {
      peerId: 'bob',
      alias: 'Bob',
      publicKey: 'bob-key',
      joinedAt: Date.now(),
      role: 'member',
    });
    wsId = ws.id;
    wsChannelId = ws.channels[0].id;
  });

  test('known contact message without isDirect and no workspace/channel falls back to DM', () => {
    directConversationsByPeer.set('bob', { id: 'dm-bob' });
    const result = routeIncoming('bob', {}, { wm, directConversationsByPeer });
    expect(result).toEqual({ kind: 'dm', channelId: 'dm-bob', reason: 'dm fallback' });
  });

  test('unknown contact without isDirect and no workspace is dropped', () => {
    const result = routeIncoming('mallory', {}, { wm, directConversationsByPeer });
    expect(result).toEqual({ kind: 'drop', reason: 'workspace/channel not found' });
  });

  test('workspaceId empty string is treated as missing (falsy) and known contact still falls back to DM', () => {
    directConversationsByPeer.set('bob', { id: 'dm-bob' });
    const result = routeIncoming('bob', { workspaceId: '' }, { wm, directConversationsByPeer });
    expect(result).toEqual({ kind: 'dm', channelId: 'dm-bob', reason: 'dm fallback' });
  });

  test('workspaceId empty string is treated as missing (falsy) and unknown contact is dropped', () => {
    const result = routeIncoming('mallory', { workspaceId: '' }, { wm, directConversationsByPeer });
    expect(result).toEqual({ kind: 'drop', reason: 'workspace/channel not found' });
  });

  test('explicit unknown non-empty workspaceId rejects immediately (no DM fallback)', () => {
    directConversationsByPeer.set('bob', { id: 'dm-bob' });
    const result = routeIncoming('bob', { workspaceId: 'ghost-workspace' }, { wm, directConversationsByPeer });
    expect(result).toEqual({ kind: 'drop', reason: 'unknown workspaceId' });
  });

  test('legacy channelId-only message routes to workspace when sender is member', () => {
    const result = routeIncoming('bob', { channelId: wsChannelId }, { wm, directConversationsByPeer });
    expect(result).toEqual({ kind: 'workspace', channelId: wsChannelId, workspaceId: wsId });
  });
});

describe('Gossip relay workspaceId fallback', () => {
  test('uses null (not empty string) when envelope and active workspace are absent', () => {
    const workspaceId = gossipWorkspaceIdFallback(undefined, null);
    expect(workspaceId).toBeNull();
    expect(workspaceId).not.toBe('');
  });

  test('prefers explicit envelope workspaceId when present', () => {
    expect(gossipWorkspaceIdFallback('ws-123', 'ws-active')).toBe('ws-123');
  });
});
