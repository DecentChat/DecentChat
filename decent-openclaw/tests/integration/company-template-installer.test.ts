import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCompanySimTemplate } from '../../src/company-sim/template-registry.ts';
import { installCompanyTemplate } from '../../src/company-sim/template-installer.ts';

const bundledTemplatesRoot = fileURLToPath(new URL('../../../company-sims/templates', import.meta.url));

describe('company template installer', () => {
  test('generates deterministic missing accounts, scaffolds workspaces, merges topology, and returns install summary', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-template-installer-'));

    try {
      const template = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });

      const baseConfig = {
        channels: {
          decentchat: {
            accounts: {
              manager: {
                seedPhrase: 'seed-manager',
                alias: 'Mira Existing',
              },
              ops: {
                seedPhrase: 'seed-ops',
                alias: 'Ops Bot',
              },
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
      } as any;

      const firstInstall = installCompanyTemplate({
        template,
        config: baseConfig,
        answers: {
          companyName: 'Acme Platform',
          workspaceName: 'Acme HQ',
          backendAlias: 'Devon API',
        },
        workspaceRootDir: root,
        companySimsRootDir: join(root, 'company-sims'),
      });

      expect(firstInstall.summary.createdAccountIds).toEqual(['backend', 'qa']);
      expect(firstInstall.summary.createdAgentIds).toEqual([
        'software-studio-backend',
        'software-studio-manager',
        'software-studio-qa',
      ]);
      expect(firstInstall.summary.createdChannels).toEqual(['engineering', 'general', 'leadership', 'qa']);

      const decentchatConfig = (firstInstall.config.channels as any).decentchat;
      expect(decentchatConfig.companySimBootstrap).toMatchObject({
        enabled: true,
        mode: 'runtime',
        manifestPath: firstInstall.manifestPath,
      });
      expect(decentchatConfig.companySimBootstrapEnabled).toBeTrue();
      expect(decentchatConfig.companySimBootstrapMode).toBe('runtime');
      expect(decentchatConfig.companySimBootstrapManifestPath).toBe(firstInstall.manifestPath);

      const accounts = decentchatConfig.accounts;
      expect(accounts.manager.alias).toBe('Mira Existing');
      expect(accounts.backend).toMatchObject({
        alias: 'Devon API',
        companySim: {
          enabled: true,
          companyId: 'software-studio',
          employeeId: 'backend',
          manifestPath: firstInstall.manifestPath,
        },
      });
      expect(accounts.qa).toMatchObject({
        alias: 'Iva QA',
        companySim: {
          enabled: true,
          companyId: 'software-studio',
          employeeId: 'qa',
          manifestPath: firstInstall.manifestPath,
        },
      });

      const agentsById = new Map((firstInstall.config.agents?.list ?? []).map((entry: any) => [entry.id, entry]));
      expect(agentsById.get('main')).toMatchObject({ id: 'main', workspace: '/tmp/main', default: true });
      expect(agentsById.get('software-studio-backend')).toMatchObject({
        workspace: join(root, '.company-sim', 'workspaces', 'software-studio', 'software-studio-backend'),
      });
      expect(agentsById.get('software-studio-manager')).toMatchObject({
        workspace: join(root, '.company-sim', 'workspaces', 'software-studio', 'software-studio-manager'),
      });
      expect(agentsById.get('software-studio-qa')).toMatchObject({
        workspace: join(root, '.company-sim', 'workspaces', 'software-studio', 'software-studio-qa'),
      });

      const routeByKey = new Map(
        (firstInstall.config.bindings ?? [])
          .filter((binding: any) => binding?.type !== 'acp')
          .map((binding: any) => [`${binding.match?.channel}:${binding.match?.accountId}`, binding.agentId]),
      );

      expect(routeByKey.get('slack:ops')).toBe('main');
      expect(routeByKey.get('decentchat:manager')).toBe('software-studio-manager');
      expect(routeByKey.get('decentchat:backend')).toBe('software-studio-backend');
      expect(routeByKey.get('decentchat:qa')).toBe('software-studio-qa');

      for (const scaffold of firstInstall.workspaceScaffold) {
        expect(existsSync(join(scaffold.workspacePath, 'AGENTS.md'))).toBeTrue();
        expect(existsSync(join(scaffold.workspacePath, 'SOUL.md'))).toBeTrue();
        expect(existsSync(join(scaffold.workspacePath, 'USER.md'))).toBeTrue();
        expect(existsSync(join(scaffold.workspacePath, 'company', 'COMPANY.md'))).toBeTrue();
        expect(existsSync(join(scaffold.workspacePath, 'employee', 'MEMORY.md'))).toBeTrue();
        expect(existsSync(join(scaffold.workspacePath, 'employee', 'PLAYBOOK.md'))).toBeTrue();
      }

      const backendMemory = readFileSync(join(firstInstall.companyDirPath, 'employees', 'backend', 'MEMORY.md'), 'utf8');
      expect(backendMemory).toContain('Devon API');

      const replayInstall = installCompanyTemplate({
        template,
        config: baseConfig,
        answers: {
          companyName: 'Acme Platform',
          workspaceName: 'Acme HQ',
          backendAlias: 'Devon API',
        },
        workspaceRootDir: root,
        companySimsRootDir: join(root, 'company-sims'),
      });

      expect(replayInstall.summary.createdAccountIds).toEqual(['backend', 'qa']);
      expect(replayInstall.config.channels).toEqual(firstInstall.config.channels);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preserves explicit companySimBootstrap policy when already configured', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-template-installer-bootstrap-policy-'));

    try {
      const template = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });
      const existingManifestPath = join(root, 'existing-company.yaml');

      const baseConfig = {
        channels: {
          decentchat: {
            companySimBootstrapEnabled: false,
            companySimBootstrapMode: 'off',
            companySimBootstrapManifestPath: existingManifestPath,
            accounts: {
              manager: { seedPhrase: 'seed-manager', alias: 'Manager' },
            },
          },
        },
      } as any;

      const install = installCompanyTemplate({
        template,
        config: baseConfig,
        answers: {
          companyName: 'Acme Platform',
          workspaceName: 'Acme HQ',
        },
        workspaceRootDir: root,
        companySimsRootDir: join(root, 'company-sims'),
      });

      const decentchatConfig = (install.config.channels as any).decentchat;
      expect(decentchatConfig.companySimBootstrap).toMatchObject({
        enabled: false,
        mode: 'off',
        manifestPath: existingManifestPath,
      });
      expect(decentchatConfig.companySimBootstrapEnabled).toBeFalse();
      expect(decentchatConfig.companySimBootstrapMode).toBe('off');
      expect(decentchatConfig.companySimBootstrapManifestPath).toBe(existingManifestPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
