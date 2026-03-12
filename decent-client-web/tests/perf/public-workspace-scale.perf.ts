import { describe, expect, test } from 'bun:test';
import { performance } from 'node:perf_hooks';
import { WorkspaceManager, type MemberDirectoryPage, type MemberSummary, type PersistentStore, type WorkspaceShell } from 'decent-protocol';
import { PublicWorkspaceController } from '../../src/app/workspace/PublicWorkspaceController';
import { searchMemberPickerPeers } from '../../src/ui/memberPickerSearch';

interface PublicWorkspacePerfMetrics {
  openWorkspaceShellMs: number;
  firstPageRenderMs: number;
  searchLatencyMs: number;
  memoryGrowthMb: number;
  joinReadinessMs: number;
  generatedPageCount: number;
  loadedMemberCount: number;
}

const PERF_THRESHOLDS = {
  // Baseline + regression headroom (see docs/plans/2026-03-11-public-workspace-benchmarks.md)
  openWorkspaceShellMs: 30,
  firstPageRenderMs: 8,
  searchLatencyMs: 30,
  memoryGrowthMb: 140,
  joinReadinessMs: 25,
};

const PAGE_SIZE = 100;
const DIRECTORY_MEMBER_COUNT = 100_000;

class InMemoryPublicWorkspaceStore {
  private readonly shells = new Map<string, WorkspaceShell>();
  private readonly pagesByWorkspace = new Map<string, MemberDirectoryPage[]>();

  async getAllWorkspaceShells(): Promise<WorkspaceShell[]> {
    return [...this.shells.values()].map((shell) => structuredClone(shell));
  }

  async getMemberDirectoryPages(workspaceId: string): Promise<MemberDirectoryPage[]> {
    return (this.pagesByWorkspace.get(workspaceId) ?? []).map((page) => structuredClone(page));
  }

  async saveWorkspaceShell(shell: WorkspaceShell): Promise<void> {
    this.shells.set(shell.id, structuredClone(shell));
  }

  async saveMemberDirectoryPage(page: MemberDirectoryPage): Promise<void> {
    const pages = this.pagesByWorkspace.get(page.workspaceId) ?? [];
    pages.push(structuredClone(page));
    this.pagesByWorkspace.set(page.workspaceId, pages);
  }
}

function bytesToMb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function createWorkspaceShell(memberCount = 10_000): WorkspaceShell {
  return {
    id: 'perf-public-workspace',
    name: 'Perf Public Workspace',
    description: 'Synthetic shell for load testing',
    createdBy: 'owner-peer',
    createdAt: 1_700_000_000_000,
    version: 42,
    memberCount,
    channelCount: 32,
    capabilityFlags: ['shell-delta-v1', 'member-directory-v1', 'presence-slices-v1'],
  };
}

function createMemberSummary(index: number): MemberSummary {
  const n = index + 1;
  const padded = String(n).padStart(6, '0');
  return {
    peerId: `peer-${padded}`,
    alias: `member-${padded}`,
    role: n === 1 ? 'owner' : n % 37 === 0 ? 'admin' : 'member',
    joinedAt: 1_700_000_000_000 + n,
    identityId: `identity-${padded}`,
    isBot: n % 211 === 0,
    allowWorkspaceDMs: n % 19 !== 0,
  };
}

function createDirectoryPages(workspaceId: string, totalMembers = DIRECTORY_MEMBER_COUNT, pageSize = PAGE_SIZE): MemberDirectoryPage[] {
  const pages: MemberDirectoryPage[] = [];

  for (let start = 0; start < totalMembers; start += pageSize) {
    const members: MemberSummary[] = [];
    const end = Math.min(start + pageSize, totalMembers);

    for (let i = start; i < end; i += 1) {
      members.push(createMemberSummary(i));
    }

    pages.push({
      workspaceId,
      pageSize,
      cursor: start === 0 ? undefined : `identity-${String(start).padStart(6, '0')}`,
      nextCursor: end < totalMembers ? `identity-${String(end).padStart(6, '0')}` : undefined,
      members,
    });
  }

  return pages;
}

function renderFirstPageRows(members: MemberSummary[]): Array<{ key: string; label: string; online: boolean }> {
  return members.slice(0, PAGE_SIZE).map((member) => ({
    key: member.peerId,
    label: `${member.alias || member.peerId} (${member.role})`,
    online: member.peerId.endsWith('0') || member.role === 'owner',
  }));
}

