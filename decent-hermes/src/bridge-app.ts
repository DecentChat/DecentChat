import express from 'express';

export type BridgeChatInfo = { name: string; type: string; chat_id: string };

export type BridgePeer = {
  isConnected: () => boolean;
  drainMessages: () => unknown[];
  sendMessage: (chatId: string, body: string, ...rest: unknown[]) => Promise<string>;
  startStream: (
    chatId: string,
    options?: {
      replyTo?: string;
      threadId?: string;
      model?: Record<string, unknown>;
      messageId?: string;
    },
  ) => Promise<string>;
  appendStream: (chatId: string, messageId: string, content: string) => Promise<void>;
  finishStream: (chatId: string, messageId: string) => Promise<void>;
  sendTyping?: (chatId: string, typing: boolean) => Promise<void>;
  getChatInfo: (chatId: string) => Promise<BridgeChatInfo>;
};

export type BridgeAppOptions = {
  messagePollTimeoutMs?: number;
  messagePollIntervalMs?: number;
  maxReplyChunkChars?: number;
  chunkDelayMs?: number;
};

export const PROGRESSIVE_REPLY_CHUNK_MAX_CHARS = 500;
export const PROGRESSIVE_REPLY_CHUNK_DELAY_MS = 100;

export function splitReplyIntoChunks(body: string, maxChars = PROGRESSIVE_REPLY_CHUNK_MAX_CHARS): string[] {
  if (body.length <= maxChars) return [body];

  const words = body.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [body];

  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let offset = 0; offset < word.length; offset += maxChars) {
        chunks.push(word.slice(offset, offset + maxChars));
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = word;
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [body];
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createBridgeApp(
  peer: BridgePeer,
  alias: string,
  options: BridgeAppOptions = {},
): express.Express {
  const app = express();
  const messagePollTimeoutMs = options.messagePollTimeoutMs ?? 20_000;
  const messagePollIntervalMs = options.messagePollIntervalMs ?? 400;
  const maxReplyChunkChars = options.maxReplyChunkChars ?? PROGRESSIVE_REPLY_CHUNK_MAX_CHARS;
  const chunkDelayMs = options.chunkDelayMs ?? PROGRESSIVE_REPLY_CHUNK_DELAY_MS;

  app.use(express.json());

  app.get('/health', (_req, res) => {
    const connected = peer.isConnected();
    res.json({
      status: connected ? 'connected' : 'connecting',
      connected,
      alias,
    });
  });

  app.get('/messages', async (_req, res) => {
    const deadline = Date.now() + messagePollTimeoutMs;
    while (Date.now() < deadline) {
      const msgs = peer.drainMessages();
      if (msgs.length > 0) {
        res.json(msgs);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, messagePollIntervalMs));
    }
    res.json([]);
  });

  app.post('/send', async (req, res) => {
    const { chatId, body, replyTo, threadId, model } = req.body as {
      chatId: string;
      body: string;
      replyTo?: string;
      threadId?: string;
      model?: { modelId?: string; modelName?: string; modelAlias?: string; modelLabel?: string };
    };
    if (!chatId || !body) {
      res.status(400).json({ success: false, error: 'chatId and body required' });
      return;
    }
    try {
      const chunks = splitReplyIntoChunks(body, maxReplyChunkChars);
      const messageId = await peer.startStream(chatId, {
        ...(replyTo ? { replyTo } : {}),
        ...(threadId ? { threadId } : {}),
        ...(model ? { model } : {}),
      });

      for (let index = 0; index < chunks.length; index += 1) {
        await peer.appendStream(chatId, messageId, chunks[index]);
        if (index < chunks.length - 1 && chunkDelayMs > 0) {
          await sleep(chunkDelayMs);
        }
      }

      await peer.finishStream(chatId, messageId);
      res.json({ success: true, messageId, chunkCount: chunks.length });
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });

  app.post('/stream/start', async (req, res) => {
    const { chatId, replyTo, threadId, model, messageId } = req.body as {
      chatId: string;
      replyTo?: string;
      threadId?: string;
      model?: Record<string, unknown>;
      messageId?: string;
    };
    if (!chatId) {
      res.status(400).json({ success: false, error: 'chatId required' });
      return;
    }
    try {
      const startedMessageId = await peer.startStream(chatId, {
        ...(replyTo ? { replyTo } : {}),
        ...(threadId ? { threadId } : {}),
        ...(model ? { model } : {}),
        ...(messageId ? { messageId } : {}),
      });
      res.json({ success: true, messageId: startedMessageId });
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });

  app.post('/stream/chunk', async (req, res) => {
    const { chatId, messageId, content } = req.body as {
      chatId: string;
      messageId: string;
      content?: string;
    };
    if (!chatId || !messageId) {
      res.status(400).json({ success: false, error: 'chatId and messageId required' });
      return;
    }
    try {
      await peer.appendStream(chatId, messageId, String(content ?? ''));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });

  app.post('/stream/done', async (req, res) => {
    const { chatId, messageId } = req.body as {
      chatId: string;
      messageId: string;
    };
    if (!chatId || !messageId) {
      res.status(400).json({ success: false, error: 'chatId and messageId required' });
      return;
    }
    try {
      await peer.finishStream(chatId, messageId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });

  app.post('/typing', async (req, res) => {
    const { chatId, typing } = req.body as { chatId: string; typing: boolean };
    if (!chatId) {
      res.status(400).json({ success: false, error: 'chatId required' });
      return;
    }
    try {
      if (peer.sendTyping) {
        await peer.sendTyping(chatId, typing === true);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e?.message ?? e) });
    }
  });

  app.get('/chat/:chatId', async (req, res) => {
    const chatId = decodeURIComponent(req.params.chatId).replace(/~/g, ':');
    try {
      const info = await peer.getChatInfo(chatId);
      res.json(info);
    } catch {
      res.status(404).json({ error: 'not found' });
    }
  });

  return app;
}
