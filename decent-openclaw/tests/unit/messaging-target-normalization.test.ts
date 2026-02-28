import { describe, expect, test } from "bun:test";
import {
  decentChatPlugin,
  looksLikeDecentChatTargetId,
  normalizeDecentChatMessagingTarget,
} from "../../src/channel.ts";

describe("decent-openclaw messaging target normalization", () => {
  test("accepts canonical channel target", () => {
    expect(normalizeDecentChatMessagingTarget("decentchat:channel:abc")).toBe("decentchat:channel:abc");
  });

  test("normalizes channel:<id> shorthand", () => {
    expect(normalizeDecentChatMessagingTarget("channel:abc")).toBe("decentchat:channel:abc");
  });

  test("accepts canonical peer target", () => {
    expect(normalizeDecentChatMessagingTarget("decentchat:peer-1")).toBe("decentchat:peer-1");
  });

  test("normalizes raw peer id", () => {
    expect(normalizeDecentChatMessagingTarget("peer-1")).toBe("decentchat:peer-1");
  });

  test("plugin messaging adapter exposes hint + looksLikeId", () => {
    expect(decentChatPlugin.messaging?.targetResolver?.hint).toContain("channel:<id>");
    expect(looksLikeDecentChatTargetId("peer-1", "decentchat:peer-1")).toBe(true);
    expect(looksLikeDecentChatTargetId("", undefined)).toBe(false);
  });
});
