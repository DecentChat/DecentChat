/**
 * Multi-User E2E Test Helpers
 *
 * Utilities for multi-browser-context tests where multiple users
 * interact via a real PeerJS signaling server.
 */

import { Page, BrowserContext, Browser, expect } from '@playwright/test';

// ─── Storage & App State ──────────────────────────────────────────────────────

/** Clear all browser storage (IndexedDB, localStorage, sessionStorage) */
export async function clearStorage(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();

    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) indexedDB.deleteDatabase(db.name);
        }
      }
    } catch {}
  });
}

/** Wait for the app to finish loading */
export async function waitForApp(page: Page): Promise<void> {
  const readySelector = '#create-ws-btn, #join-ws-btn, .sidebar-header, #compose-input';

  const waitReady = async (timeout: number) => {
    await page.waitForFunction(() => {
      const ready = !!document.querySelector('#create-ws-btn, #join-ws-btn, .sidebar-header, #compose-input');
      if (ready) return true;
      const loading = document.getElementById('loading') as HTMLElement | null;
      if (!loading) return true;
      const style = window.getComputedStyle(loading);
      return loading.style.opacity === '0' || loading.style.display === 'none' || style.display === 'none' || style.visibility === 'hidden';
    }, { timeout });

    await page.waitForSelector(readySelector, { timeout });
  };

  try {
    await waitReady(18000);
  } catch {
    if (page.isClosed()) throw new Error('page closed while waiting for app');
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitReady(18000);
  }
}

// ─── User Context Management ─────────────────────────────────────────────────

export interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** Create a fresh user with isolated browser context */
export async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await clearStorage(page);
  await waitForApp(page);
  return { name, context, page };
}

/** Close and clean up a test user */
export async function closeUser(user: TestUser): Promise<void> {
  await user.context.close();
}

// ─── Workspace Operations ─────────────────────────────────────────────────────

/** Create a workspace and return to main app view */
export async function createWorkspace(page: Page, name = 'Test Workspace', alias = 'Tester'): Promise<void> {
  if (!page.url().includes('/app')) {
    await page.goto('/app');
  }
  await waitForApp(page);

  // If a stale modal exists, close it first.
  const staleCancel = page.locator('.modal .btn-secondary').first();
  if (await staleCancel.count()) {
    await staleCancel.click().catch(() => {});
  }

  // Open create modal from app nav for deterministic behavior.
  await page.locator('#create-ws-btn-nav').click();
  await page.getByRole('heading', { name: 'Create Workspace' }).waitFor({ state: 'visible', timeout: 10000 });

  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

/** Create a workspace and capture the invite URL via clipboard interception */
export async function createWorkspaceAndGetInvite(
  page: Page,
  name: string,
  alias: string,
): Promise<string> {
  await createWorkspace(page, name, alias);

  // Capture invite URL by intercepting clipboard.writeText
  const inviteUrl = await page.evaluate(() => {
    return new Promise<string>((resolve) => {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      (navigator.clipboard as any).writeText = (text: string) => {
        (navigator.clipboard as any).writeText = original;
        resolve(text);
        return Promise.resolve();
      };
      document.getElementById('copy-invite')?.click();
      setTimeout(() => resolve(''), 3000);
    });
  });

  return inviteUrl;
}

/** Join a workspace via invite URL */
export async function joinViaInvite(page: Page, inviteUrl: string, alias: string): Promise<void> {
  await page.goto(inviteUrl);
  await waitForApp(page);

  // Invite routes show a prefilled join modal with alias input.
  const aliasInput = page.locator('input[name="alias"]');
  await aliasInput.waitFor({ state: 'visible', timeout: 10000 });
  await aliasInput.fill(alias);
  await page.click('.modal .btn-primary');

  // Wait for workspace to load.
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
}

// ─── Messaging ────────────────────────────────────────────────────────────────

/** Send a message in the current channel */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('#compose-input');
  const beforeCount = await page.locator('.message-content').count();
  await input.fill(text);
  await input.press('Enter');

  // Avoid exact-text matching here (special chars/newline normalization can differ).
  await page.waitForFunction(
    (countBefore) => document.querySelectorAll('.message-content').length > countBefore,
    beforeCount,
    { timeout: 8000 },
  );
}

/** Get all visible message texts */
export async function getMessages(page: Page): Promise<string[]> {
  const texts = await page.locator('.message-content').allTextContents();
  return texts.map((t) => t.trim()).filter(Boolean);
}

