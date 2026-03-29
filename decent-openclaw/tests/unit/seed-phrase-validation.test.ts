import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-1',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    signalingServer: 'https://0.peerjs.com/',
    invites: [],
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-seed-validation-test-')),
    ...overrides,
  };
}

describe('DecentChatNodePeer seed phrase validation', () => {
  test('throws clear error when seed phrase is missing', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount({ seedPhrase: undefined }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    await expect(peer.start()).rejects.toThrow('DecentChat seed phrase not configured (channels.decentchat.seedPhrase)');
  });

  test('throws clear error when seed phrase is invalid', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount({ seedPhrase: 'not a valid mnemonic' }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    await expect(peer.start()).rejects.toThrow('Invalid seed phrase in channels.decentchat.seedPhrase');
  });
});
