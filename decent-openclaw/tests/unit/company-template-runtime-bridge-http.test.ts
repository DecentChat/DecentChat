import { describe, expect, mock, test } from 'bun:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeedPhraseManager } from 'decent-protocol';

import {
  COMPANY_TEMPLATE_BRIDGE_HTTP_PATH,
  createCompanyTemplateBridgeHttpHandler,
} from '@decentchat/company-sim';

function createMockRequest(
  method: string,
  url: string,
  body?: unknown,
  opts?: { remoteAddress?: string; headers?: Record<string, string> },
): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', {
    value: opts?.remoteAddress ?? '127.0.0.1',
    configurable: true,
  });

  const req = new IncomingMessage(socket);
  Object.defineProperty(req.socket, 'remoteAddress', {
    value: opts?.remoteAddress ?? '127.0.0.1',
    configurable: true,
  });
  req.method = method;
  req.url = url;
  req.headers = {
    host: '127.0.0.1',
    'content-type': 'application/json',
    ...(opts?.headers ?? {}),
  };

  process.nextTick(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(JSON.stringify(body), 'utf8'));
    }
    req.emit('end');
  });

  return req;
}

function createMockResponse(): ServerResponse & {
  _status: () => number;
  _json: () => any;
} {
  const res = new ServerResponse({} as IncomingMessage);

  let body = '';
  let statusCode = 200;

  res.write = function (chunk: any) {
    body += String(chunk);
    return true;
  } as any;

  res.end = function (chunk?: any) {
    if (chunk !== undefined) {
      body += String(chunk);
    }
    return this;
  } as any;

  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (next: number) => {
      statusCode = next;
    },
  });

  (res as any)._status = () => statusCode;
  (res as any)._json = () => (body ? JSON.parse(body) : null);

  return res as any;
}

