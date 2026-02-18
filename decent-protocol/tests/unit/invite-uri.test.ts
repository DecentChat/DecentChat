/**
 * InviteURI tests — Self-contained connection tickets
 */

import { describe, test, expect } from 'bun:test';
import { InviteURI } from '../../src/invite/InviteURI';

describe('InviteURI - Encode', () => {
  test('encodes basic LAN invite', () => {
    const uri = InviteURI.create({
      host: '192.168.1.50',
      port: 9000,
      inviteCode: 'ABCD1234',
    });

    expect(uri).toContain('decent://192.168.1.50:9000/ABCD1234');
  });

  test('encodes invite with peer ID and workspace name', () => {
    const uri = InviteURI.create({
      host: '85.237.42.100',
      port: 9000,
      inviteCode: 'WXYZ5678',
      peerId: 'alice-peer-id',
      workspaceName: 'My Team',
    });

    expect(uri).toContain('decent://85.237.42.100:9000/WXYZ5678');
    expect(uri).toContain('peer=alice-peer-id');
    expect(uri).toContain('name=My+Team');
  });

  test('encodes secure invite (port 443)', () => {
    const uri = InviteURI.create({
      host: 'signal.alice.com',
      port: 443,
      inviteCode: 'SECURE01',
      secure: true,
    });

    expect(uri).toContain('secure=1');
  });

  test('includes default public fallback servers', () => {
    const uri = InviteURI.create({
      host: '192.168.1.50',
      port: 9000,
      inviteCode: 'TEST1234',
    });

    expect(uri).toContain('fallback=');
    expect(uri).toContain('peerjs');
  });
});

describe('InviteURI - Decode', () => {
  test('decodes basic LAN invite', () => {
    const data = InviteURI.decode('decent://192.168.1.50:9000/ABCD1234');

    expect(data.host).toBe('192.168.1.50');
    expect(data.port).toBe(9000);
    expect(data.inviteCode).toBe('ABCD1234');
  });

  test('decodes domain-based invite', () => {
    const data = InviteURI.decode('decent://signal.alice.com:443/CODE1234?secure=1');

    expect(data.host).toBe('signal.alice.com');
    expect(data.port).toBe(443);
    expect(data.secure).toBe(true);
    expect(data.inviteCode).toBe('CODE1234');
  });

  test('decodes IPv6 invite', () => {
    const data = InviteURI.decode('decent://[2001:db8::1]:9000/IPV6TEST');

    expect(data.host).toBe('2001:db8::1');
    expect(data.port).toBe(9000);
    expect(data.inviteCode).toBe('IPV6TEST');
  });

  test('decodes invite with all params', () => {
    const uri = 'decent://85.237.42.100:9000/FULL0001?peer=alice123&pk=pubkey&name=Team&fallback=wss://public.com&turn=turn:relay.com';
    const data = InviteURI.decode(uri);

    expect(data.host).toBe('85.237.42.100');
    expect(data.port).toBe(9000);
    expect(data.inviteCode).toBe('FULL0001');
    expect(data.peerId).toBe('alice123');
    expect(data.publicKey).toBe('pubkey');
    expect(data.workspaceName).toBe('Team');
    expect(data.fallbackServers).toContain('wss://public.com');
    expect(data.turnServers).toContain('turn:relay.com');
  });

  test('decodes localhost dev invite', () => {
    const data = InviteURI.decode('decent://localhost:9000/DEV12345');

    expect(data.host).toBe('localhost');
    expect(data.port).toBe(9000);
    expect(data.inviteCode).toBe('DEV12345');
  });

  test('decodes web URL format', () => {
    const data = InviteURI.decode('https://decentchat.org/join/ABCD1234?signal=192.168.1.50:9000');

    expect(data.host).toBe('192.168.1.50');
    expect(data.port).toBe(9000);
    expect(data.inviteCode).toBe('ABCD1234');
  });

  test('rejects invalid URI', () => {
    expect(() => InviteURI.decode('ftp://invalid')).toThrow();
    expect(() => InviteURI.decode('decent://host:9000/')).toThrow('missing invite code');
  });
});

describe('InviteURI - Roundtrip', () => {
  test('encode → decode preserves all data', () => {
    const original = InviteURI.encode({
      host: '10.0.0.5',
      port: 8080,
      inviteCode: 'ROUND001',
      secure: false,
      path: '/peerjs',
      fallbackServers: ['wss://fallback.com/peerjs'],
      turnServers: ['turn:relay.example.com'],
      peerId: 'my-peer-123',
      publicKey: 'base64publickey',
      workspaceName: 'Test Team',
    });

    const decoded = InviteURI.decode(original);

    expect(decoded.host).toBe('10.0.0.5');
    expect(decoded.port).toBe(8080);
    expect(decoded.inviteCode).toBe('ROUND001');
    expect(decoded.peerId).toBe('my-peer-123');
    expect(decoded.publicKey).toBe('base64publickey');
    expect(decoded.workspaceName).toBe('Test Team');
    expect(decoded.fallbackServers).toContain('wss://fallback.com/peerjs');
    expect(decoded.turnServers).toContain('turn:relay.example.com');
  });

  test('multiple fallback servers roundtrip', () => {
    const original = InviteURI.encode({
      host: '192.168.1.1',
      port: 9000,
      inviteCode: 'MULTI001',
      secure: false,
      path: '/peerjs',
      fallbackServers: ['wss://server1.com', 'wss://server2.com', 'wss://server3.com'],
      turnServers: [],
    });

    const decoded = InviteURI.decode(original);
    expect(decoded.fallbackServers).toHaveLength(3);
  });
});

describe('InviteURI - Validation', () => {
  test('isValid returns true for valid URIs', () => {
    expect(InviteURI.isValid('decent://192.168.1.50:9000/CODE1234')).toBe(true);
    expect(InviteURI.isValid('decent://localhost:9000/TEST')).toBe(true);
    expect(InviteURI.isValid('decent://[::1]:9000/IPV6')).toBe(true);
    expect(InviteURI.isValid('https://decentchat.org/join/CODE?signal=host:9000')).toBe(true);
  });

  test('isValid returns false for invalid URIs', () => {
    expect(InviteURI.isValid('ftp://invalid')).toBe(false);
    expect(InviteURI.isValid('not a uri')).toBe(false);
    expect(InviteURI.isValid('')).toBe(false);
  });
});

describe('InviteURI - Share Text', () => {
  test('generates shareable text', () => {
    const text = InviteURI.toShareText({
      host: '192.168.1.50',
      port: 9000,
      inviteCode: 'SHARE001',
      secure: false,
      path: '/peerjs',
      fallbackServers: [],
      turnServers: [],
      workspaceName: 'My Team',
    });

    expect(text).toContain('Join My Team on DecentChat');
    expect(text).toContain('decent://');
    expect(text).toContain('SHARE001');
  });
});
