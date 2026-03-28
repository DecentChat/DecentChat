import { defineSetupPluginEntry } from 'openclaw/plugin-sdk/core';
import { decentChatPlugin } from './src/channel.js';

export default defineSetupPluginEntry(decentChatPlugin);
