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
