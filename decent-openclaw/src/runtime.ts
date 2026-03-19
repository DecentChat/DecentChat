import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

const bootstrapInFlight = new Map<string, Promise<void>>();
const bootstrapCompleted = new Set<string>();

export function setDecentChatRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getDecentChatRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("DecentChat runtime not initialized");
  }
  return runtime;
}

export function buildDecentChatRuntimeBootstrapKey(manifestPath: string, scope?: string): string {
  const normalizedScope = scope?.trim();
  if (normalizedScope) {
    return `runtime:${manifestPath}:${normalizedScope}`;
  }
  return `runtime:${manifestPath}`;
}

export async function runDecentChatBootstrapOnce(key: string, task: () => Promise<void>): Promise<void> {
  if (bootstrapCompleted.has(key)) return;

  const inFlight = bootstrapInFlight.get(key);
  if (inFlight) {
    await inFlight;
    return;
  }

  const run = (async () => {
    try {
      await task();
      bootstrapCompleted.add(key);
    } finally {
      bootstrapInFlight.delete(key);
    }
  })();

  bootstrapInFlight.set(key, run);
  await run;
}

export function resetDecentChatRuntimeBootstrapStateForTests(): void {
  bootstrapInFlight.clear();
  bootstrapCompleted.clear();
}
