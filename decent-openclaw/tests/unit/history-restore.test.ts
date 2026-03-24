import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';

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
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-restore-test-')),
    ...overrides,
  };
}

describe('DecentChatNodePeer message restore', () => {
  test('restores persisted message buckets even when not in current workspace channel list', () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const restored: any[] = [];
    (peer as any).workspaceManager = {
      getAllWorkspaces: () => [{ id: 'ws-1', channels: [{ id: 'channel-current' }] }],
    };
    (peer as any).messageStore = {
      forceAdd: (message: any) => restored.push(message),
    };

    const driftedMessage = {
      id: 'msg-1',
      channelId: 'channel-current',
      senderId: 'peer-a',
      timestamp: 123,
      content: 'hello',
      type: 'text',
      prevHash: 'genesis',
      status: 'sent',
    };

    (peer as any).store = {
      get: <T>(key: string, defaultValue: T): T => {
        if (key === 'messages-channel-current') return [] as T;
        if (key === 'messages-channel-old') return [driftedMessage] as T;
        return defaultValue;
      },
      keys: (prefix: string): string[] => {
        if (prefix === 'messages-') return ['messages-channel-old'];
        return [];
      },
    };

    (peer as any).restoreMessages();

    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe('msg-1');
    expect(restored[0]?.channelId).toBe('channel-current');
  });

  test('getThreadHistory returns latest N thread messages and honors excludeMessageId', () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer as any).messageStore = {
      getMessages: () => [
        { id: 'root-1', senderId: 'alice', content: 'root', timestamp: 50 },
      ],
      getThread: () => [
        { id: 'msg-1', senderId: 'alice', content: 'one', timestamp: 100 },
        { id: 'msg-4', senderId: 'alice', content: 'four', timestamp: 400 },
        { id: 'msg-3', senderId: 'bob', content: 'three', timestamp: 300 },
        { id: 'msg-2', senderId: 'alice', content: 'two', timestamp: 200 },
      ],
    };

    const history = (peer as any).getThreadHistory({
      channelId: 'chan-1',
      threadId: 'root-1',
      limit: 2,
      excludeMessageId: 'msg-4',
    });

    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe('msg-2');
    expect(history[1]?.id).toBe('msg-3');
  });

});
