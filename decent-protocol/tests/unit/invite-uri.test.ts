/**
 * InviteURI tests — Self-contained connection tickets
 */

import { describe, test, expect } from 'bun:test';
import { InviteURI } from '../../src/invite/InviteURI';

describe('InviteURI - Encode', () => {
  test('encodes basic LAN invite as web URL', () => {
    const uri = InviteURI.create({
      host: '192.168.1.50',
      port: 9000,
      inviteCode: 'ABCD1234',
    });

    expect(uri).toContain('https://decentchat.app/join/ABCD1234');
    expect(decodeURIComponent(uri)).toContain('signal=192.168.1.50:9000');
  });

  test('encodes invite with peer ID and workspace name', () => {
    const uri = InviteURI.create({
      host: '85.237.42.100',
      port: 9000,
      inviteCode: 'WXYZ5678',
      peerId: 'alice-peer-id',
      workspaceName: 'My Team',
    });

    expect(uri).toContain('https://decentchat.app/join/WXYZ5678');
    const decoded = decodeURIComponent(uri);
    expect(decoded).toContain('signal=85.237.42.100:9000');
    expect(decoded).toContain('peer=alice-peer-id');
    expect(uri).toContain('name=My+Team'); // URL-encoded space
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

// ---------------------------------------------------------------------------
// Backward compatibility: decent:// vs https:// (5a, 5b, 5c)
// ---------------------------------------------------------------------------

describe('InviteURI - Backward Compatibility', () => {
  const sampleData = {
    host: '192.168.1.50',
    port: 9000,
    inviteCode: 'COMPAT01',
    secure: false,
    path: '/peerjs',
    fallbackServers: ['wss://fallback.example.com'],
    turnServers: ['turn:relay.example.com'],
    peerId: 'alice-peer-id',
    publicKey: 'alice-pub-key',
    workspaceName: 'TestTeam',
  };

  // 5a: decode() on decent:// returns same InviteData as decode() on equivalent https://
  test('decode() on decent:// URI returns same InviteData as equivalent https:// URI', () => {
    const nativeUri = InviteURI.encodeNative(sampleData);
    const webUri = InviteURI.encode(sampleData);

    const fromNative = InviteURI.decode(nativeUri);
    const fromWeb = InviteURI.decode(webUri);

    expect(fromNative.host).toBe(fromWeb.host);
    expect(fromNative.port).toBe(fromWeb.port);
    expect(fromNative.inviteCode).toBe(fromWeb.inviteCode);
    expect(fromNative.secure).toBe(fromWeb.secure);
    expect(fromNative.peerId).toBe(fromWeb.peerId);
    expect(fromNative.publicKey).toBe(fromWeb.publicKey);
    expect(fromNative.workspaceName).toBe(fromWeb.workspaceName);
    expect(fromNative.fallbackServers).toEqual(fromWeb.fallbackServers);
    expect(fromNative.turnServers).toEqual(fromWeb.turnServers);
  });

  // 5b: encode() → decode() round-trip for web format
  test('encode() → decode() round-trip for web URL format', () => {
    const encoded = InviteURI.encode(sampleData);
    const decoded = InviteURI.decode(encoded);

    expect(decoded.host).toBe(sampleData.host);
    expect(decoded.port).toBe(sampleData.port);
    expect(decoded.inviteCode).toBe(sampleData.inviteCode);
    expect(decoded.peerId).toBe(sampleData.peerId);
    expect(decoded.publicKey).toBe(sampleData.publicKey);
    expect(decoded.workspaceName).toBe(sampleData.workspaceName);
    expect(decoded.fallbackServers).toEqual(sampleData.fallbackServers);
    expect(decoded.turnServers).toEqual(sampleData.turnServers);
  });

  // 5b: encodeNative() → decode() round-trip for native format
  test('encodeNative() → decode() round-trip for decent:// format', () => {
    const encoded = InviteURI.encodeNative(sampleData);
    const decoded = InviteURI.decode(encoded);

    expect(decoded.host).toBe(sampleData.host);
    expect(decoded.port).toBe(sampleData.port);
    expect(decoded.inviteCode).toBe(sampleData.inviteCode);
    expect(decoded.peerId).toBe(sampleData.peerId);
    expect(decoded.publicKey).toBe(sampleData.publicKey);
    expect(decoded.workspaceName).toBe(sampleData.workspaceName);
    expect(decoded.fallbackServers).toEqual(sampleData.fallbackServers);
    expect(decoded.turnServers).toEqual(sampleData.turnServers);
  });

  // 5c: decode() on unknown/malformed URI throws (does not crash)
  test('decode() on malformed URI throws', () => {
    expect(() => InviteURI.decode('ftp://invalid')).toThrow();
    expect(() => InviteURI.decode('decent://')).toThrow();
    expect(() => InviteURI.decode('decent://host:9000/')).toThrow('missing invite code');
    expect(() => InviteURI.decode('')).toThrow();
    expect(() => InviteURI.decode('just-random-text')).toThrow();
  });

  // 5c: isValid returns false for malformed URIs (does not crash)
  test('isValid() returns false for malformed URIs without crashing', () => {
    expect(InviteURI.isValid('ftp://invalid')).toBe(false);
    expect(InviteURI.isValid('decent://')).toBe(false);
    expect(InviteURI.isValid('')).toBe(false);
    expect(InviteURI.isValid('random garbage !@#$')).toBe(false);
    expect(InviteURI.isValid('https://example.com/not-a-join-link')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multi-peer discovery (peers[] in InviteData)
// ---------------------------------------------------------------------------

describe('InviteURI - Multi-Peer Discovery', () => {
  test('encode includes additional peers as separate &peer= params', () => {
    const uri = InviteURI.encode({
      host: '192.168.1.50',
      port: 9000,
      inviteCode: 'MULTI001',
      secure: false,
      path: '/peerjs',
      fallbackServers: [],
      turnServers: [],
      peerId: 'alice',
      peers: ['bob', 'carol'],
    });

    const decoded = decodeURIComponent(uri);
    // Primary peer is first, additional peers follow
    expect(decoded).toContain('peer=alice');
    expect(decoded).toContain('peer=bob');
    expect(decoded).toContain('peer=carol');
  });

  test('decode reads all peer params — first as peerId, rest as peers[]', () => {
    const uri = 'https://decentchat.app/join/CODE1?signal=10.0.0.1:9000&peer=alice&peer=bob&peer=carol';
    const data = InviteURI.decode(uri);

    expect(data.peerId).toBe('alice');
    expect(data.peers).toEqual(['bob', 'carol']);
  });

  test('decode with single peer has no peers array', () => {
    const uri = 'https://decentchat.app/join/CODE2?signal=10.0.0.1:9000&peer=alice';
    const data = InviteURI.decode(uri);

    expect(data.peerId).toBe('alice');
    expect(data.peers).toBeUndefined();
  });

  test('encode → decode roundtrip preserves peers', () => {
    const original = InviteURI.encode({
      host: '10.0.0.5',
      port: 8080,
      inviteCode: 'ROUND002',
      secure: false,
      path: '/peerjs',
      fallbackServers: [],
      turnServers: [],
      peerId: 'alice',
      peers: ['bob', 'carol'],
    });

    const decoded = InviteURI.decode(original);
    expect(decoded.peerId).toBe('alice');
    expect(decoded.peers).toEqual(['bob', 'carol']);
  });

  test('encodeNative → decode roundtrip preserves peers', () => {
    const original = InviteURI.encodeNative({
      host: '10.0.0.5',
      port: 8080,
      inviteCode: 'ROUND003',
      secure: false,
      path: '/peerjs',
      fallbackServers: [],
      turnServers: [],
      peerId: 'alice',
      peers: ['bob', 'carol'],
    });

    const decoded = InviteURI.decode(original);
    expect(decoded.peerId).toBe('alice');
    expect(decoded.peers).toEqual(['bob', 'carol']);
  });

  test('does not duplicate primary peer in peers list', () => {
    const uri = InviteURI.encode({
      host: '10.0.0.1',
      port: 9000,
      inviteCode: 'DEDUP01',
      secure: false,
      path: '/peerjs',
      fallbackServers: [],
      turnServers: [],
      peerId: 'alice',
      peers: ['alice', 'bob'], // alice duplicated
    });

    const decoded = decodeURIComponent(uri);
    // Should only have alice once (as primary), bob as additional
    const peerMatches = decoded.match(/peer=alice/g);
    expect(peerMatches).toHaveLength(1);
    expect(decoded).toContain('peer=bob');
  });

  test('old links without peers still decode correctly', () => {
    // Backward compat: single peer param
    const uri = 'https://decentchat.app/join/OLD001?signal=10.0.0.1:9000&peer=alice&pk=key123';
    const data = InviteURI.decode(uri);

    expect(data.peerId).toBe('alice');
    expect(data.peers).toBeUndefined();
    expect(data.publicKey).toBe('key123');
  });

  test('old links without any peer decode correctly', () => {
    const uri = 'https://decentchat.app/join/OLD002?signal=10.0.0.1:9000';
    const data = InviteURI.decode(uri);

    expect(data.peerId).toBeUndefined();
    expect(data.peers).toBeUndefined();
  });
});

describe('InviteURI - Share Text', () => {
  test('generates shareable text with web URL', () => {
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
    expect(text).toContain('https://decentchat.app/join/');
    expect(text).toContain('SHARE001');
  });
});
