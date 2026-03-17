import { describe, test, expect } from 'bun:test';
import { RecoveryURI } from '../../src/identity/RecoveryURI';
import { SeedPhraseManager } from '../../src/identity/SeedPhrase';

describe('RecoveryURI - Encode/Decode', () => {
  test('roundtrip preserves seed phrase, peer id, and signaling servers', () => {
    const seedPhrase = new SeedPhraseManager().generate().mnemonic;

    const encoded = RecoveryURI.encode({
      seedPhrase,
      sourcePeerId: 'peer-abc123',
      signalingServers: ['wss://signal-1.example.com/peerjs', 'wss://signal-2.example.com/peerjs'],
    });

    const decoded = RecoveryURI.decode(encoded);

    expect(decoded.seedPhrase).toBe(seedPhrase);
    expect(decoded.sourcePeerId).toBe('peer-abc123');
    expect(decoded.signalingServers).toEqual([
      'wss://signal-1.example.com/peerjs',
      'wss://signal-2.example.com/peerjs',
    ]);
  });

  test('roundtrip works with required field only', () => {
    const seedPhrase = new SeedPhraseManager().generate().mnemonic;

    const encoded = RecoveryURI.encode({ seedPhrase });
    const decoded = RecoveryURI.decode(encoded);

    expect(decoded.seedPhrase).toBe(seedPhrase);
    expect(decoded.sourcePeerId).toBeUndefined();
    expect(decoded.signalingServers).toBeUndefined();
  });
});

describe('RecoveryURI - Validation', () => {
  test('isValid returns true for valid recovery URI', () => {
    const seedPhrase = new SeedPhraseManager().generate().mnemonic;
    const uri = RecoveryURI.encode({ seedPhrase, sourcePeerId: 'peer-1' });

    expect(RecoveryURI.isValid(uri)).toBe(true);
  });

  test('isValid returns false for malformed or incomplete URIs', () => {
    expect(RecoveryURI.isValid('')).toBe(false);
    expect(RecoveryURI.isValid('decent://recover')).toBe(false);
    expect(RecoveryURI.isValid('decent://recover?seed=')).toBe(false);
    expect(RecoveryURI.isValid('decent://recover?seed=not-base64-url')).toBe(false);
    expect(RecoveryURI.isValid('https://decentchat.app/recover?seed=test')).toBe(false);
  });
});

describe('RecoveryURI - Edge cases', () => {
  test('throws when encoding without seed phrase', () => {
    expect(() => RecoveryURI.encode({ seedPhrase: '' })).toThrow('requires a seed phrase');
  });

  test('throws when seed phrase word count is not 12', () => {
    const tooShort = 'one two three';
    const encoded = btoa(tooShort).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const malformed = `decent://recover?seed=${encoded}`;

    expect(() => RecoveryURI.decode(malformed)).toThrow('12 words');
  });

  test('accepts repeated sig params and comma-separated server list', () => {
    const seedPhrase = new SeedPhraseManager().generate().mnemonic;
    const encodedSeed = Buffer.from(seedPhrase, 'utf8').toString('base64url');

    const uri = `decent://recover?seed=${encodedSeed}&sig=wss://one.example.com/peerjs,wss://two.example.com/peerjs&sig=wss://three.example.com/peerjs`;

    const decoded = RecoveryURI.decode(uri);

    expect(decoded.signalingServers).toEqual([
      'wss://one.example.com/peerjs',
      'wss://two.example.com/peerjs',
      'wss://three.example.com/peerjs',
    ]);
  });
});
