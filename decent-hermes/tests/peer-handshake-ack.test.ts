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
    alias: 'HandshakeBot',
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

describe('DecentChatNodePeer handshake send (no ack round-trip)', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sends a single handshake per call, preserves the cooldown, and emits NO handshake-ack warnings', async () => {
    // Post-mortem regression test. Two historical bugs this guards against:
    //
    // Bug 1 (auto-ban incident): the original sendHandshake loop-retried on
    // ack timeout AND cleared `connectHandshakeAtByPeer` so the next reconnect
    // burned through another burst of handshakes immediately. That tripped
    // the receiver's MessageGuard handshake bucket (3 burst, 1/10s refill),
    // escalated warning → soft → hard violation, and got Xena permanently
    // banned by the web client.
    //
    // Bug 2 (log noise + wasted complexity): after Bug 1 was partially
    // fixed we still kept a bridge-local `handshake-ack` round-trip whose
    // message type nobody else in the DecentChat ecosystem implements. The
    // web client and the shared `@decentchat/protocol` package do not speak
    // `handshake-ack`, so the ack timeout fired on EVERY bridge→web
    // handshake and emitted a spurious `handshake not acknowledged by ...
    // (timeout 7500ms) — will retry on next reconnect after cooldown`
    // warning. The tracking had zero retry behaviour attached, so it was
    // pure log noise. Removed in favour of the rate-limited outbound
    // cooldown + the concrete sync/peer-auth signals that already tell us
    // whether the peer is actually talking to us.
    //
    // Asserted invariants:
    //   1. sendHandshake fires exactly ONE handshake payload per invocation.
    //   2. The payload has NO `handshakeId` field (we stopped generating one
    //      because no receiver ever echoed it back).
    //   3. The cooldown timestamp set by handlePeerConnect BEFORE this call
    //      is preserved (and may be refreshed to a current Date.now(), but
    //      never cleared or moved backwards).
    //   4. NO "handshake not acknowledged" warning is emitted.
    //   5. None of the old broken phrases appear either.
    const { DecentChatNodePeer } = await import(`../src/peer/DecentChatNodePeer.js?real=${Date.now()}`);
    const dataDir = mkdtempSync(join(tmpdir(), 'decent-hermes-handshake-'));
    tempDirs.push(dataDir);

    const warn = mock((_line: string) => {});
    const debug = mock((_line: string) => {});

    const peer = new DecentChatNodePeer({
      account: makeAccount(dataDir),
      onIncomingMessage: async () => {},
      onReply: () => {},
      log: {
        info: () => {},
        debug,
        warn,
        error: () => {},
      },
    });

    const sentPayloads: any[] = [];
    (peer as any).transport = {
      send: (_peerId: string, payload: any) => {
        sentPayloads.push(payload);
        return true;
      },
      destroy: () => {},
    };
    (peer as any).messageProtocol = {
      createHandshake: async () => ({
        publicKey: 'public-key',
        signingPublicKey: 'signing-public-key',
        preKeySupport: true,
      }),
    };
    (peer as any).publishPreKeyBundle = async () => {};
    (peer as any).resolveNameAnnounceWorkspaceId = () => undefined;

    // Simulate the cooldown that handlePeerConnect would have set BEFORE
    // calling sendHandshake. This is the invariant we want to preserve.
    const cooldownSetAt = Date.now();
    (peer as any).connectHandshakeAtByPeer.set('peer-remote', cooldownSetAt);

    await (peer as any).sendHandshake('peer-remote');

    // Assertion 1: exactly ONE handshake payload, no retry loop.
    const handshakePayloads = sentPayloads.filter((payload) => payload?.type === 'handshake');
    expect(handshakePayloads).toHaveLength(1);

    // Assertion 2: payload carries NO handshakeId (the dead round-trip
    // marker we used to generate even though nothing echoed it back).
    expect(handshakePayloads[0]?.handshakeId).toBeUndefined();

    // Assertion 3: cooldown stamp preserved. sendHandshake now refreshes it
    // to the current Date.now() on send, so it may equal or slightly exceed
    // cooldownSetAt but must never be cleared or reset earlier.
    expect((peer as any).connectHandshakeAtByPeer.has('peer-remote')).toBeTrue();
    const cooldownAfter = (peer as any).connectHandshakeAtByPeer.get('peer-remote');
    expect(cooldownAfter).toBeGreaterThanOrEqual(cooldownSetAt);
    expect(cooldownAfter).toBeLessThanOrEqual(Date.now());

    // Assertion 4: no "handshake not acknowledged" warning — that was the
    // whole log-noise bug we just deleted.
    const warnLines = warn.mock.calls.map(([line]) => String(line));
    expect(warnLines.some((line) => line.includes('handshake not acknowledged'))).toBeFalse();

    // Assertion 5: none of the older broken phrasings either.
    expect(warnLines.some((line) => line.includes('clearing cooldown for retry'))).toBeFalse();
    expect(warnLines.some((line) => /attempt \d+\/\d+ — will retry$/.test(line))).toBeFalse();

    peer.destroy();
  });

  test('does not fire a fresh handshake while cooldown is still active (handlePeerConnect path)', async () => {
    // Sanity-check the upstream invariant that the corrected sendHandshake
    // depends on: handlePeerConnect must skip handshake when the cooldown is
    // still in effect. If this regresses we'd be back to handshake spam.
    const { DecentChatNodePeer } = await import(`../src/peer/DecentChatNodePeer.js?real=${Date.now()}`);
    const dataDir = mkdtempSync(join(tmpdir(), 'decent-hermes-handshake-cd-'));
    tempDirs.push(dataDir);

    const info = mock((_line: string) => {});
    const peer = new DecentChatNodePeer({
      account: makeAccount(dataDir),
      onIncomingMessage: async () => {},
      onReply: () => {},
      log: {
        info,
        debug: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    const handshakeCalls: string[] = [];
    (peer as any).sendHandshake = async (peerId: string) => {
      handshakeCalls.push(peerId);
    };
    (peer as any).clearPeerMaintenanceFailure = () => {};
    (peer as any).hasProtocolSession = () => false;
    (peer as any).resumePeerSession = async () => {};
    (peer as any).requestSyncForPeer = () => {};
    (peer as any).flushOfflineQueue = async () => {};
    (peer as any).flushPendingReadReceipts = async () => {};
    (peer as any).sendManifestSummary = () => {};
    (peer as any).requestCustodyRecovery = () => {};

    // Pretend we sent a handshake to peer-remote 5 seconds ago — well within
    // the 60s CONNECT_HANDSHAKE_COOLDOWN_MS window.
    (peer as any).connectHandshakeAtByPeer.set('peer-remote', Date.now() - 5_000);

    await (peer as any).handlePeerConnect('peer-remote');

    expect(handshakeCalls).toHaveLength(0);
    const infoLines = info.mock.calls.map(([line]) => String(line));
    expect(infoLines.some((line) => line.includes('handshake cooldown active'))).toBeTrue();

    peer.destroy();
  });
});
