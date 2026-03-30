import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startRelayServer, type RelayServer } from '../mocks/mock-relay-server';
import { getMockTransportScript } from '../mocks/MockTransport';
import { createBrowserContext } from '../integration/context-permissions';

let relay: RelayServer;

test.beforeAll(async () => {
  relay = await startRelayServer(0);
});

test.afterAll(async () => {
  relay?.close();
});

interface TestUser {
  name: string;
  context: BrowserContext;
  page: Page;
}

async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    if (!loading) return true;
    return (loading as HTMLElement).style.opacity === '0';
  }, { timeout: 15_000 });
  await page.waitForSelector('#create-ws-btn, .sidebar-header, #compose-input', { timeout: 15_000 });
}

async function createUser(browser: Browser, name: string): Promise<TestUser> {
  const context = await createBrowserContext(browser);
  const page = await context.newPage();

  await page.addInitScript(getMockTransportScript(`ws://localhost:${relay.port}`));
  await page.addInitScript(() => {
    const orig = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async (alg: any, key: CryptoKey, sig: BufferSource, data: BufferSource) => {
      try {
        return await orig(alg, key, sig, data);
      } catch (error: any) {
        if (error?.name === 'InvalidAccessError') return true;
        throw error;
      }
    };
  });

  await page.goto('/?_cb=' + Date.now());
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        await reg.unregister();
      }
    }
    if ('caches' in window) {
      const names = await caches.keys();
      for (const name of names) {
        await caches.delete(name);
      }
    }
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);
  return { name, context, page };
}

async function closeUser(user: TestUser): Promise<void> {
  await user.context.close().catch(() => {});
}

async function createWorkspace(page: Page, name: string, alias: string): Promise<void> {
  if (!page.url().includes('/app')) {
    await page.goto('/app');
    await waitForApp(page);
  }
  await page.click('#create-ws-btn');
  await page.waitForSelector('.modal', { timeout: 10_000 });
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 10_000 });
}

async function getInviteUrl(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve) => {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    (navigator.clipboard as any).writeText = (text: string) => {
      (navigator.clipboard as any).writeText = orig;
      resolve(text);
      return Promise.resolve();
    };
    document.getElementById('copy-invite')?.click();
    setTimeout(() => resolve(''), 5_000);
  }));
}

async function joinViaUrl(page: Page, url: string, alias: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('.modal', { timeout: 10_000 });
  await page.locator('input[name="alias"]').fill(alias);
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar-header', { timeout: 15_000 });
}

async function waitForPeerConnection(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(() => {
    const state = (window as any).__state;
    return state?.connectedPeers && state.connectedPeers.size > 0;
  }, { timeout: timeoutMs });
}

async function waitForTextInMessages(page: Page, text: string, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    (t) => Array.from(document.querySelectorAll('.message-content')).some((el) => el.textContent?.includes(t)),
    text,
    { timeout: timeoutMs },
  );
}

async function sendMessageUI(page: Page, text: string): Promise<void> {
  await page.locator('#compose-input').fill(text);
  await page.locator('#compose-input').press('Enter');
  await waitForTextInMessages(page, text, 10_000);
}

async function getMyPeerId(page: Page): Promise<string> {
  return page.evaluate(() => String((window as any).__state?.myPeerId || ''));
}

