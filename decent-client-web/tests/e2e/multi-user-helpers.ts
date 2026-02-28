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
export async function waitForPeerConnection(page: Page, timeoutMs = 30000): Promise<void> {
  await page.waitForFunction(
    () => {
      const state = (window as any).__state;
      const connected = state?.connectedPeers && typeof state.connectedPeers.size === 'number' && state.connectedPeers.size > 0;
      if (connected) return true;

      const toasts = document.querySelectorAll('.toast');
      return Array.from(toasts).some(t =>
        t.textContent?.includes('Encrypted connection') ||
        t.textContent?.includes('🔐'),
      );
    },
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
