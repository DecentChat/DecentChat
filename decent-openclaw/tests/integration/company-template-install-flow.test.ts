import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SeedPhraseManager } from 'decent-protocol';

import { resolveDecentChatAccount, bootstrapDecentChatCompanySimForStartup } from '../../src/channel.ts';
import { assertCompanyBootstrapAgentInstallation } from '../../src/company-sim/bootstrap.ts';
import { installCompanyTemplate } from '../../src/company-sim/template-installer.ts';
import { getCompanySimTemplate, listCompanySimTemplates } from '../../src/company-sim/template-registry.ts';

const bundledTemplatesRoot = fileURLToPath(new URL('../../../company-sims/templates', import.meta.url));

function readWorkspace(dataDir: string): any {
  const parsed = JSON.parse(readFileSync(join(dataDir, 'workspaces.json'), 'utf8'));
  expect(Array.isArray(parsed)).toBeTrue();
  expect(parsed).toHaveLength(1);
  return parsed[0];
}

describe('company template operator install flow', () => {
  test('lists templates, installs software-studio, and bootstraps runtime workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'company-template-install-flow-'));
    const seedManager = new SeedPhraseManager();

    try {
      const templates = listCompanySimTemplates({ templatesRoot: bundledTemplatesRoot });
      const templateIds = templates.map((template) => template.id);
      expect(templateIds).toContain('software-studio');

      const template = getCompanySimTemplate('software-studio', { templatesRoot: bundledTemplatesRoot });
      const managerSeed = seedManager.generate().mnemonic;

      const baseConfig = {
        channels: {
          decentchat: {
            accounts: {
              manager: {
                seedPhrase: managerSeed,
                alias: 'Mira Existing',
                dataDir: join(root, 'manager-data'),
              },
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
          backendAlias: 'Devon API',
        },
        workspaceRootDir: root,
        companySimsRootDir: join(root, 'company-sims'),
      });

      expect(install.manifest.name).toBe('Acme Platform');
      expect(install.manifest.workspace.name).toBe('Acme HQ');
      expect(install.summary.createdAccountIds).toEqual(['backend', 'qa']);

      const channelConfig = (install.config.channels as any).decentchat;
      expect(channelConfig.companySimBootstrap).toMatchObject({
        enabled: true,
        mode: 'runtime',
        manifestPath: install.manifestPath,
      });

      const accountSeeds: Record<string, string> = {
        backend: seedManager.generate().mnemonic,
        qa: seedManager.generate().mnemonic,
      };

      const accounts = channelConfig.accounts as Record<string, any>;
      for (const accountId of install.summary.createdAccountIds) {
        accounts[accountId].seedPhrase = accountSeeds[accountId];
      }

      accounts.backend.dataDir = join(root, 'backend-data');
      accounts.qa.dataDir = join(root, 'qa-data');

      assertCompanyBootstrapAgentInstallation({
        manifestPath: install.manifestPath,
        cfg: install.config,
      });

      const managerAccount = resolveDecentChatAccount(install.config, 'manager');
      await bootstrapDecentChatCompanySimForStartup({
        cfg: install.config,
        accountId: 'manager',
        account: managerAccount,
      });

      const managerWorkspace = readWorkspace(accounts.manager.dataDir);
      const backendWorkspace = readWorkspace(accounts.backend.dataDir);
      const qaWorkspace = readWorkspace(accounts.qa.dataDir);

      expect(managerWorkspace.id).toBe(backendWorkspace.id);
      expect(managerWorkspace.id).toBe(qaWorkspace.id);

      expect(managerWorkspace.name).toBe('Acme HQ');
      expect(managerWorkspace.channels.map((channel: any) => channel.name).sort()).toEqual([
        'engineering',
        'general',
        'leadership',
        'qa',
      ]);

      expect(managerWorkspace.members).toHaveLength(3);
      expect(backendWorkspace.members).toHaveLength(3);
      expect(qaWorkspace.members).toHaveLength(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
