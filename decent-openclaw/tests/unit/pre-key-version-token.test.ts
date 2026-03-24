import { describe, expect, test } from 'bun:test';
import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer';

describe('DecentChatNodePeer pre-key publish dedupe token', () => {
  test('ignores generatedAt drift for identical key material', () => {
    const peer = Object.create(DecentChatNodePeer.prototype) as any;

    const baseBundle = {
      generatedAt: 100,
      signedPreKey: { keyId: 21 },
      oneTimePreKeys: [{ keyId: 2 }, { keyId: 4 }],
    };

    const tokenA = (DecentChatNodePeer.prototype as any).preKeyBundleVersionToken.call(peer, baseBundle);
    const tokenB = (DecentChatNodePeer.prototype as any).preKeyBundleVersionToken.call(peer, {
      ...baseBundle,
      generatedAt: 200,
    });

    expect(tokenB).toBe(tokenA);

    const tokenChanged = (DecentChatNodePeer.prototype as any).preKeyBundleVersionToken.call(peer, {
      ...baseBundle,
      oneTimePreKeys: [{ keyId: 3 }, { keyId: 5 }],
    });

    expect(tokenChanged).not.toBe(tokenA);
  });
});
