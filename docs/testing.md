# Testing Guide

## Test Layers

### 1) Protocol unit tests

Core correctness for crypto, sync, CRDTs, identity, persistence.

```bash
bun run test
```

### 2) Client unit/integration/E2E

```bash
bun run test:unit
bun run test:integration
bun run test:e2e
```

### 3) Perf + Integrity scenarios

```bash
bun run perf:smoke
bun run perf:reconnect
```

These scenarios validate invariants such as:
- no missing/duplicate messages
- consistent workspace/channel state
- queue flush correctness after reconnect

## Suggested Matrix by Change Type

- UI-only change: `test:unit` + relevant integration tests + build
- Runtime/bootstrap change: add `test:integration` and route-related E2E
- Protocol/sync/crypto change: protocol tests + perf integrity checks

## Pre-Deploy Gate

Use stricter gate for production-sensitive updates:

```bash
bun run gate:predeploy
```

## Debugging Failures

- Re-run failing suite in isolation first
- Validate env/config differences (ports, signaling config)
- Check if failure is deterministic or timing-dependent
- Document root cause in PR/commit notes


## Decent OpenClaw plugin regression pack

Use this command set before merging/deploying `decent-openclaw` runtime/threading changes:

```bash
bun test ./decent-openclaw/tests/unit/reply-to-mode-by-chat-type.test.ts
bun test ./decent-openclaw/tests/unit/thread-initial-history-limit.test.ts
bun test ./decent-openclaw/tests/unit/messaging-target-normalization.test.ts
bun test ./decent-openclaw/tests/unit/directory-live.test.ts
bun test ./decent-openclaw/tests/unit/plugin-capabilities.test.ts
bun test ./decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts
bun test ./decent-openclaw/tests/unit/history-restore.test.ts
bun run typecheck
```

Optional one-liner (same gate):

```bash
bun test ./decent-openclaw/tests/unit/reply-to-mode-by-chat-type.test.ts   && bun test ./decent-openclaw/tests/unit/thread-initial-history-limit.test.ts   && bun test ./decent-openclaw/tests/unit/messaging-target-normalization.test.ts   && bun test ./decent-openclaw/tests/unit/directory-live.test.ts   && bun test ./decent-openclaw/tests/unit/plugin-capabilities.test.ts   && bun test ./decent-openclaw/tests/unit/runtime-streaming-e2e.test.ts   && bun test ./decent-openclaw/tests/unit/history-restore.test.ts   && bun run typecheck
```
