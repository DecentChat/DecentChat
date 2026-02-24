# Development Workflow

## Branch / Commit Expectations

- Keep commits focused and atomic.
- Include docs updates when behavior changes.
- For protocol changes, link or create a DEP as needed.

## Local Loop

1. Implement change
2. Run targeted tests
3. Run broader suite if touching shared/core paths
4. Update docs/spec/DEP
5. Build client if UI/runtime changed

## Commands

```bash
# Protocol
bun run test

# Client
bun run test:unit
bun run test:integration
bun run test:e2e

# Type safety
bun run typecheck

# Build
bun run build:client
```

## Protocol-Change Rule

If you change any of these, evaluate DEP impact:

- message schemas/types
- sync or reconciliation behavior
- crypto primitives/flows
- transport-level protocol semantics

When in doubt: create/update a DEP in `specs/deps/`.

## Testing Strategy

- **Unit tests**: deterministic logic, low-level correctness
- **Integration tests**: component boundaries and runtime behavior
- **E2E tests**: user-visible flows and regressions
- **Perf integrity smoke**: multi-peer invariants under load/chaos

## Quality Gates

Recommended pre-merge checks:

```bash
bun run test
bun run test:unit
bun run typecheck
bun run build:client
```

For sync/integrity-sensitive changes:

```bash
bun run gate:quick
# or
bun run gate:predeploy
```
