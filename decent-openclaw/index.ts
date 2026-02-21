import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { decentChatPlugin } from "./src/channel.js";
import { setDecentChatRuntime } from "./src/runtime.js";

const plugin = {
  id: "decentchat",
  name: "DecentChat",
  description: "DecentChat P2P channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setDecentChatRuntime(api.runtime);
    api.registerChannel({ plugin: decentChatPlugin });
  },
};

export default plugin;
