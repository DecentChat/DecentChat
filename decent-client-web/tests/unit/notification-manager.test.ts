/**
 * NotificationManager unit tests
 *
 * Browser APIs (Notification, document, window) are mocked below so these
 * run in Bun's Node-like environment without a real DOM.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';

// ─── Browser globals mock setup ──────────────────────────────────────────────

// Track window event listeners so we can fire them manually
const windowListeners: Record<string, Array<() => void>> = { focus: [], blur: [] };

const mockWindow = {
  addEventListener: (event: string, cb: () => void) => {
    if (!windowListeners[event]) windowListeners[event] = [];
    windowListeners[event].push(cb);
  },
  focus: () => { /* no-op in tests */ },
  // Notification must be present so the `'Notification' in window` guard passes
  get Notification() { return MockNotification; },
};

/** Fire a synthetic window event */
function fireWindowEvent(event: 'focus' | 'blur') {
  windowListeners[event]?.forEach((cb) => cb());
}

// Simple document.title mock
let mockTitle = 'DecentChat';
const mockDocument = {
  get title() { return mockTitle; },
  set title(v: string) { mockTitle = v; },
};

// Notification mock — records all created notifications
interface MockNotificationInstance {
  title: string;
  options: NotificationOptions;
  onclick: ((this: Notification, ev: Event) => any) | null;
  close: () => void;
  _closed: boolean;
}

const createdNotifications: MockNotificationInstance[] = [];
let notificationPermission: NotificationPermission = 'granted';

class MockNotification {
  title: string;
  options: NotificationOptions;
  onclick: ((this: Notification, ev: Event) => any) | null = null;
  _closed = false;

  constructor(title: string, options: NotificationOptions = {}) {
    this.title = title;
    this.options = options;
    createdNotifications.push(this as any);
  }

  close() { this._closed = true; }

  static get permission(): NotificationPermission { return notificationPermission; }
  static requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve(notificationPermission);
  }
}

// Install mocks on globalThis before importing the module
(globalThis as any).window = mockWindow;
(globalThis as any).document = mockDocument;
(globalThis as any).Notification = MockNotification;

// Import AFTER mocks are installed
import { NotificationManager } from '../../src/ui/NotificationManager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeManager(): NotificationManager {
  // Reset title
  mockTitle = 'DecentChat';
  createdNotifications.length = 0;
  windowListeners.focus = [];
  windowListeners.blur = [];
  const nm = new NotificationManager();
  // Set permission directly
  (nm as any).permission = notificationPermission;
  return nm;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationManager — unread counts', () => {
  let nm: NotificationManager;
  beforeEach(() => { nm = makeManager(); });

  test('getUnreadCount returns 0 for unseen channel', () => {
    expect(nm.getUnreadCount('ch1')).toBe(0);
  });

  test('getTotalUnread starts at 0', () => {
    expect(nm.getTotalUnread()).toBe(0);
  });

  test('notify increments unread count for non-focused channel', () => {
    nm.setFocusedChannel('ch-other');
    nm.notify('ch1', '#general', 'Alice', 'hello');
    expect(nm.getUnreadCount('ch1')).toBe(1);
  });

  test('notify accumulates multiple messages', () => {
    nm.setFocusedChannel('ch-other');
    nm.notify('ch1', '#general', 'Alice', 'msg 1');
    nm.notify('ch1', '#general', 'Bob',   'msg 2');
    nm.notify('ch1', '#general', 'Carol', 'msg 3');
    expect(nm.getUnreadCount('ch1')).toBe(3);
  });

  test('getTotalUnread sums across multiple channels', () => {
    nm.setFocusedChannel('active');
    nm.notify('ch1', '#general', 'Alice', 'a');
    nm.notify('ch1', '#general', 'Alice', 'b');
    nm.notify('ch2', '#random',  'Bob',   'c');
    expect(nm.getTotalUnread()).toBe(3);
  });

  test('markRead clears unread for that channel', () => {
    nm.setFocusedChannel('ch-other');
    nm.notify('ch1', '#general', 'Alice', 'hello');
    expect(nm.getUnreadCount('ch1')).toBe(1);
    nm.markRead('ch1');
    expect(nm.getUnreadCount('ch1')).toBe(0);
  });

  test('markRead does not affect other channels', () => {
    nm.setFocusedChannel('active');
    nm.notify('ch1', '#general', 'Alice', 'a');
    nm.notify('ch2', '#random',  'Bob',   'b');
    nm.markRead('ch1');
    expect(nm.getUnreadCount('ch2')).toBe(1);
  });

  test('setFocusedChannel marks that channel as read', () => {
    nm.setFocusedChannel('ch-other');
    nm.notify('ch1', '#general', 'Alice', 'hello');
    expect(nm.getUnreadCount('ch1')).toBe(1);

    nm.setFocusedChannel('ch1');
    expect(nm.getUnreadCount('ch1')).toBe(0);
  });

  test('getUnreadChannels returns map of all channels with unread', () => {
    nm.setFocusedChannel('active');
    nm.notify('ch1', '#general', 'Alice', 'a');
    nm.notify('ch2', '#random',  'Bob',   'b');
    const unread = nm.getUnreadChannels();
    expect(unread.size).toBe(2);
    expect(unread.get('ch1')).toBe(1);
    expect(unread.get('ch2')).toBe(1);
  });
});

