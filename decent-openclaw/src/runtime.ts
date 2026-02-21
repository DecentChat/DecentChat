import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setDecentChatRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getDecentChatRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("DecentChat runtime not initialized");
  }
  return runtime;
}
