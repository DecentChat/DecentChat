/**
 * BotIdentity — Xena's DecentChat identity.
 * Generates a seed phrase on first use and stores it in localStorage.
 */

const XENA_SEED_KEY = "openclaw:bot:seed";
const XENA_ALIAS_KEY = "openclaw:bot:alias";
const XENA_PEER_ID_KEY = "openclaw:bot:peerId";

export interface BotIdentity {
  seedPhrase: string;
  peerId: string;
  alias: string;
}

export async function getOrCreateBotIdentity(): Promise<BotIdentity> {
  let seedPhrase = localStorage.getItem(XENA_SEED_KEY);
  const alias = localStorage.getItem(XENA_ALIAS_KEY) ?? "Xena AI";

  if (!seedPhrase) {
    try {
      const mod = await import("decent-protocol");
      // Prefer the existing mnemonic generator if available from decent-protocol.
      const maybeGenerateMnemonic = (mod as any).generateMnemonic as (() => string) | undefined;
      if (typeof maybeGenerateMnemonic === "function") {
        seedPhrase = maybeGenerateMnemonic();
      }
    } catch {
      // fall through to entropy fallback below
    }

    if (!seedPhrase) {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      seedPhrase = Array.from(array)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
    }

    localStorage.setItem(XENA_SEED_KEY, seedPhrase);
  }

  let peerId = localStorage.getItem(XENA_PEER_ID_KEY);
  if (!peerId) {
    const encoder = new TextEncoder();
    const data = encoder.encode(`openclaw:xena:${seedPhrase}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    peerId = `xena-${hashArray
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
    localStorage.setItem(XENA_PEER_ID_KEY, peerId);
  }

  return { seedPhrase, peerId, alias };
}

export function getBotAlias(): string {
  return localStorage.getItem(XENA_ALIAS_KEY) ?? "Xena AI";
}

export function setBotAlias(alias: string): void {
  localStorage.setItem(XENA_ALIAS_KEY, alias);
}

export function clearBotIdentity(): void {
  localStorage.removeItem(XENA_SEED_KEY);
  localStorage.removeItem(XENA_PEER_ID_KEY);
}

export function getBotPeerId(): string | null {
  return localStorage.getItem(XENA_PEER_ID_KEY);
}
