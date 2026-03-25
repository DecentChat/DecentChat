import { test, expect, type Page } from '@playwright/test';

const RUN_LIVE = process.env.PW_RUN_LIVE_DELIVERY_DEBUG === '1';
const INVITE_URL = process.env.PW_LIVE_INVITE_URL || '';
type Snapshot = {
  myPeerId: string;
  readyPeers: string[];
  connectedPeers: string[];
  activeWorkspaceId: string | null;
  activeChannelId: string | null;
  members: Array<{ peerId: string; alias: string; isBot: boolean; allowWorkspaceDMs: boolean }>;
};

async function getSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const state = (window as any).__state;
    const ctrl = (window as any).__ctrl;
    const wsId = state?.activeWorkspaceId ?? null;
    const ws = wsId ? ctrl?.workspaceManager?.getWorkspace?.(wsId) : null;
    const readyPeers = Array.from((state?.readyPeers as Set<string>) || []);
    const connectedPeers = Array.from((ctrl?.transport?.getConnectedPeers?.() as string[]) || []);

    return {
      myPeerId: String(state?.myPeerId || ''),
      readyPeers,
      connectedPeers,
      activeWorkspaceId: wsId,
      activeChannelId: state?.activeChannelId ?? null,
      members: Array.isArray(ws?.members)
        ? ws.members.map((m: any) => ({
            peerId: String(m.peerId || ''),
            alias: String(m.alias || '').trim(),
            isBot: m.isBot === true,
            allowWorkspaceDMs: m.allowWorkspaceDMs !== false,
          }))
        : [],
    };
  });
}

async function sendProbeAndReadStatus(page: Page, text: string): Promise<{
  statusSymbol: string;
  statusTooltip: string;
  statusDetail: string;
  sentAt: number;
}> {
  const sentAt = Date.now();
  await page.locator('#compose-input').fill(text);
  await page.locator('#compose-input').press('Enter');

  const messageRow = page.locator('.message').filter({
    has: page.locator('.message-content', { hasText: text }),
  }).last();
  await expect(messageRow).toBeVisible({ timeout: 15000 });

  // Allow async acks/read receipts to land.
  await page.waitForTimeout(4500);

  const status = messageRow.locator('.msg-delivery-status');
  const detail = messageRow.locator('.msg-delivery-detail');

  const statusSymbol = ((await status.textContent()) || '').trim();
  const statusTooltip = (await status.getAttribute('data-tooltip')) || '';
  const statusDetail = (await detail.textContent())?.trim() || '';

  return { statusSymbol, statusTooltip, statusDetail, sentAt };
}

test.setTimeout(240000);