async function waitForReceiptFromPeer(page: Page, content: string, peerId: string, timeoutMs = 45_000): Promise<void> {
  const hasReceiptFromPeer = async (): Promise<boolean> => {
    return page.evaluate(
      ({ content: expectedContent }) => {
        const ctrl = (window as any).__ctrl;
        const state = (window as any).__state;
        const channelId = state?.activeChannelId;
        if (!ctrl?.messageStore || !channelId || !state?.myPeerId) return false;
        const messages = ctrl.messageStore.getMessages(channelId) || [];
        const msg = messages.find((candidate: any) => candidate.senderId === state.myPeerId && String(candidate.content || '') === expectedContent);
        if (!msg) return false;
        const ackedBy = Array.isArray(msg.ackedBy) ? msg.ackedBy : [];
        const readBy = Array.isArray(msg.readBy) ? msg.readBy : [];
        return ackedBy.length > 0 || readBy.length > 0;
      },
      { content },
    );
  };

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await hasReceiptFromPeer()) return;

    await page.evaluate(async ({ targetPeerId, expectedContent }) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      if (!ctrl) return;

      try {
        const channelId = state?.activeChannelId;
        const workspaceId = state?.activeWorkspaceId;
        const myPeerId = state?.myPeerId;
        if (!channelId || !myPeerId || !ctrl?.messageStore) return;

        const messages = ctrl.messageStore.getMessages(channelId) || [];
        const msg = messages.find((candidate: any) => candidate.senderId === myPeerId && String(candidate.content || '') === expectedContent);
        if (!msg) return;

        const replayPeerId = typeof targetPeerId === 'string' && targetPeerId.length > 0
          ? targetPeerId
          : (Array.isArray(msg.recipientPeerIds) ? String(msg.recipientPeerIds[0] || '') : '');
        if (!replayPeerId) return;

        ctrl.runPeerMaintenanceNow?.('queued-receipt-wait');
        try {
          await (ctrl as any).retryUnackedOutgoingForPeer?.(replayPeerId);
        } catch {}
        try {
          await (ctrl as any).flushOfflineQueue?.(replayPeerId, { bypassCooldown: true });
        } catch {}

        const envelope = await ctrl.encryptMessageWithPreKeyBootstrap(replayPeerId, String(msg.content || ''), workspaceId || undefined);
        envelope.channelId = msg.channelId;
        envelope.workspaceId = workspaceId;
        envelope.threadId = msg.threadId;
        envelope.vectorClock = msg.vectorClock;
        envelope.messageId = msg.id;

        if (typeof ctrl.signGossipOrigin === 'function') {
          const signature = await ctrl.signGossipOrigin({
            messageId: msg.id,
            channelId: msg.channelId,
            content: String(msg.content || ''),
            threadId: msg.threadId,
          });
          if (signature) {
            envelope._gossipOriginSignature = signature;
          }
        }

        ctrl.transport?.send?.(replayPeerId, envelope);
      } catch {}
    }, { targetPeerId: peerId, expectedContent: content });

    await page.waitForTimeout(1_200);
  }

  throw new Error(`Timed out waiting for any receipt (target ${peerId.slice(0, 8)}) for message ${content}`);
}

async function getPendingRecipientsForMessage(page: Page, content: string): Promise<string[]> {
  return page.evaluate((expectedContent: string) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    const channelId = state?.activeChannelId;
    if (!ctrl?.messageStore || !channelId || !state?.myPeerId) return [];
    const messages = ctrl.messageStore.getMessages(channelId) || [];
    const msg = messages.find((candidate: any) => candidate.senderId === state.myPeerId && String(candidate.content || '') === expectedContent);
    if (!msg) return [];
    const recipients = Array.isArray(msg.recipientPeerIds) ? msg.recipientPeerIds.filter((id: unknown) => typeof id === 'string' && id.length > 0) : [];
    const ackedBy = new Set<string>(Array.isArray(msg.ackedBy) ? msg.ackedBy : []);
    const readBy = new Set<string>(Array.isArray(msg.readBy) ? msg.readBy : []);
    return recipients.filter((id: string) => !ackedBy.has(id) && !readBy.has(id));
  }, content);
}

async function injectAckForMessage(page: Page, content: string, preferredPeerId?: string): Promise<void> {
  await page.evaluate(async ({ expectedContent, preferredPeer }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    const transport = (window as any).__transport;
    const channelId = state?.activeChannelId;
    const myPeerId = state?.myPeerId;
    if (!ctrl?.messageStore || !channelId || !myPeerId || !transport?.onMessage) return;

    const messages = ctrl.messageStore.getMessages(channelId) || [];
    const msg = messages.find((candidate: any) => candidate.senderId === myPeerId && String(candidate.content || '') === expectedContent);
    if (!msg) return;

    const recipients = Array.isArray(msg.recipientPeerIds)
      ? msg.recipientPeerIds.filter((id: unknown) => typeof id === 'string' && id.length > 0)
      : [];
    const receiptPeerId = (typeof preferredPeer === 'string' && preferredPeer.length > 0)
      ? preferredPeer
      : String(recipients[0] || '');
    if (!receiptPeerId) return;

    await transport.onMessage(receiptPeerId, {
      type: 'ack',
      channelId: msg.channelId,
      messageId: msg.id,
    });
  }, { expectedContent: content, preferredPeer: preferredPeerId || '' });
}

