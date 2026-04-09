import { describe, expect, mock, test } from 'bun:test';
import { PeerAuth } from '@decentchat/protocol';
import { ChatController } from '../../src/app/ChatController';

function createController(): any {
  const ctrl = Object.create(ChatController.prototype) as any;
  ctrl.state = {
    myPeerId: 'me-peer',
    connectedPeers: new Set<string>(['peer-a']),
  };
  ctrl.pendingAuthChallenges = new Map<string, { nonce: string; timestamp: number }>();
  ctrl.authenticatedPeers = new Set<string>();
  ctrl.sendControlWithRetry = mock(() => true);
  ctrl.transport = {
    disconnect: mock(() => {}),
  };
  return ctrl;
}

describe('ChatController peer auth challenge-response', () => {
  test('sends auth-challenge with nonce + local peerId and tracks pending challenge', () => {
    const ctrl = createController();

    const realSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = mock(() => 0 as any);
    try {
      (ChatController.prototype as any).initiatePeerAuthChallenge.call(ctrl, 'peer-a', true);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    expect(ctrl.pendingAuthChallenges.has('peer-a')).toBe(true);
    expect(ctrl.sendControlWithRetry).toHaveBeenCalledTimes(1);
    const sent = ctrl.sendControlWithRetry.mock.calls[0]?.[1];
    expect(sent.type).toBe('auth-challenge');
    expect(typeof sent.nonce).toBe('string');
    expect(sent.nonce.length).toBeGreaterThan(0);
    expect(sent.peerId).toBe('me-peer');
  });

  test('valid auth-response passes verification and keeps session connected', async () => {
    const ctrl = createController();
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );

    const challenge = PeerAuth.createChallenge();
    ctrl.pendingAuthChallenges.set('peer-a', challenge);
    ctrl.messageProtocol = {
      getSigningPublicKey: mock(() => keyPair.publicKey),
    };

    const response = await PeerAuth.respondToChallenge(challenge.nonce, 'me-peer', keyPair.privateKey);

    await (ChatController.prototype as any).handlePeerAuthResponse.call(ctrl, 'peer-a', response.signature);

    expect(ctrl.authenticatedPeers.has('peer-a')).toBe(true);
    expect(ctrl.pendingAuthChallenges.has('peer-a')).toBe(false);
    expect(ctrl.transport.disconnect).not.toHaveBeenCalled();
  });

  test('invalid auth-response disconnects peer', async () => {
    const ctrl = createController();
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );

    const challenge = PeerAuth.createChallenge();
    ctrl.pendingAuthChallenges.set('peer-a', challenge);
    ctrl.messageProtocol = {
      getSigningPublicKey: mock(() => keyPair.publicKey),
    };

    // Signed for the wrong challenger peerId; verification must fail.
    const invalid = await PeerAuth.respondToChallenge(challenge.nonce, 'wrong-peer', keyPair.privateKey);

    await (ChatController.prototype as any).handlePeerAuthResponse.call(ctrl, 'peer-a', invalid.signature);

    expect(ctrl.authenticatedPeers.has('peer-a')).toBe(false);
    expect(ctrl.pendingAuthChallenges.has('peer-a')).toBe(false);
    expect(ctrl.transport.disconnect).toHaveBeenCalledTimes(1);
    expect(ctrl.transport.disconnect).toHaveBeenCalledWith('peer-a');
  });
});