test('live workspace delivery + bot response debug', async ({ page }) => {
  test.skip(!RUN_LIVE, 'Opt in with PW_RUN_LIVE_DELIVERY_DEBUG=1');
  test.skip(!INVITE_URL, 'Set PW_LIVE_INVITE_URL for live debug runs');

  const alias = `PW-Xena-${Date.now().toString().slice(-6)}`;
  const consoleLogs: string[] = [];

  page.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(line);
    if (
      line.includes('Could not connect to peer')
      || line.includes('[Join]')
      || line.includes('[Sync]')
      || line.includes('[Auth]')
      || line.includes('delivery')
    ) {
      console.log(line);
    }
  });

  await page.goto('https://decentchat.app', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Landing/app shell can vary by deployment; keep nudging into app controls.
  const appReady = page.locator('#join-ws-btn, #join-ws-btn-nav, #create-ws-btn, #create-ws-btn-nav').first();
  for (let i = 0; i < 6; i += 1) {
    if (await appReady.isVisible().catch(() => false)) break;

    const startBtn = page.locator('button:has-text("Start Chatting Free"), button:has-text("Open App")').first();
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click();
    } else {
      await page.goto('https://decentchat.app/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForTimeout(1400);
  }

  if (!(await page.locator('#compose-input').isVisible().catch(() => false))) {
    const joinBtn = page.locator('#join-ws-btn, #join-ws-btn-nav, button:has-text("Join workspace"), button:has-text("Join Workspace"), button:has-text("Join with Invite Code")').first();
    await joinBtn.waitFor({ state: 'visible', timeout: 30000 });
    await joinBtn.click();

    await page.locator('.modal').first().waitFor({ state: 'visible', timeout: 20000 });
    const inviteInput = page.locator('.modal input[placeholder*="decentchat.app/join" i], .modal input[placeholder*="Invite" i]').first();
    await inviteInput.fill(INVITE_URL);

    const displayNameInput = page.locator('.modal input[placeholder="Your name"], .modal input[name="alias"], .modal input[placeholder*="Display Name" i]').first();
    await displayNameInput.fill(alias);

    const confirmBtn = page.locator('.modal .btn-primary, .modal button:has-text("Confirm"), .modal button:has-text("Join")').first();
    await confirmBtn.click();
  }

  await page.waitForSelector('#compose-input', { timeout: 45000 });
  await page.waitForTimeout(3500);

  const initial = await getSnapshot(page);
  console.log('[LIVE-DEBUG] Initial snapshot:', JSON.stringify(initial, null, 2));

  const botMember = initial.members.find((m) => m.isBot && m.peerId !== initial.myPeerId && m.allowWorkspaceDMs);
  const mentionTarget = botMember?.alias ? `@${botMember.alias}` : '@bot';

  const channelProbe = `[PW-LIVE-PROBE ${new Date().toISOString()}] channel delivery check`;
  const channelStatus = await sendProbeAndReadStatus(page, channelProbe);
  console.log('[LIVE-DEBUG] Channel status:', JSON.stringify(channelStatus));

  const mentionProbe = `[PW-LIVE-PROBE ${new Date().toISOString()}] ${mentionTarget} can you acknowledge this message?`;
  const mentionStatus = await sendProbeAndReadStatus(page, mentionProbe);
  console.log('[LIVE-DEBUG] Mention status:', JSON.stringify(mentionStatus));

  await page.waitForTimeout(12000);
  const channelReplies = await page.evaluate((sinceTs) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    const channelId = state?.activeChannelId;
    const myPeerId = state?.myPeerId;
    if (!ctrl?.messageStore || !channelId) return [];
    const msgs = ctrl.messageStore.getMessages(channelId) || [];
    return msgs
      .filter((m: any) => Number(m.timestamp || 0) >= sinceTs && m.senderId !== myPeerId)
      .slice(-8)
      .map((m: any) => ({
        senderId: String(m.senderId || ''),
        content: String(m.content || '').slice(0, 160),
        timestamp: Number(m.timestamp || 0),
      }));
  }, mentionStatus.sentAt);
  console.log('[LIVE-DEBUG] Channel replies after mention:', JSON.stringify(channelReplies));

  let dmStatus: { statusSymbol: string; statusTooltip: string; statusDetail: string; sentAt: number } | null = null;
  let dmTargetAlias: string | null = null;

  if (botMember) {
    dmTargetAlias = botMember.alias || botMember.peerId.slice(0, 8);
    const memberRow = page.locator(`[data-member-peer-id="${botMember.peerId}"]`).first();
    await expect(memberRow).toBeVisible({ timeout: 15000 });
    await memberRow.click();

    await expect(page.locator('.channel-header h2')).toContainText(dmTargetAlias, { timeout: 15000 });

    const dmProbe = `[PW-LIVE-PROBE ${new Date().toISOString()}] DM delivery check to ${dmTargetAlias}`;
    dmStatus = await sendProbeAndReadStatus(page, dmProbe);
    console.log('[LIVE-DEBUG] DM status:', JSON.stringify(dmStatus));

    await page.waitForTimeout(12000);
    const dmReplies = await page.evaluate((sinceTs) => {
      const ctrl = (window as any).__ctrl;
      const state = (window as any).__state;
      const channelId = state?.activeChannelId;
      const myPeerId = state?.myPeerId;
      if (!ctrl?.messageStore || !channelId) return [];
      const msgs = ctrl.messageStore.getMessages(channelId) || [];
      return msgs
        .filter((m: any) => Number(m.timestamp || 0) >= sinceTs && m.senderId !== myPeerId)
        .slice(-8)
        .map((m: any) => ({
          senderId: String(m.senderId || ''),
          content: String(m.content || '').slice(0, 160),
          timestamp: Number(m.timestamp || 0),
        }));
    }, dmStatus.sentAt);
    console.log('[LIVE-DEBUG] DM replies:', JSON.stringify(dmReplies));
  } else {
    console.log('[LIVE-DEBUG] No bot member discovered in workspace member list; skipping DM bot probe');
  }

  await page.waitForTimeout(9000);

  const final = await getSnapshot(page);

  const deliveryErrors = consoleLogs.filter((line) =>
    line.includes('Could not connect to peer')
    || line.includes('peer-unavailable')
    || line.includes('Send to')
    || line.includes('Direct message send failed')
    || line.includes('Failed to connect')
  );

  const summary = {
    inviteUrl: INVITE_URL,
    alias,
    dmTargetAlias,
    channelStatus,
    mentionStatus,
    dmStatus,
    initial,
    final,
    deliveryErrors,
    interestingConsole: consoleLogs.filter((line) =>
      line.includes('Could not connect to peer')
      || line.includes('[Join]')
      || line.includes('[Sync]')
      || line.includes('[Auth]')
      || line.includes('[Privacy]')
      || line.includes('Recipient disallows workspace DMs')
    ),
  };

  console.log('[LIVE-DEBUG] SUMMARY', JSON.stringify(summary, null, 2));

  // Basic assertion so the test fails if send path is completely broken.
  expect(channelStatus.statusTooltip.length).toBeGreaterThan(0);
});
