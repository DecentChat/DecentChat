# Getting Started

## Prerequisites

- Bun installed
- Node-compatible environment (TypeScript tooling)
- Modern browser (for client and WebRTC behavior)

## Install

```bash
bun install
```

## Run the Protocol Tests

```bash
bun run test
```

## Start Local Development

Run signaling server + web client:

```bash
bun run dev
```

Or run separately:

```bash
bun run dev:signal
bun run dev:client
```

## Build Web Client

```bash
bun run build:client
```

## Run Client Test Suites

```bash
bun run test:unit
bun run test:integration
bun run test:e2e
```

## Performance / Integrity Smoke

```bash
bun run perf:smoke
bun run perf:reconnect
```

## First-Time Contributor Checklist

1. Read [Architecture Overview](/architecture)
2. Read [Development Workflow](/development)
3. Run `bun run test`
4. Run relevant client tests for touched code
5. If protocol semantics changed, check `specs/deps/` process
