/**
 * Tests verifying the plugin metadata, setup wizard, and configure flow
 * work correctly for a fresh install via `openclaw plugins install`.
 *
 * These tests exercise the same code paths that `openclaw configure` uses
 * without needing a running OpenClaw instance.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decentChatPlugin, resolveDecentChatAccount } from "../../src/channel.ts";

const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(PLUGIN_ROOT, relativePath), "utf-8"));
}

// ---------------------------------------------------------------------------
// Plugin metadata alignment
// ---------------------------------------------------------------------------

describe("plugin metadata alignment", () => {
  const packageJson = readJson("package.json");
  const manifest = readJson("openclaw.plugin.json");

  test("package.json name follows @decentchat/<id>-plugin pattern", () => {
    expect(packageJson.name).toBe("@decentchat/decentchat-plugin");
  });

  test("manifest id matches plugin id", () => {
    expect(manifest.id).toBe("decentchat");
    expect(decentChatPlugin.id).toBe("decentchat");
  });

  test("manifest kind is channel", () => {
    expect(manifest.kind).toBe("channel");
  });

  test("channel id in package.json openclaw section matches manifest id", () => {
    expect(packageJson.openclaw.channel.id).toBe(manifest.id);
  });

  test("install npmSpec matches package name", () => {
    expect(packageJson.openclaw.install.npmSpec).toBe(packageJson.name);
  });

  test("manifest version matches package version", () => {
    expect(manifest.version).toBe(packageJson.version);
  });

  test("plugin meta.id matches manifest id", () => {
    expect(decentChatPlugin.meta.id).toBe(manifest.id);
  });
});

// ---------------------------------------------------------------------------
// Hint derivation compatibility
// ---------------------------------------------------------------------------

describe("hint derivation compatibility", () => {
  // Reimplements the logic from OpenClaw's isCompatiblePluginIdHint and
  // deriveIdHint so we can verify our package name produces a compatible hint
  // without importing from the OpenClaw distribution bundle.

  function deriveIdHint(packageName: string): string {
    const unscoped = packageName.includes("/")
      ? packageName.split("/").pop()!
      : packageName;
    // Strip -provider suffix (OpenClaw normalizes this)
    const normalized = unscoped.endsWith("-provider") && unscoped.length > 9
      ? unscoped.slice(0, -9)
      : unscoped;
    return normalized;
  }

  function isCompatiblePluginIdHint(hint: string, manifestId: string): boolean {
    const normalized = hint.trim();
    if (!normalized) return true;
    if (normalized === manifestId) return true;
    return (
      normalized === `${manifestId}-provider` ||
      normalized === `${manifestId}-plugin` ||
      normalized === `${manifestId}-sandbox` ||
      normalized === `${manifestId}-media-understanding`
    );
  }

  test("@decentchat/decentchat-plugin derives hint 'decentchat-plugin'", () => {
    expect(deriveIdHint("@decentchat/decentchat-plugin")).toBe("decentchat-plugin");
  });

  test("hint 'decentchat-plugin' is compatible with manifest id 'decentchat'", () => {
    expect(isCompatiblePluginIdHint("decentchat-plugin", "decentchat")).toBe(true);
  });

  test("old name @decentchat/decentclaw would NOT be compatible", () => {
    const oldHint = deriveIdHint("@decentchat/decentclaw");
    expect(oldHint).toBe("decentclaw");
    expect(isCompatiblePluginIdHint("decentclaw", "decentchat")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Account resolution for fresh vs configured states
// ---------------------------------------------------------------------------

describe("account resolution", () => {
  test("fresh config (no seed phrase) → configured: false", () => {
    const account = resolveDecentChatAccount({});
    expect(account.configured).toBe(false);
    expect(account.seedPhrase).toBeUndefined();
  });

  test("empty seed phrase → configured: false", () => {
    const account = resolveDecentChatAccount({
      channels: { decentchat: { seedPhrase: "" } },
    });
    expect(account.configured).toBe(false);
  });

  test("whitespace seed phrase → configured: false", () => {
    const account = resolveDecentChatAccount({
      channels: { decentchat: { seedPhrase: "   " } },
    });
    expect(account.configured).toBe(false);
  });

  test("valid seed phrase → configured: true", () => {
    const account = resolveDecentChatAccount({
      channels: {
        decentchat: {
          seedPhrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        },
      },
    });
    expect(account.configured).toBe(true);
    expect(account.seedPhrase).toBeTruthy();
  });

  test("defaults are sane for unconfigured account", () => {
    const account = resolveDecentChatAccount({});
    expect(account.enabled).toBe(true);
    expect(account.alias).toBe("DecentChat Bot");
    expect(account.signalingServer).toBe("https://0.peerjs.com/");
    expect(account.invites).toEqual([]);
    expect(account.dmPolicy).toBe("open");
    expect(account.streamEnabled).toBe(true);
    expect(account.replyToMode).toBe("all");
  });

  test("huddle config preserves explicit Gemini selection with fallback knobs", () => {
    const account = resolveDecentChatAccount({
      channels: {
        decentchat: {
          huddle: {
            enabled: true,
            autoJoin: true,
            sttEngine: "gemini",
            whisperModel: "gemini-2.5-flash",
            sttApiKey: "gemini-key", // pragma: allowlist secret
            ttsEngine: "gemini",
            ttsModel: "gemini-2.5-flash-preview-tts",
            ttsApiKey: "gemini-key", // pragma: allowlist secret
            ttsVoice: "Kore",
          },
        },
      },
    });

    expect(account.huddle?.sttEngine).toBe("gemini");
    expect(account.huddle?.whisperModel).toBe("gemini-2.5-flash");
    expect(account.huddle?.sttApiKey).toBe("gemini-key"); // pragma: allowlist secret
    expect(account.huddle?.ttsEngine).toBe("gemini");
    expect(account.huddle?.ttsModel).toBe("gemini-2.5-flash-preview-tts");
    expect(account.huddle?.ttsApiKey).toBe("gemini-key"); // pragma: allowlist secret
    expect(account.huddle?.ttsVoice).toBe("Kore");
  });
});

// ---------------------------------------------------------------------------
// Setup wizard structure
// ---------------------------------------------------------------------------

describe("setup wizard structure", () => {
  const wizard = decentChatPlugin.setupWizard;

  test("wizard exists on the plugin", () => {
    expect(wizard).toBeDefined();
  });

  test("wizard channel matches plugin id", () => {
    expect(wizard!.channel).toBe("decentchat");
  });

  test("wizard has introNote with setup instructions", () => {
    expect(wizard!.introNote).toBeDefined();
    expect(wizard!.introNote!.title).toContain("DecentChat");
    expect(wizard!.introNote!.lines!.length).toBeGreaterThan(0);
  });

  test("wizard uses credentials-first step order", () => {
    expect(wizard!.stepOrder).toBe("credentials-first");
  });

  test("wizard has a prepare function", () => {
    expect(typeof wizard!.prepare).toBe("function");
  });

  test("wizard has at least one credential (seed phrase)", () => {
    expect(wizard!.credentials!.length).toBeGreaterThanOrEqual(1);
    const seedCred = wizard!.credentials![0];
    expect(seedCred.inputKey).toBe("privateKey");
    expect(seedCred.credentialLabel).toBe("seed phrase");
  });

  test("wizard has text inputs for name and invite URL", () => {
    const textInputs = wizard!.textInputs!;
    expect(textInputs.length).toBeGreaterThanOrEqual(2);
    expect(textInputs.find((t) => t.inputKey === "name")).toBeDefined();
    expect(textInputs.find((t) => t.inputKey === "url")).toBeDefined();
  });

  test("wizard has completion note", () => {
    expect(wizard!.completionNote).toBeDefined();
    expect(wizard!.completionNote!.title).toContain("DecentChat");
  });

  test("wizard has DM policy section", () => {
    expect(wizard!.dmPolicy).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Setup wizard prepare() behavior
// ---------------------------------------------------------------------------

describe("setup wizard prepare()", () => {
  const wizard = decentChatPlugin.setupWizard!;

  test("skips prompt when account is already configured", async () => {
    let promptCalled = false;
    const result = await wizard.prepare!({
      cfg: {
        channels: {
          decentchat: {
            seedPhrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
          },
        },
      } as any,
      accountId: "default",
      credentialValues: {},
      runtime: {} as any,
      prompter: {
        confirm: async () => {
          promptCalled = true;
          return true;
        },
        note: async () => {},
        text: async () => "",
        select: async () => "",
        multiselect: async () => [],
      } as any,
    });

    expect(promptCalled).toBe(false);
    expect(result).toBeUndefined();
  });

  test("asks to generate identity when account is unconfigured", async () => {
    let confirmMessage = "";
    const result = await wizard.prepare!({
      cfg: {} as any,
      accountId: "default",
      credentialValues: {},
      runtime: {} as any,
      prompter: {
        confirm: async ({ message }: { message: string }) => {
          confirmMessage = message;
          return true; // Yes, generate new identity
        },
        note: async () => {},
        text: async () => "",
        select: async () => "",
        multiselect: async () => [],
      } as any,
    });

    expect(confirmMessage).toContain("Generate");
    expect(confirmMessage).toContain("DecentChat");
    expect(result).toBeDefined();
    expect(result!.credentialValues!.privateKey).toBeTruthy();
    // The generated seed phrase should be 12 words
    const words = result!.credentialValues!.privateKey!.trim().split(/\s+/);
    expect(words.length).toBe(12);

    // prepare() must return cfg with the seedPhrase already patched in,
    // because the OpenClaw wizard framework skips applySet when shouldPrompt
    // returns false — credentialValues alone won't persist to the config file.
    const mnemonic = result!.credentialValues!.privateKey!;
    expect(result!.cfg).toBeDefined();
    expect((result!.cfg as any).channels.decentchat.seedPhrase).toBe(mnemonic);
    expect((result!.cfg as any).channels.decentchat.enabled).toBe(true);
  });

  test("shows seed phrase note when generating new identity", async () => {
    let noteContent = "";
    await wizard.prepare!({
      cfg: {} as any,
      accountId: "default",
      credentialValues: {},
      runtime: {} as any,
      prompter: {
        confirm: async () => true,
        note: async (content: string) => {
          noteContent = content;
        },
        text: async () => "",
        select: async () => "",
        multiselect: async () => [],
      } as any,
    });

    expect(noteContent).toContain("seed phrase");
    expect(noteContent).toContain("safe");
  });

  test("returns undefined when user declines generation (falls through to manual input)", async () => {
    const result = await wizard.prepare!({
      cfg: {} as any,
      accountId: "default",
      credentialValues: {},
      runtime: {} as any,
      prompter: {
        confirm: async () => false, // No, don't generate
        note: async () => {},
        text: async () => "",
        select: async () => "",
        multiselect: async () => [],
      } as any,
    });

    // Should return undefined — the wizard will then prompt for manual seed input
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Credential shouldPrompt logic
// ---------------------------------------------------------------------------

describe("credential shouldPrompt", () => {
  const seedCredential = decentChatPlugin.setupWizard!.credentials![0];

  test("skips prompt when prepare() already set a seed phrase", () => {
    const result = seedCredential.shouldPrompt!({
      credentialValues: { privateKey: "some generated seed" },  // pragma: allowlist secret
      state: { hasConfiguredValue: false, accountConfigured: false },
    } as any);
    expect(result).toBe(false);
  });

  test("skips prompt when account already has a configured seed", () => {
    const result = seedCredential.shouldPrompt!({
      credentialValues: {},
      state: { hasConfiguredValue: true, accountConfigured: true },
    } as any);
    expect(result).toBe(false);
  });

  test("prompts when no seed is available from any source", () => {
    const result = seedCredential.shouldPrompt!({
      credentialValues: {},
      state: { hasConfiguredValue: false, accountConfigured: false },
    } as any);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Package structure for npm
// ---------------------------------------------------------------------------

describe("package structure for npm", () => {
  const packageJson = readJson("package.json");

  test("declares openclaw as peer dependency", () => {
    expect(packageJson.peerDependencies?.openclaw).toBeDefined();
  });

  test("declares all internal @decentchat deps", () => {
    expect(packageJson.dependencies["@decentchat/protocol"]).toBeDefined();
    expect(packageJson.dependencies["@decentchat/transport-webrtc"]).toBeDefined();
    expect(packageJson.dependencies["@decentchat/company-sim"]).toBeDefined();
  });

  test("files array includes required entries", () => {
    const files: string[] = packageJson.files;
    expect(files).toContain("src");
    expect(files).toContain("index.ts");
    expect(files).toContain("setup-entry.ts");
    expect(files).toContain("openclaw.plugin.json");
  });

  test("openclaw.extensions points to index.ts", () => {
    expect(packageJson.openclaw.extensions).toContain("./index.ts");
  });

  test("openclaw.setupEntry points to setup-entry.ts", () => {
    expect(packageJson.openclaw.setupEntry).toBe("./setup-entry.ts");
  });

  test("type is module", () => {
    expect(packageJson.type).toBe("module");
  });

  test("publishConfig has public access", () => {
    expect(packageJson.publishConfig?.access).toBe("public");
  });
});
