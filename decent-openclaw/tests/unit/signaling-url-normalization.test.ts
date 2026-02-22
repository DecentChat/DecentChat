import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeedPhraseManager } from 'decent-protocol';

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

mock.module('decent-transport-webrtc', () => ({
  PeerTransport: MockPeerTransport,
}));

const { NodeXenaPeer } = await import('../../src/peer/NodeXenaPeer.ts');

const VALID_SEED = new SeedPhraseManager().generate().mnemonic;

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-1',
    port: 9000,
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://decentchat.app/peerjs',
    invites: [],
    alias: 'Xena',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-nodepeer-test-')),
    mode: 'peer',
    ...overrides,
  };
}

describe('NodeXenaPeer signaling URL normalization', () => {
  beforeEach(() => {
    MockPeerTransport.instances = [];
  });

  test('deduplicates https://0.peerjs.com/ and https://0.peerjs.com:443/', async () => {
    const peer = new NodeXenaPeer({
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
    const peer = new NodeXenaPeer({
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
    const peer = new NodeXenaPeer({
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
});
