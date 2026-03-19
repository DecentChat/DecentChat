import { describe, expect, test } from 'bun:test';
import { NodeXenaPeer } from '../../src/peer/NodeXenaPeer';

describe('NodeXenaPeer pre-key publish dedupe token', () => {
  test('ignores generatedAt drift for identical key material', () => {
    const peer = Object.create(NodeXenaPeer.prototype) as any;

    const baseBundle = {
      generatedAt: 100,
      signedPreKey: { keyId: 21 },
      oneTimePreKeys: [{ keyId: 2 }, { keyId: 4 }],
    };

    const tokenA = (NodeXenaPeer.prototype as any).preKeyBundleVersionToken.call(peer, baseBundle);
    const tokenB = (NodeXenaPeer.prototype as any).preKeyBundleVersionToken.call(peer, {
      ...baseBundle,
      generatedAt: 200,
    });

    expect(tokenB).toBe(tokenA);

    const tokenChanged = (NodeXenaPeer.prototype as any).preKeyBundleVersionToken.call(peer, {
      ...baseBundle,
      oneTimePreKeys: [{ keyId: 3 }, { keyId: 5 }],
    });

    expect(tokenChanged).not.toBe(tokenA);
  });
});
