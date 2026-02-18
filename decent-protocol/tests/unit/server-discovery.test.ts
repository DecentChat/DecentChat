/**
 * DEP-002 Server Discovery (PEX) Tests
 */

import { test, expect } from 'bun:test';
import { ServerDiscovery } from '../../src/workspace/ServerDiscovery';
import type { PEXServer } from '../../src/workspace/types';

test('ServerDiscovery - Init > starts with primary server', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const ranked = discovery.getRankedServers();
  
  expect(ranked.length).toBe(1);
  expect(ranked[0].url).toBe('wss://signal1.com');
  expect(ranked[0].successRate).toBe(1.0);
});

test('ServerDiscovery - Handshake > returns top 5 servers', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  
  // Add 10 servers
  for (let i = 2; i <= 11; i++) {
    discovery.mergeReceivedServers([{
      url: `wss://signal${i}.com`,
      lastSeen: Date.now(),
      successRate: 0.9,
      latency: 100,
    }]);
  }
  
  const handshake = discovery.getHandshakeServers();
  expect(handshake.length).toBe(5);
});

test('ServerDiscovery - Merge > adds new servers', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  
  const newServers: PEXServer[] = [
    { url: 'wss://signal2.com', lastSeen: Date.now(), successRate: 0.95 },
    { url: 'wss://signal3.com', lastSeen: Date.now(), successRate: 0.88, latency: 200 },
  ];
  
  discovery.mergeReceivedServers(newServers);
  
  const ranked = discovery.getRankedServers();
  expect(ranked.length).toBe(3);
  expect(ranked.find(s => s.url === 'wss://signal2.com')).toBeDefined();
  expect(ranked.find(s => s.url === 'wss://signal3.com')).toBeDefined();
});

test('ServerDiscovery - Merge > updates existing with fresher data', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const now = Date.now();
  
  discovery.mergeReceivedServers([
    { url: 'wss://signal2.com', lastSeen: now - 10000, successRate: 0.5 },
  ]);
  
  discovery.mergeReceivedServers([
    { url: 'wss://signal2.com', lastSeen: now, successRate: 0.95, latency: 50 },
  ]);
  
  const server = discovery.getRankedServers().find(s => s.url === 'wss://signal2.com');
  expect(server).toBeDefined();
  expect(server!.lastSeen).toBe(now);
  expect(server!.successRate).toBeGreaterThan(0.5); // Should be averaged
});

test('ServerDiscovery - Merge > ignores older data', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const now = Date.now();
  
  discovery.mergeReceivedServers([
    { url: 'wss://signal2.com', lastSeen: now, successRate: 0.95 },
  ]);
  
  discovery.mergeReceivedServers([
    { url: 'wss://signal2.com', lastSeen: now - 10000, successRate: 0.5 },
  ]);
  
  const server = discovery.getRankedServers().find(s => s.url === 'wss://signal2.com');
  expect(server).toBeDefined();
  expect(server!.lastSeen).toBe(now); // Still fresh
});

test('ServerDiscovery - Ranking > prefers high success rate', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const now = Date.now();
  
  discovery.mergeReceivedServers([
    { url: 'wss://reliable.com', lastSeen: now, successRate: 0.99, latency: 100 },
    { url: 'wss://unreliable.com', lastSeen: now, successRate: 0.50, latency: 50 },
  ]);
  
  const ranked = discovery.getRankedServers();
  expect(ranked[0].url).not.toBe('wss://unreliable.com');
});

test('ServerDiscovery - Ranking > prefers recent servers', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const now = Date.now();
  const weekAgo = now - (7 * 24 * 3600 * 1000);
  
  discovery.mergeReceivedServers([
    { url: 'wss://fresh.com', lastSeen: now, successRate: 0.9, latency: 100 },
    { url: 'wss://stale.com', lastSeen: weekAgo, successRate: 0.9, latency: 100 },
  ]);
  
  const ranked = discovery.getRankedServers();
  // Fresh server should rank higher (same reliability + speed, but fresher)
  const freshIndex = ranked.findIndex(s => s.url === 'wss://fresh.com');
  const staleIndex = ranked.findIndex(s => s.url === 'wss://stale.com');
  expect(freshIndex).toBeLessThan(staleIndex);
});

test('ServerDiscovery - Stats > recordSuccess updates metrics', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  
  discovery.recordSuccess('wss://signal1.com', 50);
  discovery.recordSuccess('wss://signal1.com', 100);
  
  const server = discovery.getRankedServers().find(s => s.url === 'wss://signal1.com');
  expect(server).toBeDefined();
  expect(server!.totalAttempts).toBe(2);
  expect(server!.successfulAttempts).toBe(2);
  expect(server!.successRate).toBe(1.0);
  expect(server!.avgLatency).toBeGreaterThan(0);
});

test('ServerDiscovery - Stats > recordFailure decreases success rate', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  
  discovery.recordSuccess('wss://signal1.com', 50);
  discovery.recordFailure('wss://signal1.com');
  
  const server = discovery.getRankedServers().find(s => s.url === 'wss://signal1.com');
  expect(server).toBeDefined();
  expect(server!.totalAttempts).toBe(2);
  expect(server!.successfulAttempts).toBe(1);
  expect(server!.successRate).toBe(0.5);
});