describe('company template runtime bridge http handler', () => {
  test('returns false for unrelated paths', async () => {
    const handler = createCompanyTemplateBridgeHttpHandler({
      runtimeConfig: {
        loadConfig: () => ({}),
        writeConfigFile: async () => {},
      },
    });

    const req = createMockRequest('GET', '/unrelated-path');
    const res = createMockResponse();

    const handled = await handler(req, res);
    expect(handled).toBeFalse();
  });

  test('accepts remote callers (plugin auth is enforced by route registration)', async () => {
    const handler = createCompanyTemplateBridgeHttpHandler({
      runtimeConfig: {
        loadConfig: () => ({}),
        writeConfigFile: async () => {},
      },
    });

    const req = createMockRequest('GET', COMPANY_TEMPLATE_BRIDGE_HTTP_PATH, undefined, {
      remoteAddress: '192.168.1.88',
    });
    const res = createMockResponse();

    const handled = await handler(req, res);
    expect(handled).toBeTrue();
    expect(res._status()).toBe(200);
    expect(res._json()?.ok).toBeTrue();
  });

  test('lists bundled templates through GET endpoint', async () => {
    const handler = createCompanyTemplateBridgeHttpHandler({
      runtimeConfig: {
        loadConfig: () => ({}),
        writeConfigFile: async () => {},
      },
    });

    const req = createMockRequest('GET', COMPANY_TEMPLATE_BRIDGE_HTTP_PATH);
    const res = createMockResponse();

    const handled = await handler(req, res);
    expect(handled).toBeTrue();
    expect(res._status()).toBe(200);

    const payload = res._json();
    expect(payload.ok).toBeTrue();
    expect(Array.isArray(payload.templates)).toBeTrue();
    const softwareStudio = payload.templates.find((template: any) => template.id === 'software-studio');
    expect(softwareStudio).toBeDefined();
    expect(softwareStudio.benchmarkSuite.scenarioIds).toEqual([
      'owner-routing',
      'handoff-targeting',
      'manager-summary-discipline',
      'top-level-noise-control',
    ]);
    expect(softwareStudio.benchmarkSuite.policyScores.minimal.score).toBeLessThan(softwareStudio.benchmarkSuite.policyScores.disciplined.score);
    expect(softwareStudio.benchmarkSuite.policyScores.minimal.score).toBeLessThan(softwareStudio.benchmarkSuite.policyScores.strict.score);
    expect(softwareStudio.benchmarkSuite.recommendedPolicy).toBe('disciplined');
    expect(softwareStudio.benchmarkSuite.recommendation.reasonCode).toBe('default-tie-break');
    expect(softwareStudio.benchmarkSuite.rankedPolicies[0].policy).toBe('disciplined');
  });

  test('installs template and writes updated OpenClaw config through POST endpoint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'company-template-bridge-http-'));
    const seedManager = new SeedPhraseManager();
    const managerSeed = seedManager.generate().mnemonic;

    const loadConfig = mock(() => ({
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
    }));

    const writeConfigFile = mock(async (_next: Record<string, unknown>) => {});

    try {
      const handler = createCompanyTemplateBridgeHttpHandler({
        runtimeConfig: {
          loadConfig,
          writeConfigFile,
        },
        workspaceRootDir: root,
        companySimsRootDir: join(root, 'company-sims'),
      });

      const req = createMockRequest('POST', COMPANY_TEMPLATE_BRIDGE_HTTP_PATH, {
        templateId: 'software-studio',
        workspaceId: 'ws-local-shell',
        inviteCode: 'TV3KL5RW',
        answers: {
          companyName: 'Acme Platform',
          workspaceName: 'Acme HQ',
          backendAlias: 'Devon API',
          qaAlias: 'Iva QA',
        },
      });
      const res = createMockResponse();

      const handled = await handler(req, res);
      expect(handled).toBeTrue();
      expect(res._status()).toBe(200);

      const payload = res._json();
      expect(payload.ok).toBeTrue();
      expect(payload.result.provisioningMode).toBe('config-provisioned');
      expect(payload.result.communicationPolicy).toBe('disciplined');
      expect(payload.result.benchmarkSuite.templateId).toBe('software-studio');
      expect(payload.result.benchmarkSuite.recommendedPolicy).toBe('disciplined');
      expect(payload.result.benchmarkSuite.recommendation.scoreDeltaVsMinimal).toBeGreaterThan(0);
      expect(payload.result.benchmarkSuite.policyScores.minimal.score).toBeLessThan(payload.result.benchmarkSuite.policyScores.disciplined.score);
      expect(payload.result.createdAccountIds).toEqual(['backend', 'qa']);
      expect(payload.result.provisionedAccountIds).toEqual(['backend', 'qa']);
      expect(payload.result.onlineReadyAccountIds).toEqual(['backend', 'manager', 'qa']);
      expect(payload.result.manualActionRequiredAccountIds).toEqual([]);
      expect(payload.result.manualActionItems).toContain(
        'Restart/reload OpenClaw so runtime bootstrap applies the new company manifest.',
      );

      expect(loadConfig).toHaveBeenCalledTimes(1);
      expect(writeConfigFile).toHaveBeenCalledTimes(1);

      const writtenConfig = writeConfigFile.mock.calls[0]?.[0] as any;
      expect(writtenConfig.channels.decentchat.accounts.backend).toBeDefined();
      expect(writtenConfig.channels.decentchat.accounts.qa).toBeDefined();
      expect(writtenConfig.channels.decentchat.companySimBootstrap.mode).toBe('runtime');
      expect(writtenConfig.channels.decentchat.companySimBootstrap.targetWorkspaceId).toBe('ws-local-shell');
      expect(writtenConfig.channels.decentchat.companySimBootstrap.targetInviteCode).toBe('TV3KL5RW');
      expect(writtenConfig.channels.decentchat.companySimBootstrapTargetWorkspaceId).toBe('ws-local-shell');
      expect(writtenConfig.channels.decentchat.companySimBootstrapTargetInviteCode).toBe('TV3KL5RW');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