describe('NotificationManager — focused channel suppression', () => {
  let nm: NotificationManager;
  beforeEach(() => {
    nm = makeManager();
    // Simulate focused window
    (nm as any).windowFocused = true;
  });

  test('does not increment unread for currently focused channel (window active)', () => {
    nm.setFocusedChannel('ch1');
    nm.notify('ch1', '#general', 'Alice', 'hello');
    expect(nm.getUnreadCount('ch1')).toBe(0);
  });

  test('does increment unread for non-focused channel even when window active', () => {
    nm.setFocusedChannel('ch1');
    nm.notify('ch2', '#random', 'Bob', 'hi');
    expect(nm.getUnreadCount('ch2')).toBe(1);
  });

  test('increments unread for focused channel when window is blurred', () => {
    nm.setFocusedChannel('ch1');
    (nm as any).windowFocused = false;
    nm.notify('ch1', '#general', 'Alice', 'hello');
    expect(nm.getUnreadCount('ch1')).toBe(1);
  });
});

describe('NotificationManager — tab title', () => {
  let nm: NotificationManager;
  beforeEach(() => {
    nm = makeManager();
    (nm as any).windowFocused = true;
  });

  test('title shows unread count when messages arrive', () => {
    nm.setFocusedChannel('other');
    nm.notify('ch1', '#general', 'Alice', 'hello');
    expect(mockDocument.title).toBe('(1) DecentChat');
  });

  test('title updates correctly with multiple channels', () => {
    nm.setFocusedChannel('active');
    nm.notify('ch1', '#general', 'Alice', 'a');
    nm.notify('ch1', '#general', 'Alice', 'b');
    nm.notify('ch2', '#random',  'Bob',   'c');
    expect(mockDocument.title).toBe('(3) DecentChat');
  });

  test('title resets after markRead clears all unreads', () => {
    nm.setFocusedChannel('other');
    nm.notify('ch1', '#general', 'Alice', 'hello');
    nm.markRead('ch1');
    expect(mockDocument.title).toBe('DecentChat');
  });

  test('title reflects remaining unread after partial markRead', () => {
    nm.setFocusedChannel('active');
    nm.notify('ch1', '#general', 'Alice', 'a');
    nm.notify('ch2', '#random',  'Bob',   'b');
    nm.markRead('ch1');
    expect(mockDocument.title).toBe('(1) DecentChat');
  });
});

describe('NotificationManager — window focus/blur', () => {
  let nm: NotificationManager;
  beforeEach(() => { nm = makeManager(); });

  test('window focus marks focused channel as read', () => {
    nm.setFocusedChannel('other');
    nm.notify('ch1', '#general', 'Alice', 'hello');
    nm.setFocusedChannel('ch1');

    // Simulate blur then message then re-focus
    fireWindowEvent('blur');
    nm.notify('ch1', '#general', 'Alice', 'another one');
    expect(nm.getUnreadCount('ch1')).toBe(1);

    fireWindowEvent('focus');
    // Channel is focused, so focus event marks it read
    expect(nm.getUnreadCount('ch1')).toBe(0);
  });

  test('window blur sets windowFocused to false', () => {
    expect((nm as any).windowFocused).toBe(true);
    fireWindowEvent('blur');
    expect((nm as any).windowFocused).toBe(false);
  });

  test('window focus sets windowFocused to true', () => {
    fireWindowEvent('blur');
    expect((nm as any).windowFocused).toBe(false);
    fireWindowEvent('focus');
    expect((nm as any).windowFocused).toBe(true);
  });
});

