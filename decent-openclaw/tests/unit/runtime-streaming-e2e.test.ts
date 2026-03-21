import { beforeEach, describe, expect, test } from "bun:test";
import { relayInboundMessageToPeer, resetThreadRoutingStateForTests } from "../../src/monitor.ts";

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
  beforeEach(() => {
    resetThreadRoutingStateForTests();
  });
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


  test("follow-up channel message without thread metadata reuses recent thread affinity", async () => {
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
        channelId: "chan-affinity",
        workspaceId: "ws-1",
        content: "hello in thread",
        senderId: "peer-affinity",
        senderName: "Peer",
        messageId: "msg-affinity-root",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-affinity",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-affinity",
        workspaceId: "ws-1",
        content: "follow up without thread metadata",
        senderId: "peer-affinity",
        senderName: "Peer",
        messageId: "msg-affinity-followup",
        chatType: "channel",
        timestamp: Date.now(),
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.sessionKey).toContain(":thread:root-affinity");
    expect(recorded[1]?.sessionKey).toContain(":thread:root-affinity");
    expect(recorded[1]?.ctx?.MessageThreadId).toBe("root-affinity");
  });

  test("auto-threaded top-level channel message starts a clean thread session", async () => {
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
        messageId: "msg-200",
        chatType: "channel",
        timestamp: Date.now(),
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sessionKey).toContain(":thread:msg-200");
    expect(recorded[0]?.ctx?.MessageThreadId).toBe("msg-200");
    expect(recorded[0]?.ctx?.ParentSessionKey).toBeUndefined();
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



  test("logs route decision when message is routed to thread session", async () => {
    const logs: string[] = [];

    const core = {
      config: {
        loadConfig: () => ({
          channels: {
            decentchat: {
              replyToMode: "all",
              thread: { historyScope: "thread", inheritParent: false, initialHistoryLimit: 2 },
            },
          },
        }),
      },
      channel: {
        routing: {
          resolveAgentRoute: () => ({ sessionKey: "session:group:ws:chan", agentId: "agent-1", accountId: "acct-1" }),
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
      getThreadHistory: () => [],
    } as any;

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-route-thread",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: {
        account: { streamEnabled: false } as any,
        accountId: "acct-1",
        log: {
          info: (line: string) => logs.push(`INFO ${line}`),
          debug: (line: string) => logs.push(`DEBUG ${line}`),
          warn: (line: string) => logs.push(`WARN ${line}`),
          error: (line: string) => logs.push(`ERROR ${line}`),
        },
      },
      core,
      xenaPeer,
    });

    const routeLog = logs.find((line) => line.includes("[decentchat] route"));
    expect(routeLog).toBeDefined();
    expect(routeLog).toContain("mode=thread");
    expect(routeLog).toContain("replyToMode=all");
    expect(routeLog).toContain("thread=root-777");
    expect(routeLog).toContain("session=session:group:ws:chan:thread:root-777");
    expect(routeLog).toContain("bootstrap=enabled");
  });

  test("logs route decision when thread split is disabled", async () => {
    const logs: string[] = [];

    const core = {
      config: { loadConfig: () => ({ channels: { decentchat: { replyToMode: "off" } } }) },
      channel: {
        routing: {
          resolveAgentRoute: () => ({ sessionKey: "session:group:ws:chan", agentId: "agent-1", accountId: "acct-1" }),
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
        messageId: "msg-route-base",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: {
        account: { streamEnabled: false } as any,
        accountId: "acct-1",
        log: {
          info: (line: string) => logs.push(`INFO ${line}`),
          debug: (line: string) => logs.push(`DEBUG ${line}`),
          warn: (line: string) => logs.push(`WARN ${line}`),
          error: (line: string) => logs.push(`ERROR ${line}`),
        },
      },
      core,
      xenaPeer,
    });

    const routeLog = logs.find((line) => line.includes("[decentchat] route"));
    expect(routeLog).toBeDefined();
    expect(routeLog).toContain("mode=base");
    expect(routeLog).toContain("replyToMode=off");
    expect(routeLog).toContain("thread=-");
    expect(routeLog).toContain("session=session:group:ws:chan");
    expect(routeLog).toContain("bootstrap=not-thread");
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
  test("initialHistoryLimit bootstraps first thread turn context", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];

    const core = {
      config: {
        loadConfig: () => ({
          channels: {
            decentchat: {
              replyToMode: "all",
              thread: { historyScope: "thread", inheritParent: false, initialHistoryLimit: 2 },
            },
          },
        }),
      },
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
      getThreadHistory: () => [
        { id: "m1", senderId: "peer-1", content: "first", timestamp: 100 },
        { id: "m2", senderId: "peer-2", content: "second", timestamp: 200 },
      ],
    } as any;

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "chan-1",
        workspaceId: "ws-1",
        content: "hello",
        senderId: "peer-1",
        senderName: "Peer",
        messageId: "msg-101d",
        chatType: "channel",
        timestamp: Date.now(),
        threadId: "root-777",
      },
      ctx: { account: { streamEnabled: false } as any, accountId: "acct-1" },
      core,
      xenaPeer,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.ctx?.Body).toContain("[Thread context: last 2 messages]");
    expect(recorded[0]?.ctx?.ThreadBootstrapHistoryCount).toBe(2);
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
  test("rapid partials are coalesced into a single final streamed delta and one canonical final DM", async () => {
    const streamStarts: Array<{ peerId: string; messageId: string }> = [];
    const streamDeltas: Array<{ peerId: string; messageId: string; content: string }> = [];
    const streamDone: Array<{ peerId: string; messageId: string }> = [];
    const persistedReplies: Array<{ peerId: string; content: string; threadId?: string; replyToId?: string; messageId?: string }> = [];

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
      sendDirectToPeer: async (peerId: string, content: string, threadId?: string, replyToId?: string, messageId?: string) => {
        persistedReplies.push({ peerId, content, threadId, replyToId, messageId });
      },
      sendToChannel: async () => {},
      persistMessageLocally: async () => {},
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
    expect(streamDeltas).toHaveLength(1);
    expect(streamDeltas.map((d) => d.content)).toEqual(["Hello world"]);
    expect(streamDone).toHaveLength(1);
    expect(streamDone[0]?.messageId).toBe(streamStarts[0]?.messageId);
    expect(persistedReplies).toEqual([
      {
        peerId: "peer-user",
        content: "Hello world",
        threadId: undefined,
        replyToId: "inbound-1",
        messageId: streamStarts[0]?.messageId,
      },
    ]);
  });

  test("streamed channel thread replies also send one canonical final channel message", async () => {
    const streamStarts: Array<{ channelId: string; workspaceId: string; messageId: string; threadId?: string; replyToId?: string }> = [];
    const streamDeltas: Array<{ channelId: string; workspaceId: string; messageId: string; content: string }> = [];
    const streamDone: Array<{ channelId: string; workspaceId: string; messageId: string }> = [];
    const persistedReplies: Array<{ channelId: string; content: string; threadId?: string; replyToId?: string; messageId?: string }> = [];

    const xenaPeer = {
      startStream: async (args: { channelId: string; workspaceId: string; messageId: string; threadId?: string; replyToId?: string }) => {
        streamStarts.push(args);
      },
      startDirectStream: async () => {},
      sendStreamDelta: async (args: { channelId: string; workspaceId: string; messageId: string; content: string }) => {
        streamDeltas.push(args);
      },
      sendDirectStreamDelta: async () => {},
      sendStreamDone: async (args: { channelId: string; workspaceId: string; messageId: string }) => {
        streamDone.push(args);
      },
      sendDirectStreamDone: async () => {},
      sendDirectToPeer: async () => {},
      sendToChannel: async (channelId: string, content: string, threadId?: string, replyToId?: string, messageId?: string) => {
        persistedReplies.push({ channelId, content, threadId, replyToId, messageId });
      },
      persistMessageLocally: async () => {},
      sendTyping: async () => {},
    };

    await relayInboundMessageToPeer({
      incoming: makeIncoming({
        messageId: 'inbound-thread-1',
        chatType: 'channel',
        channelId: 'chan-1',
        workspaceId: 'ws-1',
        threadId: 'thread-root-1',
      }),
      ctx: {
        account: { streamEnabled: true } as any,
        accountId: 'acct-1',
      },
      core: makeRuntime({ partials: ['Hey there'], finalText: 'Hey there' }),
      xenaPeer: xenaPeer as any,
    });

    expect(streamStarts).toHaveLength(1);
    expect(streamStarts[0]?.threadId).toBe('thread-root-1');
    expect(streamStarts[0]?.replyToId).toBe('inbound-thread-1');
    expect(streamDeltas).toEqual([
      {
        channelId: 'chan-1',
        workspaceId: 'ws-1',
        messageId: streamStarts[0]!.messageId,
        content: 'Hey there',
      },
    ]);
    expect(streamDone).toEqual([
      {
        channelId: 'chan-1',
        workspaceId: 'ws-1',
        messageId: streamStarts[0]!.messageId,
      },
    ]);
    expect(persistedReplies).toEqual([
      {
        channelId: 'chan-1',
        content: 'Hey there',
        threadId: 'thread-root-1',
        replyToId: 'inbound-thread-1',
        messageId: streamStarts[0]?.messageId,
      },
    ]);
  });

  test("channel replies send typing start immediately and stop after first streamed output", async () => {
    const calls: string[] = [];

    const xenaPeer = {
      startStream: async () => { calls.push('startStream'); },
      startDirectStream: async () => {},
      sendStreamDelta: async (args: { channelId: string; workspaceId: string; messageId: string; content: string }) => {
        void args;
        calls.push('sendStreamDelta');
      },
      sendDirectStreamDelta: async () => {},
      sendStreamDone: async () => { calls.push('sendStreamDone'); },
      sendDirectStreamDone: async () => {},
      sendDirectToPeer: async () => {},
      sendToChannel: async () => {},
      sendTyping: async (args: { channelId: string; workspaceId: string; typing: boolean }) => {
        calls.push(args.typing ? 'typingStart' : 'typingStop');
      },
    };

    await relayInboundMessageToPeer({
      incoming: makeIncoming({
        messageId: 'inbound-typing-1',
        chatType: 'channel',
        channelId: 'chan-1',
        workspaceId: 'ws-1',
      }),
      ctx: {
        account: { streamEnabled: true } as any,
        accountId: 'acct-1',
      },
      core: makeRuntime({ partials: ['Hello'], finalText: 'Hello' }),
      xenaPeer: xenaPeer as any,
    });

    expect(calls[0]).toBe('typingStart');
    expect(calls).toContain('startStream');
    expect(calls).toContain('sendStreamDelta');
    expect(calls).toContain('typingStop');
    expect(calls.indexOf('typingStart')).toBeLessThan(calls.indexOf('sendStreamDelta'));
    expect(calls.indexOf('sendStreamDelta')).toBeLessThan(calls.indexOf('typingStop'));
  });

  test("channel replies send typing start immediately and stop after non-stream final reply", async () => {
    const calls: string[] = [];

    const xenaPeer = {
      startStream: async () => {},
      startDirectStream: async () => {},
      sendStreamDelta: async () => {},
      sendDirectStreamDelta: async () => {},
      sendStreamDone: async () => {},
      sendDirectStreamDone: async () => {},
      sendDirectToPeer: async () => {},
      sendToChannel: async () => { calls.push('sendToChannel'); },
      sendTyping: async (args: { channelId: string; workspaceId: string; typing: boolean }) => {
        calls.push(args.typing ? 'typingStart' : 'typingStop');
      },
    };

    await relayInboundMessageToPeer({
      incoming: makeIncoming({
        messageId: 'inbound-typing-2',
        chatType: 'channel',
        channelId: 'chan-1',
        workspaceId: 'ws-1',
      }),
      ctx: {
        account: { streamEnabled: false } as any,
        accountId: 'acct-1',
      },
      core: makeRuntime({ finalText: 'single final reply' }),
      xenaPeer: xenaPeer as any,
    });

    expect(calls[0]).toBe('typingStart');
    expect(calls).toContain('sendToChannel');
    expect(calls).toContain('typingStop');
    expect(calls.indexOf('typingStart')).toBeLessThan(calls.indexOf('sendToChannel'));
    expect(calls.indexOf('sendToChannel')).toBeLessThan(calls.indexOf('typingStop'));
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
