import { describe, expect, test } from 'bun:test';
import { filterMentionMembers, searchMentionMembers, type MentionMember } from '../../src/ui/mentionSearch';

describe('mentionSearch', () => {
  test('filters mention members by alias and peer prefix', () => {
    const members: MentionMember[] = [
      { peerId: 'peer-alice', name: 'Alice' },
      { peerId: 'peer-bob', name: 'Bob' },
      { peerId: 'zz-top', name: 'Carol' },
    ];

    expect(filterMentionMembers(members, 'ali', 8)).toEqual([{ peerId: 'peer-alice', name: 'Alice' }]);
    expect(filterMentionMembers(members, 'peer-b', 8)).toEqual([{ peerId: 'peer-bob', name: 'Bob' }]);
  });

  test('loads additional pages when current slice misses the query', async () => {
    let members: MentionMember[] = [{ peerId: 'peer-alice', name: 'Alice' }];
    let loadedCount = 1;
    let hasMore = true;
    let loadCalls = 0;

    const matches = await searchMentionMembers(
      {
        getMembers: () => members,
        getLoadedCount: () => loadedCount,
        hasMore: () => hasMore,
        loadNextPage: async () => {
          loadCalls += 1;
          members = [...members, { peerId: 'peer-zoe', name: 'Zoe' }];
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

    const matches = await searchMentionMembers(
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
