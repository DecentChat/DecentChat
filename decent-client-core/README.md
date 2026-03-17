# decent-client-core

Shared DecentChat client logic package.

## Purpose

`decent-client-core` is the cross-platform logic layer used by both web and mobile clients. It is intended to host domain and orchestration code that should not be tied to a specific UI shell.

## Scope

- Shared messaging/workspace orchestration logic
- Protocol + transport integration glue
- Reusable state and utility modules

`decent-client-core` depends on:

- `decent-protocol`
- `decent-transport-webrtc`

## Status

Initial scaffold created under DEP-016. Exports will be added incrementally as logic is extracted from `decent-client-web`.
