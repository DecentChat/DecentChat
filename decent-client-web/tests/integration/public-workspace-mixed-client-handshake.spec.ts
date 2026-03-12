import { test, expect, type Page } from '@playwright/test';
import { createUser, closeUser, startRelay, relay } from './helpers';

test.beforeAll(async () => {
  await startRelay();
});

test.afterAll(async () => {
  relay?.close();
});

async function waitForTransportReady(page: Page): Promise<string> {
  await page.waitForFunction(() => {
    const t = (window as any).__transport;
    return t && t.getMyPeerId && t.getMyPeerId();
  }, { timeout: 10_000 });

  return page.evaluate(() => (window as any).__transport.getMyPeerId());
}

async function waitForPeersReady(page1: Page, page2: Page, timeoutMs = 15_000): Promise<void> {
  const p1Id = await page1.evaluate(() => (window as any).__state?.myPeerId);
  const p2Id = await page2.evaluate(() => (window as any).__state?.myPeerId);

  await page1.waitForFunction(
    (targetId: string) => (window as any).__state?.readyPeers?.has(targetId),
    p2Id,
    { timeout: timeoutMs },
  );
  await page2.waitForFunction(
    (targetId: string) => (window as any).__state?.readyPeers?.has(targetId),
    p1Id,
    { timeout: timeoutMs },
  );
}

async function setupSharedWorkspaceForShellSync(
  alicePage: Page,
  bobPage: Page,
  capabilityFlags: string[],
): Promise<{ alicePeerId: string; bobPeerId: string; workspaceId: string; inviteCode: string }> {
  const alicePeerId = await waitForTransportReady(alicePage);
  const bobPeerId = await waitForTransportReady(bobPage);

  const shared = await alicePage.evaluate(({ bobPeerId, capabilityFlags }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    const ws = ctrl.createWorkspace('Rollback Shared', 'Alice');
    ws.members.push({
      peerId: bobPeerId,
      alias: 'Bob',
      publicKey: '',
      joinedAt: Date.now(),
      role: 'member',
      allowWorkspaceDMs: true,
    });
    ws.shell = {
      id: ws.id,
      name: ws.name,
      createdBy: ws.createdBy,
      createdAt: ws.createdAt,
      version: 2,
      memberCount: 250,
      channelCount: ws.channels.length,
      capabilityFlags,
    };
    state.activeWorkspaceId = ws.id;
    state.activeChannelId = ws.channels[0].id;
    return { workspaceId: ws.id, inviteCode: ws.inviteCode };
  }, { bobPeerId, capabilityFlags });

  await bobPage.evaluate(({ workspaceId, inviteCode, alicePeerId }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    const ws = ctrl.workspaceManager.createWorkspace(
      'Rollback Shared',
      state.myPeerId,
      'Bob',
      ctrl.myPublicKey,
      { workspaceId, inviteCode },
    );
    ws.createdBy = alicePeerId;
    ws.members = [
      {
        peerId: alicePeerId,
        alias: 'Alice',
        publicKey: '',
        joinedAt: Date.now(),
        role: 'owner',
        allowWorkspaceDMs: true,
      },
      {
        peerId: state.myPeerId,
        alias: 'Bob',
        publicKey: ctrl.myPublicKey,
        joinedAt: Date.now(),
        role: 'member',
        allowWorkspaceDMs: true,
      },
    ];
    delete ws.shell;
    state.activeWorkspaceId = workspaceId;
    state.activeChannelId = ws.channels[0].id;
  }, { workspaceId: shared.workspaceId, inviteCode: shared.inviteCode, alicePeerId });

  await alicePage.evaluate(() => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    const ws = ctrl.createWorkspace('Legacy Active', 'Alice');
    state.activeWorkspaceId = ws.id;
    state.activeChannelId = ws.channels[0].id;
  });

  await bobPage.evaluate(async ({ alicePeerId }) => {
    await (window as any).__transport.connect(alicePeerId);
  }, { alicePeerId });

  await waitForPeersReady(alicePage, bobPage);

  return { alicePeerId, bobPeerId, workspaceId: shared.workspaceId, inviteCode: shared.inviteCode };
}

