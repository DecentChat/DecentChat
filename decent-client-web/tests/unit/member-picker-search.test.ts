import { describe, expect, test } from 'bun:test';
import {
  filterMemberPickerPeers,
  searchMemberPickerPeers,
  type MemberPickerPeer,
} from '../../src/ui/memberPickerSearch';

describe('memberPickerSearch', () => {
  test('filters peers by name and peer prefix', () => {
    const peers: MemberPickerPeer[] = [
      { peerId: 'peer-alice', name: 'Alice' },
      { peerId: 'peer-bob', name: 'Bob' },
      { peerId: 'zz-top', name: 'Carol' },
    ];

    expect(filterMemberPickerPeers(peers, 'ali', 8)).toEqual([{ peerId: 'peer-alice', name: 'Alice' }]);
    expect(filterMemberPickerPeers(peers, 'peer-b', 8)).toEqual([{ peerId: 'peer-bob', name: 'Bob' }]);
  });

  test('loads additional pages when current slice misses the query', async () => {
    let peers: MemberPickerPeer[] = [{ peerId: 'peer-alice', name: 'Alice' }];
    let loadedCount = 1;
    let hasMore = true;
    let loadCalls = 0;

    const matches = await searchMemberPickerPeers(
      {
        getMembers: () => peers,
        getLoadedCount: () => loadedCount,
        hasMore: () => hasMore,
        loadNextPage: async () => {
          loadCalls += 1;
          peers = [...peers, { peerId: 'peer-zoe', name: 'Zoe' }];
          loadedCount = 2;
          hasMore = false;
        },
      },
      'zoe',
      8,
    );

    expect(loadCalls).toBe(1);
    expect(matches).toEqual([{ peerId: 'peer-zoe', name: 'Zoe' }]);
  });

  test('stops when a load does not advance loaded count', async () => {
    let loadCalls = 0;

    const matches = await searchMemberPickerPeers(
      {
        getMembers: () => [{ peerId: 'peer-alice', name: 'Alice' }],
        getLoadedCount: () => 1,
        hasMore: () => true,
        loadNextPage: async () => {
          loadCalls += 1;
        },
      },
      'zoe',
      8,
      3,
    );

    expect(loadCalls).toBe(1);
    expect(matches).toEqual([]);
  });
});
