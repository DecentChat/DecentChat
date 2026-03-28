import { decentChatPlugin } from './src/channel.js';

// Setup entry for `openclaw configure`. OpenClaw checks that
// `export.plugin.id` matches the plugin id ("decentclaw"), but the channel
// plugin uses the channel id ("decentchat"). Override it here.
export default { plugin: { ...decentChatPlugin, id: 'decentclaw' } };
