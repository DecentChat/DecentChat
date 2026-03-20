import { describe, expect, test } from 'bun:test';
import {
  decentChatPlugin,
  listDecentChatAccountIds,
  resolveDecentChatAccount,
  resolveDefaultDecentChatAccountId,
} from '../../src/channel.ts';
import { getActivePeer, setActivePeer } from '../../src/peer-registry.ts';

describe('decent-openclaw multi-account company-sim', () => {
  test('lists configured accounts and resolves configured default account', () => {
    const cfg = {
      channels: {
        decentchat: {
          defaultAccount: 'backend-dev',
          accounts: {
            'team-manager': { seedPhrase: 'seed-1', alias: 'Mira PM' },
            'backend-dev': { seedPhrase: 'seed-2', alias: 'Rian Backend' },
          },
        },
      },
    } as any;

    expect(listDecentChatAccountIds(cfg)).toEqual(['backend-dev', 'team-manager']);
    expect(decentChatPlugin.config.defaultAccountId?.(cfg)).toBe('backend-dev');
    expect(resolveDefaultDecentChatAccountId(cfg)).toBe('backend-dev');
  });

  test('falls back to legacy single-account config when accounts map is absent', () => {
    const cfg = {
      channels: {
        decentchat: {
          seedPhrase: 'seed-legacy',
          alias: 'Xena AI',
        },
      },
    } as any;

    expect(listDecentChatAccountIds(cfg)).toEqual(['default']);
    expect(resolveDefaultDecentChatAccountId(cfg)).toBe('default');
    expect(resolveDecentChatAccount(cfg).alias).toBe('Xena AI');
  });

  test('merges base config with account overrides and attaches company-sim metadata', () => {
    const cfg = {
      channels: {
        decentchat: {
          signalingServer: 'https://signal.example',
          dmPolicy: 'pairing',
          replyToMode: 'all',
          channels: {
            '*': { requireMention: true },
          },
          companySim: {
            enabled: true,
            manifestPath: '/company-sims/software-studio/company.yaml',
            companyId: 'software-studio',
          },
          accounts: {
            'backend-dev': {
              seedPhrase: 'seed-backend',
              alias: 'Rian Backend',
              companySim: {
                employeeId: 'backend-dev',
                roleFilesDir: '/company-sims/software-studio/employees/backend-dev',
              },
            },
          },
        },
      },
    } as any;

    const account = resolveDecentChatAccount(cfg, 'backend-dev');
    expect(account.accountId).toBe('backend-dev');
    expect(account.alias).toBe('Rian Backend');
    expect(account.signalingServer).toBe('https://signal.example');
    expect(account.dmPolicy).toBe('pairing');
    expect(account.companySim).toEqual({
      enabled: true,
      manifestPath: '/company-sims/software-studio/company.yaml',
      companyId: 'software-studio',
      employeeId: 'backend-dev',
      roleFilesDir: '/company-sims/software-studio/employees/backend-dev',
    });
  });

  test('resolves company-sim silent channel ids from account overrides', () => {
    const cfg = {
      channels: {
        decentchat: {
          companySim: {
            enabled: true,
            manifestPath: '/company-sims/software-studio/company.yaml',
            companyId: 'software-studio',
            silentChannelIds: ['channel-global'],
          },
          accounts: {
            'backend-dev': {
              seedPhrase: 'seed-backend',
              alias: 'Rian Backend',
              companySim: {
                employeeId: 'backend-dev',
                silentChannelIds: ['cf190f68-fe5f-45f6-b731-4ef3286fecd7'],
              },
            },
          },
        },
      },
    } as any;

    const account = resolveDecentChatAccount(cfg, 'backend-dev');
    expect(account.companySim?.silentChannelIds).toEqual(['cf190f68-fe5f-45f6-b731-4ef3286fecd7']);
  });

  test('peer registry stores active peers per account id', () => {
    const managerPeer = { peerId: 'peer-manager' } as any;
    const backendPeer = { peerId: 'peer-backend' } as any;

    setActivePeer(managerPeer, 'team-manager');
    setActivePeer(backendPeer, 'backend-dev');

    try {
      expect(getActivePeer('team-manager')?.peerId).toBe('peer-manager');
      expect(getActivePeer('backend-dev')?.peerId).toBe('peer-backend');
      expect(getActivePeer('missing')).toBeNull();
    } finally {
      setActivePeer(null, 'team-manager');
      setActivePeer(null, 'backend-dev');
    }
  });

  test('directory and outbound use account-specific active peer', async () => {
    const cfg = {
      channels: {
        decentchat: {
          accounts: {
            'team-manager': { seedPhrase: 'seed-1', alias: 'Mira PM' },
            'backend-dev': { seedPhrase: 'seed-2', alias: 'Rian Backend' },
          },
        },
      },
    } as any;

    const calls: string[] = [];
    const managerPeer = {
      peerId: 'peer-manager',
      listDirectoryPeersLive: () => [{ kind: 'user', id: 'u1', name: 'Alice', handle: 'decentchat:u1' }],
      listDirectoryGroupsLive: () => [{ kind: 'group', id: 'decentchat:channel:g1', name: 'Workspace / #general' }],
      async sendToChannel(channelId: string, text: string) { calls.push(`manager:${channelId}:${text}`); },
      async sendDirectToPeer(peerId: string, text: string) { calls.push(`manager-dm:${peerId}:${text}`); },
    } as any;
    const backendPeer = {
      peerId: 'peer-backend',
      listDirectoryPeersLive: () => [{ kind: 'user', id: 'u2', name: 'Bob', handle: 'decentchat:u2' }],
      listDirectoryGroupsLive: () => [{ kind: 'group', id: 'decentchat:channel:g2', name: 'Workspace / #engineering' }],
      async sendToChannel(channelId: string, text: string) { calls.push(`backend:${channelId}:${text}`); },
      async sendDirectToPeer(peerId: string, text: string) { calls.push(`backend-dm:${peerId}:${text}`); },
    } as any;

    setActivePeer(managerPeer, 'team-manager');
    setActivePeer(backendPeer, 'backend-dev');

    try {
      const selfManager = await decentChatPlugin.directory?.self?.({ cfg, runtime: {} as any, accountId: 'team-manager' });
      const selfBackend = await decentChatPlugin.directory?.self?.({ cfg, runtime: {} as any, accountId: 'backend-dev' });
      const peers = await decentChatPlugin.directory?.listPeersLive?.({ cfg, runtime: {} as any, accountId: 'backend-dev', query: null, limit: 20 });

      expect(selfManager?.name).toBe('Mira PM');
      expect(selfBackend?.name).toBe('Rian Backend');
      expect(peers?.[0]?.id).toBe('u2');

      await decentChatPlugin.outbound?.sendText?.({
        cfg,
        to: 'decentchat:channel:engineering',
        text: 'hello',
        accountId: 'backend-dev',
      } as any);
      await decentChatPlugin.outbound?.sendText?.({
        cfg,
        to: 'decentchat:peer-123',
        text: 'hi',
        accountId: 'team-manager',
      } as any);

      expect(calls).toEqual([
        'backend:engineering:hello',
        'manager-dm:peer-123:hi',
      ]);
    } finally {
      setActivePeer(null, 'team-manager');
      setActivePeer(null, 'backend-dev');
    }
  });
});
