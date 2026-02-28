import { describe, expect, test } from "bun:test";
import { relayInboundMessageToPeer } from "../../src/monitor.ts";

type RuntimeScript = {
  partials?: string[];
  finalText?: string;
};

function makeRuntime(script: RuntimeScript): any {
  return {
    config: {
      loadConfig: () => ({}),
    },
    channel: {
      routing: {
        resolveAgentRoute: () => ({
          sessionKey: "session:direct:peer-user",
          agentId: "agent-1",
          accountId: "acct-1",
        }),
      },
      session: {
        resolveStorePath: () => "/tmp/decent-openclaw-stream-test-store",
        readSessionUpdatedAt: () => undefined,
        recordInboundSession: async () => {},
      },
      reply: {
        resolveEnvelopeFormatOptions: () => ({}),
        formatAgentEnvelope: (params: { body: string }) => params.body,
        finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
        dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions, replyOptions }: any) => {
          // onPartialReply sends CUMULATIVE text (like the real OpenClaw runtime)
          let cumulative = "";
          for (const chunk of script.partials ?? []) {
            cumulative += chunk;
            await replyOptions?.onPartialReply?.({ text: cumulative });
          }
          await dispatcherOptions.deliver({ text: script.finalText ?? "" });
        },
      },
    },
  };
}

