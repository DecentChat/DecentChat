# @decentchat/transport-webrtc

WebRTC transport for [`@decentchat/protocol`](https://npmjs.com/package/@decentchat/protocol). Connects peers over WebRTC data channels using [PeerJS](https://peerjs.com/) for signaling.

## What it does

Implements the `Transport` interface from `@decentchat/protocol` so peers can send and receive messages over WebRTC. Handles signaling server connections, ICE/TURN negotiation, connection deduplication (glare resolution), heartbeat monitoring, and auto-reconnect with exponential backoff.

Supports multiple signaling servers simultaneously. Alice on `signal.alice.com` and Bob on `signal.bob.com` can talk if they share at least one server -- similar to how email MX records work. If both servers discover the same peer, only one connection is kept.

## Install

```
npm install @decentchat/transport-webrtc
```

Depends on `@decentchat/protocol` and `peerjs`.

## Quick start

```ts
import { PeerTransport } from '@decentchat/transport-webrtc';

const transport = new PeerTransport({
  signalingServers: ['https://decentchat.app/peerjs'],
});

transport.onConnect = (peerId) => console.log('connected:', peerId);
transport.onMessage = (peerId, data) => console.log('message from', peerId, data);

const myId = await transport.init();
await transport.connect('some-peer-id');
transport.send('some-peer-id', { hello: 'world' });
```

## Embedded signaling server

Every node can run its own signaling server, removing the need for external infrastructure:

```ts
import { EmbeddedSignaling } from '@decentchat/transport-webrtc';

const server = new EmbeddedSignaling({ port: 9000 });
await server.start();
// Other peers can now connect via ws://your-ip:9000/peerjs
```

This runs in Node.js/Bun. Browser clients connect to it; they don't run it.

## ICE/TURN configuration

Three ICE server constants are exported for convenience:

- `DEFAULT_ICE_SERVERS` -- Google STUN servers
- `DEFAULT_TURN_SERVERS` -- open relay TURN (dev only, rate-limited)
- `ICE_SERVERS_WITH_TURN` -- both combined

For production, pass your own TURN credentials:

```ts
const transport = new PeerTransport({
  signalingServers: ['https://signal.example.com/peerjs'],
  turnServers: [
    { urls: 'turn:turn.example.com:443', username: 'user', credential: 'pass' },
  ],
});
```

On localhost, ICE servers are skipped entirely (host candidates work fine, and STUN timeouts break tests).

## Config reference

`PeerTransportConfig` fields:

| Field | Default | Description |
|-------|---------|-------------|
| `signalingServer` | -- | Single server URL (legacy) |
| `signalingServers` | `[]` | Multiple servers for federation |
| `iceServers` | auto | Full override for ICE config |
| `useTurn` | `true` | Include TURN servers (auto-false on localhost) |
| `turnServers` | open relay | Custom TURN servers |
| `debug` | `1` | PeerJS log level (0-3) |
| `maxRetries` | `3` | Connection retries per server |
| `retryDelayMs` | `2000` | Base retry delay (doubles each attempt) |

## Build

```
npm run build    # compiles to dist/ via tsc
```

Both compiled JS (`dist/`) and raw TypeScript (`src/`) are included in the npm package. Bun users get direct `.ts` imports via the `"bun"` export condition.

## Repository

This package lives in the `decent-transport-webrtc/` directory of the [DecentChat monorepo](https://github.com/Alino/DecentChat).

## License

MIT
