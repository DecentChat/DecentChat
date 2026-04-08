import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import {
  createBridgeApp,
  splitReplyIntoChunks,
  PROGRESSIVE_REPLY_CHUNK_MAX_CHARS,
} from '../src/bridge-app.js';
import type { IncomingMessage } from '../src/peer.js';

type FakePeer = {
  isConnected: () => boolean;
  drainMessages: () => IncomingMessage[];
  sendMessage: (chatId: string, body: string) => Promise<string>;
  startStream: (
    chatId: string,
    options?: { replyTo?: string; threadId?: string; model?: Record<string, unknown> },
  ) => Promise<string>;
  appendStream: (chatId: string, messageId: string, content: string) => Promise<void>;
  finishStream: (chatId: string, messageId: string) => Promise<void>;
  sendTyping: (chatId: string, typing: boolean) => Promise<void>;
  getChatInfo: (chatId: string) => Promise<{ name: string; type: string; chat_id: string }>;
};

function listen(app: ReturnType<typeof createBridgeApp>): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve listening port'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
    server.on('error', reject);
  });
}

describe('bridge HTTP app', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    server = undefined;
  });

  test('health and message endpoints return expected payloads', async () => {
    const queue: IncomingMessage[] = [
      {
        id: 'm1',
        chatId: 'ws:general',
        senderId: 'peer-1',
        senderAlias: 'Alice',
        body: 'hello',
        timestamp: Date.now(),
        chatType: 'channel',
        isGroup: true,
        workspaceId: 'ws',
      },
    ];
    const peer: FakePeer = {
      isConnected: () => true,
      drainMessages: () => queue.splice(0, queue.length),
      sendMessage: async () => 'sent-1',
      startStream: async () => 'stream-1',
      appendStream: async () => {},
      finishStream: async () => {},
      sendTyping: async () => {},
      getChatInfo: async (chatId: string) => ({ name: chatId, type: 'group', chat_id: chatId }),
    };

    const app = createBridgeApp(peer, 'Hermes QA', {
      messagePollTimeoutMs: 30,
      messagePollIntervalMs: 5,
    });
    const listening = await listen(app);
    server = listening.server;

    const healthResp = await fetch(`${listening.baseUrl}/health`);
    expect(healthResp.status).toBe(200);
    expect(await healthResp.json()).toEqual({
      status: 'connected',
      connected: true,
      alias: 'Hermes QA',
    });

    const messagesResp = await fetch(`${listening.baseUrl}/messages`);
    expect(messagesResp.status).toBe(200);
    const messages = await messagesResp.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('hello');

    const emptyResp = await fetch(`${listening.baseUrl}/messages`);
    expect(emptyResp.status).toBe(200);
    expect(await emptyResp.json()).toEqual([]);
  });

  test('splitReplyIntoChunks keeps short replies as a single chunk', () => {
    const text = 'Short reply that should stay intact.';
    expect(splitReplyIntoChunks(text)).toEqual([text]);
  });

  test('splitReplyIntoChunks breaks long replies into <=500-char word-boundary chunks', () => {
    const repeated = Array.from({ length: 160 }, (_, i) => `word${i}`).join(' ');
    const chunks = splitReplyIntoChunks(repeated);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= PROGRESSIVE_REPLY_CHUNK_MAX_CHARS)).toBeTrue();

    const normalizedOriginal = repeated.replace(/\s+/g, ' ').trim();
    const normalizedRejoined = chunks.join(' ').replace(/\s+/g, ' ').trim();
    expect(normalizedRejoined).toBe(normalizedOriginal);

    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith(' ')).toBeFalse();
      expect(chunk.length).toBeLessThanOrEqual(PROGRESSIVE_REPLY_CHUNK_MAX_CHARS);
    }
  });

  test('POST /send sends long replies as sequential chunks', async () => {
    const sentBodies: string[] = [];
    const sentAt: number[] = [];
    const startedMessageIds: string[] = [];
    const finishedMessageIds: string[] = [];
    let startCount = 0;
    const peer: FakePeer = {
      isConnected: () => true,
      drainMessages: () => [],
      sendMessage: async () => 'unused',
      startStream: async () => {
        startCount += 1;
        return 'stream-send-1';
      },
      appendStream: async (_chatId: string, messageId: string, body: string) => {
        startedMessageIds.push(messageId);
        sentBodies.push(body);
        sentAt.push(Date.now());
      },
      finishStream: async (_chatId: string, messageId: string) => {
        finishedMessageIds.push(messageId);
      },
      sendTyping: async () => {},
      getChatInfo: async (chatId: string) => ({ name: chatId, type: 'group', chat_id: chatId }),
    };

    const text = Array.from({ length: 160 }, (_, i) => `word${i}`).join(' ');

    const app = createBridgeApp(peer, 'Hermes QA', {
      chunkDelayMs: 15,
    });
    const listening = await listen(app);
    server = listening.server;

    const response = await fetch(`${listening.baseUrl}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: 'ws:general', body: text }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBeTrue();
    expect(payload.chunkCount).toBeGreaterThan(1);
    expect(payload.messageId).toBe('stream-send-1');

    expect(sentBodies.length).toBeGreaterThan(1);
    expect(sentBodies.every((chunk) => chunk.length <= PROGRESSIVE_REPLY_CHUNK_MAX_CHARS)).toBeTrue();
    expect(startCount).toBe(1);
    expect(startedMessageIds.every((messageId) => messageId === 'stream-send-1')).toBeTrue();
    expect(finishedMessageIds).toEqual(['stream-send-1']);

    for (let idx = 1; idx < sentAt.length; idx += 1) {
      expect(sentAt[idx] - sentAt[idx - 1]).toBeGreaterThanOrEqual(10);
    }
  });

  test('POST /send keeps short replies as a single outbound message', async () => {
    const sentBodies: string[] = [];
    let started = 0;
    let finished = 0;
    const peer: FakePeer = {
      isConnected: () => true,
      drainMessages: () => [],
      sendMessage: async () => 'unused',
      startStream: async () => {
        started += 1;
        return 'stream-short-1';
      },
      appendStream: async (_chatId: string, _messageId: string, body: string) => {
        sentBodies.push(body);
      },
      finishStream: async () => {
        finished += 1;
      },
      sendTyping: async () => {},
      getChatInfo: async (chatId: string) => ({ name: chatId, type: 'group', chat_id: chatId }),
    };

    const app = createBridgeApp(peer, 'Hermes QA');
    const listening = await listen(app);
    server = listening.server;

    const response = await fetch(`${listening.baseUrl}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: 'ws:general', body: 'short reply' }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBeTrue();
    expect(payload.chunkCount).toBe(1);
    expect(payload.messageId).toBe('stream-short-1');
    expect(started).toBe(1);
    expect(finished).toBe(1);
    expect(sentBodies).toEqual(['short reply']);
  });

  test('stream endpoints forward start/chunk/done to peer streaming lifecycle', async () => {
    const calls: Array<{ kind: 'start' | 'chunk' | 'done'; payload: Record<string, unknown> }> = [];
    const peer: FakePeer = {
      isConnected: () => true,
      drainMessages: () => [],
      sendMessage: async () => 'unused',
      startStream: async (chatId, options) => {
        calls.push({ kind: 'start', payload: { chatId, options } });
        return 'stream-msg-1';
      },
      appendStream: async (chatId, messageId, content) => {
        calls.push({ kind: 'chunk', payload: { chatId, messageId, content } });
      },
      finishStream: async (chatId, messageId) => {
        calls.push({ kind: 'done', payload: { chatId, messageId } });
      },
      sendTyping: async () => {},
      getChatInfo: async (chatId: string) => ({ name: chatId, type: 'group', chat_id: chatId }),
    };

    const app = createBridgeApp(peer, 'Hermes QA');
    const listening = await listen(app);
    server = listening.server;

    const startResp = await fetch(`${listening.baseUrl}/stream/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: 'ws:general',
        replyTo: 'msg-parent',
        threadId: 'thread-1',
        model: { modelId: 'gpt-5.4' },
      }),
    });
    expect(startResp.status).toBe(200);
    expect(await startResp.json()).toEqual({
      success: true,
      messageId: 'stream-msg-1',
    });

    const chunkResp = await fetch(`${listening.baseUrl}/stream/chunk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: 'ws:general',
        messageId: 'stream-msg-1',
        content: 'partial token payload',
      }),
    });
    expect(chunkResp.status).toBe(200);
    expect(await chunkResp.json()).toEqual({ success: true });

    const doneResp = await fetch(`${listening.baseUrl}/stream/done`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: 'ws:general',
        messageId: 'stream-msg-1',
      }),
    });
    expect(doneResp.status).toBe(200);
    expect(await doneResp.json()).toEqual({ success: true });

    expect(calls).toEqual([
      {
        kind: 'start',
        payload: {
          chatId: 'ws:general',
          options: {
            replyTo: 'msg-parent',
            threadId: 'thread-1',
            model: { modelId: 'gpt-5.4' },
          },
        },
      },
      {
        kind: 'chunk',
        payload: {
          chatId: 'ws:general',
          messageId: 'stream-msg-1',
          content: 'partial token payload',
        },
      },
      {
        kind: 'done',
        payload: {
          chatId: 'ws:general',
          messageId: 'stream-msg-1',
        },
      },
    ]);
  });
});
