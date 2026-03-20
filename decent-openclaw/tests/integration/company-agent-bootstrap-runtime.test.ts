import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeedPhraseManager } from 'decent-protocol';

import { planCompanyAgentTopology } from '../../src/company-sim/agent-topology.ts';
import { parseCompanyManifestFile } from '../../src/company-sim/manifest.ts';
import { materializeCompanyOpenClawConfig } from '../../src/company-sim/openclaw-config.ts';

type BootstrapFn = (params: {
  cfg: any;
  accountId: string;
  account: any;
  log?: { info?: (message: string) => void; warn?: (message: string) => void; error?: (message: string) => void };
}) => Promise<unknown>;

type ResetFn = () => void;

const repoRoot = new URL('../../../', import.meta.url).pathname;
const manifestPath = join(repoRoot, 'company-sims/software-studio/company.yaml');
const originalCwd = process.cwd();
const originalWorkspaceDir = process.env.OPENCLAW_WORKSPACE_DIR;

beforeAll(() => {
  process.chdir(repoRoot);
  process.env.OPENCLAW_WORKSPACE_DIR = repoRoot;
});

afterAll(() => {
  process.chdir(originalCwd);
  if (originalWorkspaceDir === undefined) {
    delete process.env.OPENCLAW_WORKSPACE_DIR;
  } else {
    process.env.OPENCLAW_WORKSPACE_DIR = originalWorkspaceDir;
  }
});

function readWorkspaces(dataDir: string): any[] {
  return JSON.parse(readFileSync(join(dataDir, 'workspaces.json'), 'utf8'));
}

function makeConfig(root: string, seeds: Record<string, string>): any {
  return {
    channels: {
      decentchat: {
        companySimBootstrapEnabled: true,
        companySimBootstrapMode: 'runtime',
        companySimBootstrapManifestPath: 'company-sims/software-studio/company.yaml',
        accounts: {
          'team-manager': {
            seedPhrase: seeds['team-manager'],
            alias: 'Mira PM',
            dataDir: join(root, 'team-manager'),
          },
          'backend-dev': {
            seedPhrase: seeds['backend-dev'],
            alias: 'Rian Backend',
            dataDir: join(root, 'backend-dev'),
          },
          tester: {
            seedPhrase: seeds.tester,
            alias: 'Iva QA',
            dataDir: join(root, 'tester'),
          },
        },
      },
    },
  };
}

function installCompanyAgentTopology(cfg: any, workspaceRootDir: string): any {
  const topology = planCompanyAgentTopology({
    manifest: parseCompanyManifestFile(manifestPath),
    manifestPath,
    workspaceRootDir,
  });

  return materializeCompanyOpenClawConfig({
    config: cfg,
    topology,
  });
}

describe('company bootstrap runtime startup (agent-aware)', () => {
  test('refuses startup when company manifest agent bindings are not installed in config', async () => {
    const channel = await import('../../src/channel.ts');
    const runtime = await import('../../src/runtime.ts');

    const startupBootstrap = (channel as any).bootstrapDecentChatCompanySimForStartup as BootstrapFn | undefined;
    const resetBootstrapState = (runtime as any).resetDecentChatRuntimeBootstrapStateForTests as ResetFn | undefined;

    expect(typeof startupBootstrap).toBe('function');
    expect(typeof resetBootstrapState).toBe('function');

    const seedManager = new SeedPhraseManager();
    const seeds = {
      'team-manager': seedManager.generate().mnemonic,
      'backend-dev': seedManager.generate().mnemonic,
      tester: seedManager.generate().mnemonic,
    };

    const root = mkdtempSync(join(tmpdir(), 'company-agent-bootstrap-missing-topology-'));
    try {
      const cfg = makeConfig(root, seeds);
      const account = channel.resolveDecentChatAccount(cfg, 'team-manager');

      await expect(startupBootstrap!({ cfg, accountId: 'team-manager', account })).rejects.toThrow(
        /agents\.list|bindings|software-studio-team-manager/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      resetBootstrapState?.();
    }
  });

  test('materializes deterministic shared workspace and stays idempotent across restart once topology is installed', async () => {
    const channel = await import('../../src/channel.ts');
    const runtime = await import('../../src/runtime.ts');

    const startupBootstrap = (channel as any).bootstrapDecentChatCompanySimForStartup as BootstrapFn | undefined;
    const resetBootstrapState = (runtime as any).resetDecentChatRuntimeBootstrapStateForTests as ResetFn | undefined;

    expect(typeof startupBootstrap).toBe('function');
    expect(typeof resetBootstrapState).toBe('function');

    const seedManager = new SeedPhraseManager();
    const seeds = {
      'team-manager': seedManager.generate().mnemonic,
      'backend-dev': seedManager.generate().mnemonic,
      tester: seedManager.generate().mnemonic,
    };

    const root = mkdtempSync(join(tmpdir(), 'company-agent-bootstrap-runtime-'));
    try {
      const cfg = installCompanyAgentTopology(makeConfig(root, seeds), root);
      const account = channel.resolveDecentChatAccount(cfg, 'team-manager');

      await startupBootstrap!({ cfg, accountId: 'team-manager', account });

      const dirs = {
        'team-manager': join(root, 'team-manager'),
        'backend-dev': join(root, 'backend-dev'),
        tester: join(root, 'tester'),
      };

      const workspaceByAccount = Object.fromEntries(
        Object.entries(dirs).map(([accountId, dir]) => {
          const workspaces = readWorkspaces(dir);
          expect(workspaces).toHaveLength(1);
          return [accountId, workspaces[0]];
        }),
      ) as Record<string, any>;

      const workspaceIds = new Set(Object.values(workspaceByAccount).map((ws) => ws.id));
      expect(workspaceIds.size).toBe(1);

      for (const ws of Object.values(workspaceByAccount)) {
        expect(ws.name).toBe('Studio HQ');
        expect(ws.channels.map((ch: any) => ch.name).sort()).toEqual(['engineering', 'general', 'leadership', 'qa']);
      }

      const expectedPeerIds = await Promise.all([
        seedManager.derivePeerId(seeds['team-manager']),
        seedManager.derivePeerId(seeds['backend-dev']),
        seedManager.derivePeerId(seeds.tester),
      ]);

      for (const ws of Object.values(workspaceByAccount)) {
        const peerIds = ws.members.map((member: any) => member.peerId);
        expect(new Set(peerIds).size).toBe(3);
        expect(peerIds.sort()).toEqual([...expectedPeerIds].sort());
      }

      const snapshotBeforeRestart = JSON.stringify(workspaceByAccount);

      resetBootstrapState!();
      await startupBootstrap!({ cfg, accountId: 'team-manager', account });

      const workspaceAfterRestart = Object.fromEntries(
        Object.entries(dirs).map(([accountId, dir]) => {
          const workspaces = readWorkspaces(dir);
          expect(workspaces).toHaveLength(1);
          const workspace = workspaces[0];
          expect(workspace.channels).toHaveLength(4);
          expect(workspace.members).toHaveLength(3);
          return [accountId, workspace];
        }),
      );

      expect(JSON.stringify(workspaceAfterRestart)).toBe(snapshotBeforeRestart);
    } finally {
      rmSync(root, { recursive: true, force: true });
      resetBootstrapState?.();
    }
  });
});
