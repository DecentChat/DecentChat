export interface MemberPickerPeer {
  peerId: string;
  name: string;
}

export interface MemberPickerSearchRuntime<T extends MemberPickerPeer> {
  getMembers: () => T[];
  getLoadedCount: () => number;
  hasMore: () => boolean;
  loadNextPage: () => Promise<void>;
}

export function filterMemberPickerPeers<T extends MemberPickerPeer>(
  peers: T[],
  query: string,
  limit: number,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();

  return peers
    .filter((peer) => !normalizedQuery
      || peer.name.toLowerCase().includes(normalizedQuery)
      || peer.peerId.toLowerCase().startsWith(normalizedQuery))
    .slice(0, limit);
}

export async function searchMemberPickerPeers<T extends MemberPickerPeer>(
  runtime: MemberPickerSearchRuntime<T>,
  query: string,
  limit: number,
  maxAdditionalPages = 3,
): Promise<T[]> {
  let matches = filterMemberPickerPeers(runtime.getMembers(), query, limit);
  let previousLoadedCount = runtime.getLoadedCount();

  for (let i = 0; i < maxAdditionalPages; i += 1) {
    if (matches.length >= limit || !runtime.hasMore()) break;

    await runtime.loadNextPage();

    const nextLoadedCount = runtime.getLoadedCount();
    if (nextLoadedCount <= previousLoadedCount) break;

    previousLoadedCount = nextLoadedCount;
    matches = filterMemberPickerPeers(runtime.getMembers(), query, limit);
  }

  return matches;
}
