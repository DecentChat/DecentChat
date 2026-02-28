import { describe, expect, test } from "bun:test";
import { relayInboundMessageToPeer } from "../../src/monitor.ts";

function makeCore(params: {
  config: any;
  previousTimestamp?: number;
  recorded: Array<{ sessionKey: string; ctx: any }>;
}): any {
  return {
    config: { loadConfig: () => params.config },
    channel: {
      routing: {
        resolveAgentRoute: () => ({ sessionKey: "session:group:ws:chan", agentId: "agent-1", accountId: "acct-1" }),
      },
      session: {
        resolveStorePath: () => "/tmp/decent-openclaw-thread-history-test-store",
        readSessionUpdatedAt: () => params.previousTimestamp,
        recordInboundSession: async (args: any) => params.recorded.push(args),
      },
      reply: {
        resolveEnvelopeFormatOptions: () => ({}),
        formatAgentEnvelope: (args: { body: string }) => args.body,
        finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
        dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
          await dispatcherOptions.deliver({ text: "ok" });
        },
      },
    },
  };
}

function makePeer(overrides: Partial<any> = {}): any {
  return {
    startStream: async () => {},
    startDirectStream: async () => {},
    sendStreamDelta: async () => {},
    sendDirectStreamDelta: async () => {},
    sendStreamDone: async () => {},
    sendDirectStreamDone: async () => {},
    sendDirectToPeer: async () => {},
    sendToChannel: async () => {},
    sendReadReceipt: async () => {},
    requestFullImage: async () => null,
    ...overrides,
  };
}

describe("thread.initialHistoryLimit bootstrap", () => {
  test("first thread turn prepends bounded thread context", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];
    const core = makeCore({
      config: {
        channels: {
          decentchat: {
            replyToMode: "all",
            thread: { historyScope: "thread", inheritParent: false, initialHistoryLimit: 2 },
          },
        },
      },
      recorded,
    });

    const xenaPeer = makePeer({
      getThreadHistory: () => [
        { id: "m1", senderId: "peer-1", content: "first", timestamp: 100 },
        { id: "m2", senderId: "peer-2", content: "second", timestamp: 200 },
      ],
    });

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-new",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    const body = String(recorded[0]?.ctx?.Body ?? "");
    expect(body).toContain("[Thread context: last 2 messages]");
    expect(body).toContain("- Peer: first");
    expect(body).toContain("- peer-2: second");
    expect(body).toContain("\n\nhello");
  });

  test("initialHistoryLimit=0 disables bootstrap lookup", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];
    let lookupCalls = 0;
    const core = makeCore({
      config: {
        channels: {
          decentchat: {
            replyToMode: "all",
            thread: { historyScope: "thread", inheritParent: false, initialHistoryLimit: 0 },
          },
        },
      },
      recorded,
    });

    const xenaPeer = makePeer({
      getThreadHistory: () => {
        lookupCalls += 1;
        return [];
      },
    });

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-no-bootstrap",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(lookupCalls).toBe(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.ctx?.Body).toBe("hello");
  });

  test("subsequent thread turns do not re-bootstrap history", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];
    let lookupCalls = 0;
    const core = makeCore({
      config: {
        channels: {
          decentchat: {
            replyToMode: "all",
            thread: { historyScope: "thread", inheritParent: false, initialHistoryLimit: 5 },
          },
        },
      },
      previousTimestamp: Date.now() - 1000,
      recorded,
    });

    const xenaPeer = makePeer({
      getThreadHistory: () => {
        lookupCalls += 1;
        return [{ id: "m1", senderId: "peer-1", content: "first", timestamp: 100 }];
      },
    });

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-followup",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(lookupCalls).toBe(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.ctx?.Body).toBe("hello");
  });
});
