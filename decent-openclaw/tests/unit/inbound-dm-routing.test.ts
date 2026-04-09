import { describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';

const VALID_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-routing',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://0.peerjs.com/',
    invites: [],
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-routing-test-')),
    ...overrides,
  };
}

function makeEnvelope(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'env-1',
    ratchet: {
      header: { dhPublicKey: 'x', previousCount: 0, messageNumber: 1 },
      ciphertext: 'cipher',
      iv: 'iv',
    },
    signature: 'sig',
    protocolVersion: 2,
    senderId: 'peer-sender',
    senderName: 'Sender',
    messageId: 'msg-1',
    timestamp: 100,
    ...overrides,
  };
}

function makePeerHarness(): {
  peer: DecentChatNodePeer;
  onIncomingMessage: ReturnType<typeof mock>;
  logInfo: ReturnType<typeof mock>;
  logWarn: ReturnType<typeof mock>;
} {
  const onIncomingMessage = mock(async () => {});
  const logInfo = mock((_line: string) => {});
  const logWarn = mock((_line: string) => {});
  const peer = new DecentChatNodePeer({
    account: makeAccount(),
    onIncomingMessage,
    onReply: () => {},
    log: { info: logInfo, warn: logWarn },
  });

  (peer as any).transport = {
    send: mock(() => true),
    getConnectedPeers: mock(() => ['peer-sender'] as string[]),
  };
  (peer as any).messageProtocol = {
    decryptMessage: mock(async () => 'hello inbound'),
  };
  (peer as any).syncProtocol = {};
  (peer as any).cryptoManager = {
    importPublicKey: mock(async () => ({ mocked: true })),
  };
  (peer as any).getPeerPublicKey = () => 'peer-sender-public-key';

  return { peer, onIncomingMessage, logInfo, logWarn };
}

describe('inbound DM routing invariants', () => {
  test('isDirect=true without channelId routes as direct and falls back channelId to fromPeerId', async () => {
    const { peer, onIncomingMessage, logWarn, logInfo } = makePeerHarness();

    await (peer as any).handlePeerMessage(
      'peer-direct',
      makeEnvelope({
        isDirect: true,
        channelId: undefined,
        messageId: 'msg-direct',
      }),
    );

    expect(onIncomingMessage).toHaveBeenCalledTimes(1);
    const incoming = onIncomingMessage.mock.calls[0]?.[0];
    expect(incoming.chatType).toBe('direct');
    expect(incoming.channelId).toBe('peer-direct');
    expect(logWarn).toHaveBeenCalledTimes(0);
    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(logInfo.mock.calls[0]?.[0]).toContain('chatType=direct');
  });

  test('isDirect=false with explicit channelId routes as workspace/channel', async () => {
    const { peer, onIncomingMessage, logWarn, logInfo } = makePeerHarness();

    await (peer as any).handlePeerMessage(
      'peer-channel',
      makeEnvelope({
        isDirect: false,
        channelId: 'ch-xyz',
        workspaceId: 'ws-123',
        messageId: 'msg-channel',
      }),
    );

    expect(onIncomingMessage).toHaveBeenCalledTimes(1);
    const incoming = onIncomingMessage.mock.calls[0]?.[0];
    expect(incoming.chatType).toBe('channel');
    expect(incoming.channelId).toBe('ch-xyz');
    expect(incoming.workspaceId).toBe('ws-123');
    expect(logWarn).toHaveBeenCalledTimes(0);
    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(logInfo.mock.calls[0]?.[0]).toContain('chatType=channel');
  });

  test('isDirect=false without channelId drops with a warning instead of silent return', async () => {
    const { peer, onIncomingMessage, logInfo, logWarn } = makePeerHarness();

    await (peer as any).handlePeerMessage(
      'peer-missing-route',
      makeEnvelope({
        isDirect: false,
        channelId: undefined,
        workspaceId: undefined,
        messageId: 'msg-drop',
      }),
    );

    expect(onIncomingMessage).toHaveBeenCalledTimes(0);
    expect(logInfo).toHaveBeenCalledTimes(0);
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logWarn.mock.calls[0]?.[0]).toContain('route-drop');
    expect(logWarn.mock.calls[0]?.[0]).toContain('missing channelId');
  });
});
