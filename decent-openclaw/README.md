# decent-openclaw

OpenClaw channel plugin for DecentChat.

## Setup

1. Add this plugin path to your OpenClaw config under `plugins.load.paths`.
2. Configure channel settings under `channels.decentchat`:
   - `enabled`
   - `port` (default `4242`)
   - `secret` (optional shared secret)
3. Enable OpenClaw in the DecentChat settings panel.
4. Use `/activation` in any channel if you want responses to all messages.
