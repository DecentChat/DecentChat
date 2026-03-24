import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decentChatPlugin } from "../../src/channel.ts";
import { DecentChatNodePeer } from "../../src/peer/DecentChatNodePeer.ts";
import { setActivePeer } from "../../src/peer-registry.ts";

const VALID_SEED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: "acct-1",
    enabled: true,
    dmPolicy: "allow",
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: "https://decentchat.app/peerjs",
    invites: [],
    alias: "DecentChat Bot",
    dataDir: mkdtempSync(join(tmpdir(), "openclaw-directory-live-test-")),
    ...overrides,
  };
}

describe("decent-openclaw live directory", () => {
  test("DecentChatNodePeer lists peers/groups from workspace cache", () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer as any).myPeerId = "self-peer";
    (peer as any).workspaceManager = {
      getAllWorkspaces: () => [
        {
          id: "ws-1",
          name: "Workspace One",
          members: [
            { peerId: "self-peer", alias: "DecentChat Bot" },
            { peerId: "peer-a", alias: "Alice" },
            { peerId: "peer-b", alias: "Bob" },
          ],
          channels: [
            { id: "chan-1", name: "general", type: "channel" },
            { id: "dm-1", name: "Alice DM", type: "dm" },
          ],
        },
        {
          id: "ws-2",
          name: "Workspace Two",
          members: [
            { peerId: "peer-a", alias: "Alice" },
          ],
          channels: [
            { id: "chan-2", name: "dev", type: "channel" },
          ],
        },
      ],
    };

    const peers = (peer as any).listDirectoryPeersLive({ query: "ali", limit: 10 });
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ kind: "user", id: "peer-a", name: "Alice" });

    const groups = (peer as any).listDirectoryGroupsLive({ query: "workspace", limit: 10 });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.id).toContain("decentchat:channel:");
  });

  test("channel directory adapter reads live data from active peer", async () => {
    const peer = {
      peerId: "peer-self",
      listDirectoryPeersLive: () => [{ kind: "user", id: "peer-a", name: "Alice", handle: "decentchat:peer-a" }],
      listDirectoryGroupsLive: () => [{ kind: "group", id: "decentchat:channel:chan-1", name: "Workspace / #general" }],
    } as any;

    setActivePeer(peer);
    try {
      const peers = await decentChatPlugin.directory?.listPeersLive?.({ cfg: {}, runtime: {} as any, query: null, limit: 20 });
      const groups = await decentChatPlugin.directory?.listGroupsLive?.({ cfg: {}, runtime: {} as any, query: null, limit: 20 });
      expect(peers).toHaveLength(1);
      expect(peers?.[0]?.id).toBe("peer-a");
      expect(groups).toHaveLength(1);
      expect(groups?.[0]?.id).toBe("decentchat:channel:chan-1");
    } finally {
      setActivePeer(null);
    }
  });
});
