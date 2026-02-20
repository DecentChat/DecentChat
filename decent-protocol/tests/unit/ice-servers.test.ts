/**
 * T2.3: TURN Redundancy — ICE server resolution tests
 *
 * Tests PeerTransport._resolveIceServers() logic and the exported constants.
 * Pure unit tests — no real PeerJS/WebRTC.
 */

import { describe, test, expect } from 'bun:test';
import {
  DEFAULT_ICE_SERVERS,
  DEFAULT_TURN_SERVERS,
  ICE_SERVERS_WITH_TURN,
} from '../../../decent-transport-webrtc/src/PeerTransport';

// ---------------------------------------------------------------------------
// Mirror _resolveIceServers() logic for isolated testing
// (same priority chain as the private method in PeerTransport)
// ---------------------------------------------------------------------------

interface ResolveConfig {
  iceServers?: RTCIceServer[];
  useTurn?: boolean;
  turnServers?: RTCIceServer[];
}

function resolveIceServers(isLocalhost: boolean, config: ResolveConfig = {}): RTCIceServer[] {
  if (config.iceServers) return config.iceServers;
  if (isLocalhost) return [];
  if (config.useTurn === false) return DEFAULT_ICE_SERVERS;
  if (config.turnServers && config.turnServers.length > 0) {
    return [...DEFAULT_ICE_SERVERS, ...config.turnServers];
  }
  return ICE_SERVERS_WITH_TURN;
}

const CUSTOM_TURN: RTCIceServer = {
  urls: 'turn:turn.example.com:3478',
  username: 'user',
  credential: 'pass',
};

// ---------------------------------------------------------------------------
// Tests: exported constants
// ---------------------------------------------------------------------------

describe('T2.3 TURN Redundancy — exported constants', () => {
  test('DEFAULT_ICE_SERVERS contains only STUN entries', () => {
    expect(DEFAULT_ICE_SERVERS.length).toBeGreaterThan(0);
    for (const server of DEFAULT_ICE_SERVERS) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      for (const url of urls) {
        expect(url).toMatch(/^stun:/);
      }
    }
  });

  test('DEFAULT_TURN_SERVERS contains only TURN entries', () => {
    expect(DEFAULT_TURN_SERVERS.length).toBeGreaterThan(0);
    for (const server of DEFAULT_TURN_SERVERS) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls as string];
      for (const url of urls) {
        expect(url).toMatch(/^turn:/);
      }
    }
  });

  test('DEFAULT_TURN_SERVERS entries have username + credential', () => {
    for (const server of DEFAULT_TURN_SERVERS) {
      expect(server.username).toBeTruthy();
      expect(server.credential).toBeTruthy();
    }
  });

  test('ICE_SERVERS_WITH_TURN is STUN + TURN combined', () => {
    expect(ICE_SERVERS_WITH_TURN.length).toBe(DEFAULT_ICE_SERVERS.length + DEFAULT_TURN_SERVERS.length);
    // STUN first
    for (let i = 0; i < DEFAULT_ICE_SERVERS.length; i++) {
      expect(ICE_SERVERS_WITH_TURN[i]).toEqual(DEFAULT_ICE_SERVERS[i]);
    }
    // TURN after
    for (let i = 0; i < DEFAULT_TURN_SERVERS.length; i++) {
      expect(ICE_SERVERS_WITH_TURN[DEFAULT_ICE_SERVERS.length + i]).toEqual(DEFAULT_TURN_SERVERS[i]);
    }
  });

  test('ICE_SERVERS_WITH_TURN has more entries than DEFAULT_ICE_SERVERS', () => {
    expect(ICE_SERVERS_WITH_TURN.length).toBeGreaterThan(DEFAULT_ICE_SERVERS.length);
  });
});

// ---------------------------------------------------------------------------
// Tests: _resolveIceServers() priority chain
// ---------------------------------------------------------------------------

