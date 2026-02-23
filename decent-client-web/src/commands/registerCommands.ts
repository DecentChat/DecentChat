/**
 * Register all slash commands for DecentChat
 */

import type { CommandParser, CommandResult } from './CommandParser';
import type { ChatController } from '../app/ChatController';
import type { AppState } from '../main';

export function registerCommands(parser: CommandParser, ctrl: ChatController, state: AppState): void {

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔐 IDENTITY & SECURITY
  // ═══════════════════════════════════════════════════════════════════════════

  parser.register({
    name: 'seed',
    description: 'Show your 12-word seed phrase',
    usage: '/seed',
    category: 'identity',
    execute: async () => {
      const identity = await ctrl.persistentStore.getSetting('seedPhrase');
      if (!identity) {
        return { handled: true, output: '⚠️ No seed phrase set. Generate one in Settings.' };
      }
      return {
        handled: true,
        output: `🔐 Your seed phrase (KEEP SECRET!):\n\n${identity}\n\n⚠️ Anyone with these words can access your account.`,
      };
    },
  });

  parser.register({
    name: 'pubkey',
    aliases: ['pk'],
    description: 'Show your public key',
    usage: '/pubkey',
    category: 'identity',
    execute: () => ({
      handled: true,
      output: `🔑 Your public key:\n${ctrl.myPublicKey || 'Not initialized'}`,
    }),
  });

  parser.register({
    name: 'whoami',
    description: 'Show your identity info',
    usage: '/whoami',
    category: 'identity',
    execute: () => ({
      handled: true,
      output: [
        `👤 Identity`,
        `  Peer ID:    ${state.myPeerId}`,
        `  Alias:      ${state.myAlias}`,
        `  Public Key:  ${ctrl.myPublicKey?.slice(0, 24)}...`,
        `  Workspace:  ${state.activeWorkspaceId || 'none'}`,
        `  Channel:    ${state.activeChannelId || 'none'}`,
      ].join('\n'),
    }),
  });

  parser.register({
    name: 'safety',
    description: 'Show safety number for a peer',
    usage: '/safety <peerId>',
    category: 'identity',
    execute: async (args) => {
      if (!args[0]) return { handled: true, error: 'Usage: /safety <peerId>' };
      const peerId = args[0];
      const peerData = await ctrl.persistentStore.getPeer(peerId);
      if (!peerData) return { handled: true, error: `Unknown peer: ${peerId}` };

      // Compute safety number (sorted public keys → hash → 60 digits)
      const keys = [ctrl.myPublicKey, peerData.publicKey].sort();
      const combined = keys.join(':');
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined));
      const bytes = new Uint8Array(hash);
      let digits = '';
      for (let i = 0; i < 30; i++) {
        digits += ((bytes[i % bytes.length] * 256 + bytes[(i + 1) % bytes.length]) % 100)
          .toString().padStart(2, '0');
      }
      const formatted = digits.match(/.{5}/g)!.join(' ');

      return {
        handled: true,
        output: `🔐 Safety Number with ${peerId.slice(0, 8)}:\n\n${formatted}\n\nCompare this with your peer. If they match, the connection is secure.`,
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 🏠 WORKSPACE
  // ═══════════════════════════════════════════════════════════════════════════

  parser.register({
    name: 'invite',
    description: 'Generate invite link for this workspace',
    usage: '/invite',
    category: 'workspace',
    execute: () => {
      if (!state.activeWorkspaceId) {
        return { handled: true, error: 'No active workspace' };
      }
      const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
      if (!ws) return { handled: true, error: 'Workspace not found' };

      const code = ws.inviteCode || 'NONE';
      const uri = ctrl.generateInviteURL(state.activeWorkspaceId);

      return {
        handled: true,
        output: `📨 Invite to "${ws.name}":\n\n${uri}\n\nInvite code: ${code}\nPeer ID: ${state.myPeerId}\n\nShare this with someone to invite them.`,
      };
    },
  });

  parser.register({
    name: 'members',
    aliases: ['who'],
    description: 'List workspace members',
    usage: '/members',
    category: 'workspace',
    execute: () => {
      if (!state.activeWorkspaceId) return { handled: true, error: 'No active workspace' };
      const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
      if (!ws) return { handled: true, error: 'Workspace not found' };

      const lines = ws.members.map((m: any) => {
        const online = state.readyPeers.has(m.peerId) ? '🟢' : '⚫';
        const me = m.peerId === state.myPeerId ? ' (you)' : '';
        const role = m.role === 'admin' ? ' 👑' : '';
        return `  ${online} ${m.alias || m.peerId.slice(0, 8)}${me}${role}`;
      });

      return {
        handled: true,
        output: `👥 Members of "${ws.name}" (${ws.members.length}):\n${lines.join('\n')}`,
      };
    },
  });

  parser.register({
    name: 'kick',
    description: 'Remove a peer from workspace',
    usage: '/kick <peerId>',
    category: 'workspace',
    execute: (args) => {
      if (!args[0]) return { handled: true, error: 'Usage: /kick <peerId>' };
      if (!state.activeWorkspaceId) return { handled: true, error: 'No active workspace' };

      const result = ctrl.workspaceManager.removeMember(
        state.activeWorkspaceId, args[0], state.myPeerId,
      );

      if (result?.success === false) {
        return { handled: true, error: result.error || 'Failed to kick member' };
      }
      return { handled: true, output: `👢 Kicked ${args[0].slice(0, 8)} from workspace.` };
    },
  });

  parser.register({
    name: 'ban',
    description: 'Ban a peer (disconnect + rate limit)',
    usage: '/ban <peerId> [minutes]',
    category: 'workspace',
    execute: (args) => {
      if (!args[0]) return { handled: true, error: 'Usage: /ban <peerId> [minutes]' };
      const minutes = parseInt(args[1]) || 60;
      ctrl.messageGuard.ban(args[0], minutes * 60 * 1000);
      return { handled: true, output: `🚫 Banned ${args[0].slice(0, 8)} for ${minutes} minutes.` };
    },
  });

  parser.register({
    name: 'unban',
    description: 'Unban a peer',
    usage: '/unban <peerId>',
    category: 'workspace',
    execute: (args) => {
      if (!args[0]) return { handled: true, error: 'Usage: /unban <peerId>' };
      ctrl.messageGuard.unban(args[0]);
      return { handled: true, output: `✅ Unbanned ${args[0].slice(0, 8)}.` };
    },
  });

  parser.register({
    name: 'delete-workspace',
    description: 'Delete active workspace (owner only)',
    usage: '/delete-workspace',
    category: 'workspace',
    execute: async () => {
      if (!state.activeWorkspaceId) return { handled: true, error: 'No active workspace' };
      const ok = await ctrl.deleteWorkspace(state.activeWorkspaceId);
      if (!ok) return { handled: true, error: 'Only owner can delete workspace' };
      return { handled: true, output: '🗑️ Workspace deleted' };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 💬 CHANNEL
  // ═══════════════════════════════════════════════════════════════════════════

  parser.register({
    name: 'create',
    description: 'Create a new channel',
    usage: '/create <name>',
    category: 'channel',
    execute: async (args, rawArgs) => {
      const name = rawArgs.replace(/^#/, '').trim();
      if (!name) return { handled: true, error: 'Usage: /create <channel-name>' };

      const result = ctrl.createChannel(name);
      if (!result.success) return { handled: true, error: result.error || 'Failed' };

      if (state.activeWorkspaceId) {
        await ctrl.persistWorkspace(state.activeWorkspaceId);
      }
      return { handled: true, output: `✅ Created channel #${name}` };
    },
  });

  parser.register({
    name: 'topic',
    description: 'Set channel topic',
    usage: '/topic <text>',
    category: 'channel',
    execute: async (_args, rawArgs) => {
      if (!rawArgs) return { handled: true, error: 'Usage: /topic <text>' };
      if (!state.activeWorkspaceId || !state.activeChannelId) {
        return { handled: true, error: 'No active channel' };
      }

      const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
      const ch = ws?.channels.find((c: any) => c.id === state.activeChannelId);
      if (ch) {
        (ch as any).topic = rawArgs;
        await ctrl.persistWorkspace(state.activeWorkspaceId);
      }
      return { handled: true, output: `📌 Topic set to: ${rawArgs}` };
    },
  });

  parser.register({
    name: 'remove-channel',
    description: 'Remove current channel (admins/owner only)',
    usage: '/remove-channel',
    category: 'channel',
    execute: async () => {
      if (!state.activeWorkspaceId || !state.activeChannelId) {
        return { handled: true, error: 'No active channel' };
      }
      const res = await ctrl.removeChannel(state.activeChannelId);
      if (!res.success) return { handled: true, error: res.error || 'Failed to remove channel' };
      return { handled: true, output: '🗑️ Channel removed' };
    },
  });

  parser.register({
    name: 'dm',
    description: 'Open a DM with a peer',
    usage: '/dm <peerId>',
    category: 'channel',
    execute: (args) => {
      if (!args[0]) return { handled: true, error: 'Usage: /dm <peerId>' };
      const result = ctrl.createDM(args[0]);
      if (!result.success) return { handled: true, error: 'Failed to create DM' };
      return { handled: true, output: `💬 DM opened with ${args[0].slice(0, 8)}` };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 📎 MEDIA & STORAGE
  // ═══════════════════════════════════════════════════════════════════════════

  parser.register({
    name: 'storage',
    description: 'Show storage usage breakdown',
    usage: '/storage',
    category: 'media',
    execute: () => {
      const stats = ctrl.getStorageStats();
      const formatBytes = (b: number) => {
        if (b < 1024) return `${b} B`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
        return `${(b / (1024 * 1024)).toFixed(1)} MB`;
      };

      let output = `📊 Storage Usage: ${formatBytes(stats.totalBytes)}\n`;
      output += `  Attachments: ${stats.attachmentCount} (${stats.prunedCount} pruned)\n`;

      for (const [type, info] of Object.entries(stats.byType)) {
        output += `  ${type}: ${info.count} files, ${formatBytes(info.bytes)}\n`;
      }

      if (state.activeWorkspaceId) {
        const wsStats = ctrl.getWorkspaceStorageStats(state.activeWorkspaceId);
        output += `\n  Current workspace: ${formatBytes(wsStats.totalBytes)}`;
      }

      return { handled: true, output };
    },
  });

  parser.register({
    name: 'prune',
    description: 'Prune media older than N days',
    usage: '/prune [days]',
    category: 'media',
    execute: async (args) => {
      const days = parseInt(args[0]) || 30;
      const pruned = await ctrl.pruneOldMedia(days * 24 * 60 * 60 * 1000);
      return { handled: true, output: `🗑️ Pruned ${pruned} attachment${pruned !== 1 ? 's' : ''} older than ${days} days.` };
    },
  });

  parser.register({
    name: 'clear',
    description: 'Clear all media in current workspace',
    usage: '/clear',
    category: 'media',
    execute: async () => {
      if (!state.activeWorkspaceId) return { handled: true, error: 'No active workspace' };
      const pruned = await ctrl.pruneWorkspaceMedia(state.activeWorkspaceId);
      return { handled: true, output: `🗑️ Cleared ${pruned} attachment${pruned !== 1 ? 's' : ''} from workspace.` };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌐 NETWORK
  // ═══════════════════════════════════════════════════════════════════════════

  parser.register({
    name: 'peers',
    description: 'Show connected peers with details',
    usage: '/peers',
    category: 'network',
    execute: () => {
      const connected = Array.from(state.connectedPeers);
      const ready = Array.from(state.readyPeers);

      if (connected.length === 0) {
        return { handled: true, output: '🌐 No peers connected.' };
      }

      const lines = connected.map(p => {
        const encrypted = ready.includes(p) ? '🔐' : '🔓';
        const clock = ctrl.clockSync.getPeerClock(p);
        const offset = clock ? `${clock.offsetMs > 0 ? '+' : ''}${clock.offsetMs}ms` : 'unknown';
        const rtt = clock ? `${clock.rttMs}ms` : '-';
        const confidence = clock?.confidence || '-';

        return `  ${encrypted} ${p.slice(0, 12)}  RTT: ${rtt}  Clock: ${offset} (${confidence})`;
      });

      return {
        handled: true,
        output: `🌐 Peers (${connected.length} connected, ${ready.length} encrypted):\n${lines.join('\n')}`,
      };
    },
  });

  parser.register({
    name: 'status',
    description: 'Show connection status',
    usage: '/status',
    category: 'network',
    execute: () => {
      const sigStatus = ctrl.transport.getSignalingStatus?.() || {};
      const banned = ctrl.messageGuard.rateLimiter.getBannedPeers();

      return {
        handled: true,
        output: [
          '📡 Network Status',
          `  Peer ID:        ${state.myPeerId}`,
          `  Connected:      ${state.connectedPeers.size} peers`,
          `  Encrypted:      ${state.readyPeers.size} peers`,
          `  Signaling:      ${JSON.stringify(sigStatus)}`,
          `  Banned peers:   ${banned.length}`,
          `  Rate limiter:   active`,
        ].join('\n'),
      };
    },
  });

  parser.register({
    name: 'ping',
    description: 'Measure round-trip time to a peer',
    usage: '/ping <peerId>',
    category: 'network',
    execute: async (args) => {
      if (!args[0]) return { handled: true, error: 'Usage: /ping <peerId>' };
      const peerId = args[0];

      if (!state.readyPeers.has(peerId)) {
        return { handled: true, error: `Peer ${peerId.slice(0, 8)} not connected` };
      }

      // Use clock sync to measure RTT
      const request = ctrl.clockSync.startSync(peerId);
      ctrl.transport.send(peerId, request);

      return {
        handled: true,
        output: `🏓 Ping sent to ${peerId.slice(0, 8)}... (check /peers for result)`,
      };
    },
  });

  parser.register({
    name: 'sync',
    description: 'Force workspace sync with peers',
    usage: '/sync',
    category: 'network',
    execute: () => {
      if (!state.activeWorkspaceId) return { handled: true, error: 'No active workspace' };
      const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
      if (!ws) return { handled: true, error: 'Workspace not found' };

      let synced = 0;
      for (const member of ws.members) {
        if (member.peerId !== state.myPeerId && state.readyPeers.has(member.peerId)) {
          ctrl.transport.send(member.peerId, {
            type: 'workspace-sync',
            workspaceId: state.activeWorkspaceId,
            data: ctrl.workspaceManager.exportWorkspace(state.activeWorkspaceId),
          });
          synced++;
        }
      }

      return { handled: true, output: `🔄 Sync requested with ${synced} peer${synced !== 1 ? 's' : ''}.` };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔧 DEBUG
  // ═══════════════════════════════════════════════════════════════════════════

  parser.register({
    name: 'debug',
    description: 'Toggle debug mode',
    usage: '/debug',
    category: 'debug',
    execute: async () => {
      const current = await ctrl.persistentStore.getSetting('debug') || false;
      const next = !current;
      await ctrl.persistSetting('debug', next);
      return { handled: true, output: `🔧 Debug mode: ${next ? 'ON' : 'OFF'}` };
    },
  });

  parser.register({
    name: 'export',
    description: 'Export workspace data as JSON',
    usage: '/export',
    category: 'debug',
    execute: () => {
      if (!state.activeWorkspaceId) return { handled: true, error: 'No active workspace' };
      const data = ctrl.workspaceManager.exportWorkspace(state.activeWorkspaceId);
      const json = JSON.stringify(data, null, 2);

      // Copy to clipboard
      navigator.clipboard?.writeText(json).catch(() => {});

      return {
        handled: true,
        output: `📋 Workspace exported (${json.length} bytes). Copied to clipboard.\n\n${json.slice(0, 500)}${json.length > 500 ? '\n...(truncated)' : ''}`,
      };
    },
  });

  parser.register({
    name: 'version',
    aliases: ['v'],
    description: 'Show version info',
    usage: '/version',
    category: 'debug',
    execute: () => ({
      handled: true,
      output: [
        '⚡ DecentChat',
        '  Protocol:  decent-protocol v0.1.0',
        '  Transport: decent-transport-webrtc v0.1.0',
        '  Client:    decent-client-web v0.1.0',
        '  Crypto:    P-256 ECDH + AES-GCM-256 + ECDSA + Double Ratchet',
        '  Sync:      CRDT + Vector Clocks + Merkle Trees',
        '  Identity:  BIP39 + HD Key Derivation',
      ].join('\n'),
    }),
  });

  parser.register({
    name: 'nick',
    aliases: ['alias'],
    description: 'Change your display name',
    usage: '/nick <name>',
    category: 'identity',
    execute: async (args, rawArgs) => {
      if (!rawArgs) return { handled: true, error: 'Usage: /nick <name>' };
      state.myAlias = rawArgs;
      await ctrl.persistSetting('myAlias', rawArgs);
      return { handled: true, output: `✅ Display name changed to: ${rawArgs}` };
    },
  });
}
