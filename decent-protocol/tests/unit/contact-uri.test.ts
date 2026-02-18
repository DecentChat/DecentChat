/**
 * Tests for ContactURI encode/decode utility
 */

import { describe, expect, test } from 'bun:test';
import { ContactURI } from '../../src/contacts/ContactURI';

describe('ContactURI', () => {
  const sampleData = {
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+test+key+base64==',
    displayName: 'Alice',
    peerId: 'abc123-peer-id',
    signalingServers: ['wss://0.peerjs.com/peerjs'],
  };

  test('encode produces a valid decent://contact URI', () => {
    const uri = ContactURI.encode(sampleData);
    expect(uri).toStartWith('decent://contact?');
    expect(uri).toContain('pub=');
    expect(uri).toContain('name=Alice');
    expect(uri).toContain('peer=abc123-peer-id');
    expect(uri).toContain('sig=');
  });

  test('decode roundtrips correctly', () => {
    const uri = ContactURI.encode(sampleData);
    const decoded = ContactURI.decode(uri);

    expect(decoded.publicKey).toBe(sampleData.publicKey);
    expect(decoded.displayName).toBe(sampleData.displayName);
    expect(decoded.peerId).toBe(sampleData.peerId);
    expect(decoded.signalingServers).toEqual(sampleData.signalingServers);
  });

  test('encode works without optional fields', () => {
    const uri = ContactURI.encode({
      publicKey: 'test-key',
      displayName: 'Bob',
    });
    expect(uri).toStartWith('decent://contact?');
    expect(uri).toContain('name=Bob');
    expect(uri).not.toContain('peer=');
  });

  test('decode minimal URI', () => {
    const uri = 'decent://contact?pub=test-key&name=Bob';
    const decoded = ContactURI.decode(uri);
    expect(decoded.publicKey).toBe('test-key');
    expect(decoded.displayName).toBe('Bob');
    expect(decoded.peerId).toBeUndefined();
    expect(decoded.signalingServers).toEqual([]);
  });

  test('decode throws on invalid scheme', () => {
    expect(() => ContactURI.decode('http://example.com')).toThrow('Invalid contact URI');
  });

  test('decode throws on missing public key', () => {
    expect(() => ContactURI.decode('decent://contact?name=Bob')).toThrow('missing public key');
  });

  test('decode throws on missing name', () => {
    expect(() => ContactURI.decode('decent://contact?pub=key')).toThrow('missing display name');
  });

  test('isValid returns true for valid URIs', () => {
    const uri = ContactURI.encode(sampleData);
    expect(ContactURI.isValid(uri)).toBe(true);
  });

  test('isValid returns false for invalid URIs', () => {
    expect(ContactURI.isValid('not a uri')).toBe(false);
    expect(ContactURI.isValid('decent://contact')).toBe(false);
    expect(ContactURI.isValid('decent://contact?pub=key')).toBe(false);
  });

  test('handles special characters in display name', () => {
    const uri = ContactURI.encode({
      publicKey: 'key',
      displayName: 'John & Jane <3',
    });
    const decoded = ContactURI.decode(uri);
    expect(decoded.displayName).toBe('John & Jane <3');
  });

  test('handles multiple signaling servers', () => {
    const data = {
      publicKey: 'key',
      displayName: 'Test',
      signalingServers: ['wss://server1.com', 'wss://server2.com'],
    };
    const uri = ContactURI.encode(data);
    const decoded = ContactURI.decode(uri);
    expect(decoded.signalingServers).toEqual(['wss://server1.com', 'wss://server2.com']);
  });
});
