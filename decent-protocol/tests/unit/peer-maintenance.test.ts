/**
 * T2.5: Proactive Peer Maintenance tests
 *
 * Tests the peer maintenance sweep state machine — pure in-memory,
 * no real WebRTC or transport involved.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Minimal peer maintenance state machine — mirrors ChatController logic
// ---------------------------------------------------------------------------

interface WorkspaceMember {
  peerId: string;
  alias: string;
}

interface Workspace {
  id: string;
  members: WorkspaceMember[];
}

class PeerMaintenanceStateMachine {
  myPeerId = 'alice';
  activeWorkspaceId: string | null = null;

  /** Mirrors transport.getConnectedPeers() */
  connectedPeers = new Set<string>();

  /** Mirrors state.connectingPeers */
  connectingPeers = new Set<string>();

  /** Mirrors workspaceManager.getWorkspace() */
  workspace: Workspace | null = null;

  /** connect() calls made by maintenance sweep */
  connectAttempts: string[] = [];

  /** If true, connect() rejects */
  connectShouldFail = false;

  private maintenanceInterval: ReturnType<typeof setInterval> | null = null;

  /** Mirrors ChatController._runPeerMaintenance() */
  runPeerMaintenance(): number {
    const ws = this.activeWorkspaceId
      ? this.workspace
      : null;
    if (!ws) return 0;

    let attempted = 0;
    for (const member of ws.members) {
      if (member.peerId === this.myPeerId) continue;
      if (this.connectedPeers.has(member.peerId)) continue;
      if (this.connectingPeers.has(member.peerId)) continue;

      attempted++;
      this.connectingPeers.add(member.peerId);
      this._doConnect(member.peerId);
    }
    return attempted;
  }

  private _doConnect(peerId: string): void {
    this.connectAttempts.push(peerId);
    if (this.connectShouldFail) {
      // Simulate async failure — remove from connectingPeers
      Promise.resolve().then(() => {
        this.connectingPeers.delete(peerId);
      });
    } else {
      // Simulate async success
      Promise.resolve().then(() => {
        this.connectingPeers.delete(peerId);
        this.connectedPeers.add(peerId);
      });
    }
  }

  startMaintenance(intervalMs = 60_000): void {
    if (this.maintenanceInterval) return;
    this.runPeerMaintenance();
    this.maintenanceInterval = setInterval(() => this.runPeerMaintenance(), intervalMs);
  }

  stopMaintenance(): void {
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
  }

  get isRunning(): boolean {
    return this.maintenanceInterval !== null;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('T2.5 Proactive Peer Maintenance', () => {
  let sm: PeerMaintenanceStateMachine;

  beforeEach(() => {
    sm = new PeerMaintenanceStateMachine();
    sm.activeWorkspaceId = 'ws-1';
    sm.workspace = {
      id: 'ws-1',
      members: [
        { peerId: 'alice', alias: 'Alice' },  // self — should be skipped
        { peerId: 'bob', alias: 'Bob' },
        { peerId: 'carol', alias: 'Carol' },
      ],
    };
  });

  afterEach(() => {
    sm.stopMaintenance();
  });

  // ── Basic sweep ──────────────────────────────────────────────────────────

  test('attempts connection to all unconnected members', () => {
    const attempted = sm.runPeerMaintenance();

    expect(attempted).toBe(2); // bob + carol
    expect(sm.connectAttempts).toContain('bob');
    expect(sm.connectAttempts).toContain('carol');
  });

  test('skips self (myPeerId)', () => {
    sm.runPeerMaintenance();
    expect(sm.connectAttempts).not.toContain('alice');
  });

  test('skips already connected peers', () => {
    sm.connectedPeers.add('bob');

    sm.runPeerMaintenance();

    expect(sm.connectAttempts).not.toContain('bob');
    expect(sm.connectAttempts).toContain('carol');
  });

  test('skips peers already in connectingPeers (in-flight)', () => {
    sm.connectingPeers.add('carol');

    sm.runPeerMaintenance();

    expect(sm.connectAttempts).toContain('bob');
    expect(sm.connectAttempts).not.toContain('carol');
  });

  test('skips all when fully connected', () => {
    sm.connectedPeers.add('bob');
    sm.connectedPeers.add('carol');

    const attempted = sm.runPeerMaintenance();
    expect(attempted).toBe(0);
    expect(sm.connectAttempts).toHaveLength(0);
  });

  // ── State after sweep ────────────────────────────────────────────────────

  test('adds peer to connectingPeers during connect attempt', () => {
    sm.runPeerMaintenance();

    // Synchronously, bob and carol should be in connectingPeers
    expect(sm.connectingPeers.has('bob')).toBe(true);
    expect(sm.connectingPeers.has('carol')).toBe(true);
  });

  test('removes peer from connectingPeers and adds to connected on success', async () => {
    sm.connectShouldFail = false;
    sm.runPeerMaintenance();

    await sleep(10); // let promises resolve

    expect(sm.connectingPeers.has('bob')).toBe(false);
    expect(sm.connectedPeers.has('bob')).toBe(true);
  });

  test('removes peer from connectingPeers on connect failure', async () => {
    sm.connectShouldFail = true;
    sm.runPeerMaintenance();

    await sleep(10);

    expect(sm.connectingPeers.has('bob')).toBe(false);
    expect(sm.connectedPeers.has('bob')).toBe(false);
  });

  // ── Idempotency ──────────────────────────────────────────────────────────

  test('second sweep does not duplicate connect attempts (connectingPeers guard)', () => {
    sm.runPeerMaintenance(); // first sweep — bob + carol added to connectingPeers
    sm.runPeerMaintenance(); // second sweep — both already in connectingPeers

    // Each peer should only be attempted once
    expect(sm.connectAttempts.filter(p => p === 'bob')).toHaveLength(1);
    expect(sm.connectAttempts.filter(p => p === 'carol')).toHaveLength(1);
  });

  test('after successful connect, peer no longer attempted on next sweep', async () => {
    sm.connectShouldFail = false;
    sm.runPeerMaintenance();

    await sleep(10); // bob + carol now connected

    sm.connectAttempts = []; // reset
    sm.runPeerMaintenance();

    expect(sm.connectAttempts).toHaveLength(0);
  });

  test('after failed connect, peer is retried on next sweep', async () => {
    sm.connectShouldFail = true;
    sm.runPeerMaintenance();

    await sleep(10); // bob + carol fail, removed from connectingPeers

    sm.connectAttempts = []; // reset
    sm.runPeerMaintenance();

    // Both should be retried
    expect(sm.connectAttempts).toContain('bob');
    expect(sm.connectAttempts).toContain('carol');
  });

  // ── No workspace ────────────────────────────────────────────────────────

  test('does nothing when no active workspace', () => {
    sm.activeWorkspaceId = null;

    const attempted = sm.runPeerMaintenance();
    expect(attempted).toBe(0);
    expect(sm.connectAttempts).toHaveLength(0);
  });

  test('does nothing when workspace is null', () => {
    sm.workspace = null;

    const attempted = sm.runPeerMaintenance();
    expect(attempted).toBe(0);
  });

  // ── startMaintenance / stopMaintenance ───────────────────────────────────

  test('startMaintenance runs sweep immediately', () => {
    sm.startMaintenance(60_000);

    // Should have run immediately
    expect(sm.connectAttempts.length).toBeGreaterThan(0);
  });

  test('startMaintenance is idempotent (second call is no-op)', () => {
    sm.startMaintenance(60_000);
    const firstAttempts = [...sm.connectAttempts];

    sm.startMaintenance(60_000); // second call — no-op
    expect(sm.connectAttempts).toHaveLength(firstAttempts.length);
  });

  test('stopMaintenance stops the interval', async () => {
    sm.startMaintenance(10); // 10ms interval for test
    await sleep(25); // let a few sweeps fire

    sm.stopMaintenance();
    expect(sm.isRunning).toBe(false);

    const countBefore = sm.connectAttempts.length;
    await sleep(25); // no new sweeps should fire
    expect(sm.connectAttempts.length).toBe(countBefore);
  });

  test('stopMaintenance is safe to call when not running', () => {
    expect(() => sm.stopMaintenance()).not.toThrow();
  });

  // ── New member discovery ────────────────────────────────────────────────

  test('maintenance connects to newly added workspace members', async () => {
    sm.connectedPeers.add('bob');
    sm.connectedPeers.add('carol');

    sm.runPeerMaintenance(); // all connected — no attempts

    // Dave joins the workspace
    sm.workspace!.members.push({ peerId: 'dave', alias: 'Dave' });
    sm.connectAttempts = [];

    sm.runPeerMaintenance(); // should attempt dave

    expect(sm.connectAttempts).toContain('dave');
  });
});
