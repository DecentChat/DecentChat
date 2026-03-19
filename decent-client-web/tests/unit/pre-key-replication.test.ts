import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('ChatController pre-key replication bootstrap', () => {
  test('stores published bundles under ownerPeerId (not transport sender)', async () => {
    const storePeerPreKeyBundle = mock(async () => true);

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = { myPeerId: 'peer-self' };
    ctrl.messageProtocol = {
      storePeerPreKeyBundle,
    };
    ctrl.recordManifestDomain = mock(() => {});
    ctrl.resolveSharedWorkspaceIds = mock(() => ['ws-1']);

    await (ChatController.prototype as any).handlePreKeyControlMessage.call(ctrl, 'custodian-1', {
      type: 'pre-key-bundle.publish',
      workspaceId: 'ws-1',
      ownerPeerId: 'peer-target',
      bundle: { generatedAt: 123, signedPreKey: { keyId: 7 } },
    });

    expect(storePeerPreKeyBundle).toHaveBeenCalledWith('peer-target', {
      generatedAt: 123,
      signedPreKey: { keyId: 7 },
    });
    expect(ctrl.recordManifestDomain).toHaveBeenCalledWith('pre-key-bundle', 'ws-1', expect.any(Object));
  });



  test('dedupes publish version token when only generatedAt changes', () => {
    const ctrl = Object.create(ChatController.prototype) as any;

    const baseBundle = {
      generatedAt: 100,
      signedPreKey: { keyId: 7 },
      oneTimePreKeys: [{ keyId: 11 }, { keyId: 13 }],
    };

    const tokenA = (ChatController.prototype as any).preKeyBundleVersionToken.call(ctrl, baseBundle);
    const tokenB = (ChatController.prototype as any).preKeyBundleVersionToken.call(ctrl, {
      ...baseBundle,
      generatedAt: 999999,
    });

    expect(tokenB).toBe(tokenA);

    const tokenChanged = (ChatController.prototype as any).preKeyBundleVersionToken.call(ctrl, {
      ...baseBundle,
      oneTimePreKeys: [{ keyId: 12 }, { keyId: 14 }],
    });

    expect(tokenChanged).not.toBe(tokenA);
  });
  test('targets likely custodians first for pre-key bootstrap', async () => {
    let hasBundle = false;
    const storePeerPreKeyBundle = mock(async (peerId: string) => {
      if (peerId === 'peer-target') hasBundle = true;
      return true;
    });

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'peer-self',
      readyPeers: new Set(['custodian-1', 'peer-relay']),
    };
    ctrl.pendingPreKeyBundleFetches = new Map();
    ctrl.workspaceManager = {
      getWorkspace: mock(() => ({
        id: 'ws-1',
        members: [
          { peerId: 'peer-self' },
          { peerId: 'peer-target' },
          { peerId: 'custodian-1' },
          { peerId: 'peer-relay' },
        ],
      })),
      getAllWorkspaces: mock(() => []),
    };
    ctrl.recordManifestDomain = mock(() => {});
    ctrl.selectCustodianPeers = mock(() => ['custodian-1']);

    const fetchTargets: string[] = [];
    ctrl.sendControlWithRetry = mock((peerId: string, payload: any) => {
      if (payload?.type === 'pre-key-bundle.fetch') {
        fetchTargets.push(`${peerId}:${payload.querySource}`);
        if (peerId === 'custodian-1') {
          setTimeout(() => {
            void (ChatController.prototype as any).handlePreKeyControlMessage.call(ctrl, 'custodian-1', {
              type: 'pre-key-bundle.fetch-response',
              requestId: payload.requestId,
              ownerPeerId: 'peer-target',
              workspaceId: 'ws-1',
              querySource: payload.querySource,
              bundle: { generatedAt: 456, signedPreKey: { keyId: 9 } },
            });
          }, 0);
        }
      }
      return true;
    });

    ctrl.messageProtocol = {
      encryptMessage: mock(async (peerId: string) => {
        if (peerId === 'peer-target' && !hasBundle) {
          throw new Error('No shared secret with peer peer-target. Exchange handshakes first.');
        }
        return { encrypted: 'ok' };
      }),
      getPeerPreKeyBundle: mock(async () => null),
      storePeerPreKeyBundle,
    };

    const envelope = await (ChatController.prototype as any).encryptMessageWithPreKeyBootstrap.call(
      ctrl,
      'peer-target',
      'hello',
      'ws-1',
    );

    expect(envelope).toEqual({ encrypted: 'ok' });
    expect(storePeerPreKeyBundle).toHaveBeenCalledWith('peer-target', {
      generatedAt: 456,
      signedPreKey: { keyId: 9 },
    });
    expect(fetchTargets).toEqual(['custodian-1:custodian-targeted']);
  });

  test('falls back to broader peer lookup when custodians do not have the target bundle', async () => {
    let hasBundle = false;
    const storePeerPreKeyBundle = mock(async (peerId: string) => {
      if (peerId === 'peer-target') hasBundle = true;
      return true;
    });

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'peer-self',
      readyPeers: new Set(['custodian-1', 'peer-relay']),
    };
    ctrl.pendingPreKeyBundleFetches = new Map();
    ctrl.workspaceManager = {
      getWorkspace: mock(() => ({
        id: 'ws-1',
        members: [
          { peerId: 'peer-self' },
          { peerId: 'peer-target' },
          { peerId: 'custodian-1' },
          { peerId: 'peer-relay' },
        ],
      })),
      getAllWorkspaces: mock(() => []),
    };
    ctrl.recordManifestDomain = mock(() => {});
    ctrl.selectCustodianPeers = mock(() => ['custodian-1']);

    const fetchTargets: string[] = [];
    ctrl.sendControlWithRetry = mock((peerId: string, payload: any) => {
      if (payload?.type === 'pre-key-bundle.fetch') {
        fetchTargets.push(`${peerId}:${payload.querySource}`);
        if (peerId === 'custodian-1') {
          setTimeout(() => {
            void (ChatController.prototype as any).handlePreKeyControlMessage.call(ctrl, 'custodian-1', {
              type: 'pre-key-bundle.fetch-response',
              requestId: payload.requestId,
              ownerPeerId: 'peer-target',
              workspaceId: 'ws-1',
              querySource: payload.querySource,
              notAvailable: true,
            });
          }, 0);
        }
        if (peerId === 'peer-relay') {
          setTimeout(() => {
            void (ChatController.prototype as any).handlePreKeyControlMessage.call(ctrl, 'peer-relay', {
              type: 'pre-key-bundle.fetch-response',
              requestId: payload.requestId,
              ownerPeerId: 'peer-target',
              workspaceId: 'ws-1',
              querySource: payload.querySource,
              bundle: { generatedAt: 789, signedPreKey: { keyId: 11 } },
            });
          }, 0);
        }
      }
      return true;
    });

    ctrl.messageProtocol = {
      encryptMessage: mock(async (peerId: string) => {
        if (peerId === 'peer-target' && !hasBundle) {
          throw new Error('No shared secret with peer peer-target. Exchange handshakes first.');
        }
        return { encrypted: 'ok' };
      }),
      getPeerPreKeyBundle: mock(async () => null),
      storePeerPreKeyBundle,
    };

    const envelope = await (ChatController.prototype as any).encryptMessageWithPreKeyBootstrap.call(
      ctrl,
      'peer-target',
      'hello',
      'ws-1',
    );

    expect(envelope).toEqual({ encrypted: 'ok' });
    expect(fetchTargets).toEqual([
      'custodian-1:custodian-targeted',
      'peer-relay:peer-broadcast',
    ]);
    expect(storePeerPreKeyBundle).toHaveBeenCalledWith('peer-target', {
      generatedAt: 789,
      signedPreKey: { keyId: 11 },
    });
  });
});
