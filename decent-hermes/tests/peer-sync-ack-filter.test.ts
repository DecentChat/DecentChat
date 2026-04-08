import { describe, expect, test } from 'bun:test';

function makeSyncHarness() {
  const sentPayloads: any[] = [];
  const importedBatches: Array<{ channelId: string; messages: any[] }> = [];
  const surfacedMessages: any[] = [];
  const persistedChannels: string[] = [];
  const messagesByChannel = new Map<string, any[]>();

  const workspace = {
    id: 'ws-1',
    members: [{ peerId: 'peer-remote' }],
  };

  return {
    sentPayloads,
    importedBatches,
    surfacedMessages,
    persistedChannels,
    messagesByChannel,
    workspace,
  };
}

describe('DecentChatNodePeer sync ACK gating', () => {
  test('does not ACK content-less sync messages (prevents repeated ACK loop)', async () => {
    const { DecentChatNodePeer } = await import(`../src/peer/DecentChatNodePeer.js?real=${Date.now()}`);
    const harness = makeSyncHarness();

    const peer = Object.create((DecentChatNodePeer as any).prototype) as any;
    peer.startedAt = Date.now();
    peer.myPeerId = 'peer-self';
    peer.transport = {
      send: (_peerId: string, payload: any) => {
        harness.sentPayloads.push(payload);
        return true;
      },
    };
    peer.workspaceManager = {
      getWorkspace: (workspaceId: string) => (workspaceId === 'ws-1' ? harness.workspace : null),
    };
    peer.messageStore = {
      getMessages: (channelId: string) => harness.messagesByChannel.get(channelId) ?? [],
      importMessages: async (channelId: string, messages: any[]) => {
        harness.messagesByChannel.set(channelId, messages);
        harness.importedBatches.push({ channelId, messages });
      },
    };
    peer.findWorkspaceIdForChannel = (channelId: string) => (channelId === 'chan-1' ? 'ws-1' : undefined);
    peer.persistMessagesForChannel = (channelId: string) => {
      harness.persistedChannels.push(channelId);
    };
    peer.enqueueOffline = async () => {};
    peer.opts = {
      log: {
        info: () => {},
        warn: () => {},
      },
      onIncomingMessage: async (message: any) => {
        harness.surfacedMessages.push(message);
      },
    };

    const syncPayload = {
      type: 'message-sync-response',
      workspaceId: 'ws-1',
      messages: [
        {
          id: 'msg-empty-1',
          channelId: 'chan-1',
          senderId: 'peer-remote',
          content: '',
          timestamp: Date.now(),
        },
      ],
    };

    await peer.handleMessageSyncResponse('peer-remote', syncPayload);
    await peer.handleMessageSyncResponse('peer-remote', syncPayload);

    expect(harness.sentPayloads.filter((payload) => payload?.type === 'ack')).toHaveLength(0);
    expect(harness.importedBatches).toHaveLength(0);
    expect(harness.persistedChannels).toHaveLength(0);
    expect(harness.surfacedMessages).toHaveLength(0);
  });
});
