# DecentChat Docs

Welcome to the DecentChat documentation.

This docs set is organized for fast onboarding, contributor clarity, and production reliability.

## Start Here

- [User Guide](/user/)
- [Quick Start](/user/quick-start)
- [How DecentChat Works](/user/how-decentchat-works)
- [Sync, Multi-Device, and Backup](/user/sync-and-backup)
- [Getting Started](/getting-started)
- [Development Workflow](/development)
- [Architecture Overview](/architecture)

## Product Docs

- [Landing & App Routing](/product/landing-routing)
- [Join Workspace Dialog UX](/client/join-workspace-dialog)

## Engineering Docs

- [Testing Guide](/testing)
- [Deployment Guide](/deployment)
- [Troubleshooting](/troubleshooting)

## Protocol & Standards (existing)

- Protocol specs: `decent-protocol/spec/`
  - `PROTOCOL.md`
  - `MESSAGE-FORMAT.md`
  - `CRYPTO.md`
  - `SYNC.md`
- Enhancement proposals: `specs/deps/`

## Repo Structure

```text
/decent-chat
  decent-protocol/          # Protocol SDK (core crypto, sync, identity, storage)
  decent-transport-webrtc/  # WebRTC transport implementation
  decent-client-web/        # Reference web client (PWA)
  decent-openclaw/          # OpenClaw integration package
  specs/deps/               # Decent Enhancement Proposals (DEPs)
  docs/                     # This documentation
```

## Documentation Principles

- Keep docs operational: written for people shipping code.
- Prefer concrete examples over abstract descriptions.
- Update docs in the same PR/commit as behavior changes.
- Link to DEPs for protocol-level changes.
