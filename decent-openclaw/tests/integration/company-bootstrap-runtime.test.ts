import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InviteURI, SeedPhraseManager } from 'decent-protocol';

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

beforeAll(() => {
  process.chdir(repoRoot);
});

afterAll(() => {
  process.chdir(originalCwd);
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

describe('company bootstrap runtime startup', () => {
  test('validates required employee accounts and lists missing account ids', async () => {
    const channel = await import('../../src/channel.ts');
    const startupBootstrap = (channel as any).bootstrapDecentChatCompanySimForStartup as BootstrapFn | undefined;

    expect(typeof startupBootstrap).toBe('function');

    const root = mkdtempSync(join(tmpdir(), 'company-bootstrap-runtime-missing-account-'));
    try {
      const cfg = installCompanyAgentTopology(makeConfig(root, {
        'team-manager': 'one two three four five six seven eight nine ten eleven twelve',
        'backend-dev': 'one two three four five six seven eight nine ten eleven twelve',
        tester: 'one two three four five six seven eight nine ten eleven twelve',
      }), root);

      delete cfg.channels.decentchat.accounts.tester;

      const account = channel.resolveDecentChatAccount(cfg, 'team-manager');

      await expect(startupBootstrap!({ cfg, accountId: 'team-manager', account })).rejects.toThrow(/tester/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });


  test('binds runtime bootstrap to invited workspace context instead of synthesized manifest workspace id', async () => {
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

    const targetWorkspaceId = 'afcdbd3d-0473-4204-a72f-6b3b33271903';
    const targetInviteCode = 'TV3KL5RW';
    const inviteUri = InviteURI.create({
      host: 'decentchat.app',
      port: 443,
      inviteCode: targetInviteCode,
      workspaceId: targetWorkspaceId,
      workspaceName: 'Live Workspace',
    });

    const root = mkdtempSync(join(tmpdir(), 'company-bootstrap-runtime-invite-workspace-'));
    try {
      const cfg = installCompanyAgentTopology(makeConfig(root, seeds), root);
      for (const accountId of ['team-manager', 'backend-dev', 'tester']) {
        cfg.channels.decentchat.accounts[accountId].invites = [inviteUri];
      }

      const account = channel.resolveDecentChatAccount(cfg, 'team-manager');
      const logs: string[] = [];

      await startupBootstrap!({
        cfg,
        accountId: 'team-manager',
        account,
        log: {
          info: (message: string) => logs.push(message),
        },
      });

      const dirs = {
        'team-manager': join(root, 'team-manager'),
        'backend-dev': join(root, 'backend-dev'),
        tester: join(root, 'tester'),
      };

      for (const dir of Object.values(dirs)) {
        const workspaces = readWorkspaces(dir);
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0].id).toBe(targetWorkspaceId);
        expect(workspaces[0].inviteCode).toBe(targetInviteCode);
      }

      expect(logs.some((entry) => entry.includes(`workspace=${targetWorkspaceId}`))).toBeTrue();
    } finally {
      rmSync(root, { recursive: true, force: true });
      resetBootstrapState?.();
    }
  });


  test('materializes deterministic workspace/channel membership and stays idempotent across restart', async () => {
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

    const root = mkdtempSync(join(tmpdir(), 'company-bootstrap-runtime-'));
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
