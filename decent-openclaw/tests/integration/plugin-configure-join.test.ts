/**
 * In-process E2E integration test: configure → start → join
 *
 * Verifies the full lifecycle that a user goes through after
 * `openclaw plugins install @decentchat/decentchat-plugin`:
 *
 *   1. Setup wizard generates a valid seed phrase
 *   2. The seed phrase produces a deterministic peer identity
 *   3. Two peers connect via local signaling and complete a workspace join
 *
 * Architecture:
 *   - PeerServer (from `peer` npm package) on localhost, random port
 *   - Two DecentChatNodePeer instances, each with a temp data directory
 *   - Real crypto, real WebRTC (via node-datachannel polyfill), real sync protocol
 *   - No Docker, no external services — runs in ~5-10s
 *
 * The WebRTC polyfill (node-datachannel) is preloaded via bunfig.toml
 * so RTCPeerConnection is installed on globalThis before any module
 * evaluates. This avoids the PeerJS `supports` IIFE timing issue.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CryptoManager,
  InviteURI,
  SeedPhraseManager,
  WorkspaceManager,
} from '@decentchat/protocol';

import { decentChatPlugin, resolveDecentChatAccount } from '../../src/channel.ts';
import { DecentChatNodePeer, resetDecentChatNodePeerStartupLockForTests } from '../../src/peer/DecentChatNodePeer.ts';

type DecentChatNodePeerType = InstanceType<typeof DecentChatNodePeer>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const seedMgr = new SeedPhraseManager();

/** Poll a predicate until it returns true or the timeout elapses. */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 20_000, intervalMs = 250 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/** Read workspaces.json from a peer's data directory (returns [] if missing). */
function readWorkspaces(dataDir: string): any[] {
  const p = join(dataDir, 'workspaces.json');
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

/** Build a minimal ResolvedDecentChatAccount for test peers. */
function makeAccount(opts: {
  seedPhrase: string;
  alias: string;
  dataDir: string;
  signalingServer: string;
  invites?: string[];
}) {
  return resolveDecentChatAccount({
    channels: {
      decentchat: {
        seedPhrase: opts.seedPhrase,
        alias: opts.alias,
        dataDir: opts.dataDir,
        signalingServer: opts.signalingServer,
        invites: opts.invites ?? [],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('plugin configure → peer start → workspace join', () => {
  let tmpRoot: string;
  let signalingUrl: string;
  let signalingPort: number;
  let httpServer: http.Server;
  const connectedPeers = new Set<string>();

  // Peer identities
  let seedA: string;
  let seedB: string;
  let peerIdA: string;
  let peerIdB: string;
  let publicKeyA: string;

  // Data directories
  let dataDirA: string;
  let dataDirB: string;

  // Peer instances (created in individual tests)
  let peerA: DecentChatNodePeerType | null = null;
  let peerB: DecentChatNodePeerType | null = null;

  // Workspace details
  let workspaceId: string;
  let inviteCode: string;
  let inviteUri: string;

  beforeAll(async () => {
    resetDecentChatNodePeerStartupLockForTests();

    tmpRoot = mkdtempSync(join(tmpdir(), 'decentchat-e2e-'));
    dataDirA = join(tmpRoot, 'peer-a');
    dataDirB = join(tmpRoot, 'peer-b');
    mkdirSync(dataDirA, { recursive: true });
    mkdirSync(dataDirB, { recursive: true });

    // Generate identities
    seedA = seedMgr.generate().mnemonic;
    seedB = seedMgr.generate().mnemonic;
    peerIdA = await seedMgr.derivePeerId(seedA);
    peerIdB = await seedMgr.derivePeerId(seedB);

    // Derive Peer A's public key so we can build a proper workspace
    const keysA = await seedMgr.deriveKeys(seedA);
    const tempCrypto = new CryptoManager();
    publicKeyA = await tempCrypto.exportPublicKey(keysA.ecdhKeyPair.publicKey);

    // Start PeerServer on a random port (port 0 = OS-assigned).
    // The `peer` package's PeerServer creates its own http server internally.
    const { PeerServer } = await import('peer');
    signalingPort = await new Promise<number>((resolve) => {
      const peerServer = PeerServer({ port: 0, path: '/peerjs' }, (server: http.Server) => {
        httpServer = server;
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(port);
      });

      // Track connected peers via server events
      peerServer.on('connection', (client: any) => {
        connectedPeers.add(client.getId());
      });
      peerServer.on('disconnect', (client: any) => {
        connectedPeers.delete(client.getId());
      });
    });

    signalingUrl = `http://localhost:${signalingPort}/peerjs`;

    // Pre-seed Peer A with a workspace so it can accept join requests.
    // This mimics what happens after a user creates a workspace in the web client.
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('Test Workspace', peerIdA, 'Peer A', publicKeyA);
    workspaceId = ws.id;
    inviteCode = ws.inviteCode;

    writeFileSync(join(dataDirA, 'workspaces.json'), JSON.stringify([ws], null, 2), 'utf-8');

    // Build the invite URI pointing at our local signaling server
    inviteUri = InviteURI.create({
      host: 'localhost',
      port: signalingPort,
      inviteCode,
      peerId: peerIdA,
      workspaceId,
      workspaceName: 'Test Workspace',
      secure: false,
    });
  }, 30_000);

  afterAll(async () => {
    peerA?.destroy();
    peerB?.destroy();
    try { httpServer?.close(); } catch { /* already stopped */ }
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  // -------------------------------------------------------------------------
  // 1. Setup wizard generates a valid seed phrase
  // -------------------------------------------------------------------------

  test('setup wizard generates a valid 12-word seed phrase for fresh config', async () => {
    const wizard = decentChatPlugin.setupWizard!;

    const result = await wizard.prepare!({
      cfg: {} as any,
      accountId: 'default',
      credentialValues: {},
      runtime: {} as any,
      prompter: {
        confirm: async () => true,
        note: async () => {},
        text: async () => '',
        select: async () => '',
        multiselect: async () => [],
      } as any,
    });

    expect(result).toBeDefined();
    const generatedSeed = result!.credentialValues!.privateKey!;
    const words = generatedSeed.trim().split(/\s+/);
    expect(words.length).toBe(12);

    const validation = seedMgr.validate(generatedSeed);
    expect(validation.valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Seed phrase produces a valid peer identity
  // -------------------------------------------------------------------------

  test('seed phrase deterministically produces a peer identity', async () => {
    const derivedId = await seedMgr.derivePeerId(seedB);
    expect(derivedId).toBe(peerIdB);
    expect(derivedId.length).toBeGreaterThan(0);

    // Deriving again yields the same result
    const derivedAgain = await seedMgr.derivePeerId(seedB);
    expect(derivedAgain).toBe(derivedId);
  });

  // -------------------------------------------------------------------------
  // 3. Peer A starts and registers with signaling
  // -------------------------------------------------------------------------

  test('peer A starts and connects to local signaling', async () => {
    const logs: string[] = [];

    const accountA = makeAccount({
      seedPhrase: seedA,
      alias: 'Peer A',
      dataDir: dataDirA,
      signalingServer: signalingUrl,
    });

    peerA = new DecentChatNodePeer({
      account: accountA,
      onIncomingMessage: async () => {},
      onReply: () => {},
      log: { info: (s) => logs.push(s), warn: (s) => logs.push(s), error: (s) => logs.push(s) },
    });

    await peerA.start();

    expect(peerA.peerId).toBe(peerIdA);

    // Wait for Peer A to register with the PeerServer
    await waitFor(() => connectedPeers.has(peerIdA), { timeoutMs: 15_000 });
    expect(connectedPeers.has(peerIdA)).toBe(true);

    // Verify the pre-seeded workspace was loaded
    const wsFile = readWorkspaces(dataDirA);
    expect(wsFile.length).toBe(1);
    expect(wsFile[0].id).toBe(workspaceId);
  }, 30_000);

  // -------------------------------------------------------------------------
  // 4. Peer B joins workspace via invite URI
  // -------------------------------------------------------------------------

  test('peer B joins workspace via invite URI', async () => {
    resetDecentChatNodePeerStartupLockForTests();

    const logs: string[] = [];

    const accountB = makeAccount({
      seedPhrase: seedB,
      alias: 'Peer B',
      dataDir: dataDirB,
      signalingServer: signalingUrl,
      invites: [inviteUri],
    });

    peerB = new DecentChatNodePeer({
      account: accountB,
      onIncomingMessage: async () => {},
      onReply: () => {},
      log: { info: (s) => logs.push(s), warn: (s) => logs.push(s), error: (s) => logs.push(s) },
    });

    await peerB.start();
    expect(peerB.peerId).toBe(peerIdB);

    // Wait for Peer B to register with the PeerServer
    await waitFor(() => connectedPeers.has(peerIdB), { timeoutMs: 15_000 });

    // Wait for Peer B to receive the workspace (persisted to disk after workspace-joined event)
    await waitFor(() => {
      const ws = readWorkspaces(dataDirB);
      return ws.length > 0 && ws.some((w: any) => w.id === workspaceId);
    }, { timeoutMs: 30_000 });

    // -- Assert: Peer B has the workspace --
    const peerBWorkspaces = readWorkspaces(dataDirB);
    expect(peerBWorkspaces.length).toBe(1);
    const joinedWs = peerBWorkspaces[0];
    expect(joinedWs.id).toBe(workspaceId);
    expect(joinedWs.name).toBe('Test Workspace');

    // -- Assert: Peer B is a member --
    const memberPeerIds = joinedWs.members.map((m: any) => m.peerId);
    expect(memberPeerIds).toContain(peerIdB);

    // -- Assert: Peer A is also a member (workspace owner) --
    expect(memberPeerIds).toContain(peerIdA);

    // -- Assert: Peer A's workspace was updated to include Peer B --
    await waitFor(() => {
      const ws = readWorkspaces(dataDirA);
      if (ws.length === 0) return false;
      const host = ws.find((w: any) => w.id === workspaceId);
      if (!host) return false;
      return host.members.some((m: any) => m.peerId === peerIdB);
    }, { timeoutMs: 15_000 });

    const peerAWorkspaces = readWorkspaces(dataDirA);
    const hostWs = peerAWorkspaces.find((w: any) => w.id === workspaceId);
    expect(hostWs).toBeDefined();
    const hostMemberIds = hostWs.members.map((m: any) => m.peerId);
    expect(hostMemberIds).toContain(peerIdA);
    expect(hostMemberIds).toContain(peerIdB);
  }, 60_000);
});
