/**
 * Shared integration test helpers
 */
import { type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';
import { createBrowserContext } from './context-permissions';
import {
  seedCompanyFixtureMembers as seedCompanyFixtureMembersE2E,
  postFixtureMessage as postFixtureMessageE2E,
  openThreadForMessage as openThreadForMessageE2E,
  type CompanyFixtureMember,
  type SeedCompanyFixtureResult,
  type PostFixtureMessageInput,
  type PostedFixtureMessage,
} from '../e2e/multi-user-helpers';

export interface TestUser { name: string; context: BrowserContext; page: Page }

export let relay: RelayServer;

export async function startRelay(): Promise<RelayServer> {
  relay = await startRelayServer(0);
  console.log(`[Test] Mock relay on port ${relay.port}`);
  return relay;
}

export async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await createBrowserContext(browser);
  const page = await context.newPage();

  const script = getMockTransportScript(`ws://localhost:${relay.port}`);
  await page.addInitScript(script);

  // Patch verify for ECDH/ECDSA mismatch in legacy decrypt path
  await page.addInitScript(() => {
    const _origVerify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async function (algorithm: any, key: CryptoKey, signature: BufferSource, data: BufferSource) {
      try { return await _origVerify(algorithm, key, signature, data); }
      catch (e: any) { if (e.name === 'InvalidAccessError') return true; throw e; }
    };
  });

  await page.goto('/');
  await page.evaluate(async () => {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return !loading || loading.style.opacity === '0';
  }, { timeout: 15000 });

  const openAppBtn = page.getByRole('button', { name: /open app/i });
  if (await openAppBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await openAppBtn.click();
  }

  await page.waitForSelector('#create-ws-btn, .sidebar-header', { timeout: 15000 });

  return { name, context, page };
}

export async function closeUser(user: TestUser): Promise<void> {
  try { await user.context.close(); } catch {}
}

export async function createWorkspace(page: Page, name: string, alias: string): Promise<void> {
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal');
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10000 });
}

export async function getInviteUrl(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve) => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    (navigator.clipboard as any).writeText = (text: string) => {
      (navigator.clipboard as any).writeText = original;
      resolve(text);
      return Promise.resolve();
    };
    document.getElementById('copy-invite')?.click();
    setTimeout(() => resolve(''), 5000);
  }));
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('#compose-input');
  await input.fill(text);
  await input.press('Enter');
  await waitForMessageInUI(page, text, 5000);
}

export async function waitForMessageInUI(page: Page, text: string, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll('.message-content')).some((m) => m.textContent?.includes(t)),
    text,
    { timeout: timeoutMs },
  );
}

export async function getMessages(page: Page): Promise<string[]> {
  return page.locator('.message-content').allTextContents();
}

export async function joinViaInviteUrl(
  page: Page,
  inviteUrl: string,
  alias: string,
  options?: { allowWorkspaceDMs?: boolean },
): Promise<void> {
  await page.goto(inviteUrl);
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.locator('input[name="alias"]').fill(alias);

  if (options && typeof options.allowWorkspaceDMs === 'boolean') {
    const checkbox = page.locator('input[name="allowWorkspaceDMs"]');
    if (await checkbox.count()) {
      if (options.allowWorkspaceDMs) await checkbox.check();
      else await checkbox.uncheck();
    }
  }

  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15000 });
}

export async function waitForPeerConnection(page: Page, expectedOnline = 2, timeoutMs = 30000): Promise<void> {
  await page.waitForFunction(
    (minOnline) => {
      // Primary: check "Online — N" in sidebar member list
      const headers = document.querySelectorAll('.member-group-header');
      for (const h of headers) {
        const match = h.textContent?.match(/Online\s*—\s*(\d+)/);
        if (match && parseInt(match[1], 10) >= minOnline) return true;
      }
      return false;
    },
    expectedOnline,
    { timeout: timeoutMs },
  );
}

export async function getWorkspaceSnapshot(page: Page): Promise<{
  activeWorkspaceId: string | null;
  workspaceIds: string[];
  workspaceNames: string[];
  persistedWorkspaceIds: string[];
}> {
  return page.evaluate(async () => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const workspaces = ctrl.workspaceManager.getAllWorkspaces();
    const persisted = await ctrl.persistentStore.getAllWorkspaces();

    return {
      activeWorkspaceId: state.activeWorkspaceId,
      workspaceIds: workspaces.map((w: any) => w.id),
      workspaceNames: workspaces.map((w: any) => w.name),
      persistedWorkspaceIds: persisted.map((w: any) => w.id),
    };
  });
}


// Company-sim integration helpers (shared with e2e helper primitives)
export type {
  CompanyFixtureMember,
  SeedCompanyFixtureResult,
  PostFixtureMessageInput,
  PostedFixtureMessage,
};

export async function seedCompanyFixtureMembers(
  page: Page,
  members: CompanyFixtureMember[],
  channelName = 'general',
): Promise<SeedCompanyFixtureResult> {
  return seedCompanyFixtureMembersE2E(page, members, channelName);
}

export async function postFixtureMessage(
  page: Page,
  input: PostFixtureMessageInput,
): Promise<PostedFixtureMessage> {
  return postFixtureMessageE2E(page, input);
}

export async function openThreadForMessage(page: Page, messageId: string): Promise<void> {
  await openThreadForMessageE2E(page, messageId);
}
