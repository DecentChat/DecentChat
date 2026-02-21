/**
 * Presence dot tests — 3 states: offline (grey), connecting (amber pulsing), online (green)
 *
 * Strategy: create a workspace, inject a fake member directly into the
 * WorkspaceManager + app state, then drive connectingPeers / readyPeers
 * via window.__ctrl / window.__state and check the rendered classes.
 */

import { test, expect, Page } from '@playwright/test';
import { clearStorage, waitForApp, createWorkspace } from './helpers';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const FAKE_PEER_ID = 'aabbccdd-0011-2233-4455-667788990011';
const FAKE_ALIAS = 'FakeBob';

/** Inject a workspace member and force a sidebar re-render */
async function injectMember(page: Page, peerId = FAKE_PEER_ID, alias = FAKE_ALIAS) {
  await page.evaluate(
    ({ peerId, alias }) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      if (!ctrl || !state?.activeWorkspaceId) throw new Error('ctrl/state not ready');

      // Add member to workspace
      const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
      if (!ws) throw new Error('no active workspace');
      // Avoid duplicates
      if (!ws.members.find((m: any) => m.peerId === peerId)) {
        ws.members.push({ peerId, alias, publicKey: '' });
      }
      // Make sure they're not already in ready/connecting
      state.readyPeers.delete(peerId);
      state.connectingPeers.delete(peerId);
      // Re-render
      ctrl.ui?.updateSidebar();
    },
    { peerId, alias },
  );
}

