import { describe, expect, test } from 'bun:test';
import { DecentHermesPeer } from '../src/peer.js';

describe('DecentHermesPeer config', () => {
  test('constructs with minimal required config', () => {
    expect(() => {
      new DecentHermesPeer({
        seedPhrase:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      });
    }).not.toThrow();
  });
});
