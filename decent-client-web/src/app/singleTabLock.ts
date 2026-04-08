export type SingleTabLockAction =
  | 'respond-pong'
  | 'duplicate-tab-detected'
  | 'focus-existing-tab'
  | 'ignore';

type LockMessageType = 'ping' | 'pong' | 'focus-tab';

function isLockMessageType(value: unknown): value is LockMessageType {
  return value === 'ping' || value === 'pong' || value === 'focus-tab';
}

export function isSingleTabLockRoute(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/');
}

export function classifySingleTabMessage(payload: unknown, tabId: string): SingleTabLockAction {
  if (!payload || typeof payload !== 'object') return 'ignore';
  const candidate = payload as Record<string, unknown>;
  if (!isLockMessageType(candidate.type)) return 'ignore';
  if (typeof candidate.tabId !== 'string') return 'ignore';
  if (candidate.tabId === tabId) return 'ignore';

  if (candidate.type === 'ping') return 'respond-pong';
  if (candidate.type === 'pong') return 'duplicate-tab-detected';
  return 'focus-existing-tab';
}
