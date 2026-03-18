import { describe, expect, test } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import { DirectoryProtocol } from '../../src/workspace/DirectoryProtocol';
import { DirectoryShardPlanner } from '../../src/workspace/DirectoryShardPlanner';

describe('protocol company member profile', () => {
  test('preserves company sim metadata on member add/export', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('Software Studio', 'alice', 'Alice', 'alice-pk');

    wm.addMember(ws.id, {
      peerId: 'bob',
      alias: 'Rian Backend',
      publicKey: 'bob-pk',
      joinedAt: Date.now(),
      role: 'member',
      companySim: {
        automationKind: 'openclaw-agent',
        roleTitle: 'Backend Engineer',
        teamId: 'engineering',
        managerPeerId: 'carol',
        avatarUrl: 'https://example.com/avatar-backend.png',
      },
    });

    const exported = wm.exportWorkspace(ws.id);
    const bob = exported?.members.find((m) => m.peerId === 'bob');

    expect(bob?.companySim).toEqual({
      automationKind: 'openclaw-agent',
      roleTitle: 'Backend Engineer',
      teamId: 'engineering',
      managerPeerId: 'carol',
      avatarUrl: 'https://example.com/avatar-backend.png',
    });
  });

  test('includes company sim in directory member summaries', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('Software Studio', 'alice', 'Alice', 'alice-pk');
    const protocol = new DirectoryProtocol(wm, new DirectoryShardPlanner());

    wm.addMember(ws.id, {
      peerId: 'tester',
      alias: 'Iva QA',
      publicKey: 'tester-pk',
      joinedAt: Date.now(),
      role: 'member',
      companySim: {
        automationKind: 'openclaw-agent',
        roleTitle: 'QA Engineer',
        teamId: 'qa',
        managerPeerId: 'alice',
      },
    });

    const page = protocol.getMemberPage(ws.id, { pageSize: 200 });
    const tester = page.members.find((m) => m.peerId === 'tester');

    expect(tester?.companySim?.roleTitle).toBe('QA Engineer');
    expect(tester?.companySim?.teamId).toBe('qa');
    expect(tester?.companySim?.managerPeerId).toBe('alice');
  });

  test('backward compatible: missing companySim is allowed', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('Old Workspace', 'dave', 'Dave', 'dave-pk');

    wm.addMember(ws.id, {
      peerId: 'eve',
      alias: 'Eve',
      publicKey: 'eve-pk',
      joinedAt: Date.now(),
      role: 'member',
    });

    const exported = wm.exportWorkspace(ws.id);
    const eve = exported?.members.find((m) => m.peerId === 'eve');

    expect(eve?.companySim).toBeUndefined();
  });
});
