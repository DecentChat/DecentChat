import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeXenaPeer } from '../../src/peer/NodeXenaPeer.ts';

const VALID_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-1',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://decentchat.app/peerjs',
    invites: [],
    alias: 'Xena',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-name-test-')),
    ...overrides,
  };
}

describe('NodeXenaPeer name-announce flow', () => {
  test('sends name-announce immediately after handshake', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: (peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      },
    };
    (peer as any).messageProtocol = {
      createHandshake: async () => ({ publicKey: 'pk', peerId: 'me' }),
    };

    await (peer as any).sendHandshake('peer-1');

    expect(sent).toHaveLength(2);
    expect(sent[0]?.peerId).toBe('peer-1');
    expect(sent[0]?.msg.type).toBe('handshake');
    expect(sent[1]?.peerId).toBe('peer-1');
    expect(sent[1]?.msg).toEqual({ type: 'name-announce', alias: 'Xena', isBot: true });
  });

  test('resolveSenderName prefers cached alias over peer ID', () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const values = new Map<string, unknown>();
    values.set('peer-alias-peer-abc', 'Alice');
    (peer as any).store = {
      get: <T>(key: string, defaultValue: T): T => {
        return (values.get(key) as T | undefined) ?? defaultValue;
      },
      set: () => {},
      delete: () => {},
    };

    const senderName = (peer as any).resolveSenderName('', 'peer-abc');
    expect(senderName).toBe('Alice');
  });

  test('caches alias in store on name-announce', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const values = new Map<string, unknown>();
    (peer as any).store = {
      get: <T>(key: string, defaultValue: T): T => {
        return (values.get(key) as T | undefined) ?? defaultValue;
      },
      set: (key: string, value: unknown): void => {
        values.set(key, value);
      },
      delete: () => {},
    };
    (peer as any).syncProtocol = {};
    (peer as any).messageProtocol = {};
    (peer as any).transport = {};

    await (peer as any).handlePeerMessage('peer-xyz', { type: 'name-announce', alias: 'Bob' });

    expect(values.get('peer-alias-peer-xyz')).toBe('Bob');
  });
});
