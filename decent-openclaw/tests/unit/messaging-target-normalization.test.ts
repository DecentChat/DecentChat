import { afterEach, describe, expect, test } from "bun:test";
import {
  decentChatPlugin,
  looksLikeDecentChatTargetId,
  normalizeDecentChatMessagingTarget,
} from "../../src/channel.ts";
import { setActivePeer } from "../../src/peer-registry.ts";

afterEach(() => {
  setActivePeer(null);
});

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
    expect(looksLikeDecentChatTargetId("e232f16dc7cf465cd3", "decentchat:e232f16dc7cf465cd3")).toBe(true);
    expect(looksLikeDecentChatTargetId("cf190f68-fe5f-45f6-b731-4ef3286fecd7")).toBe(true);
    expect(looksLikeDecentChatTargetId("Mira", "decentchat:Mira")).toBe(false);
    expect(looksLikeDecentChatTargetId("Mira PM", "decentchat:Mira PM")).toBe(false);
    expect(looksLikeDecentChatTargetId("", undefined)).toBe(false);
  });

  test("resolves a plain peer alias to the real direct peer id", async () => {
    setActivePeer({
      listDirectoryPeersLive: ({ query }: { query?: string | null }) => {
        const q = query?.toLowerCase() ?? "";
        const entries = [
          { kind: "user", id: "e232f16dc7cf465cd3", name: "Mira PM", handle: "decentchat:e232f16dc7cf465cd3", rank: 3 },
        ];
        return entries.filter((entry) => !q || entry.name.toLowerCase().includes(q) || entry.id.includes(q) || entry.handle.toLowerCase().includes(q));
      },
      listDirectoryGroupsLive: () => [],
    } as any);

    expect(looksLikeDecentChatTargetId("Mira", "decentchat:Mira")).toBe(true);

    const resolved = await decentChatPlugin.messaging?.targetResolver?.resolveTarget?.({
      cfg: {},
      accountId: "default",
      input: "Mira",
      normalized: "decentchat:Mira",
      preferredKind: undefined,
    });

    expect(resolved).toEqual({
      to: "decentchat:e232f16dc7cf465cd3",
      kind: "user",
      display: "Mira PM",
      source: "directory",
    });
  });
});