describe('T2.3 TURN Redundancy — _resolveIceServers() priority chain', () => {

  // ── Localhost: always empty ──────────────────────────────────────────────

  test('localhost → returns [] (skip all STUN/TURN)', () => {
    const result = resolveIceServers(true);
    expect(result).toHaveLength(0);
  });

  test('localhost + explicit iceServers override → still uses override', () => {
    const override = [{ urls: 'stun:custom.example.com:3478' }];
    const result = resolveIceServers(true, { iceServers: override });
    expect(result).toEqual(override);
  });

  test('localhost + useTurn:false → still returns [] (localhost wins)', () => {
    const result = resolveIceServers(true, { useTurn: false });
    expect(result).toHaveLength(0);
  });

  test('localhost + custom turnServers → still returns [] (localhost wins)', () => {
    const result = resolveIceServers(true, { turnServers: [CUSTOM_TURN] });
    expect(result).toHaveLength(0);
  });

  // ── Production: explicit iceServers override ─────────────────────────────

  test('production + explicit iceServers → used as-is (highest priority)', () => {
    const override = [{ urls: 'stun:override.example.com:3478' }, CUSTOM_TURN];
    const result = resolveIceServers(false, { iceServers: override });
    expect(result).toEqual(override);
  });

  test('explicit iceServers override even if useTurn is false', () => {
    const override = [CUSTOM_TURN];
    const result = resolveIceServers(false, { iceServers: override, useTurn: false });
    expect(result).toEqual(override);
  });

  // ── Production: useTurn:false → STUN only ───────────────────────────────

  test('production + useTurn:false → STUN only (no TURN)', () => {
    const result = resolveIceServers(false, { useTurn: false });
    expect(result).toEqual(DEFAULT_ICE_SERVERS);
    for (const server of result) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls as string];
      for (const url of urls) {
        expect(url).not.toMatch(/^turn:/);
      }
    }
  });

  // ── Production: custom TURN servers ─────────────────────────────────────

  test('production + custom turnServers → STUN + custom TURN', () => {
    const result = resolveIceServers(false, { turnServers: [CUSTOM_TURN] });
    expect(result).toContainEqual(CUSTOM_TURN);
    // Also contains STUN
    for (const stunServer of DEFAULT_ICE_SERVERS) {
      expect(result).toContainEqual(stunServer);
    }
  });

  test('custom turnServers replaces DEFAULT_TURN_SERVERS (not additive)', () => {
    const result = resolveIceServers(false, { turnServers: [CUSTOM_TURN] });
    // Should contain custom TURN but NOT the default open relay
    const hasDefaultTurn = DEFAULT_TURN_SERVERS.some(t =>
      result.some(r => JSON.stringify(r) === JSON.stringify(t))
    );
    expect(hasDefaultTurn).toBe(false);
  });

  test('multiple custom TURN servers all included', () => {
    const turn1 = { urls: 'turn:turn1.example.com:3478', username: 'u', credential: 'p' };
    const turn2 = { urls: 'turn:turn2.example.com:3478', username: 'u', credential: 'p' };
    const result = resolveIceServers(false, { turnServers: [turn1, turn2] });
    expect(result).toContainEqual(turn1);
    expect(result).toContainEqual(turn2);
  });

  test('empty turnServers array falls through to default STUN+TURN', () => {
    const result = resolveIceServers(false, { turnServers: [] });
    expect(result).toEqual(ICE_SERVERS_WITH_TURN);
  });

  // ── Production: default (no config) → STUN + TURN ───────────────────────

  test('production + no config → ICE_SERVERS_WITH_TURN (default)', () => {
    const result = resolveIceServers(false);
    expect(result).toEqual(ICE_SERVERS_WITH_TURN);
  });

  test('default includes both STUN and TURN entries', () => {
    const result = resolveIceServers(false);
    const stunEntries = result.filter(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls as string];
      return urls.every(u => u.startsWith('stun:'));
    });
    const turnEntries = result.filter(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls as string];
      return urls.some(u => u.startsWith('turn:'));
    });
    expect(stunEntries.length).toBeGreaterThan(0);
    expect(turnEntries.length).toBeGreaterThan(0);
  });

  // ── Priority ordering ────────────────────────────────────────────────────

  test('priority: explicit iceServers > useTurn:false', () => {
    const override = [CUSTOM_TURN];
    const result = resolveIceServers(false, { iceServers: override, useTurn: false });
    // iceServers wins — even though useTurn:false was set
    expect(result).toEqual(override);
  });

  test('priority: explicit iceServers > custom turnServers', () => {
    const override = [{ urls: 'stun:stun.override.com:3478' }];
    const result = resolveIceServers(false, { iceServers: override, turnServers: [CUSTOM_TURN] });
    expect(result).toEqual(override);
    expect(result).not.toContainEqual(CUSTOM_TURN);
  });

  test('priority: useTurn:false > custom turnServers', () => {
    // useTurn:false means explicitly no TURN, even if turnServers is provided
    // (This case: iceServers not set, useTurn:false takes priority over turnServers)
    const result = resolveIceServers(false, { useTurn: false, turnServers: [CUSTOM_TURN] });
    // useTurn:false wins (checked before turnServers in priority chain)
    expect(result).toEqual(DEFAULT_ICE_SERVERS);
    expect(result).not.toContainEqual(CUSTOM_TURN);
  });
});
