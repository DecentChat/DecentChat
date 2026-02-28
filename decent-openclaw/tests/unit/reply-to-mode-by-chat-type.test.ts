import { describe, expect, test } from "bun:test";
import { resolveDecentThreadingFlags } from "../../src/monitor.ts";

describe("decent-openclaw replyToModeByChatType", () => {
  test("falls back to global replyToMode when no override exists", () => {
    const cfg = { channels: { decentchat: { replyToMode: "off" } } } as any;
    expect(resolveDecentThreadingFlags(cfg, "direct").replyToMode).toBe("off");
  });

  test("direct override wins over global", () => {
    const cfg = {
      channels: {
        decentchat: {
          replyToMode: "off",
          replyToModeByChatType: { direct: "all" },
        },
      },
    } as any;
    expect(resolveDecentThreadingFlags(cfg, "direct").replyToMode).toBe("all");
  });

  test("channel override wins over global", () => {
    const cfg = {
      channels: {
        decentchat: {
          replyToMode: "all",
          replyToModeByChatType: { channel: "off" },
        },
      },
    } as any;
    expect(resolveDecentThreadingFlags(cfg, "channel").replyToMode).toBe("off");
  });

  test("group falls back to channel override when group is unset", () => {
    const cfg = {
      channels: {
        decentchat: {
          replyToMode: "first",
          replyToModeByChatType: { channel: "off" },
        },
      },
    } as any;
    expect(resolveDecentThreadingFlags(cfg, "group").replyToMode).toBe("off");
  });
});