async function runScaleBenchmark(): Promise<PublicWorkspacePerfMetrics> {
  const workspaceManager = new WorkspaceManager();
  const store = new InMemoryPublicWorkspaceStore();
  const controller = new PublicWorkspaceController(
    workspaceManager,
    store as unknown as PersistentStore,
  );

  const shell = createWorkspaceShell(10_000);
  const pages = createDirectoryPages(shell.id, DIRECTORY_MEMBER_COUNT, PAGE_SIZE);

  const baselineHeap = process.memoryUsage().heapUsed;

  const shellStart = performance.now();
  await controller.ingestWorkspaceShell(shell, 'PERF0001');
  const shellSnapshot = controller.getSnapshot(shell.id);
  const openWorkspaceShellMs = performance.now() - shellStart;

  if (shellSnapshot.totalCount !== 10_000) {
    throw new Error(`Unexpected shell member count: ${shellSnapshot.totalCount}`);
  }

  const joinStart = performance.now();
  await controller.ingestMemberPage(pages[0]!);
  const joinedSnapshot = controller.getSnapshot(shell.id);
  const joinReadinessMs = performance.now() - joinStart;

  if (joinedSnapshot.loadedCount === 0) {
    throw new Error('Join readiness failed: first page did not hydrate directory');
  }

  const firstRenderStart = performance.now();
  const firstPageRows = renderFirstPageRows(joinedSnapshot.members);
  const firstPageRenderMs = performance.now() - firstRenderStart;

  if (firstPageRows.length === 0) {
    throw new Error('First page render produced zero rows');
  }

  // Search latency benchmark on paged runtime: force additional page loads.
  let loadedPageIndex = 0;
  const searchTarget = `member-${String((PAGE_SIZE * 4) + 5).padStart(6, '0')}`; // lands in page #5
  const searchStart = performance.now();
  const searchMatches = await searchMemberPickerPeers(
    {
      getMembers: () => controller.getSnapshot(shell.id).members.map((member) => ({
        peerId: member.peerId,
        name: member.alias || member.peerId,
      })),
      getLoadedCount: () => controller.getSnapshot(shell.id).loadedCount,
      hasMore: () => loadedPageIndex < pages.length - 1,
      loadNextPage: async () => {
        loadedPageIndex += 1;
        const next = pages[loadedPageIndex];
        if (next) await controller.ingestMemberPage(next);
      },
    },
    searchTarget,
    5,
    5,
  );
  const searchLatencyMs = performance.now() - searchStart;

  if (searchMatches.length === 0) {
    throw new Error('Search benchmark failed to resolve a synthetic member');
  }

  // Full 100k hydration for memory-growth guard and loaded-count assertions.
  for (let i = loadedPageIndex + 1; i < pages.length; i += 1) {
    await controller.ingestMemberPage(pages[i]!);
  }

  const fullSnapshot = controller.getSnapshot(shell.id);
  const memoryGrowthMb = bytesToMb(process.memoryUsage().heapUsed - baselineHeap);

  return {
    openWorkspaceShellMs,
    firstPageRenderMs,
    searchLatencyMs,
    memoryGrowthMb,
    joinReadinessMs,
    generatedPageCount: pages.length,
    loadedMemberCount: fullSnapshot.loadedCount,
  };
}

describe('public workspace scale perf harness (10k/100k)', () => {
  test('measures shell open, first render, search, memory, and join readiness', async () => {
    const metrics = await runScaleBenchmark();

    console.log('[perf][public-workspace-scale]', JSON.stringify(metrics));

    expect(metrics.generatedPageCount).toBe(1_000);
    expect(metrics.loadedMemberCount).toBe(DIRECTORY_MEMBER_COUNT);

    expect(metrics.openWorkspaceShellMs).toBeLessThan(PERF_THRESHOLDS.openWorkspaceShellMs);
    expect(metrics.firstPageRenderMs).toBeLessThan(PERF_THRESHOLDS.firstPageRenderMs);
    expect(metrics.searchLatencyMs).toBeLessThan(PERF_THRESHOLDS.searchLatencyMs);
    expect(metrics.memoryGrowthMb).toBeLessThan(PERF_THRESHOLDS.memoryGrowthMb);
    expect(metrics.joinReadinessMs).toBeLessThan(PERF_THRESHOLDS.joinReadinessMs);
  });
});
