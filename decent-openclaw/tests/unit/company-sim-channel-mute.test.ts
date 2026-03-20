import { describe, expect, test } from "bun:test";
import { relayInboundMessageToPeer } from "../../src/monitor.ts";

function makeCore(params: { config: any; recorded: Array<{ sessionKey: string; ctx: any }> }): any {
  return {
    config: { loadConfig: () => params.config },
    channel: {
      routing: {
        resolveAgentRoute: () => ({ sessionKey: "session:group:ws:chan", agentId: "software-studio-backend", accountId: "backend-dev" }),
      },
      session: {
        resolveStorePath: () => "/tmp/decent-openclaw-company-mute-store",
        readSessionUpdatedAt: () => undefined,
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

describe("company-sim channel mute", () => {
  test("company-sim account stays silent in explicitly muted external channel before context load", async () => {
    const recorded: Array<{ sessionKey: string; ctx: any }> = [];
    const readReceipts: string[] = [];

    const core = makeCore({
      config: {
        channels: {
          decentchat: {
            replyToMode: "all",
            accounts: {
              "backend-dev": {
                companySim: {
                  silentChannelIds: ["cf190f68-fe5f-45f6-b731-4ef3286fecd7"],
                },
              },
            },
          },
        },
      },
      recorded,
    });

    await relayInboundMessageToPeer({
      incoming: {
        channelId: "cf190f68-fe5f-45f6-b731-4ef3286fecd7",
        workspaceId: "ws-1",
        content: "continue",
        senderId: "peer-1",
        senderName: "Alino",
        messageId: "msg-muted",
        chatType: "channel",
        timestamp: Date.now(),
      },
      ctx: {
        accountId: "backend-dev",
        account: {
          accountId: "backend-dev",
          enabled: true,
          dmPolicy: "open",
          configured: true,
          alias: "Devon API",
          invites: [],
          streamEnabled: false,
          replyToMode: "all",
          replyToModeByChatType: {},
          thread: { historyScope: "thread", inheritParent: false, initialHistoryLimit: 20 },
          companySim: {
            enabled: true,
            manifestPath: "/tmp/missing-company.yaml",
            companyId: "software-studio",
            employeeId: "backend-dev",
          },
        } as any,
        log: { info: () => {}, warn: () => {}, error: () => {} },
      },
      core,
      xenaPeer: {
        startStream: async () => {},
        startDirectStream: async () => {},
        sendStreamDelta: async () => {},
        sendDirectStreamDelta: async () => {},
        sendStreamDone: async () => {},
        sendDirectStreamDone: async () => {},
        sendDirectToPeer: async () => {},
        sendToChannel: async () => {},
        sendReadReceipt: async (_peerId: string, channelId: string, messageId: string) => {
          readReceipts.push(`${channelId}:${messageId}`);
        },
        requestFullImage: async () => null,
      } as any,
    });

    expect(recorded).toHaveLength(0);
    expect(readReceipts).toEqual(["cf190f68-fe5f-45f6-b731-4ef3286fecd7:msg-muted"]);
  });
});