function makeIncoming(overrides: Partial<any> = {}): any {
  return {
    channelId: "peer-user",
    workspaceId: "",
    content: "hello bot",
    senderId: "peer-user",
    senderName: "User",
    messageId: "inbound-1",
    chatType: "direct",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("runtime streaming relay integration", () => {
  test("thread reply without threadId uses replyToId and bootstraps parent session on first thread turn", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];

    const core = {
      config: { loadConfig: () => ({ channels: { decentchat: { replyToMode: "all", thread: { historyScope: "thread", inheritParent: false } } } }) },
      channel: {
        routing: {
          resolveAgentRoute: () => ({ sessionKey: "session:group:ws:chan", agentId: "agent-1", accountId: "acct-1" }),
        },
        session: {
          resolveStorePath: () => "/tmp/decent-openclaw-stream-test-store",
          readSessionUpdatedAt: () => undefined,
          recordInboundSession: async (args: any) => recorded.push(args),
        },
        reply: {
          resolveEnvelopeFormatOptions: () => ({}),
          formatAgentEnvelope: (params: { body: string }) => params.body,
          finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
            await dispatcherOptions.deliver({ text: "ok" });
          },
        },
      },
    } as any;

    const xenaPeer = {
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
    } as any;

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-100",
        chatType: "channel",
        timestamp: Date.now(),
        replyToId: "root-777",
        // threadId intentionally missing (legacy)
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sessionKey).toContain(":thread:root-777");
    expect(recorded[0]?.ctx?.MessageThreadId).toBe("root-777");
    expect(recorded[0]?.ctx?.ParentSessionKey).toBe("session:group:ws:chan");
  });

  test("replyToMode=off keeps base channel session (no per-thread split)", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];

    const core = {
      config: { loadConfig: () => ({ channels: { decentchat: { replyToMode: "off" } } }) },
      channel: {
        routing: {
          resolveAgentRoute: () => ({ sessionKey: "session:group:ws:chan", agentId: "agent-1", accountId: "acct-1" }),
        },
        session: {
          resolveStorePath: () => "/tmp/decent-openclaw-stream-test-store",
          readSessionUpdatedAt: () => undefined,
          recordInboundSession: async (args: any) => recorded.push(args),
        },
        reply: {
          resolveEnvelopeFormatOptions: () => ({}),
          formatAgentEnvelope: (params: { body: string }) => params.body,
          finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
            await dispatcherOptions.deliver({ text: "ok" });
          },
        },
      },
    } as any;

    const xenaPeer = {
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
    } as any;

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-101",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sessionKey).toBe("session:group:ws:chan");
    expect(recorded[0]?.ctx?.MessageThreadId).toBeUndefined();
  });



  test("replyToModeByChatType.channel=off keeps base channel session even when global is all", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];

    const core = {
      config: { loadConfig: () => ({ channels: { decentchat: { replyToMode: "all", replyToModeByChatType: { channel: "off" } } } }) },
      channel: {
        routing: {
          resolveAgentRoute: () => ({ sessionKey: "session:group:ws:chan", agentId: "agent-1", accountId: "acct-1" }),
        },
        session: {
          resolveStorePath: () => "/tmp/decent-openclaw-stream-test-store",
          readSessionUpdatedAt: () => undefined,
          recordInboundSession: async (args: any) => recorded.push(args),
        },
        reply: {
          resolveEnvelopeFormatOptions: () => ({}),
          formatAgentEnvelope: (params: { body: string }) => params.body,
          finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
            await dispatcherOptions.deliver({ text: "ok" });
          },
        },
      },
    } as any;

    const xenaPeer = {
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
    } as any;

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-101b",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sessionKey).toBe("session:group:ws:chan");
    expect(recorded[0]?.ctx?.MessageThreadId).toBeUndefined();
  });

  test("replyToModeByChatType.direct=off keeps base direct session even when global is all", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];

    const core = {
      config: { loadConfig: () => ({ channels: { decentchat: { replyToMode: "all", replyToModeByChatType: { direct: "off" } } } }) },
      channel: {
        routing: {
          resolveAgentRoute: () => ({ sessionKey: "session:direct:peer-user", agentId: "agent-1", accountId: "acct-1" }),
        },
        session: {
          resolveStorePath: () => "/tmp/decent-openclaw-stream-test-store",
          readSessionUpdatedAt: () => undefined,
          recordInboundSession: async (args: any) => recorded.push(args),
        },
        reply: {
          resolveEnvelopeFormatOptions: () => ({}),
          formatAgentEnvelope: (params: { body: string }) => params.body,
          finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
            await dispatcherOptions.deliver({ text: "ok" });
          },
        },
      },
    } as any;

    const xenaPeer = {
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
    } as any;

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "peer-user",
        workspaceId: "",
        content: "hello",
        senderId: "peer-user",
        senderName: "User",
        messageId: "msg-101c",
        chatType: "direct",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sessionKey).toBe("session:direct:peer-user");
    expect(recorded[0]?.ctx?.MessageThreadId).toBeUndefined();
  });
  test("thread.historyScope=channel keeps base channel session", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];

    const core = {
      config: { loadConfig: () => ({ channels: { decentchat: { replyToMode: "all", thread: { historyScope: "channel", inheritParent: true } } } }) },
      channel: {
        routing: {
          resolveAgentRoute: () => ({ sessionKey: "session:group:ws:chan", agentId: "agent-1", accountId: "acct-1" }),
        },
        session: {
          resolveStorePath: () => "/tmp/decent-openclaw-stream-test-store",
          readSessionUpdatedAt: () => undefined,
          recordInboundSession: async (args: any) => recorded.push(args),
        },
        reply: {
          resolveEnvelopeFormatOptions: () => ({}),
          formatAgentEnvelope: (params: { body: string }) => params.body,
          finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
            await dispatcherOptions.deliver({ text: "ok" });
          },
        },
      },
    } as any;

    const xenaPeer = {
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
    } as any;

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-102a",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sessionKey).toBe("session:group:ws:chan");
    expect(recorded[0]?.ctx?.MessageThreadId).toBeUndefined();
  });

  test("thread.inheritParent=true sets ParentSessionKey on thread sessions", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];

    const core = {
      config: { loadConfig: () => ({ channels: { decentchat: { replyToMode: "all", thread: { historyScope: "thread", inheritParent: true } } } }) },
      channel: {
        routing: {
          resolveAgentRoute: () => ({ sessionKey: "session:group:ws:chan", agentId: "agent-1", accountId: "acct-1" }),
        },
        session: {
          resolveStorePath: () => "/tmp/decent-openclaw-stream-test-store",
          readSessionUpdatedAt: () => undefined,
          recordInboundSession: async (args: any) => recorded.push(args),
        },
        reply: {
          resolveEnvelopeFormatOptions: () => ({}),
          formatAgentEnvelope: (params: { body: string }) => params.body,
          finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
            await dispatcherOptions.deliver({ text: "ok" });
          },
        },
      },
    } as any;

    const xenaPeer = {
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
    } as any;

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-102",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sessionKey).toContain(":thread:root-777");
    expect(recorded[0]?.ctx?.ParentSessionKey).toBe("session:group:ws:chan");
  });
  test("onPartialReply delivers tokens and final deliver is skipped when stream is active", async () => {
    const streamStarts: Array<{ peerId: string; messageId: string }> = [];
    const streamDeltas: Array<{ peerId: string; messageId: string; content: string }> = [];
    const streamDone: Array<{ peerId: string; messageId: string }> = [];
    const persistedReplies: Array<{ peerId: string; content: string; threadId?: string; replyToId?: string }> = [];

    const xenaPeer = {
      startStream: async () => {},
      startDirectStream: async (args: { peerId: string; messageId: string }) => {
        streamStarts.push(args);
      },
      sendStreamDelta: async () => {},
      sendDirectStreamDelta: async (args: { peerId: string; messageId: string; content: string }) => {
        streamDeltas.push(args);
      },
      sendStreamDone: async () => {},
      sendDirectStreamDone: async (args: { peerId: string; messageId: string }) => {
        streamDone.push(args);
      },
      sendDirectToPeer: async (peerId: string, content: string, threadId?: string, replyToId?: string) => {
        persistedReplies.push({ peerId, content, threadId, replyToId });
      },
      sendToChannel: async () => {},
    };

    await relayInboundMessageToPeer({
      incoming: makeIncoming(),
      ctx: {
        account: { streamEnabled: true } as any,
        accountId: "acct-1",
      },
      core: makeRuntime({ partials: ["Hel", "lo", " world"], finalText: "Hello world" }),
      xenaPeer,
    });

    expect(streamStarts).toHaveLength(1);
    expect(streamDeltas).toHaveLength(3);
    expect(streamDeltas.map((d) => d.content)).toEqual(["Hel", "Hello", "Hello world"]);
    expect(streamDone).toHaveLength(1);
    expect(streamDone[0]?.messageId).toBe(streamStarts[0]?.messageId);
    // Deliver(final text) is skipped in stream mode after partials became active.
    expect(persistedReplies).toEqual([]);
  });

  test("when streamEnabled=false, deliver callback persists final reply normally", async () => {
    const streamStarts: Array<{ peerId: string; messageId: string }> = [];
    const streamDeltas: Array<{ peerId: string; messageId: string; content: string }> = [];
    const streamDone: Array<{ peerId: string; messageId: string }> = [];
    const persistedReplies: Array<{ peerId: string; content: string; threadId?: string; replyToId?: string }> = [];

    const xenaPeer = {
      startStream: async () => {},
      startDirectStream: async (args: { peerId: string; messageId: string }) => {
        streamStarts.push(args);
      },
      sendStreamDelta: async () => {},
      sendDirectStreamDelta: async (args: { peerId: string; messageId: string; content: string }) => {
        streamDeltas.push(args);
      },
      sendStreamDone: async (args: { channelId: string; workspaceId: string; messageId: string }) => {
        void args;
      },
      sendDirectStreamDone: async (args: { peerId: string; messageId: string }) => {
        streamDone.push(args);
      },
      sendDirectToPeer: async (peerId: string, content: string, threadId?: string, replyToId?: string) => {
        persistedReplies.push({ peerId, content, threadId, replyToId });
      },
      sendToChannel: async () => {},
    };

    await relayInboundMessageToPeer({
      incoming: makeIncoming({ messageId: "inbound-2" }),
      ctx: {
        account: { streamEnabled: false } as any,
        accountId: "acct-1",
      },
      core: makeRuntime({ finalText: "single final reply" }),
      xenaPeer,
    });

    expect(streamStarts).toHaveLength(0);
    expect(streamDeltas).toHaveLength(0);
    expect(streamDone).toHaveLength(0);
    expect(persistedReplies).toEqual([
      {
        peerId: "peer-user",
        content: "single final reply",
        threadId: undefined,
        replyToId: "inbound-2",
      },
    ]);
  });

  test("empty partial reply text is ignored", async () => {
    const streamDeltas: Array<{ peerId: string; messageId: string; content: string }> = [];

    const xenaPeer = {
      startStream: async () => {},
      startDirectStream: async () => {},
      sendStreamDelta: async () => {},
      sendDirectStreamDelta: async (args: { peerId: string; messageId: string; content: string }) => {
        streamDeltas.push(args);
      },
      sendStreamDone: async () => {},
      sendDirectStreamDone: async () => {},
      sendDirectToPeer: async () => {},
      sendToChannel: async () => {},
    };

    await relayInboundMessageToPeer({
      incoming: makeIncoming({ messageId: "inbound-3" }),
      ctx: {
        account: { streamEnabled: true } as any,
        accountId: "acct-1",
      },
      core: makeRuntime({ partials: ["", "OK"], finalText: "OK" }),
      xenaPeer,
    });

    expect(streamDeltas.map((d) => d.content)).toEqual(["OK"]);
  });

  test("tool-call mismatch regex filtering still suppresses output", async () => {
    const streamDeltas: Array<{ peerId: string; messageId: string; content: string }> = [];
    const persistedReplies: Array<{ peerId: string; content: string; threadId?: string; replyToId?: string }> = [];

    const xenaPeer = {
      startStream: async () => {},
      startDirectStream: async () => {},
      sendStreamDelta: async () => {},
      sendDirectStreamDelta: async (args: { peerId: string; messageId: string; content: string }) => {
        streamDeltas.push(args);
      },
      sendStreamDone: async () => {},
      sendDirectStreamDone: async () => {},
      sendDirectToPeer: async (peerId: string, content: string, threadId?: string, replyToId?: string) => {
        persistedReplies.push({ peerId, content, threadId, replyToId });
      },
      sendToChannel: async () => {},
    };

    const mismatch = "No tool call found for function call output with call_id abc";
    await relayInboundMessageToPeer({
      incoming: makeIncoming({ messageId: "inbound-4" }),
      ctx: {
        account: { streamEnabled: true } as any,
        accountId: "acct-1",
      },
      core: makeRuntime({ partials: [mismatch], finalText: mismatch }),
      xenaPeer,
    });

    expect(streamDeltas).toHaveLength(0);
    expect(persistedReplies).toHaveLength(0);
  });
});
