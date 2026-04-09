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

  test("fails fast on no-match alias", async () => {
    setActivePeer({
      listDirectoryPeersLive: () => [],
      listDirectoryGroupsLive: () => [],
    } as any);

    const resolveTarget = decentChatPlugin.messaging?.targetResolver?.resolveTarget;
    expect(resolveTarget).toBeDefined();

    await expect(resolveTarget?.({
      cfg: {},
      accountId: "default",
      input: "unknown-user",
      normalized: "decentchat:unknown-user",
      preferredKind: undefined,
    })).rejects.toThrow(/no matching target found/i);
  });

  test("fails fast on ambiguous alias", async () => {
    setActivePeer({
      listDirectoryPeersLive: ({ query }: { query?: string | null }) => {
        const q = query?.toLowerCase() ?? "";
        const entries = [
          { kind: "user", id: "peer-a", name: "Mira", handle: "decentchat:peer-a", rank: 3 },
          { kind: "user", id: "peer-b", name: "Mira", handle: "decentchat:peer-b", rank: 3 },
        ];
        return entries.filter((entry) => !q || entry.name.toLowerCase().includes(q) || entry.id.includes(q) || entry.handle.toLowerCase().includes(q));
      },
      listDirectoryGroupsLive: () => [],
    } as any);

    const resolveTarget = decentChatPlugin.messaging?.targetResolver?.resolveTarget;
    expect(resolveTarget).toBeDefined();

    await expect(resolveTarget?.({
      cfg: {},
      accountId: "default",
      input: "Mira",
      normalized: "decentchat:Mira",
      preferredKind: undefined,
    })).rejects.toThrow(/ambiguous/i);
  });

  test("fails fast on kind mismatch", async () => {
    const resolveTarget = decentChatPlugin.messaging?.targetResolver?.resolveTarget;
    expect(resolveTarget).toBeDefined();

    await expect(resolveTarget?.({
      cfg: {},
      accountId: "default",
      input: "decentchat:peer-1",
      normalized: "decentchat:peer-1",
      preferredKind: "channel",
    })).rejects.toThrow(/kind mismatch/i);
  });

  test("sendText resolves alias to canonical peer id before dispatch", async () => {
    const calls: string[] = [];
    setActivePeer({
      listDirectoryPeersLive: ({ query }: { query?: string | null }) => {
        const q = query?.toLowerCase() ?? "";
        const entries = [
          { kind: "user", id: "e232f16dc7cf465cd3", name: "Mira PM", handle: "decentchat:e232f16dc7cf465cd3", rank: 3 },
        ];
        return entries.filter((entry) => !q || entry.name.toLowerCase().includes(q) || entry.id.includes(q) || entry.handle.toLowerCase().includes(q));
      },
      listDirectoryGroupsLive: () => [],
      async sendDirectToPeer(peerId: string, text: string) {
        calls.push(`dm:${peerId}:${text}`);
      },
      async sendToChannel(channelId: string, text: string) {
        calls.push(`ch:${channelId}:${text}`);
      },
    } as any);

    const result = await decentChatPlugin.outbound?.sendText?.({
      cfg: {},
      accountId: "default",
      to: "Mira",
      text: "hello",
    } as any);

    expect(result?.ok).toBe(true);
    expect(calls).toEqual(["dm:e232f16dc7cf465cd3:hello"]);
  });

  test("sendText fails before dispatch when target cannot be resolved", async () => {
    const calls: string[] = [];
    setActivePeer({
      listDirectoryPeersLive: () => [],
      listDirectoryGroupsLive: () => [],
      async sendDirectToPeer(peerId: string, text: string) {
        calls.push(`dm:${peerId}:${text}`);
      },
      async sendToChannel(channelId: string, text: string) {
        calls.push(`ch:${channelId}:${text}`);
      },
    } as any);

    const result = await decentChatPlugin.outbound?.sendText?.({
      cfg: {},
      accountId: "default",
      to: "ghost",
      text: "hello",
    } as any);

    expect(result?.ok).toBe(false);
    expect(String((result as any)?.error?.message ?? "")).toContain("no matching target found");
    expect(calls).toEqual([]);
  });
});
