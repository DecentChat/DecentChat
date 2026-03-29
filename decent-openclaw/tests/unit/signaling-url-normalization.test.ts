import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeedPhraseManager } from '@decentchat/protocol';

class MockPeerTransport {
  static instances: MockPeerTransport[] = [];
  signalingServers: string[];
  onConnect?: (peerId: string) => void;
  onDisconnect?: (peerId: string) => void;
  onMessage?: (fromPeerId: string, data: unknown) => void;
  onError?: (err: Error) => void;

  constructor(opts: { signalingServers: string[] }) {
    this.signalingServers = opts.signalingServers;
    MockPeerTransport.instances.push(this);
  }

  async init(peerId: string): Promise<string> {
    return peerId;
  }

  getConnectedPeers(): string[] {
    return [];
  }

  send = mock(() => true);
  connect = mock(async () => {});
  destroy = mock(() => {});
}

mock.module('@decentchat/transport-webrtc', () => ({
  PeerTransport: MockPeerTransport,
}));

const {
  DecentChatNodePeer,
  resetDecentChatNodePeerStartupLockForTests,
  runDecentChatNodePeerStartupLocked,
} = await import('../../src/peer/DecentChatNodePeer.ts');

const VALID_SEED = new SeedPhraseManager().generate().mnemonic;

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-1',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://0.peerjs.com/',
    invites: [],
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-nodepeer-test-')),
    ...overrides,
  };
}

describe('DecentChatNodePeer signaling URL normalization', () => {
  beforeEach(() => {
    MockPeerTransport.instances = [];
  });

  test('serializes overlapping peer startup work', async () => {
    resetDecentChatNodePeerStartupLockForTests();

    const events: string[] = [];
    const releases: Array<() => void> = [];

    const run = (label: string) => runDecentChatNodePeerStartupLocked(async () => {
      events.push(`${label}:start`);
      await new Promise<void>((resolve) => {
        releases.push(() => {
          events.push(`${label}:done`);
          resolve();
        });
      });
    });

    const first = run('first');
    const second = run('second');

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['first:start', 'first:done', 'second:start']);

    releases.shift()?.();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:done', 'second:start', 'second:done']);
  });

  test('deduplicates https://0.peerjs.com/ and https://0.peerjs.com:443/', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount({
        signalingServer: 'https://0.peerjs.com/',
        invites: ['decent://0.peerjs.com:443/CODE1234?secure=1&path=%2F&peer=peer-a'],
      }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    await peer.start();
    peer.destroy();

    const servers = MockPeerTransport.instances[0]?.signalingServers ?? [];
    expect(servers).toEqual(['https://0.peerjs.com/']);
  });

  test('deduplicates http://localhost:9000 and http://localhost:9000/', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount({
        signalingServer: 'http://localhost:9000',
        invites: ['decent://localhost:9000/CODE1234?path=%2F&peer=peer-b'],
      }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    await peer.start();
    peer.destroy();

    const servers = MockPeerTransport.instances[0]?.signalingServers ?? [];
    expect(servers).toEqual(['http://localhost:9000']);
  });

  test('strips only default ports during dedup and keeps non-default ports distinct', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount({
        signalingServer: 'https://0.peerjs.com:8443/',
        invites: ['decent://0.peerjs.com:443/CODE1234?secure=1&path=%2F&peer=peer-c'],
      }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    await peer.start();
    peer.destroy();

    const servers = MockPeerTransport.instances[0]?.signalingServers ?? [];
    expect(servers).toEqual(['https://0.peerjs.com:8443/', 'https://0.peerjs.com:443/']);
  });

  test('peer maintenance backs off repeated offline reconnect attempts for the same peer', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const connect = mock(async () => {
      throw new Error('offline');
    });
    (peer as any).transport = {
      connect,
      getConnectedPeers: () => [],
    };
    (peer as any).workspaceManager.getAllWorkspaces = () => [
      {
        members: [
          { peerId: 'peer-offline' },
          { peerId: 'peer-offline' },
        ],
      },
    ];
    (peer as any).myPeerId = 'peer-self';

    await (peer as any).runPeerMaintenancePass(1_000);
    await (peer as any).runPeerMaintenancePass(2_000);
    await (peer as any).runPeerMaintenancePass(31_000);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect.mock.calls.map((call) => call[0])).toEqual(['peer-offline', 'peer-offline']);
  });

  test('transport dial errors mark the peer for maintenance backoff', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const connect = mock(async () => {
      throw new Error('offline');
    });
    (peer as any).transport = {
      connect,
      getConnectedPeers: () => [],
    };
    (peer as any).workspaceManager.getAllWorkspaces = () => [
      {
        members: [{ peerId: 'peer-offline' }],
      },
    ];
    (peer as any).myPeerId = 'peer-self';

    (peer as any).notePeerMaintenanceFailure('peer-offline', 5_000);
    await (peer as any).runPeerMaintenancePass(34_000);
    await (peer as any).runPeerMaintenancePass(65_001);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith('peer-offline');
  });

  test('startup skips invite auto-join when the invited workspace is already restored locally', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount({
        invites: [
          'https://decentchat.app/join/TV3KL5RW?signal=0.peerjs.com%3A443&peer=peer-host&ws=workspace-1&secure=1&path=%2F',
        ],
      }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer as any).workspaceManager.getWorkspace = (workspaceId: string) => (
      workspaceId === 'workspace-1'
        ? {
            id: 'workspace-1',
            channels: [],
            members: [
              { peerId: (peer as any).myPeerId },
              { peerId: 'peer-host' },
            ],
          }
        : undefined
    );
    (peer as any).workspaceManager.getAllWorkspaces = () => [
      {
        id: 'workspace-1',
        channels: [],
        members: [
          { peerId: (peer as any).myPeerId },
          { peerId: 'peer-host' },
        ],
      },
    ];

    await peer.start();
    const transport = MockPeerTransport.instances[0];
    expect(transport?.connect).toHaveBeenCalledTimes(0);
    peer.destroy();
  });
});
