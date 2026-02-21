/**
 * GAP 11: Gossip Partition — TTL-limited message propagation
 *
 * Scenario: 5 peers, C is bridge between {A,B} and {D,E}. C disconnects.
 * A sends a message.
 *
 * Verify: with TTL=2, message does NOT reach D/E (document this limitation).
 * No crash, no infinite loop.
 */

import { describe, test, expect, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// In-memory gossip simulation (mirrors DecentChat gossip relay logic)
// ---------------------------------------------------------------------------

interface GossipMessage {
  id: string;
  content: string;
  senderId: string;
  ttl: number;
  hops: string[];
}

class GossipPeer {
  peerId: string;
  connections = new Set<string>();
  received = new Map<string, GossipMessage>();
  forwarded = new Map<string, Set<string>>();
  onReceive?: (msg: GossipMessage) => void;

  constructor(peerId: string) {
    this.peerId = peerId;
  }

  connect(otherPeerId: string): void {
    this.connections.add(otherPeerId);
  }

  disconnect(otherPeerId: string): void {
    this.connections.delete(otherPeerId);
  }
}

class GossipNetwork {
  peers = new Map<string, GossipPeer>();

  addPeer(peerId: string): GossipPeer {
    const peer = new GossipPeer(peerId);
    this.peers.set(peerId, peer);
    return peer;
  }

  /** Bidirectional connection */
  connect(a: string, b: string): void {
    this.peers.get(a)?.connect(b);
    this.peers.get(b)?.connect(a);
  }

  /** Bidirectional disconnect */
  disconnect(a: string, b: string): void {
    this.peers.get(a)?.disconnect(b);
    this.peers.get(b)?.disconnect(a);
  }

  /** Full disconnect of a peer from all its connections */
  disconnectPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    for (const connId of peer.connections) {
      this.peers.get(connId)?.disconnect(peerId);
    }
    peer.connections.clear();
  }

  /**
   * Send a gossip message from a peer. Propagates through the network
   * respecting TTL. Returns the set of peer IDs that received the message.
   */
  gossip(senderId: string, content: string, ttl: number): Set<string> {
    const msg: GossipMessage = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      content,
      senderId,
      ttl,
      hops: [senderId],
    };

    const reached = new Set<string>();
    const sender = this.peers.get(senderId);
    if (!sender) return reached;

    // Sender "receives" its own message
    sender.received.set(msg.id, msg);
    reached.add(senderId);

    // BFS propagation with TTL
    const queue: { peerId: string; msg: GossipMessage }[] = [];

    // Initial forward to direct connections (only if TTL allows)
    if (ttl > 0) {
      for (const connId of sender.connections) {
        queue.push({
          peerId: connId,
          msg: { ...msg, ttl: ttl - 1, hops: [...msg.hops, connId] },
        });
      }
    }

    const processed = new Set<string>(); // dedup: msgId:peerId
    processed.add(`${msg.id}:${senderId}`);

    while (queue.length > 0) {
      const item = queue.shift()!;
      const key = `${item.msg.id}:${item.peerId}`;

      if (processed.has(key)) continue;
      processed.add(key);

      const peer = this.peers.get(item.peerId);
      if (!peer) continue;

      // Already has this message? Skip
      if (peer.received.has(item.msg.id)) continue;

      // Receive the message
      peer.received.set(item.msg.id, item.msg);
      reached.add(item.peerId);
      peer.onReceive?.(item.msg);

      // Forward if TTL > 0
      if (item.msg.ttl > 0) {
        for (const connId of peer.connections) {
          const fwdKey = `${item.msg.id}:${connId}`;
          if (!processed.has(fwdKey)) {
            queue.push({
              peerId: connId,
              msg: {
                ...item.msg,
                ttl: item.msg.ttl - 1,
                hops: [...item.msg.hops, connId],
              },
            });
          }
        }
      }
    }

    return reached;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Gossip Partition — TTL-limited propagation', () => {
  let network: GossipNetwork;

  beforeEach(() => {
    network = new GossipNetwork();

    // Topology: A — B — C — D — E (linear chain)
    // C is the bridge between {A,B} and {D,E}
    network.addPeer('A');
    network.addPeer('B');
    network.addPeer('C');
    network.addPeer('D');
    network.addPeer('E');

    network.connect('A', 'B');
    network.connect('B', 'C');
    network.connect('C', 'D');
    network.connect('D', 'E');
  });

  test('TTL=2 reaches A→B→C but not D or E when sent from A', () => {
    const reached = network.gossip('A', 'Hello from A', 2);

    expect(reached.has('A')).toBe(true);
    expect(reached.has('B')).toBe(true);
    expect(reached.has('C')).toBe(true);

    // TTL exhausted before reaching D and E — this is the documented limitation
    expect(reached.has('D')).toBe(false);
    expect(reached.has('E')).toBe(false);
  });

  test('TTL=4 reaches all peers in linear chain', () => {
    const reached = network.gossip('A', 'Hello from A', 4);

    expect(reached.has('A')).toBe(true);
    expect(reached.has('B')).toBe(true);
    expect(reached.has('C')).toBe(true);
    expect(reached.has('D')).toBe(true);
    expect(reached.has('E')).toBe(true);
  });

  test('C disconnects: A message does not reach D or E even with high TTL', () => {
    // Disconnect C from the network
    network.disconnectPeer('C');

    const reached = network.gossip('A', 'Hello after partition', 10);

    expect(reached.has('A')).toBe(true);
    expect(reached.has('B')).toBe(true);

    // C, D, E are unreachable (partition)
    expect(reached.has('C')).toBe(false);
    expect(reached.has('D')).toBe(false);
    expect(reached.has('E')).toBe(false);
  });

  test('no infinite loop in mesh topology', () => {
    // Create a cycle: A — B — C — A
    network.connect('A', 'C');

    const reached = network.gossip('A', 'Cycle test', 5);

    // No crash, no infinite loop, all reachable peers get it
    expect(reached.has('A')).toBe(true);
    expect(reached.has('B')).toBe(true);
    expect(reached.has('C')).toBe(true);
  });

  test('no infinite loop in fully connected graph', () => {
    // Connect everyone to everyone
    const peers = ['A', 'B', 'C', 'D', 'E'];
    for (let i = 0; i < peers.length; i++) {
      for (let j = i + 1; j < peers.length; j++) {
        network.connect(peers[i], peers[j]);
      }
    }

    const reached = network.gossip('A', 'Full mesh', 3);

    // All peers reachable with TTL=1 in fully connected graph
    for (const p of peers) {
      expect(reached.has(p)).toBe(true);
    }
  });

  test('message is not forwarded beyond TTL=0', () => {
    const reached = network.gossip('A', 'TTL zero', 0);

    // Only sender receives
    expect(reached.has('A')).toBe(true);
    expect(reached.size).toBe(1);
  });

  test('TTL=1 reaches only direct connections', () => {
    const reached = network.gossip('C', 'TTL one', 1);

    expect(reached.has('C')).toBe(true);
    expect(reached.has('B')).toBe(true); // Direct connection
    expect(reached.has('D')).toBe(true); // Direct connection
    expect(reached.has('A')).toBe(false); // 2 hops away
    expect(reached.has('E')).toBe(false); // 2 hops away
  });

  test('duplicate message not processed twice', () => {
    // Create a diamond: A→B→D, A→C→D
    const diamond = new GossipNetwork();
    diamond.addPeer('A');
    diamond.addPeer('B');
    diamond.addPeer('C');
    diamond.addPeer('D');

    diamond.connect('A', 'B');
    diamond.connect('A', 'C');
    diamond.connect('B', 'D');
    diamond.connect('C', 'D');

    let dReceiveCount = 0;
    diamond.peers.get('D')!.onReceive = () => { dReceiveCount++; };

    diamond.gossip('A', 'Diamond test', 3);

    // D should receive the message exactly once
    expect(dReceiveCount).toBe(1);
    expect(diamond.peers.get('D')!.received.size).toBe(1);
  });

  test('partition heals: C reconnects, new message reaches D/E', () => {
    // First: disconnect C
    network.disconnectPeer('C');

    const r1 = network.gossip('A', 'During partition', 10);
    expect(r1.has('D')).toBe(false);

    // Heal: reconnect C
    network.connect('B', 'C');
    network.connect('C', 'D');

    const r2 = network.gossip('A', 'After heal', 10);
    expect(r2.has('D')).toBe(true);
    expect(r2.has('E')).toBe(true);
  });

  test('sending from disconnected peer reaches no one', () => {
    network.disconnectPeer('C');

    const reached = network.gossip('C', 'Lonely message', 5);

    // Only C itself
    expect(reached.size).toBe(1);
    expect(reached.has('C')).toBe(true);
  });
});
