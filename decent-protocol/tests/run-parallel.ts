const shardCount = 2;

async function collectTestFiles(): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("tests/**/*.test.ts");

  for await (const file of glob.scan(".")) {
    files.push(file);
  }

  files.sort();
  return files;
}

function shardFiles(files: string[], count: number): string[][] {
  const shards: string[][] = Array.from({ length: count }, () => []);
  files.forEach((file, index) => {
    shards[index % count]!.push(file);
  });
  return shards;
}

async function runShard(index: number, files: string[]): Promise<number> {
  if (files.length === 0) {
    return 0;
  }

  const proc = Bun.spawn(["bun", "test", ...files], {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      BUN_TEST_SHARD: String(index + 1),
      BUN_TEST_TOTAL_SHARDS: String(shardCount),
    },
  });

  return proc.exited;
}

const start = performance.now();
const files = await collectTestFiles();

if (files.length === 0) {
  console.error("[test-parallel] No test files found under tests/**/*.test.ts");
  process.exit(1);
}

const shards = shardFiles(files, shardCount);

console.log(
  `[test-parallel] Running ${files.length} test files across ${shardCount} shards (${shards
    .map((s) => s.length)
    .join(" + ")})`,
);

const statuses = await Promise.all(shards.map((shard, index) => runShard(index, shard)));
const elapsedMs = performance.now() - start;

const failed = statuses.some((code) => code !== 0);

console.log(
  `[test-parallel] Completed in ${(elapsedMs / 1000).toFixed(2)}s (exit codes: ${statuses.join(", ")})`,
);

if (failed) {
  process.exit(1);
}
