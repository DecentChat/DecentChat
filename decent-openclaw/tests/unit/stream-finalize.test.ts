import { describe, expect, test } from 'bun:test';
import { finalizePeerStream } from '../../src/monitor.ts';

describe('stream finalization', () => {
  test('direct chat finalization sends only direct stream-done', async () => {
    const calls: string[] = [];
    const xenaPeer = {
      sendDirectStreamDone: async (_args: { peerId: string; messageId: string }) => {
        calls.push('sendDirectStreamDone');
      },
      sendStreamDone: async (_args: { channelId: string; workspaceId: string; messageId: string }) => {
        calls.push('sendStreamDone');
      },
      // Guard against regression to old duplicate path
      sendMessage: async () => {
        calls.push('sendMessage');
      },
    } as any;

    await finalizePeerStream({
      xenaPeer,
      chatType: 'direct',
      senderId: 'peer-1',
      channelId: 'ch-1',
      workspaceId: 'ws-1',
      streamMessageId: 'stream-1',
    });

    expect(calls).toEqual(['sendDirectStreamDone']);
  });

  test('group chat finalization sends only workspace stream-done', async () => {
    const calls: string[] = [];
    const xenaPeer = {
      sendDirectStreamDone: async (_args: { peerId: string; messageId: string }) => {
        calls.push('sendDirectStreamDone');
      },
      sendStreamDone: async (_args: { channelId: string; workspaceId: string; messageId: string }) => {
        calls.push('sendStreamDone');
      },
      sendMessage: async () => {
        calls.push('sendMessage');
      },
    } as any;

    await finalizePeerStream({
      xenaPeer,
      chatType: 'group',
      senderId: 'peer-1',
      channelId: 'ch-1',
      workspaceId: 'ws-1',
      streamMessageId: 'stream-2',
    });

    expect(calls).toEqual(['sendStreamDone']);
  });

  test('no-op when stream message id is missing', async () => {
    const calls: string[] = [];
    const xenaPeer = {
      sendDirectStreamDone: async () => { calls.push('sendDirectStreamDone'); },
      sendStreamDone: async () => { calls.push('sendStreamDone'); },
    } as any;

    await finalizePeerStream({
      xenaPeer,
      chatType: 'group',
      senderId: 'peer-1',
      channelId: 'ch-1',
      workspaceId: 'ws-1',
      streamMessageId: null,
    });

    expect(calls).toEqual([]);
  });
});
