import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedDecentChatAccount } from '../src/types.js';

const tempDirs: string[] = [];

function makeAccount(dataDir: string): ResolvedDecentChatAccount {
  return {
    accountId: 'test-account',
    enabled: true,
    dmPolicy: 'allow-all',
    configured: true,
    seedPhrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    signalingServer: 'https://0.peerjs.com/',
    invites: [],
    alias: 'HandshakeBot',
    dataDir,
    streamEnabled: true,
    replyToMode: 'off',
    replyToModeByChatType: {},
    thread: {
      historyScope: 'channel',
      inheritParent: true,
      initialHistoryLimit: 100,
    },
  };
}

describe('DecentChatNodePeer handshake ack retry', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('retries once and clears connect cooldown when handshake ack never arrives', async () => {
    const { DecentChatNodePeer } = await import(`../src/peer/DecentChatNodePeer.js?real=${Date.now()}`);
    const dataDir = mkdtempSync(join(tmpdir(), 'decent-hermes-handshake-'));
    tempDirs.push(dataDir);

    const warn = mock((_line: string) => {});
    const debug = mock((_line: string) => {});

    const peer = new DecentChatNodePeer({
      account: makeAccount(dataDir),
      onIncomingMessage: async () => {},
      onReply: () => {},
      log: {
        info: () => {},
        debug,
        warn,
        error: () => {},
      },
    });

    const sentPayloads: any[] = [];
    (peer as any).transport = {
      send: (_peerId: string, payload: any) => {
        sentPayloads.push(payload);
        return true;
      },
      destroy: () => {},
    };
    (peer as any).messageProtocol = {
      createHandshake: async () => ({
        publicKey: 'public-key',
        signingPublicKey: 'signing-public-key',
        preKeySupport: true,
      }),
    };
    (peer as any).publishPreKeyBundle = async () => {};
    (peer as any).resolveNameAnnounceWorkspaceId = () => undefined;
    (peer as any).handshakeAckTimeoutMs = () => 5;
    (peer as any).handshakeMaxAttempts = () => 2;
    (peer as any).connectHandshakeAtByPeer.set('peer-remote', Date.now());

    await (peer as any).sendHandshake('peer-remote');

    const handshakePayloads = sentPayloads.filter((payload) => payload?.type === 'handshake');
    expect(handshakePayloads).toHaveLength(2);
    expect(typeof handshakePayloads[0]?.handshakeId).toBe('string');
    expect(typeof handshakePayloads[1]?.handshakeId).toBe('string');
    expect((peer as any).connectHandshakeAtByPeer.has('peer-remote')).toBeFalse();

    const warnLines = warn.mock.calls.map(([line]) => String(line));
    expect(warnLines.some((line) => line.includes('will retry'))).toBeTrue();
    expect(warnLines.some((line) => line.includes('clearing cooldown for retry'))).toBeTrue();

    peer.destroy();
  });
});