test.describe('public workspace mixed-client handshake regression', () => {
  test.setTimeout(60_000);

  test('shell bootstrap survives active-workspace mismatch at handshake time', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      const alicePeerId = await waitForTransportReady(alice.page);
      const bobPeerId = await waitForTransportReady(bob.page);

      const shared = await alice.page.evaluate(({ bobPeerId }) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const ws = ctrl.createWorkspace('Large Shared', 'Alice');
        ws.members.push({
          peerId: bobPeerId,
          alias: 'Bob',
          publicKey: '',
          joinedAt: Date.now(),
          role: 'member',
          allowWorkspaceDMs: true,
        });
        ws.shell = {
          id: ws.id,
          name: ws.name,
          createdBy: ws.createdBy,
          createdAt: ws.createdAt,
          version: 2,
          memberCount: 250,
          channelCount: ws.channels.length,
          capabilityFlags: ['large-workspace-v1'],
        };
        state.activeWorkspaceId = ws.id;
        state.activeChannelId = ws.channels[0].id;
        return { workspaceId: ws.id, inviteCode: ws.inviteCode };
      }, { bobPeerId });

      await bob.page.evaluate(({ workspaceId, inviteCode, alicePeerId }) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const ws = ctrl.workspaceManager.createWorkspace(
          'Large Shared',
          state.myPeerId,
          'Bob',
          ctrl.myPublicKey,
          { workspaceId, inviteCode },
        );
        ws.createdBy = alicePeerId;
        ws.members = [
          {
            peerId: alicePeerId,
            alias: 'Alice',
            publicKey: '',
            joinedAt: Date.now(),
            role: 'owner',
            allowWorkspaceDMs: true,
          },
          {
            peerId: state.myPeerId,
            alias: 'Bob',
            publicKey: ctrl.myPublicKey,
            joinedAt: Date.now(),
            role: 'member',
            allowWorkspaceDMs: true,
          },
        ];
        delete ws.shell;
        state.activeWorkspaceId = workspaceId;
        state.activeChannelId = ws.channels[0].id;
      }, { workspaceId: shared.workspaceId, inviteCode: shared.inviteCode, alicePeerId });

      await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const ws = ctrl.createWorkspace('Legacy Active', 'Alice');
        state.activeWorkspaceId = ws.id;
        state.activeChannelId = ws.channels[0].id;
      });

      await bob.page.evaluate(async ({ alicePeerId }) => {
        await (window as any).__transport.connect(alicePeerId);
      }, { alicePeerId });

      await waitForPeersReady(alice.page, bob.page);

      await expect.poll(async () => {
        return bob.page.evaluate(({ alicePeerId }) => Array.from((window as any).__ctrl.peerCapabilities.get(alicePeerId) || []), { alicePeerId });
      }).toContain('workspace-shell-v1');

      await expect.poll(async () => {
        return bob.page.evaluate(({ alicePeerId }) => Array.from((window as any).__ctrl.peerCapabilities.get(alicePeerId) || []), { alicePeerId });
      }).toContain('member-directory-v1');

      await bob.page.evaluate(({ alicePeerId, workspaceId }) => {
        (window as any).__ctrl.requestWorkspaceShell(alicePeerId, workspaceId);
      }, { alicePeerId, workspaceId: shared.workspaceId });

      await bob.page.waitForFunction(
        ({ workspaceId }) => {
          const ctrl = (window as any).__ctrl;
          const ws = ctrl.workspaceManager.getWorkspace(workspaceId);
          return ws?.shell?.capabilityFlags?.includes('large-workspace-v1') === true;
        },
        { workspaceId: shared.workspaceId },
        { timeout: 15_000 },
      );

      const shellFlags = await bob.page.evaluate(({ workspaceId }) => {
        const ctrl = (window as any).__ctrl;
        return ctrl.workspaceManager.getWorkspace(workspaceId)?.shell?.capabilityFlags || [];
      }, { workspaceId: shared.workspaceId });

      expect(shellFlags).toContain('large-workspace-v1');
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  test('alias-only rollback stays enabled, but full rollback propagates cleared shell flags', async ({ browser }) => {
    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      const { alicePeerId, workspaceId } = await setupSharedWorkspaceForShellSync(
        alice.page,
        bob.page,
        ['large-workspace-v1', 'shell-delta-v1', 'member-directory-v1'],
      );

      await expect.poll(async () => {
        return bob.page.evaluate(({ alicePeerId }) => Array.from((window as any).__ctrl.peerCapabilities.get(alicePeerId) || []), { alicePeerId });
      }).toContain('workspace-shell-v1');

      await bob.page.evaluate(({ alicePeerId, workspaceId }) => {
        (window as any).__ctrl.requestWorkspaceShell(alicePeerId, workspaceId);
      }, { alicePeerId, workspaceId });

      await bob.page.waitForFunction(
        ({ workspaceId }) => {
          const ctrl = (window as any).__ctrl;
          return ctrl.workspaceManager.getWorkspace(workspaceId)?.shell?.capabilityFlags?.includes('large-workspace-v1') === true;
        },
        { workspaceId },
        { timeout: 15_000 },
      );

      // ── Phase 2: Alias-only rollback ─────────────────────────────
      // Verify Alice's flags before mutation
      const aliceFlagsBefore = await alice.page.evaluate(({ workspaceId }) => {
        const ws = (window as any).__ctrl.workspaceManager.getWorkspace(workspaceId);
        return ws?.shell?.capabilityFlags || [];
      }, { workspaceId });
      console.log('[DEBUG] Alice flags BEFORE mutation:', JSON.stringify(aliceFlagsBefore));

      await alice.page.evaluate(({ workspaceId }) => {
        const ctrl = (window as any).__ctrl;
        const ws = ctrl.workspaceManager.getWorkspace(workspaceId);
        ws.shell = {
          ...ws.shell,
          version: (ws.shell?.version ?? 2) + 1,
          capabilityFlags: ['shell-delta-v1', 'member-directory-v1'],
        };
      }, { workspaceId });

      const aliceFlagsAfter = await alice.page.evaluate(({ workspaceId }) => {
        const ws = (window as any).__ctrl.workspaceManager.getWorkspace(workspaceId);
        return { flags: ws?.shell?.capabilityFlags || [], version: ws?.shell?.version };
      }, { workspaceId });
      console.log('[DEBUG] Alice flags AFTER mutation:', JSON.stringify(aliceFlagsAfter));

      // Monkey-patch Alice's handleWorkspaceShellRequest to capture debug info
      await alice.page.evaluate(() => {
        (window as any).__debugShellReq = [];
        const ctrl = (window as any).__ctrl;
        const orig = ctrl.handleWorkspaceShellRequest.bind(ctrl);
        ctrl.handleWorkspaceShellRequest = function(peerId: string, wsId: string) {
          const ws = ctrl.workspaceManager.getWorkspace(wsId);
          (window as any).__debugShellReq.push({
            peerId: peerId.slice(0, 8), wsId: wsId.slice(0, 8),
            wsExists: !!ws, hasLarge: ws ? ctrl.workspaceHasLargeWorkspaceCapability(ws) : null,
            flags: ws?.shell?.capabilityFlags || [],
          });
          return orig(peerId, wsId);
        };
      });

      // Monkey-patch Bob's handleWorkspaceShellResponse to capture debug info
      await bob.page.evaluate(() => {
        (window as any).__debugShellResp = [];
        const ctrl = (window as any).__ctrl;
        const orig = ctrl.handleWorkspaceShellResponse.bind(ctrl);
        ctrl.handleWorkspaceShellResponse = async function(peerId: string, shell: any, inviteCode?: string) {
          (window as any).__debugShellResp.push({
            before: { flags: ctrl.workspaceManager.getWorkspace(shell.id)?.shell?.capabilityFlags },
            shellFlags: shell?.capabilityFlags,
          });
          const result = await orig(peerId, shell, inviteCode);
          const ws = ctrl.workspaceManager.getWorkspace(shell.id);
          (window as any).__debugShellResp[(window as any).__debugShellResp.length - 1].after = { flags: ws?.shell?.capabilityFlags };
          return result;
        };
      });

      // Re-establish connection or re-request after state change
      // The issue: after initial setup, the relay may not be forwarding messages properly
      // Try calling the actual method instead of inline
      await bob.page.evaluate(({ alicePeerId, workspaceId }) => {
        (window as any).__ctrl.requestWorkspaceShell(alicePeerId, workspaceId);
      }, { alicePeerId, workspaceId });

      await new Promise(r => setTimeout(r, 5000));
      
      const aliceDebug = await alice.page.evaluate(() => (window as any).__debugShellReq || []);
      const bobDebug = await bob.page.evaluate(() => (window as any).__debugShellResp || []);
      console.log('[DEBUG-ALICE handleWorkspaceShellRequest calls:', JSON.stringify(aliceDebug));
      console.log('[DEBUG-BOB handleWorkspaceShellResponse calls:', JSON.stringify(bobDebug));
      
      const debugFlags = await bob.page.evaluate(({ workspaceId }) => {
        const ws = (window as any).__ctrl.workspaceManager.getWorkspace(workspaceId);
        return { flags: ws?.shell?.capabilityFlags || [], version: ws?.shell?.version };
      }, { workspaceId });
      console.log('[DEBUG] Bob flags after 5s wait:', JSON.stringify(debugFlags));

      await bob.page.waitForFunction(
        ({ workspaceId }) => {
          const ctrl = (window as any).__ctrl;
          const ws = ctrl.workspaceManager.getWorkspace(workspaceId);
          const flags = ws?.shell?.capabilityFlags || [];
          return !flags.includes('large-workspace-v1')
            && flags.includes('shell-delta-v1')
            && flags.includes('member-directory-v1')
            && ctrl.workspaceHasLargeWorkspaceCapability(ws) === true;
        },
        { workspaceId },
        { timeout: 15_000 },
      );

      await alice.page.evaluate(({ workspaceId }) => {
        const ctrl = (window as any).__ctrl;
        const ws = ctrl.workspaceManager.getWorkspace(workspaceId);
        ws.shell = {
          ...ws.shell,
          capabilityFlags: [],
        };
      }, { workspaceId });

      await bob.page.evaluate(({ alicePeerId, workspaceId }) => {
        (window as any).__ctrl.requestWorkspaceShell(alicePeerId, workspaceId);
      }, { alicePeerId, workspaceId });

      await bob.page.waitForFunction(
        ({ workspaceId }) => {
          const ctrl = (window as any).__ctrl;
          const ws = ctrl.workspaceManager.getWorkspace(workspaceId);
          const flags = ws?.shell?.capabilityFlags || [];
          return flags.length === 0 && ctrl.workspaceHasLargeWorkspaceCapability(ws) === false;
        },
        { workspaceId },
        { timeout: 15_000 },
      );
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