/** Wait for a specific message to appear in the message list */
export async function waitForMessage(page: Page, text: string, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    (t) => {
      const msgs = document.querySelectorAll('.message-content');
      return Array.from(msgs).some(el => el.textContent?.includes(t));
    },
    text,
    { timeout: timeoutMs },
  );
}

/** Wait for a message count to reach at least N */
export async function waitForMessageCount(page: Page, count: number, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    (n) => document.querySelectorAll('.message-content').length >= n,
    count,
    { timeout: timeoutMs },
  );
}

// ─── Peer Connection ──────────────────────────────────────────────────────────

/** Wait for successful P2P handshake (connectedPeers > 0); toast is fallback for older builds */
export async function waitForPeerConnection(page: Page, expectedOnline = 2, timeoutMs = 30000): Promise<void> {
  await page.waitForFunction(
    (min: number) => {
      const headers = document.querySelectorAll('.member-group-header');
      for (const h of headers) {
        const match = h.textContent?.match(/Online\s*—\s*(\d+)/);
        if (match && parseInt(match[1], 10) >= min) return true;
      }
      return false;
    },
    expectedOnline,
    { timeout: timeoutMs },
  );
}

/** Wait for peer count in sidebar to show N connected peers */
export async function waitForPeerCount(page: Page, count: number, timeoutMs = 30000): Promise<void> {
  // The sidebar shows connected peer count — wait for it to update
  await page.waitForFunction(
    (n) => {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return false;
      const peerIndicators = sidebar.querySelectorAll('.peer-indicator, .peer-status, .online-dot');
      return peerIndicators.length >= n;
    },
    count,
    { timeout: timeoutMs },
  );
}

// ─── Channel Operations ──────────────────────────────────────────────────────

