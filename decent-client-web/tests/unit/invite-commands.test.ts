import { describe, test, expect } from 'bun:test';
import { CommandParser } from '../../src/commands/CommandParser';
import { registerCommands } from '../../src/commands/registerCommands';

describe('invite commands', () => {
  function setupHarness(overrides?: Partial<any>) {
    const parser = new CommandParser();

    const workspace = {
      id: 'ws-1',
      name: 'Acme',
      inviteCode: 'ACME1234',
      createdBy: 'me-peer',
      createdAt: Date.now(),
      members: [],
      channels: [],
      permissions: {
        whoCanCreateChannels: 'everyone',
        whoCanInviteMembers: 'everyone',
        revokedInviteIds: [],
      },
    };

    const inviteCalls: Array<{ workspaceId: string; opts?: { permanent?: boolean } }> = [];
    const revokeCalls: string[] = [];

    const ctrl: any = {
      workspaceManager: {
        getWorkspace: (id: string) => (id === 'ws-1' ? workspace : undefined),
      },
      generateInviteURL: async (workspaceId: string, opts?: { permanent?: boolean }) => {
        inviteCalls.push({ workspaceId, opts });
        return opts?.permanent ? 'https://decentchat.app/join/PERM' : 'https://decentchat.app/join/EXP';
      },
      revokeInviteLink: async (ref: string) => {
        revokeCalls.push(ref);
        return { success: true, inviteId: 'inv-123' };
      },
      ...overrides,
    };

    const state: any = {
      activeWorkspaceId: 'ws-1',
      myPeerId: 'me-peer',
      myAlias: 'Me',
      readyPeers: new Set<string>(),
      connectedPeers: new Set<string>(),
    };

    registerCommands(parser, ctrl, state);

    return { parser, ctrl, state, inviteCalls, revokeCalls };
  }

  test('/invite defaults to expiring invite', async () => {
    const { parser, inviteCalls } = setupHarness();

    const result = await parser.execute('/invite');

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('https://decentchat.app/join/EXP');
    expect(result.output).toContain('This invite expires in 7 days.');
    expect(inviteCalls).toEqual([{ workspaceId: 'ws-1', opts: { permanent: false } }]);
  });

  test('/invite permanent creates non-expiring invite', async () => {
    const { parser, inviteCalls } = setupHarness();

    const result = await parser.execute('/invite permanent');

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('https://decentchat.app/join/PERM');
    expect(result.output).toContain('does not expire unless revoked');
    expect(inviteCalls).toEqual([{ workspaceId: 'ws-1', opts: { permanent: true } }]);
  });

  test('/invite rejects unknown args', async () => {
    const { parser } = setupHarness();

    const result = await parser.execute('/invite forever');

    expect(result.handled).toBe(true);
    expect(result.error).toContain('Usage: /invite [permanent|--permanent]');
  });

  test('/invite reports error when controller cannot generate invite URL', async () => {
    const { parser } = setupHarness({
      generateInviteURL: async () => '',
    });

    const result = await parser.execute('/invite');

    expect(result.handled).toBe(true);
    expect(result.error).toContain('Could not generate invite link');
  });

  test('/invite-revoke passes raw input to ChatController and reports success', async () => {
    const { parser, revokeCalls } = setupHarness();

    const result = await parser.execute('/invite-revoke inv-abc');

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('Revoked invite inv-123');
    expect(revokeCalls).toEqual(['inv-abc']);
  });

  test('/invite-revoke shows already-revoked message', async () => {
    const { parser } = setupHarness({
      revokeInviteLink: async () => ({ success: true, inviteId: 'inv-abc', alreadyRevoked: true }),
    });

    const result = await parser.execute('/invite-revoke inv-abc');

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('already revoked');
  });
});
