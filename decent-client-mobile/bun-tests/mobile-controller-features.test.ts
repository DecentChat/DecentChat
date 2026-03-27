import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AttachmentMeta } from '@decentchat/protocol';
import { get } from 'svelte/store';
import { MobileController } from '../src/app/MobileController';
import * as appState from '../src/stores/appState';

type SentEntry = { peerId: string; payload: any };

class MockTransport {
  onConnect: ((peerId: string) => void) | null = null;
  onDisconnect: ((peerId: string) => void) | null = null;
  onMessage: ((peerId: string, payload: unknown) => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  sent: SentEntry[] = [];

  async init(): Promise<string> {
    return 'me-peer';
  }

  async connect(): Promise<void> {
    return;
  }

  send(peerId: string, payload: any): boolean {
    this.sent.push({ peerId, payload });
    return true;
  }

  destroy(): void {
    return;
  }

  getMyPeerId(): string {
    return 'me-peer';
  }
}

function resetStores(): void {
  appState.workspaces.set([]);
  appState.activeWorkspaceId.set(null);
  appState.messages.set({});
  appState.typingByChannel.set({});
  appState.connectionStatus.set('disconnected');
  appState.connectedPeers.set([]);
  appState.myPeerId.set('me-peer');
  appState.myAlias.set('Me');
}

function createController(): MobileController {
  (globalThis as any).__MockTransport = MockTransport;
  const controller = new MobileController();

  const persistent = controller.persistentStore as any;
  persistent.saveMessage = async () => {};
  persistent.saveMessages = async () => {};
  persistent.saveDirectConversation = async () => {};
  persistent.saveWorkspace = async () => {};
  persistent.saveSetting = async () => {};

  return controller;
}

beforeEach(() => {
  resetStores();
});

describe('MobileController outbox + sync + receipts', () => {
  test('queues outbound channel messages when peer is not ready', async () => {
    const controller = createController();
    const queued: Array<{ peerId: string; data: any }> = [];

    (controller.persistentStore as any).enqueueMessage = async (peerId: string, data: any) => {
      queued.push({ peerId, data });
    };

    const workspace = controller.workspaceManager.createWorkspace('Alpha', 'me-peer', 'Me', 'pub-me');
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-a',
      alias: 'Alice',
      publicKey: 'pub-a',
      role: 'member',
    });

    const channelId = workspace.channels[0]!.id;
    const sent = await controller.sendMessage(channelId, 'queued hello');

    expect(sent).toBe(true);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.peerId).toBe('peer-a');
    expect(queued[0]?.data?._deferred).toBe(true);
    expect(queued[0]?.data?.content).toBe('queued hello');
  });

  test('flushes deferred outbox when peer becomes ready', async () => {
    const controller = createController();
    const transport = controller.transport as unknown as MockTransport;

    const queueItem = {
      id: 7,
      attempts: 0,
      data: {
        _deferred: true,
        content: 'hello after reconnect',
        type: 'text',
        channelId: 'channel-1',
        workspaceId: 'workspace-1',
        timestamp: 1700000000000,
        messageId: 'msg-1',
      },
    };

    const dequeued: number[] = [];
    (controller.persistentStore as any).getQueuedMessages = async () => [queueItem];
    (controller.persistentStore as any).dequeueMessage = async (id: number) => {
      dequeued.push(id);
    };
    (controller.persistentStore as any).updateQueuedMessage = async () => {};

    (controller as any).readyPeers.add('peer-a');
    controller.messageProtocol = {
      encryptMessage: async () => ({ encrypted: { body: 'cipher' }, ratchet: { counter: 1 } }),
    } as any;

    await (controller as any).flushOfflineQueue('peer-a');

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.peerId).toBe('peer-a');
    expect(transport.sent[0]?.payload?.messageId).toBe('msg-1');
    expect(transport.sent[0]?.payload?.encrypted).toEqual({ body: 'cipher' });
    expect(dequeued).toEqual([7]);
  });

  test('marks unread messages as read and emits read receipts', async () => {
    const controller = createController();
    const transport = controller.transport as unknown as MockTransport;

    const workspace = controller.workspaceManager.createWorkspace('Beta', 'me-peer', 'Me', 'pub-me');
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-a',
      alias: 'Alice',
      publicKey: 'pub-a',
      role: 'member',
    });
    const channelId = workspace.channels[0]!.id;

    const incomingOne = await controller.messageStore.createMessage(channelId, 'peer-a', 'first');
    incomingOne.status = 'delivered';
    await controller.messageStore.addMessage(incomingOne);

    await new Promise((resolve) => setTimeout(resolve, 2));

    const incomingTwo = await controller.messageStore.createMessage(channelId, 'peer-a', 'second');
    incomingTwo.status = 'delivered';
    await controller.messageStore.addMessage(incomingTwo);

    (controller as any).readyPeers.add('peer-a');

    await controller.markChannelRead(channelId);

    const messages = controller.messageStore.getMessages(channelId);
    expect(messages.every((message) => message.status === 'read')).toBe(true);

    const readReceipts = transport.sent.filter((entry) => entry.payload?.type === 'read');
    expect(readReceipts).toHaveLength(2);
    expect(readReceipts[0]?.peerId).toBe('peer-a');
    expect(readReceipts[0]?.payload?.channelId).toBe(channelId);
  });

  test('requests missing attachment blobs after sync response import', async () => {
    const controller = createController();
    const transport = controller.transport as unknown as MockTransport;

    const workspace = controller.workspaceManager.createWorkspace('Gamma', 'me-peer', 'Me', 'pub-me');
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-a',
      alias: 'Alice',
      publicKey: 'pub-a',
      role: 'member',
    });
    const channelId = workspace.channels[0]!.id;

    const attachment: AttachmentMeta = {
      id: 'att-1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      type: 'image',
      size: 1234,
      hash: 'abc123',
    };

    await (controller as any).handleMessageSyncResponse('peer-a', {
      type: 'message-sync-response',
      workspaceId: workspace.id,
      messages: [
        {
          id: 'sync-msg-1',
          channelId,
          senderId: 'peer-a',
          content: 'with attachment',
          timestamp: Date.now(),
          type: 'file',
          prevHash: '',
          attachments: [attachment],
        },
      ],
    });

    const mediaRequests = transport.sent.filter((entry) => entry.payload?.type === 'media-request');
    expect(mediaRequests).toHaveLength(1);
    expect(mediaRequests[0]?.peerId).toBe('peer-a');
    expect(mediaRequests[0]?.payload?.attachmentId).toBe('att-1');
  });

  test('typing indicator updates channel typing store', () => {
    appState.setTypingForChannel('chan-1', []);
    appState.updateTypingForChannel('chan-1', 'peer-a', true);
    expect(get(appState.typingByChannel)['chan-1']).toEqual(['peer-a']);

    appState.updateTypingForChannel('chan-1', 'peer-a', false);
    expect(get(appState.typingByChannel)['chan-1']).toEqual([]);
  });


  test('direct conversations request timestamp sync and import direct sync responses', async () => {
    const controller = createController();
    const transport = controller.transport as unknown as MockTransport;

    const conversation = await controller.directConversationStore.create('peer-a');
    (controller as any).directConversationsById.set(conversation.id, conversation);
    (controller as any).readyPeers.add('peer-a');

    await (controller as any).requestTimestampMessageSyncForPeer('peer-a');

    const syncRequest = transport.sent.find((entry) => entry.payload?.type === 'message-sync-request' && entry.peerId === 'peer-a');
    expect(syncRequest?.payload?.workspaceId).toBe('__direct__:peer-a');
    expect(syncRequest?.payload?.channelTimestamps?.__direct__).toBe(0);

    await (controller as any).handleMessageSyncResponse('peer-a', {
      type: 'message-sync-response',
      workspaceId: '__direct__:peer-a',
      messages: [
        {
          id: 'dm-sync-1',
          channelId: '__direct__',
          senderId: 'peer-a',
          content: 'missed dm while offline',
          timestamp: Date.now(),
          type: 'text',
          status: 'delivered',
          prevHash: '',
        },
      ],
    });

    const directMessages = controller.messageStore.getMessages(conversation.id);
    expect(directMessages).toHaveLength(1);
    expect(directMessages[0]?.content).toBe('missed dm while offline');
  });

  test('receipt status only advances when all recipients have acknowledged or read', async () => {
    const controller = createController();

    const workspace = controller.workspaceManager.createWorkspace('Receipts', 'me-peer', 'Me', 'pub-me');
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-a',
      alias: 'Alice',
      publicKey: 'pub-a',
      role: 'member',
    });
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-b',
      alias: 'Bob',
      publicKey: 'pub-b',
      role: 'member',
    });

    const channelId = workspace.channels[0]!.id;
    await controller.sendMessage(channelId, 'team update');
    const outgoing = controller.messageStore.getMessages(channelId)[0]!;

    await (controller as any).handleReceiptControl('peer-a', { type: 'ack', channelId, messageId: outgoing.id });
    expect(controller.messageStore.getMessages(channelId)[0]?.status).toBe('sent');

    await (controller as any).handleReceiptControl('peer-b', { type: 'ack', channelId, messageId: outgoing.id });
    expect(controller.messageStore.getMessages(channelId)[0]?.status).toBe('delivered');

    await (controller as any).handleReceiptControl('peer-a', { type: 'read', channelId, messageId: outgoing.id });
    expect(controller.messageStore.getMessages(channelId)[0]?.status).toBe('delivered');

    await (controller as any).handleReceiptControl('peer-b', { type: 'read', channelId, messageId: outgoing.id });
    expect(controller.messageStore.getMessages(channelId)[0]?.status).toBe('read');
  });

  test('sync response merges edited or deleted messages even when replacement content is shorter', async () => {
    const controller = createController();

    const workspace = controller.workspaceManager.createWorkspace('Delta', 'me-peer', 'Me', 'pub-me');
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-a',
      alias: 'Alice',
      publicKey: 'pub-a',
      role: 'member',
    });
    const channelId = workspace.channels[0]!.id;

    const original = await controller.messageStore.createMessage(channelId, 'peer-a', 'this is the original longer message');
    original.id = 'msg-edit-1';
    original.status = 'delivered';
    await controller.messageStore.addMessage(original);

    await (controller as any).handleMessageSyncResponse('peer-a', {
      type: 'message-sync-response',
      workspaceId: workspace.id,
      messages: [
        {
          id: 'msg-edit-1',
          channelId,
          senderId: 'peer-a',
          content: 'short edit',
          timestamp: original.timestamp + 10,
          type: 'system',
          status: 'read',
          prevHash: 'updated-prev-hash',
          editedAt: Date.now(),
          deletedAt: Date.now(),
          deleted: true,
        },
      ],
    });

    const updated = controller.messageStore.getMessages(channelId)[0] as any;
    expect(updated.content).toBe('short edit');
    expect(updated.type).toBe('system');
    expect(updated.status).toBe('read');
    expect(updated.prevHash).toBe('updated-prev-hash');
    expect(updated.editedAt).toBeNumber();
    expect(updated.deletedAt).toBeNumber();
    expect(updated.deleted).toBe(true);
  });

  test('join-request rejects peer spoofing and never grants elevated role from payload', async () => {
    const controller = createController();
    const transport = controller.transport as unknown as MockTransport;

    const workspace = controller.workspaceManager.createWorkspace('JoinHardening', 'me-peer', 'Me', 'pub-me');

    await (controller as any).handleJoinRequest('peer-a', {
      inviteCode: workspace.inviteCode,
      member: {
        peerId: 'peer-b',
        alias: 'Mallory',
        publicKey: 'pub-b',
        role: 'owner',
      },
    });

    const spoofedMember = workspace.members.find((member) => member.peerId === 'peer-b');
    expect(spoofedMember).toBeUndefined();

    const spoofRejection = transport.sent.find((entry) => entry.payload?.sync?.type === 'join-rejected');
    expect(spoofRejection?.payload?.sync?.reason).toBe('Peer identity mismatch');

    transport.sent = [];

    await (controller as any).handleJoinRequest('peer-a', {
      inviteCode: workspace.inviteCode,
      member: {
        peerId: 'peer-a',
        alias: 'Alice',
        publicKey: 'pub-a',
        role: 'owner',
      },
    });

    const joined = workspace.members.find((member) => member.peerId === 'peer-a');
    expect(joined?.role).toBe('member');

    const accepted = transport.sent.find((entry) => entry.payload?.sync?.type === 'join-accepted');
    expect(accepted).toBeDefined();
  });

  test('media-request only serves attachments to authorized peers', async () => {
    const controller = createController();
    const transport = controller.transport as unknown as MockTransport;

    const conversation = await controller.directConversationStore.create('peer-a');
    (controller as any).directConversationsById.set(conversation.id, conversation);

    const attachment: AttachmentMeta = {
      id: 'att-secure-1',
      name: 'secret.txt',
      mimeType: 'text/plain',
      type: 'file',
      size: 6,
      hash: 'hash',
    };

    const message = await controller.messageStore.createMessage(conversation.id, 'me-peer', 'secret', 'file');
    message.status = 'sent';
    message.recipientPeerIds = ['peer-a'];
    (message as any).attachments = [attachment];
    await controller.messageStore.addMessage(message);
    (controller as any).registerAttachmentIndex(conversation.id, message.id, [attachment]);
    (controller as any).localAttachmentBlobs.set(attachment.id, new TextEncoder().encode('secret').buffer);

    await (controller as any).handleMediaRequest('peer-b', {
      type: 'media-request',
      attachmentId: attachment.id,
      channelId: conversation.id,
      messageId: message.id,
    });

    const denied = transport.sent.find((entry) => entry.peerId === 'peer-b' && entry.payload?.type === 'media-response');
    expect(denied?.payload?.available).toBe(false);

    transport.sent = [];

    await (controller as any).handleMediaRequest('peer-a', {
      type: 'media-request',
      attachmentId: attachment.id,
      channelId: conversation.id,
      messageId: message.id,
    });

    const allowed = transport.sent.find((entry) => entry.peerId === 'peer-a' && entry.payload?.type === 'media-response');
    expect(allowed?.payload?.available).toBe(true);
  });

  test('media chunks from a different peer are ignored for an existing transfer', async () => {
    const controller = createController();

    const conversation = await controller.directConversationStore.create('peer-a');
    (controller as any).directConversationsById.set(conversation.id, conversation);

    const attachment: AttachmentMeta = {
      id: 'att-secure-2',
      name: 'secret.txt',
      mimeType: 'text/plain',
      type: 'file',
      size: 6,
      hash: 'hash',
    };

    const message = await controller.messageStore.createMessage(conversation.id, 'peer-a', 'secret', 'file');
    message.status = 'delivered';
    message.recipientPeerIds = ['me-peer'];
    (message as any).attachments = [attachment];
    await controller.messageStore.addMessage(message);

    await (controller as any).handleMediaResponse('peer-a', {
      type: 'media-response',
      attachmentId: attachment.id,
      channelId: conversation.id,
      messageId: message.id,
      available: true,
      totalChunks: 1,
    });

    await (controller as any).handleMediaChunk('peer-b', {
      type: 'media-chunk',
      attachmentId: attachment.id,
      channelId: conversation.id,
      messageId: message.id,
      index: 0,
      total: 1,
      data: '',
      chunkHash: '',
    });

    const transfer = (controller as any).pendingMediaTransfers.get(attachment.id);
    expect(transfer?.peerId).toBe('peer-a');
  });

  test('sync response ignores messages with sender outside workspace membership', async () => {
    const controller = createController();

    const workspace = controller.workspaceManager.createWorkspace('SyncHardening', 'me-peer', 'Me', 'pub-me');
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-a',
      alias: 'Alice',
      publicKey: 'pub-a',
      role: 'member',
    });
    const channelId = workspace.channels[0]!.id;

    await (controller as any).handleMessageSyncResponse('peer-a', {
      type: 'message-sync-response',
      workspaceId: workspace.id,
      messages: [
        {
          id: 'spoof-msg-1',
          channelId,
          senderId: 'peer-z',
          content: 'spoof',
          timestamp: Date.now(),
          type: 'text',
          prevHash: '',
        },
      ],
    });

    expect(controller.messageStore.getMessages(channelId)).toHaveLength(0);

    const original = await controller.messageStore.createMessage(channelId, 'peer-a', 'real');
    original.id = 'msg-real-1';
    original.status = 'delivered';
    await controller.messageStore.addMessage(original);

    await (controller as any).handleMessageSyncResponse('peer-a', {
      type: 'message-sync-response',
      workspaceId: workspace.id,
      messages: [
        {
          id: 'msg-real-1',
          channelId,
          senderId: 'peer-z',
          content: 'tampered',
          timestamp: original.timestamp + 1,
          type: 'text',
          prevHash: original.prevHash,
        },
      ],
    });

    expect(controller.messageStore.getMessages(channelId)[0]?.content).toBe('real');
  });

  test('pre-key bootstrap targets custodians first for sender-side first-contact encryption', async () => {
    const controller = createController();
    const transport = controller.transport as unknown as MockTransport;

    const workspace = controller.workspaceManager.createWorkspace('PreKey', 'me-peer', 'Me', 'pub-me');
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-target',
      alias: 'Target',
      publicKey: 'pub-target',
      role: 'member',
    });
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'custodian-1',
      alias: 'Server Custodian',
      publicKey: 'pub-custodian',
      role: 'member',
    });
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-relay',
      alias: 'Relay',
      publicKey: 'pub-relay',
      role: 'member',
    });

    (controller as any).readyPeers.add('custodian-1');
    (controller as any).readyPeers.add('peer-relay');

    let hasBundle = false;
    const storePeerPreKeyBundle = mock(async (ownerPeerId: string) => {
      if (ownerPeerId === 'peer-target') hasBundle = true;
      return true;
    });

    controller.messageProtocol = {
      encryptMessage: mock(async (peerId: string) => {
        if (peerId === 'peer-target' && !hasBundle) {
          throw new Error('No shared secret with peer peer-target');
        }
        return { encrypted: { body: 'cipher' }, ratchet: { counter: 1 } };
      }),
      getPeerPreKeyBundle: mock(async () => null),
      storePeerPreKeyBundle,
    } as any;

    (controller as any).selectCustodianPeers = mock(() => ['custodian-1']);

    const fetchTargets: string[] = [];
    transport.send = (peerId: string, payload: any) => {
      if (payload?.type === 'pre-key-bundle.fetch') {
        fetchTargets.push(`${peerId}:${payload.querySource}`);
        if (peerId === 'custodian-1') {
          setTimeout(() => {
            void (controller as any).handlePreKeyControlMessage('custodian-1', {
              type: 'pre-key-bundle.fetch-response',
              requestId: payload.requestId,
              ownerPeerId: 'peer-target',
              workspaceId: workspace.id,
              querySource: payload.querySource,
              bundle: {
                version: 1,
                peerId: 'peer-target',
                generatedAt: Date.now(),
                signingPublicKey: 'signing',
                signedPreKey: {
                  keyId: 1,
                  publicKey: 'signed',
                  signature: 'sig',
                  createdAt: Date.now(),
                  expiresAt: Date.now() + 60_000,
                },
                oneTimePreKeys: [],
              },
            });
          }, 0);
        }
      }
      return true;
    };

    const envelope = await (controller as any).encryptMessageWithPreKeyBootstrap(
      'peer-target',
      'hello',
      'text',
      undefined,
      workspace.id,
    );

    expect(envelope).toEqual({ encrypted: { body: 'cipher' }, ratchet: { counter: 1 } });
    expect(fetchTargets).toEqual(['custodian-1:custodian-targeted']);
    expect(storePeerPreKeyBundle).toHaveBeenCalledWith('peer-target', expect.any(Object));
  });

  test('pre-key bootstrap falls back to broader peer fetch when custodians do not have bundle', async () => {
    const controller = createController();
    const transport = controller.transport as unknown as MockTransport;

    const workspace = controller.workspaceManager.createWorkspace('PreKeyFallback', 'me-peer', 'Me', 'pub-me');
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-target',
      alias: 'Target',
      publicKey: 'pub-target',
      role: 'member',
    });
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'custodian-1',
      alias: 'Server Custodian',
      publicKey: 'pub-custodian',
      role: 'member',
    });
    controller.workspaceManager.addMember(workspace.id, {
      peerId: 'peer-relay',
      alias: 'Relay',
      publicKey: 'pub-relay',
      role: 'member',
    });

    (controller as any).readyPeers.add('custodian-1');
    (controller as any).readyPeers.add('peer-relay');

    let hasBundle = false;
    const storePeerPreKeyBundle = mock(async (ownerPeerId: string) => {
      if (ownerPeerId === 'peer-target') hasBundle = true;
      return true;
    });

    controller.messageProtocol = {
      encryptMessage: mock(async (peerId: string) => {
        if (peerId === 'peer-target' && !hasBundle) {
          throw new Error('No shared secret with peer peer-target');
        }
        return { encrypted: { body: 'cipher' }, ratchet: { counter: 1 } };
      }),
      getPeerPreKeyBundle: mock(async () => null),
      storePeerPreKeyBundle,
    } as any;

    (controller as any).selectCustodianPeers = mock(() => ['custodian-1']);

    const fetchTargets: string[] = [];
    transport.send = (peerId: string, payload: any) => {
      if (payload?.type === 'pre-key-bundle.fetch') {
        fetchTargets.push(`${peerId}:${payload.querySource}`);

        if (peerId === 'custodian-1') {
          setTimeout(() => {
            void (controller as any).handlePreKeyControlMessage('custodian-1', {
              type: 'pre-key-bundle.fetch-response',
              requestId: payload.requestId,
              ownerPeerId: 'peer-target',
              workspaceId: workspace.id,
              querySource: payload.querySource,
              notAvailable: true,
            });
          }, 0);
        }

        if (peerId === 'peer-relay') {
          setTimeout(() => {
            void (controller as any).handlePreKeyControlMessage('peer-relay', {
              type: 'pre-key-bundle.fetch-response',
              requestId: payload.requestId,
              ownerPeerId: 'peer-target',
              workspaceId: workspace.id,
              querySource: payload.querySource,
              bundle: {
                version: 1,
                peerId: 'peer-target',
                generatedAt: Date.now(),
                signingPublicKey: 'signing',
                signedPreKey: {
                  keyId: 2,
                  publicKey: 'signed-2',
                  signature: 'sig-2',
                  createdAt: Date.now(),
                  expiresAt: Date.now() + 60_000,
                },
                oneTimePreKeys: [],
              },
            });
          }, 0);
        }
      }
      return true;
    };

    const envelope = await (controller as any).encryptMessageWithPreKeyBootstrap(
      'peer-target',
      'hello',
      'text',
      undefined,
      workspace.id,
    );

    expect(envelope).toEqual({ encrypted: { body: 'cipher' }, ratchet: { counter: 1 } });
    expect(fetchTargets).toEqual([
      'custodian-1:custodian-targeted',
      'peer-relay:peer-broadcast',
    ]);
    expect(storePeerPreKeyBundle).toHaveBeenCalledWith('peer-target', expect.any(Object));
  });

});
