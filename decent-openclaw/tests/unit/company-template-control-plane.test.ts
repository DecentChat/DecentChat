import { describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeXenaPeer } from '../../src/peer/NodeXenaPeer.ts';

const VALID_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-1',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://decentchat.app/peerjs',
    invites: [],
    alias: 'Xena',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-company-control-')),
    ...overrides,
  };
}

describe('NodeXenaPeer company-template control plane', () => {
  test('advertises company-template control capability when bridge handler is configured', async () => {
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
      companyTemplateControl: {
        installTemplate: async () => ({ provisioningMode: 'config-provisioned' as const }),
      },
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: (peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      },
    };
    (peer as any).messageProtocol = {
      createHandshake: async () => ({ publicKey: 'pk', peerId: 'me', preKeySupport: true }),
      createPreKeyBundle: async () => ({
        version: 1,
        peerId: 'me',
        generatedAt: Date.now(),
        signingPublicKey: 'sig',
        signedPreKey: { keyId: 1, publicKey: 'spk', signature: 'sig', createdAt: Date.now(), expiresAt: Date.now() + 1000 },
        oneTimePreKeys: [],
      }),
    };

    await (peer as any).sendHandshake('peer-1');

    expect(sent[0]?.msg?.type).toBe('handshake');
    expect(Array.isArray(sent[0]?.msg?.capabilities)).toBeTrue();
    expect(sent[0]?.msg?.capabilities).toContain('company-template-control-v1');
  });

  test('handles authorized install requests and returns runtime provisioning payload', async () => {
    const installTemplate = mock(async () => ({
      provisioningMode: 'config-provisioned' as const,
      createdAccountIds: ['backend'],
      provisionedAccountIds: ['backend'],
      onlineReadyAccountIds: ['backend', 'manager'],
      manualActionRequiredAccountIds: [],
      manualActionItems: [],
    }));

    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
      companyTemplateControl: { installTemplate },
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: (peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      },
    };
    (peer as any).syncProtocol = {
      handleMessage: async () => {},
    };
    (peer as any).messageProtocol = {};
    (peer as any).workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1'
        ? {
          id: 'ws-1',
          createdBy: 'owner-peer',
          members: [
            { peerId: 'owner-peer', role: 'owner' },
            { peerId: 'host-peer', role: 'member' },
          ],
        }
        : null,
      isBanned: () => false,
    };

    await (peer as any).handlePeerMessage('owner-peer', {
      type: 'workspace-sync',
      workspaceId: 'ws-1',
      sync: {
        type: 'company-template-install-request',
        requestId: 'req-1',
        templateId: 'software-studio',
        answers: { companyName: 'Acme' },
      },
    });

    expect(installTemplate).toHaveBeenCalledTimes(1);
    expect(installTemplate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      templateId: 'software-studio',
      requestedByPeerId: 'owner-peer',
    }));

    const response = sent.find((entry) => entry.msg?.type === 'workspace-sync' && entry.msg?.sync?.type === 'company-template-install-response');
    expect(response).toBeDefined();
    expect(response?.peerId).toBe('owner-peer');
    expect(response?.msg?.sync?.ok).toBeTrue();
    expect(response?.msg?.sync?.result?.provisioningMode).toBe('config-provisioned');
  });

  test('rejects install requests from non-admin members', async () => {
    const installTemplate = mock(async () => ({ provisioningMode: 'config-provisioned' as const }));
    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
      companyTemplateControl: { installTemplate },
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: (peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      },
    };
    (peer as any).syncProtocol = {
      handleMessage: async () => {},
    };
    (peer as any).messageProtocol = {};
    (peer as any).workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1'
        ? {
          id: 'ws-1',
          createdBy: 'owner-peer',
          members: [
            { peerId: 'owner-peer', role: 'owner' },
            { peerId: 'member-peer', role: 'member' },
            { peerId: 'host-peer', role: 'member' },
          ],
        }
        : null,
      isBanned: () => false,
    };

    await (peer as any).handlePeerMessage('member-peer', {
      type: 'workspace-sync',
      workspaceId: 'ws-1',
      sync: {
        type: 'company-template-install-request',
        requestId: 'req-2',
        templateId: 'software-studio',
        answers: { companyName: 'Acme' },
      },
    });

    expect(installTemplate).toHaveBeenCalledTimes(0);

    const response = sent.find((entry) => entry.msg?.type === 'workspace-sync' && entry.msg?.sync?.requestId === 'req-2');
    expect(response).toBeDefined();
    expect(response?.msg?.sync?.ok).toBeFalse();
    expect(response?.msg?.sync?.error?.code).toBe('forbidden');
  });


  test('default control-plane installer pins bootstrap target workspace id from authorized install request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openclaw-company-control-default-install-'));

    const loadConfig = mock(() => ({
      channels: {
        decentchat: {
          accounts: {
            manager: {
              seedPhrase: VALID_SEED,
              alias: 'Manager',
              dataDir: join(root, 'manager-data'),
            },
          },
        },
      },
    }));
    const writeConfigFile = mock(async (_next: Record<string, unknown>) => {});

    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
      companyTemplateControl: {
        loadConfig,
        writeConfigFile,
        workspaceRootDir: root,
        companySimsRootDir: join(root, 'company-sims'),
      },
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: (peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      },
    };
    (peer as any).syncProtocol = {
      handleMessage: async () => {},
    };
    (peer as any).messageProtocol = {};
    (peer as any).workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'afcdbd3d-0473-4204-a72f-6b3b33271903'
        ? {
          id: workspaceId,
          createdBy: 'owner-peer',
          members: [
            { peerId: 'owner-peer', role: 'owner' },
            { peerId: 'host-peer', role: 'member' },
          ],
        }
        : null,
      isBanned: () => false,
    };

    try {
      await (peer as any).handlePeerMessage('owner-peer', {
        type: 'workspace-sync',
        workspaceId: 'afcdbd3d-0473-4204-a72f-6b3b33271903',
        sync: {
          type: 'company-template-install-request',
          requestId: 'req-default-install',
          templateId: 'software-studio',
          answers: {
            companyName: 'Acme Platform',
            workspaceName: 'Acme HQ',
          },
        },
      });

      expect(loadConfig).toHaveBeenCalledTimes(1);
      expect(writeConfigFile).toHaveBeenCalledTimes(1);

      const writtenConfig = writeConfigFile.mock.calls[0]?.[0] as any;
      expect(writtenConfig.channels.decentchat.companySimBootstrap.targetWorkspaceId)
        .toBe('afcdbd3d-0473-4204-a72f-6b3b33271903');
      expect(writtenConfig.channels.decentchat.companySimBootstrapTargetWorkspaceId)
        .toBe('afcdbd3d-0473-4204-a72f-6b3b33271903');

      const response = sent.find((entry) => entry.msg?.type === 'workspace-sync' && entry.msg?.sync?.requestId === 'req-default-install');
      expect(response?.msg?.sync?.ok).toBeTrue();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });


  test('serializes concurrent install requests to avoid config write races', async () => {
    const events: string[] = [];
    let releaseFirstInstall: (() => void) | null = null;

    const firstInstallGate = new Promise<void>((resolve) => {
      releaseFirstInstall = resolve;
    });

    let firstCall = true;
    const installTemplate = mock(async ({ templateId }: { templateId: string }) => {
      events.push(`start:${templateId}`);
      if (firstCall) {
        firstCall = false;
        await firstInstallGate;
      }
      events.push(`end:${templateId}`);
      return {
        provisioningMode: 'config-provisioned' as const,
        provisionedAccountIds: [templateId],
      };
    });

    const peer = new NodeXenaPeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
      companyTemplateControl: { installTemplate },
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: (peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      },
    };
    (peer as any).syncProtocol = {
      handleMessage: async () => {},
    };
    (peer as any).messageProtocol = {};
    (peer as any).workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1'
        ? {
          id: 'ws-1',
          createdBy: 'owner-peer',
          members: [
            { peerId: 'owner-peer', role: 'owner' },
            { peerId: 'host-peer', role: 'member' },
          ],
        }
        : null,
      isBanned: () => false,
    };

    const firstRequest = (peer as any).handlePeerMessage('owner-peer', {
      type: 'workspace-sync',
      workspaceId: 'ws-1',
      sync: {
        type: 'company-template-install-request',
        requestId: 'req-a',
        templateId: 'software-studio-a',
      },
    });

    await Promise.resolve();

    const secondRequest = (peer as any).handlePeerMessage('owner-peer', {
      type: 'workspace-sync',
      workspaceId: 'ws-1',
      sync: {
        type: 'company-template-install-request',
        requestId: 'req-b',
        templateId: 'software-studio-b',
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(installTemplate).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['start:software-studio-a']);

    releaseFirstInstall?.();

    await firstRequest;
    await secondRequest;

    expect(installTemplate).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      'start:software-studio-a',
      'end:software-studio-a',
      'start:software-studio-b',
      'end:software-studio-b',
    ]);

    const responses = sent.filter((entry) => entry.msg?.type === 'workspace-sync' && entry.msg?.sync?.type === 'company-template-install-response');
    expect(responses.map((entry) => entry.msg?.sync?.requestId)).toEqual(['req-a', 'req-b']);
    expect(responses.every((entry) => entry.msg?.sync?.ok === true)).toBeTrue();
  });

});
