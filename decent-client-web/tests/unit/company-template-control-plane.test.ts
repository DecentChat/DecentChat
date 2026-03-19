import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('company-template control-plane sync', () => {


  test('sends install request to capable host peer and resolves with response payload', async () => {
    const sendControlWithRetry = mock(() => true);

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me-peer',
      readyPeers: new Set(['host-peer']),
    };
    ctrl.transport = {
      connect: async () => {},
    };
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1'
        ? {
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner' },
            { peerId: 'host-peer', role: 'member', isBot: true },
          ],
        }
        : null,
    };
    ctrl.peerSupportsCapability = (peerId: string, capability: string) => {
      return peerId === 'host-peer' && capability === 'company-template-control-v1';
    };
    ctrl.sendControlWithRetry = sendControlWithRetry;
    ctrl.pendingCompanyTemplateInstallRequests = new Map();

    const installPromise = ctrl.installCompanyTemplateViaControlPlane({
      workspaceId: 'ws-1',
      templateId: 'software-studio',
      answers: {
        companyName: 'Acme',
      },
    });

    const [[requestId]] = ctrl.pendingCompanyTemplateInstallRequests.entries();

    await ctrl.handleSyncMessage('host-peer', {
      workspaceId: 'ws-1',
      sync: {
        type: 'company-template-install-response',
        requestId,
        ok: true,
        result: {
          provisioningMode: 'config-provisioned',
          provisionedAccountIds: ['backend'],
        },
      },
    });

    const installResult = await installPromise;

    expect(sendControlWithRetry).toHaveBeenCalledTimes(1);
    expect(sendControlWithRetry).toHaveBeenCalledWith(
      'host-peer',
      expect.objectContaining({
        type: 'workspace-sync',
        workspaceId: 'ws-1',
        sync: expect.objectContaining({
          type: 'company-template-install-request',
          templateId: 'software-studio',
        }),
      }),
      { label: 'company-template-install' },
    );
    expect(installResult).toEqual(expect.objectContaining({
      provisioningMode: 'config-provisioned',
      provisionedAccountIds: ['backend'],
    }));
  });

  test('resolves pending install request when response arrives', async () => {
    const resolve = mock(() => {});
    const reject = mock(() => {});
    const timer = setTimeout(() => {}, 30_000);

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.pendingCompanyTemplateInstallRequests = new Map([
      [
        'req-1',
        {
          targetPeerId: 'host-peer',
          resolve,
          reject,
          timer,
        },
      ],
    ]);

    await ctrl.handleSyncMessage('host-peer', {
      workspaceId: 'ws-1',
      sync: {
        type: 'company-template-install-response',
        requestId: 'req-1',
        ok: true,
        result: {
          provisioningMode: 'config-provisioned',
          createdAccountIds: ['backend'],
        },
      },
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      provisioningMode: 'config-provisioned',
      createdAccountIds: ['backend'],
    }));
    expect(reject).toHaveBeenCalledTimes(0);
    expect(ctrl.pendingCompanyTemplateInstallRequests.size).toBe(0);

    clearTimeout(timer);
  });

  test('rejects malformed success payloads to avoid fake installs', async () => {
    const resolve = mock(() => {});
    const reject = mock(() => {});
    const timer = setTimeout(() => {}, 30_000);

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.pendingCompanyTemplateInstallRequests = new Map([
      [
        'req-malformed',
        {
          targetPeerId: 'host-peer',
          resolve,
          reject,
          timer,
        },
      ],
    ]);

    await ctrl.handleSyncMessage('host-peer', {
      workspaceId: 'ws-1',
      sync: {
        type: 'company-template-install-response',
        requestId: 'req-malformed',
        ok: true,
        result: {},
      },
    });

    expect(resolve).toHaveBeenCalledTimes(0);
    expect(reject).toHaveBeenCalledTimes(1);
    expect(String(reject.mock.calls[0]?.[0]?.message ?? reject.mock.calls[0]?.[0] ?? '')).toContain('malformed install result');
    expect(ctrl.pendingCompanyTemplateInstallRequests.size).toBe(0);

    clearTimeout(timer);
  });

});