async function startDeliveryStatusTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const records: Array<{
      messageId: string;
      content: string;
      statusClass: string;
      tooltip: string;
      symbol: string;
      detail: string;
      at: number;
    }> = [];
    const seen = new Set<string>();

    const capture = () => {
      const statusNodes = document.querySelectorAll('.msg-delivery-status[data-message-id]');
      for (const node of Array.from(statusNodes)) {
        const el = node as HTMLElement;
        const messageId = el.getAttribute('data-message-id') || '';
        if (!messageId) continue;

        const row = el.closest('.message') as HTMLElement | null;
        const content = (row?.querySelector('.message-content') as HTMLElement | null)?.textContent?.trim() || '';
        const detailNode = row?.querySelector(`.msg-delivery-detail[data-message-id="${messageId}"]`) as HTMLElement | null;
        const detail = detailNode?.textContent?.trim() || '';
        const tooltip = el.getAttribute('data-tooltip') || '';
        const symbol = (el.textContent || '').trim();
        const statusClass = ['pending', 'sent', 'delivered', 'read'].find((cls) => el.classList.contains(cls)) || 'unknown';

        const dedupKey = `${messageId}|${statusClass}|${tooltip}|${symbol}|${detail}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        records.push({
          messageId,
          content,
          statusClass,
          tooltip,
          symbol,
          detail,
          at: Date.now(),
        });
      }
    };

    capture();
    const observer = new MutationObserver(() => capture());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-tooltip'],
    });

    const interval = setInterval(capture, 60);
    (window as any).__deliveryStatusTrace = { records };
    (window as any).__stopDeliveryStatusTrace = () => {
      clearInterval(interval);
      observer.disconnect();
      capture();
    };
  });
}

async function stopDeliveryStatusTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (typeof (window as any).__stopDeliveryStatusTrace === 'function') {
      (window as any).__stopDeliveryStatusTrace();
    }
  });
}

async function getDeliveryStatusHistory(page: Page, content: string): Promise<Array<{ statusClass: string; tooltip: string; at: number }>> {
  return page.evaluate((expectedContent: string) => {
    const trace = (window as any).__deliveryStatusTrace;
    const records = Array.isArray(trace?.records) ? trace.records : [];
    return records
      .filter((entry: any) => String(entry?.content || '') === expectedContent)
      .map((entry: any) => ({
        statusClass: String(entry?.statusClass || 'unknown'),
        tooltip: String(entry?.tooltip || ''),
        at: Number(entry?.at || 0),
      }))
      .sort((a: any, b: any) => a.at - b.at);
  }, content);
}

test.describe('Queued delivery refresh regression', () => {
  test('duplicate replay ACK resolves pending and does not show queued-delivery toast after refresh', async ({ browser }) => {
    test.setTimeout(180_000);

    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Queued Refresh', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);

      const bobPeerId = await getMyPeerId(bob.page);

      await bob.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const original = ctrl.sendInboundReceipt.bind(ctrl);
        (window as any).__dropReceiptStats = {
          dropped: 0,
          sent: 0,
          events: [] as string[],
        };

        ctrl.sendInboundReceipt = (peerId: string, envelope: any, channelId: string, messageId: string, type: 'ack' | 'read') => {
          const stats = (window as any).__dropReceiptStats;
          const event = `${type}:${messageId}`;
          if ((type === 'ack' || type === 'read') && stats.dropped < 2) {
            stats.dropped += 1;
            stats.events.push(`${event}:dropped`);
            return;
          }
          stats.sent += 1;
          stats.events.push(`${event}:sent`);
          return original(peerId, envelope, channelId, messageId, type);
        };
      });

      await bob.context.setOffline(true);
      await alice.page.waitForTimeout(2_000);

      const content = `queued-refresh-${Date.now()}`;
      await sendMessageUI(alice.page, content);

      await bob.context.setOffline(false);
      await bob.page.waitForFunction(() => (window as any).__transport?._ws?.readyState === 1, { timeout: 30_000 });
      await bob.page.waitForTimeout(200);

      await alice.page.evaluate(() => (window as any).__ctrl?.runPeerMaintenanceNow?.('queued-refresh-regression'));

      await alice.page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('.toast')).some((el) => {
          const text = String(el.textContent || '');
          return text.includes('Delivered') && text.includes('queued message');
        });
      }, { timeout: 30_000 });

      await waitForTextInMessages(bob.page, content, 30_000);
      await injectAckForMessage(alice.page, content, bobPeerId);
      await expect.poll(async () => {
        return (await getPendingRecipientsForMessage(alice.page, content)).length;
      }, { timeout: 15_000 }).toBe(0);

      const pendingBeforeRefresh = await getPendingRecipientsForMessage(alice.page, content);
      expect(pendingBeforeRefresh.length).toBe(0);

      await alice.page.addInitScript(() => {
        (window as any).__queuedDeliveryToastHits = [] as string[];
        const seen = new Set<string>();

        const capture = () => {
          const arr = (window as any).__queuedDeliveryToastHits as string[];
          const toasts = document.querySelectorAll('.toast');
          for (const toast of Array.from(toasts)) {
            const text = String(toast.textContent || '').trim();
            if (!text) continue;
            if (!text.includes('queued message')) continue;
            if (seen.has(text)) continue;
            seen.add(text);
            arr.push(text);
          }
        };

        document.addEventListener('DOMContentLoaded', () => {
          capture();
          const observer = new MutationObserver(() => capture());
          observer.observe(document.documentElement, { childList: true, subtree: true });
          setTimeout(() => observer.disconnect(), 15_000);
        });
      });

      await alice.page.reload({ waitUntil: 'domcontentloaded' });
      await waitForApp(alice.page);
      await waitForPeerConnection(alice.page, 45_000);
      await alice.page.waitForTimeout(7_000);

      const queuedToastsAfterRefresh = await alice.page.evaluate(() => (window as any).__queuedDeliveryToastHits || []);
      expect(queuedToastsAfterRefresh).toEqual([]);

      const pendingAfterRefresh = await getPendingRecipientsForMessage(alice.page, content);
      expect(pendingAfterRefresh.length).toBe(0);
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });

  test('status badge transitions pending/sent to delivered in duplicate replay flow', async ({ browser }) => {
    test.setTimeout(180_000);

    const alice = await createUser(browser, 'Alice');
    const bob = await createUser(browser, 'Bob');

    try {
      await createWorkspace(alice.page, 'Queued Status Flow', 'Alice');
      const inviteUrl = await getInviteUrl(alice.page);
      await joinViaUrl(bob.page, inviteUrl, 'Bob');
      await waitForPeerConnection(alice.page);
      await waitForPeerConnection(bob.page);

      const bobPeerId = await getMyPeerId(bob.page);

      await alice.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const original = ctrl.queueCustodyEnvelope.bind(ctrl);
        ctrl.queueCustodyEnvelope = async (...args: any[]) => {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return original(...args);
        };
      });

      await bob.page.evaluate(() => {
        const ctrl = (window as any).__ctrl;
        const original = ctrl.sendInboundReceipt.bind(ctrl);
        ctrl.sendInboundReceipt = (peerId: string, envelope: any, channelId: string, messageId: string, type: 'ack' | 'read') => {
          const stats = ((window as any).__statusDropStats ||= { dropped: 0, sent: 0 });
          if ((type === 'ack' || type === 'read') && stats.dropped < 2) {
            stats.dropped += 1;
            return;
          }
          stats.sent += 1;
          return original(peerId, envelope, channelId, messageId, type);
        };
      });

      await startDeliveryStatusTrace(alice.page);

      await bob.context.setOffline(true);
      await alice.page.waitForTimeout(2_000);

      const content = `queued-status-${Date.now()}`;
      await sendMessageUI(alice.page, content);

      const statusNode = alice.page.locator('.message')
        .filter({ has: alice.page.locator('.message-content', { hasText: content }) })
        .last()
        .locator('.msg-delivery-status');
      await expect(statusNode).toBeVisible({ timeout: 10_000 });

      await expect.poll(async () => {
        return await statusNode.evaluate((el) => {
          if (el.classList.contains('pending')) return 'pending';
          if (el.classList.contains('sent')) return 'sent';
          if (el.classList.contains('delivered')) return 'delivered';
          if (el.classList.contains('read')) return 'read';
          return 'unknown';
        });
      }, { timeout: 10_000 }).toMatch(/pending|sent/);

      await bob.context.setOffline(false);
      await bob.page.waitForFunction(() => (window as any).__transport?._ws?.readyState === 1, { timeout: 30_000 });
      await bob.page.waitForTimeout(200);
      await alice.page.evaluate(() => (window as any).__ctrl?.runPeerMaintenanceNow?.('queued-status-regression'));

      await waitForTextInMessages(bob.page, content, 30_000);
      await waitForReceiptFromPeer(alice.page, content, bobPeerId, 45_000);

      await expect.poll(async () => {
        return await statusNode.evaluate((el) => {
          if (el.classList.contains('pending')) return 'pending';
          if (el.classList.contains('sent')) return 'sent';
          if (el.classList.contains('delivered')) return 'delivered';
          if (el.classList.contains('read')) return 'read';
          return 'unknown';
        });
      }, { timeout: 30_000 }).toMatch(/delivered|read/);

      await stopDeliveryStatusTrace(alice.page);
      const history = await getDeliveryStatusHistory(alice.page, content);
      const classes = history.map((entry) => entry.statusClass);
      expect(classes).toContain('sent');
      expect(classes.some((cls) => cls === 'delivered' || cls === 'read')).toBe(true);

      const firstDeliveredIdx = classes.findIndex((cls) => cls === 'delivered' || cls === 'read');
      expect(firstDeliveredIdx).toBeGreaterThan(0);
      expect(classes.slice(0, firstDeliveredIdx)).toEqual(expect.arrayContaining(['sent']));
    } finally {
      await closeUser(alice);
      await closeUser(bob);
    }
  });
});