/** Click on a channel in the sidebar */
export async function switchChannel(page: Page, channelName: string): Promise<void> {
  await page.click(`.sidebar-channel:has-text("${channelName}")`);
  await page.waitForTimeout(300); // Small delay for channel switch
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

/** Check if typing indicator is visible */
export async function isTypingIndicatorVisible(page: Page): Promise<boolean> {
  const el = page.locator('#typing-indicator');
  const isVisible = await el.evaluate((e) => e.classList.contains('visible')).catch(() => false);
  return isVisible;
}

/** Get typing indicator text */
export async function getTypingIndicatorText(page: Page): Promise<string> {
  return page.locator('#typing-indicator').textContent() || '';
}

// ─── Reactions ────────────────────────────────────────────────────────────────

/** Add a reaction to a message by hovering and clicking */
export async function addReaction(page: Page, messageIndex: number, emoji: string): Promise<void> {
  const message = page.locator('.message').nth(messageIndex);
  await message.hover();
  // Click the quick reaction button
  await message.locator(`.reaction-btn[data-emoji="${emoji}"], .quick-reaction`).first().click();
  await page.waitForTimeout(300);
}

/** Get reaction pills for a message */
export async function getReactionPills(page: Page, messageIndex: number): Promise<string[]> {
  const message = page.locator('.message').nth(messageIndex);
  return message.locator('.reaction-pill').allTextContents();
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

/** Wait for a toast notification with specific text */
export async function waitForToast(page: Page, text: string, timeoutMs = 10000): Promise<void> {
  await page.waitForFunction(
    (t) => {
      const toasts = document.querySelectorAll('.toast');
      return Array.from(toasts).some(el => el.textContent?.includes(t));
    },
    text,
    { timeout: timeoutMs },
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Open settings panel */
export async function openSettings(page: Page): Promise<void> {
  await page.click('#settings-btn');
  await page.waitForSelector('.settings-modal', { timeout: 3000 });
}

/** Close any open modal */
export async function closeModal(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 3000 }).catch(() => {});
}


// ─── Company Simulation Fixtures ─────────────────────────────────────────────

export interface CompanyFixtureProfile {
  automationKind?: string;
  roleTitle?: string;
  teamId?: string;
  managerPeerId?: string;
  avatarUrl?: string;
}

export interface CompanyFixtureMember {
  peerId: string;
  alias: string;
  role?: 'owner' | 'admin' | 'member';
  companySim?: CompanyFixtureProfile;
}

export interface SeedCompanyFixtureResult {
  workspaceId: string;
  channelId: string;
  channelName: string;
}

export interface PostFixtureMessageInput {
  senderId: string;
  content: string;
  channelId?: string;
  threadId?: string;
  senderAlias?: string;
}

export interface PostedFixtureMessage {
  id: string;
  channelId: string;
  threadId: string | null;
  senderId: string;
  senderName: string;
}

/** Ensure workspace contains deterministic company-sim fixture members */
export async function seedCompanyFixtureMembers(
  page: Page,
  members: CompanyFixtureMember[],
  channelName = 'general',
): Promise<SeedCompanyFixtureResult> {
  return page.evaluate(({ membersArg, channelNameArg }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;

    if (!state?.activeWorkspaceId) throw new Error('No active workspace in test session');
    const ws = ctrl?.workspaceManager?.getWorkspace(state.activeWorkspaceId);
    if (!ws) throw new Error(`Workspace ${state.activeWorkspaceId} not found`);

    if (!Array.isArray(ws.members)) ws.members = [];

    for (const member of membersArg) {
      let existing = ws.members.find((m: any) => m.peerId === member.peerId);
      if (!existing) {
        existing = {
          peerId: member.peerId,
          alias: member.alias,
          publicKey: `pk-${member.peerId}`,
          signingPublicKey: `spk-${member.peerId}`,
          identityId: member.peerId,
          devices: [],
          role: member.role ?? 'member',
        };
        ws.members.push(existing);
      }

      existing.alias = member.alias;
      if (member.role) existing.role = member.role;
      if (member.companySim) {
        existing.companySim = {
          ...(existing.companySim ?? {}),
          ...member.companySim,
        };
      }
    }

    const channel = (ws.channels || []).find((c: any) => c.name === channelNameArg) || ws.channels?.[0];
    if (!channel) throw new Error(`No channel found for ${channelNameArg}`);

    return {
      workspaceId: ws.id,
      channelId: channel.id,
      channelName: channel.name,
    };
  }, { membersArg: members, channelNameArg: channelName });
}

/** Inject a local message as a seeded fixture member (no network dependency). */
export async function postFixtureMessage(
  page: Page,
  input: PostFixtureMessageInput,
): Promise<PostedFixtureMessage> {
  return page.evaluate(async ({ payload }) => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;

    if (!ctrl?.messageStore) throw new Error('Chat controller messageStore unavailable');

    const channelId = payload.channelId || state?.activeChannelId;
    if (!channelId) throw new Error('No active channel available for fixture message');

    const ws = state?.activeWorkspaceId
      ? ctrl.workspaceManager?.getWorkspace(state.activeWorkspaceId)
      : null;

    const member = ws?.members?.find((m: any) => m.peerId === payload.senderId);
    const senderName = payload.senderAlias || member?.alias || payload.senderId;

    const msg = await ctrl.messageStore.createMessage(
      channelId,
      payload.senderId,
      payload.content,
      'text',
      payload.threadId || undefined,
    );

    const existingMessages = ctrl.messageStore.getMessages(channelId);
    const previous = existingMessages[existingMessages.length - 1];
    if (previous && msg.timestamp <= previous.timestamp) {
      msg.timestamp = previous.timestamp + 1;
    }

    (msg as any).senderName = senderName;
    (msg as any).status = 'sent';

    const added = await ctrl.messageStore.addMessage(msg);
    if (!added?.success) {
      throw new Error(`Failed to add fixture message: ${added?.error || 'unknown error'}`);
    }

    ctrl.ui?.renderMessages?.();
    if (payload.threadId && state?.threadOpen && state?.activeThreadId === payload.threadId) {
      ctrl.ui?.renderThreadMessages?.();
    }

    return {
      id: msg.id,
      channelId,
      threadId: msg.threadId ?? null,
      senderId: msg.senderId,
      senderName,
    };
  }, { payload: input });
}

/** Open a thread from the channel message list using stable test ids. */
export async function openThreadForMessage(page: Page, messageId: string): Promise<void> {
  const root = page.locator(`[data-testid="message"][data-message-id="${messageId}"]`);
  await expect(root, `message ${messageId} should exist before opening thread`).toHaveCount(1);

  const threadIndicator = root.locator(`.message-thread-indicator[data-thread-id="${messageId}"]`);
  await threadIndicator.click({ force: true });

  const panel = page.getByTestId('thread-panel');
  await expect(panel).toBeVisible();
}
