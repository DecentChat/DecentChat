import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('ChatController manifest state persistence', () => {
  test('restoreFromStorage hydrates manifest state from PersistentStore cache', async () => {
    const persistedManifest = {
      schemaVersion: 1,
      workspaces: [
        {
          workspaceId: 'ws-1',
          versions: [
            {
              domain: 'membership',
              workspaceId: 'ws-1',
              version: 2,
              itemCount: 3,
              lastUpdatedAt: 100,
              lastUpdatedBy: 'peer-a',
            },
          ],
          deltas: [],
          snapshots: [],
        },
      ],
    };

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myAlias: 'xena',
      workspaceAliases: {},
    };
    ctrl.activityItems = [];
    ctrl.workspaceInviteRegistry = {};

    ctrl.messageStore = {
      setThreadRoot: mock(() => {}),
      forceAdd: mock(() => {}),
    };
    ctrl.persistentStore = {
      getSetting: mock(async () => undefined),
      getManifestStoreState: mock(async () => persistedManifest),
      getAllWorkspaces: mock(async () => []),
      getChannelMessages: mock(async () => []),
    };
    ctrl.publicWorkspaceController = {
      restoreFromStorage: mock(async () => {}),
      ingestWorkspaceSnapshot: mock(() => {}),
      findStaleOwnedShellPlaceholders: mock(() => []),
      removeWorkspace: mock(async () => {}),
    };
    ctrl.manifestStore = {
      importState: mock(() => {}),
    };
    ctrl.workspaceManager = {
      importWorkspace: mock(() => {}),
      getAllWorkspaces: mock(() => []),
    };
    ctrl.reactions = {
      loadFromJSON: mock(() => {}),
    };
    ctrl.mediaStore = {
      getAttachment: mock(() => null),
      registerMeta: mock(() => {}),
    };
    ctrl.blobStorage = {
      has: mock(async () => false),
    };
    ctrl.restoreServerDiscovery = mock(async () => {});
    ctrl.getOrCreateCRDT = mock(() => ({ addMessage: mock(() => {}) }));
    ctrl.persistMessage = mock(async () => {});
    ctrl.startPEXBroadcasts = mock(() => {});
    ctrl.startPeerMaintenance = mock(() => {});
    ctrl.startQuotaChecks = mock(() => {});
    ctrl.startGossipCleanup = mock(() => {});

    await ChatController.prototype.restoreFromStorage.call(ctrl);

    expect(ctrl.persistentStore.getManifestStoreState).toHaveBeenCalledTimes(1);
    expect(ctrl.manifestStore.importState).toHaveBeenCalledWith(persistedManifest);
  });

  test('persistManifestState saves exported manifest state via PersistentStore', async () => {
    const persisted = {
      schemaVersion: 1,
      workspaces: [],
    };

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.manifestStore = {
      exportState: mock(() => persisted),
    };
    ctrl.persistentStore = {
      saveManifestStoreState: mock(async () => {}),
    };

    await (ChatController.prototype as any).persistManifestState.call(ctrl);

    expect(ctrl.manifestStore.exportState).toHaveBeenCalledTimes(1);
    expect(ctrl.persistentStore.saveManifestStoreState).toHaveBeenCalledWith(persisted);
  });
});
