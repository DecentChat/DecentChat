export interface MentionMember {
  peerId: string;
  name: string;
}

export interface MentionSearchRuntime {
  getMembers: () => MentionMember[];
  getLoadedCount: () => number;
  hasMore: () => boolean;
  loadNextPage: () => Promise<void>;
}

export function filterMentionMembers(
  members: MentionMember[],
  query: string,
  limit: number,
): MentionMember[] {
  const normalizedQuery = query.trim().toLowerCase();
  return members
    .filter((member) => !normalizedQuery
      || member.name.toLowerCase().includes(normalizedQuery)
      || member.peerId.toLowerCase().startsWith(normalizedQuery))
    .slice(0, limit);
}

export async function searchMentionMembers(
  runtime: MentionSearchRuntime,
  query: string,
  limit: number,
  maxAdditionalPages = 3,
): Promise<MentionMember[]> {
  let matches = filterMentionMembers(runtime.getMembers(), query, limit);
  let previousLoadedCount = runtime.getLoadedCount();

  for (let i = 0; i < maxAdditionalPages; i += 1) {
    if (matches.length >= limit || !runtime.hasMore()) break;

    await runtime.loadNextPage();

    const nextLoadedCount = runtime.getLoadedCount();
    if (nextLoadedCount <= previousLoadedCount) break;

    previousLoadedCount = nextLoadedCount;
    matches = filterMentionMembers(runtime.getMembers(), query, limit);
  }

  return matches;
}
