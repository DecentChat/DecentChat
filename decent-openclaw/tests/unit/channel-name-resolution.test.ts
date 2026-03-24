import { describe, expect, test } from 'bun:test';
import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';

describe('DecentChatNodePeer channel name lookup compatibility', () => {
  test('resolveChannelNameById delegates to channel lookup for routing consumers', () => {
    const peer = Object.create(DecentChatNodePeer.prototype) as DecentChatNodePeer & {
      workspaceManager: { getAllWorkspaces: () => Array<any> };
    };
    peer.workspaceManager = {
      getAllWorkspaces: () => [
        {
          id: 'ws-1',
          channels: [
            { id: 'lead-1', name: 'leadership', type: 'channel' },
          ],
        },
      ],
    };

    expect(peer.findChannelNameById('lead-1')).toBe('leadership');
    expect(peer.resolveChannelNameById('lead-1')).toBe('leadership');
  });
});