describe('NotificationManager — desktop notifications', () => {
  let nm: NotificationManager;
  beforeEach(() => {
    nm = makeManager();
    notificationPermission = 'granted';
    (nm as any).permission = 'granted';
    (nm as any).windowFocused = false; // window not focused → desktop notif fires
  });

  afterEach(() => {
    notificationPermission = 'granted';
  });

  test('creates a desktop notification when permission granted and window blurred', () => {
    nm.setFocusedChannel('other');
    nm.notify('ch1', '#general', 'Alice', 'hello world');
    expect(createdNotifications.length).toBe(1);
    expect(createdNotifications[0].title).toBe('Alice in #general');
  });

  test('notification body is truncated to 200 chars', () => {
    nm.setFocusedChannel('other');
    const longMsg = 'A'.repeat(300);
    nm.notify('ch1', '#general', 'Alice', longMsg);
    expect(createdNotifications[0].options.body?.length).toBe(200);
  });

  test('notification uses channel-specific tag (deduplication)', () => {
    nm.setFocusedChannel('other');
    nm.notify('ch1', '#general', 'Alice', 'first');
    nm.notify('ch1', '#general', 'Bob',   'second');
    // Both get same tag → browser replaces instead of stacking
    expect(createdNotifications[0].options.tag).toBe('decent-ch1');
    expect(createdNotifications[1].options.tag).toBe('decent-ch1');
  });

  test('different channels get different tags', () => {
    nm.setFocusedChannel('other');
    nm.notify('ch1', '#general', 'Alice', 'a');
    nm.notify('ch2', '#random',  'Bob',   'b');
    expect(createdNotifications[0].options.tag).toBe('decent-ch1');
    expect(createdNotifications[1].options.tag).toBe('decent-ch2');
  });

  test('does NOT create desktop notification when permission denied', () => {
    (nm as any).permission = 'denied';
    nm.setFocusedChannel('other');
    nm.notify('ch1', '#general', 'Alice', 'hello');
    expect(createdNotifications.length).toBe(0);
    // Unread count still increments
    expect(nm.getUnreadCount('ch1')).toBe(1);
  });

  test('does NOT create desktop notification when window is focused', () => {
    (nm as any).windowFocused = true;
    nm.setFocusedChannel('other');
    nm.notify('ch1', '#general', 'Alice', 'hello');
    expect(createdNotifications.length).toBe(0);
  });

  test('onNotificationClick callback is called on notification click', () => {
    let clickedChannel = '';
    nm.onNotificationClick = (channelId) => { clickedChannel = channelId; };
    nm.setFocusedChannel('other');
    nm.notify('ch1', '#general', 'Alice', 'hello');

    const notif = createdNotifications[0] as any;
    // Simulate click
    notif.onclick?.call(notif);
    expect(clickedChannel).toBe('ch1');
  });
});

describe('NotificationManager — requestPermission', () => {
  test('returns true when already granted', async () => {
    notificationPermission = 'granted';
    const nm = makeManager();
    const result = await nm.requestPermission();
    expect(result).toBe(true);
    expect((nm as any).permission).toBe('granted');
  });

  test('returns false when already denied', async () => {
    notificationPermission = 'denied';
    const nm = makeManager();
    const result = await nm.requestPermission();
    expect(result).toBe(false);
  });

  afterEach(() => { notificationPermission = 'granted'; });
});

describe('NotificationManager — edge cases', () => {
  test('markRead on channel with no unread is a no-op', () => {
    const nm = makeManager();
    expect(() => nm.markRead('nonexistent')).not.toThrow();
    expect(nm.getUnreadCount('nonexistent')).toBe(0);
  });

  test('setFocusedChannel(null) clears focused channel without error', () => {
    const nm = makeManager();
    nm.setFocusedChannel('ch1');
    expect(() => nm.setFocusedChannel(null)).not.toThrow();
    expect((nm as any).focusedChannelId).toBeNull();
  });

  test('getTotalUnread returns 0 after all channels marked read', () => {
    const nm = makeManager();
    (nm as any).windowFocused = false;
    nm.setFocusedChannel('active');
    nm.notify('ch1', '#general', 'Alice', 'a');
    nm.notify('ch2', '#random',  'Bob',   'b');
    nm.markRead('ch1');
    nm.markRead('ch2');
    expect(nm.getTotalUnread()).toBe(0);
  });

  test('unread count never goes below 0', () => {
    const nm = makeManager();
    nm.markRead('ch1');
    nm.markRead('ch1');
    expect(nm.getUnreadCount('ch1')).toBe(0);
    expect(nm.getTotalUnread()).toBe(0);
  });

  test('getUnreadChannels returns empty map with no unreads', () => {
    const nm = makeManager();
    expect(nm.getUnreadChannels().size).toBe(0);
  });
});