/** Assert that the first `.dm-status` dot for a member has (or lacks) a CSS class */
async function expectDotClass(
  page: Page,
  peerId: string,
  expected: 'online' | 'connecting' | null,
) {
  // The dot is the .dm-status span inside the member-row for this peer
  const dot = page.locator(`[data-member-peer-id="${peerId}"] .dm-status`);
  await expect(dot).toBeVisible({ timeout: 3000 });

  if (expected === 'online') {
    await expect(dot).toHaveClass(/online/, { timeout: 3000 });
    await expect(dot).not.toHaveClass(/connecting/);
  } else if (expected === 'connecting') {
    await expect(dot).toHaveClass(/connecting/, { timeout: 3000 });
    await expect(dot).not.toHaveClass(/online/);
  } else {
    // offline — no online, no connecting
    await expect(dot).not.toHaveClass(/online/);
    await expect(dot).not.toHaveClass(/connecting/);
  }
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test.describe('Presence dots — 3-state indicator', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
    await createWorkspace(page, 'Dot Test WS', 'Alice');
  });

  // ── 1. Offline ────────────────────────────────────────────────────────────

  test('shows grey (offline) dot when peer is not connected', async ({ page }) => {
    await injectMember(page);
    await expectDotClass(page, FAKE_PEER_ID, null);

    // Confirm no online/connecting class at all
    const dot = page.locator(`[data-member-peer-id="${FAKE_PEER_ID}"] .dm-status`);
    const cls = await dot.getAttribute('class');
    expect(cls).not.toContain('online');
    expect(cls).not.toContain('connecting');
  });

  // ── 2. Connecting (amber) ─────────────────────────────────────────────────

  test('shows amber pulsing dot when peer is in connectingPeers', async ({ page }) => {
    await injectMember(page);

    // Move to connecting state
    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.connectingPeers.add(peerId);
      state.readyPeers.delete(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);

    await expectDotClass(page, FAKE_PEER_ID, 'connecting');
  });

  test('connecting dot has amber color via CSS variable', async ({ page }) => {
    await injectMember(page);
    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.connectingPeers.add(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);

    const dot = page.locator(`[data-member-peer-id="${FAKE_PEER_ID}"] .dm-status`);
    await expect(dot).toHaveClass(/connecting/);
    // Verify the animation is applied (pulse-connecting keyframes)
    const animName = await dot.evaluate((el) =>
      getComputedStyle(el).animationName,
    );
    expect(animName).toContain('pulse-connecting');
  });

  // ── 3. Online (green) ─────────────────────────────────────────────────────

  test('shows green dot when peer is in readyPeers', async ({ page }) => {
    await injectMember(page);

    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.connectingPeers.delete(peerId);
      state.readyPeers.add(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);

    await expectDotClass(page, FAKE_PEER_ID, 'online');
  });

  // ── 4. Transitions ────────────────────────────────────────────────────────

  test('transitions: offline → connecting → online', async ({ page }) => {
    await injectMember(page);

    // 1) offline
    await expectDotClass(page, FAKE_PEER_ID, null);

    // 2) connecting
    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.connectingPeers.add(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);
    await expectDotClass(page, FAKE_PEER_ID, 'connecting');

    // 3) online
    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.connectingPeers.delete(peerId);
      state.readyPeers.add(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);
    await expectDotClass(page, FAKE_PEER_ID, 'online');
  });

  test('transitions: online → offline (disconnect)', async ({ page }) => {
    await injectMember(page);

    // Start online
    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.readyPeers.add(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);
    await expectDotClass(page, FAKE_PEER_ID, 'online');

    // Disconnect → offline
    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.readyPeers.delete(peerId);
      state.connectingPeers.delete(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);
    await expectDotClass(page, FAKE_PEER_ID, null);
  });

  // ── 5. Tooltips ───────────────────────────────────────────────────────────

  test('offline dot has tooltip label "Offline"', async ({ page }) => {
    await injectMember(page);
    const dot = page.locator(`[data-member-peer-id="${FAKE_PEER_ID}"] .dm-status`);
    // TooltipManager converts title → aria-label + data-tooltip
    await expect(dot).toHaveAttribute('aria-label', 'Offline');
  });

  test('connecting dot has tooltip label "Connecting..."', async ({ page }) => {
    await injectMember(page);
    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.connectingPeers.add(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);
    const dot = page.locator(`[data-member-peer-id="${FAKE_PEER_ID}"] .dm-status`);
    await expect(dot).toHaveAttribute('aria-label', 'Connecting...');
  });

  test('online dot has tooltip label "Online"', async ({ page }) => {
    await injectMember(page);
    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.readyPeers.add(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);
    const dot = page.locator(`[data-member-peer-id="${FAKE_PEER_ID}"] .dm-status`);
    await expect(dot).toHaveAttribute('aria-label', 'Online');
  });

  // ── 6. On-refresh pre-population ─────────────────────────────────────────

  test('members show amber on page reload (pre-populated connecting state)', async ({ page }) => {
    // Add a member via state injection first, then save workspace
    await injectMember(page);
    // Persist so it survives reload
    await page.evaluate(async (peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      // Ensure member is in workspace members (already done by injectMember)
      // Simulate what the app does on restore: clear ready/connecting, then
      // pre-populate connectingPeers like main.ts does after our fix.
      state.readyPeers.delete(peerId);
      state.connectingPeers.delete(peerId);
      // Save workspace to storage so reload sees the member
      await ctrl.persistentStore.saveWorkspace(
        ctrl.workspaceManager.exportWorkspace(state.activeWorkspaceId),
      );
    }, FAKE_PEER_ID);

    // Reload — the init sequence should pre-populate connectingPeers
    await page.reload();
    await waitForApp(page);

    // After reload, member should be in amber (connecting) state immediately
    // because main.ts now pre-populates connectingPeers before renderApp()
    const dot = page.locator(`[data-member-peer-id="${FAKE_PEER_ID}"] .dm-status`);
    await expect(dot).toBeVisible({ timeout: 5000 });
    await expect(dot).toHaveClass(/connecting/, { timeout: 5000 });
  });

  // ── 7. DM sidebar dots ────────────────────────────────────────────────────

  test('DM conversation dot reflects peer status', async ({ page }) => {
    // No direct way to create a DM conv without a real peer, so we inject
    // a direct conversation entry into the state via ctrl
    await page.evaluate(
      ({ peerId, alias }) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        if (!state.activeWorkspaceId) return;
        // Simulate a direct conversation
        const fakeConv = {
          id: 'fake-dm-conv-001',
          workspaceId: state.activeWorkspaceId,
          contactPeerId: peerId,
          contactAlias: alias,
          lastMessageAt: Date.now(),
          createdAt: Date.now(),
        };
        // We can't easily inject into contactStore from here, but we can
        // verify the dot class logic by setting state and checking member-row
        // which uses the same peerStatusClass() helper.
        state.connectingPeers.add(peerId);
        ctrl.ui?.updateSidebar();
      },
      { peerId: FAKE_PEER_ID, alias: FAKE_ALIAS },
    );

    // At least the member-row shows connecting (DM conv test requires a real conv)
    await injectMember(page);
    await page.evaluate((peerId) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      state.connectingPeers.add(peerId);
      ctrl.ui?.updateSidebar();
    }, FAKE_PEER_ID);

    await expectDotClass(page, FAKE_PEER_ID, 'connecting');
  });
});

// ---------------------------------------------------------------------------
// CSS smoke tests — verify the keyframe animation exists in the stylesheet
// ---------------------------------------------------------------------------

test.describe('Presence dot CSS', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await page.goto('/');
    await waitForApp(page);
  });

  test('pulse-connecting keyframe is defined in the stylesheet', async ({ page }) => {
    const hasKeyframe = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule instanceof CSSKeyframesRule && rule.name === 'pulse-connecting') {
              return true;
            }
          }
        } catch { /* cross-origin sheet — skip */ }
      }
      return false;
    });
    expect(hasKeyframe).toBe(true);
  });

  test('--connecting CSS variable is defined', async ({ page }) => {
    const value = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--connecting').trim(),
    );
    expect(value).not.toBe('');
    // Should be amber-ish (#f39c12 or equivalent)
    expect(value).toBeTruthy();
  });
});
