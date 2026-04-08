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
    const peer: FakePeer = {
      isConnected: () => true,
      drainMessages: () => [],
      sendMessage: async (_chatId: string, body: string) => {
        sentBodies.push(body);
        sentAt.push(Date.now());
        return `sent-${sentBodies.length}`;
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

    expect(sentBodies.length).toBeGreaterThan(1);
    expect(sentBodies.every((chunk) => chunk.length <= PROGRESSIVE_REPLY_CHUNK_MAX_CHARS)).toBeTrue();

    for (let idx = 1; idx < sentAt.length; idx += 1) {
      expect(sentAt[idx] - sentAt[idx - 1]).toBeGreaterThanOrEqual(10);
    }
  });

  test('POST /send keeps short replies as a single outbound message', async () => {
    const sentBodies: string[] = [];
    const peer: FakePeer = {
      isConnected: () => true,
      drainMessages: () => [],
      sendMessage: async (_chatId: string, body: string) => {
        sentBodies.push(body);
        return 'sent-short';
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
    expect(sentBodies).toEqual(['short reply']);
  });
});
