import { describe, expect, test } from 'bun:test';
import { performance } from 'node:perf_hooks';
import { DirectoryShardPlanner } from '../../src/workspace/DirectoryShardPlanner';
import type { DirectoryShardRef } from '../../src/workspace/types';

interface ShardMetadataBenchmarkResult {
  shardCount: number;
  generationMs: number;
  memoryGrowthMb: number;
  largestShardLoad: number;
  smallestShardLoad: number;
}

const PERF_THRESHOLDS = {
  // Baseline + regression headroom (see docs/plans/2026-03-11-public-workspace-benchmarks.md)
  shardMetadataGenerationMs: 1_250,
  shardMetadataMemoryGrowthMb: 90,
};

function bytesToMb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function benchmarkShardMetadataGeneration(totalMembers = 500_000): ShardMetadataBenchmarkResult {
  const workspaceId = 'perf-ws-500k';
  const planner = new DirectoryShardPlanner(2);
  const replicaPeerIds = ['directory-01', 'directory-02', 'directory-03'];

  const baselineHeap = process.memoryUsage().heapUsed;
  const startedAt = performance.now();

  // Metadata-only synthetic generation: track per-shard counts without materializing full roster objects.
  const shardCounts = new Map<string, number>();
  for (let i = 0; i < totalMembers; i += 1) {
    const identityId = `identity-${i.toString(36).padStart(8, '0')}`;
    const shardPrefix = planner.getShardPrefixForMember({
      peerId: `peer-${i}`,
      identityId,
    });
    shardCounts.set(shardPrefix, (shardCounts.get(shardPrefix) ?? 0) + 1);
  }

  const shardMetadata: DirectoryShardRef[] = [...shardCounts.keys()].sort().map((prefix) => ({
    workspaceId,
    shardId: `${workspaceId}:${prefix}`,
    shardPrefix: prefix,
    replicaPeerIds,
    version: 1,
  }));

  const generationMs = performance.now() - startedAt;
  const memoryGrowthMb = bytesToMb(process.memoryUsage().heapUsed - baselineHeap);

  const loads = [...shardCounts.values()];
  const largestShardLoad = Math.max(...loads);
  const smallestShardLoad = Math.min(...loads);

  if (shardMetadata.length !== shardCounts.size) {
    throw new Error('Shard metadata cardinality mismatch');
  }

  return {
    shardCount: shardMetadata.length,
    generationMs,
    memoryGrowthMb,
    largestShardLoad,
    smallestShardLoad,
  };
}

describe('directory shard perf harness (metadata-only scale)', () => {
  test('generates 500k-member shard metadata within regression thresholds', () => {
    const result = benchmarkShardMetadataGeneration(500_000);

    console.log('[perf][directory-shard]', JSON.stringify(result));

    // With a 2-hex-prefix planner we expect up to 256 shard buckets.
    expect(result.shardCount).toBeLessThanOrEqual(256);
    expect(result.shardCount).toBeGreaterThan(180);

    // Keep distribution roughly balanced (hash skew guard).
    expect(result.largestShardLoad / Math.max(1, result.smallestShardLoad)).toBeLessThan(2.5);

    // Regression gates.
    expect(result.generationMs).toBeLessThan(PERF_THRESHOLDS.shardMetadataGenerationMs);
    expect(result.memoryGrowthMb).toBeLessThan(PERF_THRESHOLDS.shardMetadataMemoryGrowthMb);
  });
});
