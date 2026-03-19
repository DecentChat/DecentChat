import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planCompanyAgentTopology } from '../../src/company-sim/agent-topology.ts';
import { materializeCompanyOpenClawConfig } from '../../src/company-sim/openclaw-config.ts';
import type { CompanyManifest } from '../../src/company-sim/types.ts';

function createManifest(): CompanyManifest {
  return {
    id: 'software-studio',
    name: 'Software Studio',
    mode: 'company-sim',
    workspace: {
      name: 'Studio HQ',
      channels: ['general', 'engineering'],
    },
    teams: [],
    employees: [
      {
        id: 'backend-dev',
        agentId: 'software-studio-backend-dev',
        accountId: 'backend-dev',
        alias: 'Rian Backend',
        title: 'Backend Engineer',
        channels: ['engineering'],
        participation: { mode: 'specialist' },
      },
      {
        id: 'tester',
        agentId: 'software-studio-tester',
        accountId: 'tester',
        alias: 'Iva QA',
        title: 'QA Engineer',
        channels: ['engineering'],
        participation: { mode: 'specialist' },
      },
    ],
  };
}

describe('company openclaw config materializer', () => {
  test('generates agents.list + decentchat account bindings while preserving unrelated entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-openclaw-config-'));
    try {
      const manifest = createManifest();
      const topology = planCompanyAgentTopology({
        manifest,
        manifestPath: join(root, 'company-sims', 'software-studio', 'company.yaml'),
        workspaceRootDir: root,
      });

      const existingConfig = {
        channels: {
          decentchat: {
            accounts: {
              'backend-dev': { seedPhrase: 'seed-backend' },
              tester: { seedPhrase: 'seed-tester' },
              unrelated: { seedPhrase: 'seed-unrelated' },
            },
          },
        },
        agents: {
          list: [
            { id: 'main', workspace: '/tmp/main', default: true },
          ],
        },
        bindings: [
          { type: 'route', agentId: 'main', match: { channel: 'slack', accountId: 'ops' } },
        ],
      };

      const nextConfig = materializeCompanyOpenClawConfig({
        config: existingConfig,
        topology,
      });

      const agentsById = new Map((nextConfig.agents?.list ?? []).map((entry: any) => [entry.id, entry]));
      expect(agentsById.get('main')).toMatchObject({ id: 'main', workspace: '/tmp/main', default: true });
      expect(agentsById.get('software-studio-backend-dev')).toMatchObject({
        id: 'software-studio-backend-dev',
        workspace: topology.agents[0]!.workspace.path,
      });
      expect(agentsById.get('software-studio-tester')).toMatchObject({
        id: 'software-studio-tester',
        workspace: topology.agents[1]!.workspace.path,
      });

      const routeByKey = new Map(
        (nextConfig.bindings ?? [])
          .filter((binding: any) => binding?.type !== 'acp')
          .map((binding: any) => [`${binding.match?.channel}:${binding.match?.accountId}`, binding.agentId]),
      );

      expect(routeByKey.get('slack:ops')).toBe('main');
      expect(routeByKey.get('decentchat:backend-dev')).toBe('software-studio-backend-dev');
      expect(routeByKey.get('decentchat:tester')).toBe('software-studio-tester');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('is idempotent and does not duplicate company agents/bindings on re-apply', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-openclaw-config-'));
    try {
      const topology = planCompanyAgentTopology({
        manifest: createManifest(),
        manifestPath: join(root, 'company-sims', 'software-studio', 'company.yaml'),
        workspaceRootDir: root,
      });

      const baseConfig = {
        channels: {
          decentchat: {
            accounts: {
              'backend-dev': { seedPhrase: 'seed-backend' },
              tester: { seedPhrase: 'seed-tester' },
            },
          },
        },
        agents: {
          list: [
            { id: 'software-studio-backend-dev', workspace: '/tmp/old-backend' },
          ],
        },
        bindings: [
          { type: 'route', agentId: 'legacy-agent', match: { channel: 'decentchat', accountId: 'backend-dev' } },
        ],
      };

      const first = materializeCompanyOpenClawConfig({ config: baseConfig, topology });
      const second = materializeCompanyOpenClawConfig({ config: first, topology });

      const firstManagedAgents = (first.agents?.list ?? []).filter((entry: any) => entry.id.startsWith('software-studio-'));
      const secondManagedAgents = (second.agents?.list ?? []).filter((entry: any) => entry.id.startsWith('software-studio-'));
      expect(firstManagedAgents).toHaveLength(2);
      expect(secondManagedAgents).toHaveLength(2);

      const firstManagedBindings = (first.bindings ?? []).filter(
        (binding: any) => binding.match?.channel === 'decentchat' && ['backend-dev', 'tester'].includes(binding.match?.accountId),
      );
      const secondManagedBindings = (second.bindings ?? []).filter(
        (binding: any) => binding.match?.channel === 'decentchat' && ['backend-dev', 'tester'].includes(binding.match?.accountId),
      );

      expect(firstManagedBindings).toHaveLength(2);
      expect(secondManagedBindings).toHaveLength(2);
      expect(secondManagedBindings.map((binding: any) => [binding.match.accountId, binding.agentId]).sort()).toEqual([
        ['backend-dev', 'software-studio-backend-dev'],
        ['tester', 'software-studio-tester'],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('throws a clear error when manifest account ids are missing from channels.decentchat.accounts', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-openclaw-config-'));
    try {
      const topology = planCompanyAgentTopology({
        manifest: createManifest(),
        manifestPath: join(root, 'company-sims', 'software-studio', 'company.yaml'),
        workspaceRootDir: root,
      });

      const config = {
        channels: {
          decentchat: {
            accounts: {
              'backend-dev': { seedPhrase: 'seed-backend' },
            },
          },
        },
      };

      expect(() => materializeCompanyOpenClawConfig({ config, topology })).toThrow(
        /channels\.decentchat\.accounts.*tester/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
