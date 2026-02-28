import { describe, expect, test } from "bun:test";
import { decentChatPlugin } from "../../src/channel.ts";

describe("decent-openclaw plugin capabilities", () => {
  test("advertises explicit thread/media capabilities", () => {
    expect(decentChatPlugin.capabilities?.chatTypes).toEqual(["direct", "group", "thread"]);
    expect(decentChatPlugin.capabilities?.threads).toBe(true);
    expect(decentChatPlugin.capabilities?.media).toBe(true);
  });

  test("does not over-claim unsupported capabilities", () => {
    expect(decentChatPlugin.capabilities?.reactions).toBeUndefined();
    expect(decentChatPlugin.capabilities?.nativeCommands).toBeUndefined();
    expect(decentChatPlugin.actions).toBeUndefined();
  });
});
