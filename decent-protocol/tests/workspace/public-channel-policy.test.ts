import { beforeEach, describe, expect, test } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';

const makeMember = (peerId: string, alias: string) => ({
  peerId,
  alias,
  publicKey: `${peerId}-key`,
  joinedAt: Date.now(),
  role: 'member' as const,
});

describe('public channel policy groundwork', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  test('new default channels are marked as public-workspace channels', () => {
    const ws = wm.createWorkspace('Big Team', 'alice', 'Alice', 'alice-key');
    const general = ws.channels[0];

    expect(wm.isPublicWorkspaceChannel(general)).toBe(true);
    expect(general.accessPolicy?.mode).toBe('public-workspace');
  });

  test('adding a member to workspace does not append them into every public channel member array', () => {
    const ws = wm.createWorkspace('Big Team', 'alice', 'Alice', 'alice-key');
    const created = wm.createChannel(ws.id, 'announcements', 'alice');
    expect(created.success).toBe(true);

    const before = wm.getChannels(ws.id).map(ch => ({ id: ch.id, members: [...ch.members] }));

    const join = wm.addMember(ws.id, makeMember('bob', 'Bob'));
    expect(join.success).toBe(true);

    const after = wm.getChannels(ws.id);
    for (const channel of after) {
      expect(wm.isPublicWorkspaceChannel(channel)).toBe(true);
      expect(channel.members).toEqual(before.find(prev => prev.id === channel.id)?.members ?? []);
      expect(wm.isMemberAllowedInChannel(ws.id, channel.id, 'bob')).toBe(true);
    }
  });

  test('removing a member revokes public-channel access without mutating every public channel array', () => {
    const ws = wm.createWorkspace('Big Team', 'alice', 'Alice', 'alice-key');
    wm.createChannel(ws.id, 'announcements', 'alice');
    wm.addMember(ws.id, makeMember('bob', 'Bob'));

    const before = wm.getChannels(ws.id).map(ch => ({ id: ch.id, members: [...ch.members] }));
    const removed = wm.removeMember(ws.id, 'bob', 'alice');

    expect(removed.success).toBe(true);

    for (const channel of wm.getChannels(ws.id)) {
      expect(channel.members).toEqual(before.find(prev => prev.id === channel.id)?.members ?? []);
      expect(wm.isMemberAllowedInChannel(ws.id, channel.id, 'bob')).toBe(false);
    }
  });

  test('DM channels remain explicit-member channels', () => {
    const ws = wm.createWorkspace('Big Team', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws.id, makeMember('bob', 'Bob'));

    const dm = wm.createDM(ws.id, 'alice', 'bob');
    expect(dm.success).toBe(true);
    expect(dm.channel?.accessPolicy?.mode).toBe('dm');
    expect(wm.isPublicWorkspaceChannel(dm.channel!)).toBe(false);
    expect(wm.isMemberAllowedInChannel(ws.id, dm.channel!.id, 'alice')).toBe(true);
    expect(wm.isMemberAllowedInChannel(ws.id, dm.channel!.id, 'bob')).toBe(true);
  });
});