test('ServerDiscovery - Pruning > removes old servers', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const now = Date.now();
  const monthAgo = now - (31 * 24 * 3600 * 1000);
  
  discovery.mergeReceivedServers([
    { url: 'wss://old.com', lastSeen: monthAgo, successRate: 0.9 },
    { url: 'wss://fresh.com', lastSeen: now, successRate: 0.9 },
  ]);
  
  // Trigger pruning by merging again
  discovery.mergeReceivedServers([]);
  
  const ranked = discovery.getRankedServers();
  expect(ranked.find(s => s.url === 'wss://old.com')).toBeUndefined();
  expect(ranked.find(s => s.url === 'wss://fresh.com')).toBeDefined();
});

test('ServerDiscovery - Pruning > never prunes primary server', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const monthAgo = Date.now() - (31 * 24 * 3600 * 1000);
  
  // Force primary server to be old
  discovery.recordFailure('wss://signal1.com'); // This will update lastSeen
  const server = discovery.getRankedServers().find(s => s.url === 'wss://signal1.com');
  if (server) {
    server.lastSeen = monthAgo;
  }
  
  // Trigger pruning
  discovery.mergeReceivedServers([]);
  
  const ranked = discovery.getRankedServers();
  expect(ranked.find(s => s.url === 'wss://signal1.com')).toBeDefined();
});

test('ServerDiscovery - Limits > enforces max 50 servers', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const now = Date.now();
  
  // Add 60 servers
  const servers: PEXServer[] = [];
  for (let i = 2; i <= 61; i++) {
    servers.push({
      url: `wss://signal${i}.com`,
      lastSeen: now - i * 1000, // Stagger timestamps
      successRate: 0.9,
    });
  }
  
  discovery.mergeReceivedServers(servers);
  
  const ranked = discovery.getRankedServers();
  expect(ranked.length).toBeLessThanOrEqual(50);
});

test('ServerDiscovery - Limits > keeps highest ranked servers when pruning', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const now = Date.now();
  
  // Add servers with varying quality
  const servers: PEXServer[] = [
    { url: 'wss://best.com', lastSeen: now, successRate: 0.99, latency: 20 },
    { url: 'wss://worst.com', lastSeen: now - 10000, successRate: 0.60, latency: 500 },
  ];
  
  for (let i = 1; i <= 55; i++) {
    servers.push({
      url: `wss://medium${i}.com`,
      lastSeen: now - i * 100,
      successRate: 0.85,
      latency: 100,
    });
  }
  
  discovery.mergeReceivedServers(servers);
  
  const ranked = discovery.getRankedServers();
  expect(ranked.find(s => s.url === 'wss://best.com')).toBeDefined();
  expect(ranked.find(s => s.url === 'wss://worst.com')).toBeUndefined();
});

test('ServerDiscovery - Serialization > toJSON exports state', () => {
  const discovery = new ServerDiscovery('ws-123', 'wss://signal1.com');
  
  discovery.mergeReceivedServers([
    { url: 'wss://signal2.com', lastSeen: Date.now(), successRate: 0.95 },
  ]);
  
  const json = discovery.toJSON();
  expect(json.workspaceId).toBe('ws-123');
  expect(json.servers.length).toBe(2);
  expect(json.servers.find(s => s.url === 'wss://signal1.com')).toBeDefined();
  expect(json.servers.find(s => s.url === 'wss://signal2.com')).toBeDefined();
});

test('ServerDiscovery - Serialization > fromJSON restores state', () => {
  const original = new ServerDiscovery('ws-123', 'wss://signal1.com');
  original.mergeReceivedServers([
    { url: 'wss://signal2.com', lastSeen: Date.now(), successRate: 0.95, latency: 100 },
  ]);
  
  const json = original.toJSON();
  const restored = ServerDiscovery.fromJSON(json, 'wss://signal1.com');
  
  const servers = restored.getRankedServers();
  expect(servers.length).toBe(2);
  expect(servers.find(s => s.url === 'wss://signal1.com')).toBeDefined();
  expect(servers.find(s => s.url === 'wss://signal2.com')).toBeDefined();
});

test('ServerDiscovery - Integration > realistic multi-peer scenario', () => {
  // Simulate 3 peers sharing servers
  const peer1 = new ServerDiscovery('ws-123', 'wss://signal1.com');
  const peer2 = new ServerDiscovery('ws-123', 'wss://signal2.com');
  const peer3 = new ServerDiscovery('ws-123', 'wss://signal3.com');
  
  // Peer 1 and 2 exchange
  peer1.mergeReceivedServers(peer2.getHandshakeServers());
  peer2.mergeReceivedServers(peer1.getHandshakeServers());
  
  // Peer 3 joins later, learns from peer 1
  peer3.mergeReceivedServers(peer1.getHandshakeServers());
  
  // All peers should now know about all 3 servers
  expect(peer1.getRankedServers().length).toBeGreaterThanOrEqual(2);
  expect(peer2.getRankedServers().length).toBeGreaterThanOrEqual(2);
  expect(peer3.getRankedServers().length).toBeGreaterThanOrEqual(2);
  
  // Peer 3 should know about signal1 and signal2 (learned from peer1)
  const peer3Servers = peer3.getRankedServers();
  expect(peer3Servers.find(s => s.url === 'wss://signal1.com')).toBeDefined();
  expect(peer3Servers.find(s => s.url === 'wss://signal2.com')).toBeDefined();
});
