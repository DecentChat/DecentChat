/**
 * Regression test for the "sync import failed" log flood.
 *
 * Symptom: Xena's bridge.log was showing a wall of
 *   [decent-hermes-peer] [decentchat-peer] sync import failed for msg ...
 *   in channel ...: Tampered message history detected: First message has
 *   invalid genesis hash. Expected 000...0, got undefined — skipping ACK
 * on EVERY sync cycle (roughly every 10-30s), from peers stuck on a
 * legacy workspace whose hash chain predates the `prevHash` enforcement.
 *
 * Root cause: `importFailedChannels` was a `Set<string>` scoped to a
 * single `handleMessageSyncResponse` invocation. Each new sync-response
 * got a fresh set, so the "first failure per channel" dedupe reset on
 * every sync cycle. Structurally-unverifiable chains produced a warn
 * forever.
 *
 * Fix asserted here:
 *   1. A message import with `got undefined` in the error emits an INFO
 *      line (not warn) — structural, not tampering.
 *   2. Repeating the exact same failing sync-response within the
 *      suppression window produces ZERO additional log lines for that
 *      (peer, channel) pair.
 *   3. The summary line is also throttled (one per peer per window).
 *   4. A NEW tampered-style failure in a different channel still logs
 *      (we're not swallowing real integrity signals).
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedDecentChatAccount } from '../src/types.js';

const tempDirs: string[] = [];

function makeAccount(dataDir: string): ResolvedDecentChatAccount {
  return {
    accountId: 'test-account',
    enabled: true,
    dmPolicy: 'allow-all',
    configured: true,
    seedPhrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    signalingServer: 'https://0.peerjs.com/',
    invites: [],
    alias: 'SyncImportBot',
    dataDir,
    streamEnabled: true,
    replyToMode: 'off',
    replyToModeByChatType: {},
    thread: {
      historyScope: 'channel',
      inheritParent: true,
      initialHistoryLimit: 100,
    },
  };
}

describe('DecentChatNodePeer sync import failure suppression', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('collapses repeat structural failures to one info per (peer, channel) per window', async () => {
    const { DecentChatNodePeer } = await import(`../src/peer/DecentChatNodePeer.js?real=${Date.now()}`);
    const dataDir = mkdtempSync(join(tmpdir(), 'decent-hermes-syncimport-'));
    tempDirs.push(dataDir);

    const info = mock((_line: string) => {});
    const warn = mock((_line: string) => {});
    const peer = new DecentChatNodePeer({
      account: makeAccount(dataDir),
      onIncomingMessage: async () => {},
      onReply: () => {},
      log: {
        info,
        debug: () => {},
        warn,
        error: () => {},
      },
    });

    // Stub out everything handleMessageSyncResponse touches besides the
    // import-failure logging we're testing.
    (peer as any).myPeerId = 'bridge-peer-id';
    (peer as any).transport = { send: () => true, destroy: () => {} };
    (peer as any).findWorkspaceIdForChannel = () => 'ws-1';
    (peer as any).persistMessagesForChannel = () => {};
    (peer as any).enqueueOffline = async () => {};

    // Force importMessages to always fail with the signature structural
    // error we see from the legacy workspace peer in prod.
    const fakeStore = {
      getMessages: () => [],
      importMessages: async () => ({
        success: false,
        error: 'Tampered message history detected: First message has invalid genesis hash. Expected 000...0, got undefined',
      }),
    };
    (peer as any).messageStore = fakeStore;

    const badBatch = {
      // Intentionally omit workspaceId so handleMessageSyncResponse doesn't
      // bail on the membership check. `findWorkspaceIdForChannel` returns
      // 'ws-1' in our stub, which is all the per-message resolution needs.
      messages: [
        { id: 'msg-00000001', channelId: 'chan-A', senderId: 'peer-remote', content: 'hi', timestamp: 1 },
        { id: 'msg-00000002', channelId: 'chan-A', senderId: 'peer-remote', content: 'there', timestamp: 2 },
      ],
    };

    // First sync-response: should log once per (peer, channel) at INFO level,
    // plus a summary INFO.
    await (peer as any).handleMessageSyncResponse('peer-remote', badBatch);

    const afterFirst = {
      warnCalls: warn.mock.calls.length,
      infoCalls: info.mock.calls.length,
    };
    const firstInfoLines = info.mock.calls.map(([l]: any) => String(l));
    expect(afterFirst.warnCalls).toBe(0); // structural, not tampering
    expect(firstInfoLines.some((l) => l.includes('sync import failed for msg') && l.includes('chan-A'))).toBeTrue();
    expect(firstInfoLines.some((l) => l.includes('sync import summary'))).toBeTrue();

    // Second sync-response immediately after with the EXACT same bad
    // messages: no NEW failure-related log lines should appear. (The
    // top-of-function "message-sync-response from ... N messages" info
    // line fires every call — that's fine, it's not the flood we're
    // fixing.) The assertion targets the import-failure lines and the
    // summary line specifically.
    info.mockClear();
    warn.mockClear();
    await (peer as any).handleMessageSyncResponse('peer-remote', badBatch);
    await (peer as any).handleMessageSyncResponse('peer-remote', badBatch);
    await (peer as any).handleMessageSyncResponse('peer-remote', badBatch);
    const repeatInfoLines = info.mock.calls.map(([l]: any) => String(l));
    const repeatWarnLines = warn.mock.calls.map(([l]: any) => String(l));
    const repeatFailureLines = [...repeatInfoLines, ...repeatWarnLines].filter(
      (l) => l.includes('sync import failed') || l.includes('sync import summary'),
    );
    expect(repeatFailureLines).toHaveLength(0);

    // A NEW channel in the same batch still gets its own first-fail line.
    info.mockClear();
    const badBatchNewChan = {
      messages: [
        { id: 'msg-00000003', channelId: 'chan-B', senderId: 'peer-remote', content: 'x', timestamp: 3 },
      ],
    };
    await (peer as any).handleMessageSyncResponse('peer-remote', badBatchNewChan);
    const newChanLines = info.mock.calls.map(([l]: any) => String(l));
    expect(newChanLines.some((l) => l.includes('chan-B'))).toBeTrue();

    peer.destroy();
  });

  test('genuine tampering (not "got undefined") still logs as warn', async () => {
    const { DecentChatNodePeer } = await import(`../src/peer/DecentChatNodePeer.js?real=${Date.now()}`);
    const dataDir = mkdtempSync(join(tmpdir(), 'decent-hermes-syncimport-warn-'));
    tempDirs.push(dataDir);

    const info = mock((_line: string) => {});
    const warn = mock((_line: string) => {});
    const peer = new DecentChatNodePeer({
      account: makeAccount(dataDir),
      onIncomingMessage: async () => {},
      onReply: () => {},
      log: { info, debug: () => {}, warn, error: () => {} },
    });

    (peer as any).myPeerId = 'bridge-peer-id';
    (peer as any).transport = { send: () => true, destroy: () => {} };
    (peer as any).findWorkspaceIdForChannel = () => 'ws-1';
    (peer as any).persistMessagesForChannel = () => {};
    (peer as any).enqueueOffline = async () => {};

    const fakeStore = {
      getMessages: () => [],
      importMessages: async () => ({
        success: false,
        // A proper tampering error, not a structural "got undefined" one.
        error: 'Tampered message history detected: Hash chain broken at message 3. Expected prevHash abc..., got xyz...',
      }),
    };
    (peer as any).messageStore = fakeStore;

    await (peer as any).handleMessageSyncResponse('peer-remote-evil', {
      messages: [
        { id: 'tm-00000001', channelId: 'chan-X', senderId: 'peer-remote-evil', content: 'evil', timestamp: 10 },
      ],
    });

    const warnLines = warn.mock.calls.map(([l]: any) => String(l));
    expect(warnLines.some((l) => l.includes('sync import failed') && l.includes('chan-X'))).toBeTrue();
    peer.destroy();
  });
});
