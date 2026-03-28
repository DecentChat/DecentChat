import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { decentChatPlugin } from './src/channel.js';
import { setDecentChatRuntime } from './src/runtime.js';

export default defineChannelPluginEntry({
  id: 'decentchat',
  name: 'DecentChat',
  description: 'DecentChat P2P channel plugin',
  plugin: decentChatPlugin,
  setRuntime: setDecentChatRuntime,
});
