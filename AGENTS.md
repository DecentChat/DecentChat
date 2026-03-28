# DecentChat

Serverless, E2E-encrypted, CRDT-based P2P messaging system with an OpenClaw agent plugin.

## Monorepo structure

| Directory | npm package | Ships |
|-----------|------------|-------|
| `decent-protocol/` | `@decentchat/protocol` | compiled JS (`dist/`) + source (`src/`) |
| `decent-transport-webrtc/` | `@decentchat/transport-webrtc` | compiled JS (`dist/`) + source (`src/`) |
| `decent-company-sim/` | `@decentchat/company-sim` | raw TypeScript only |
| `decent-openclaw/` | `@decentchat/decentchat-plugin` | raw TypeScript only |
| `decent-client-web/` | not published | web client (Vite + SvelteKit) |
| `decent-client-core/` | not published | shared client logic |
| `decent-client-mobile/` | not published | mobile client |

## Package manager

**Use Bun, not npm.** The project uses Bun workspaces for local development.

- `bun install` to install deps (resolves `@decentchat/*` packages locally via workspace symlinks)
- `bun test` to run tests
- `bun run build` to build individual packages
- `bun run typecheck` at root to type-check protocol, transport-webrtc, and client-web

## Publishing to npm

**Use `bun publish`, not `npm publish`.** Internal deps use `workspace:^` specifiers. Bun replaces these with real semver ranges (e.g. `^0.1.1`) at publish time. npm does not -- it ships the literal `workspace:^` string, which breaks installs.

Packages that need a build step before publishing (`decent-protocol`, `decent-transport-webrtc`) have a `prepublishOnly` script that runs `tsc` automatically.

All packages are published under the `@decentchat` npm org with public access.

## Workspace dependency protocol

All internal `@decentchat/*` dependencies use `"workspace:^"` in package.json. This means:

- Locally: Bun resolves them to workspace symlinks (live source, no build needed for dev)
- At publish: Bun replaces `workspace:^` with `^<actual-version>` in the tarball
- Bun runtime uses the `"bun"` export condition to load raw `.ts` source directly

## Testing

```
bun test                    # run all tests in current package
bun test --filter "pattern" # filter tests
```

Tests use `bun:test` (not jest/vitest). Test files live alongside source or in `tests/` directories.

## Key conventions

- The OpenClaw plugin id is `"decentchat"` (the channel id), and the npm package is `@decentchat/decentchat-plugin`
- The IndexedDB database name is `"decent-protocol"` (not the npm package name) -- don't rename it during refactors
- Crypto salt strings (`decent-protocol-seed-v1`, `decent-protocol-v1`) are not package names -- don't rename them either
- Pre-existing LSP errors in `decent-openclaw` files (channel.ts, monitor.ts, DecentChatNodePeer.ts) and `decent-client-web` (ChatController.ts) are from being out of sync with the OpenClaw SDK -- not bugs in this repo
