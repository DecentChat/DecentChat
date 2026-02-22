import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeXenaPeer } from '../../src/peer/NodeXenaPeer.ts';

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-1',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    signalingServer: 'https://decentchat.app/peerjs',
    invites: [],
    alias: 'Xena',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-seed-validation-test-')),
    ...overrides,
  };
}

describe('NodeXenaPeer seed phrase validation', () => {
  test('throws clear error when seed phrase is missing', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount({ seedPhrase: undefined }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    await expect(peer.start()).rejects.toThrow('Xena seed phrase not configured (channels.decentchat.seedPhrase)');
  });

  test('throws clear error when seed phrase is invalid', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount({ seedPhrase: 'not a valid mnemonic' }),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    await expect(peer.start()).rejects.toThrow('Invalid seed phrase in channels.decentchat.seedPhrase');
  });
});
