# Public Workspace Scale Benchmarks (Task 14)

## Scope

Synthetic performance harness for adaptive public workspaces across these scales:

- **10k** member workspace shell (metadata-only open path)
- **100k** member directory pages (paged hydration + search)
- **500k** shard metadata generation (no DOM materialization)

## Benchmarks Added

### 1) Client-scale harness

File: `decent-client-web/tests/perf/public-workspace-scale.perf.ts`

Measures:
- Open workspace shell time
- Join readiness time (shell + first directory page available)
- First page render projection time
- Search latency (paged member picker search path)
- Heap growth after full 100k directory hydration

Synthetic data:
- 10k shell (`WorkspaceShell.memberCount = 10_000`)
- 100k members split into 1,000 pages (page size 100)

### 2) Protocol-scale harness

File: `decent-protocol/tests/perf/directory-shard.perf.ts`

Measures:
- 500k metadata-only shard planning time
- Heap growth during shard metadata generation
- Shard distribution skew (largest/smallest bucket ratio)

Synthetic data:
- 500k synthetic identity IDs
- 2-hex shard prefix planner (max 256 shards)
- 3 replica IDs per shard metadata ref

## Regression Gates

The perf tests fail when these thresholds are exceeded.

### Client thresholds

- `openWorkspaceShellMs < 30`
- `firstPageRenderMs < 8`
- `searchLatencyMs < 30`
- `memoryGrowthMb < 140`
- `joinReadinessMs < 25`

### Protocol thresholds

- `shardMetadataGenerationMs < 1250`
- `shardMetadataMemoryGrowthMb < 90`
- Shard skew ratio (`largest/smallest`) `< 2.5`

## Baseline Results (Mac Studio, Bun test)

> Filled from latest local run of the perf suite.

### Client (`public-workspace-scale.perf.ts`)

- openWorkspaceShellMs: **0.37 ms**
- firstPageRenderMs: **0.06 ms**
- searchLatencyMs: **1.34 ms**
- memoryGrowthMb: **30.85 MB**
- joinReadinessMs: **0.80 ms**
- generatedPageCount: **1000**
- loadedMemberCount: **100000**

### Protocol (`directory-shard.perf.ts`)

- shardCount: **256**
- generationMs: **115.56 ms**
- memoryGrowthMb: **0.22 MB**
- largestShardLoad: **2168**
- smallestShardLoad: **1742**

## Run Commands

From repo root:

```bash
bun test ./decent-protocol/tests/perf/directory-shard.perf.ts
bun test ./decent-client-web/tests/perf/public-workspace-scale.perf.ts
```

Optional full perf smoke:

```bash
bun run perf:smoke
bun run perf:reconnect
```
