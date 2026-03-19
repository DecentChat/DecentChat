import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk';
import { decentChatPlugin } from './src/channel.js';
import { setDecentChatRuntime } from './src/runtime.js';
import {
  COMPANY_TEMPLATE_BRIDGE_HTTP_PATH,
  createCompanyTemplateBridgeHttpHandler,
} from './src/company-sim/template-runtime-bridge-http.js';

const plugin = {
  id: 'decentchat',
  name: 'DecentChat',
  description: 'DecentChat P2P channel plugin',
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setDecentChatRuntime(api.runtime);
    api.registerChannel({ plugin: decentChatPlugin });

    api.registerHttpRoute({
      path: COMPANY_TEMPLATE_BRIDGE_HTTP_PATH,
      auth: 'plugin',
      match: 'exact',
      handler: createCompanyTemplateBridgeHttpHandler({
        runtimeConfig: {
          loadConfig: api.runtime.config.loadConfig,
          writeConfigFile: api.runtime.config.writeConfigFile,
        },
        logger: api.logger,
      }),
    });
  },
};

export default plugin;
