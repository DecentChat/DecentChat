/**
 * NotificationManager — Browser notifications + unread badges
 * 
 * Uses the Web Notifications API for desktop alerts.
 * Tracks unread counts per channel.
 */

import type { NotificationTarget } from './notificationNavigation';

export class NotificationManager {
  private permission: NotificationPermission = 'default';
  /** Unread count per channel */
  private unreadCounts = new Map<string, number>();
  /** Currently focused channel */
  private focusedChannelId: string | null = null;
  /** Is the window focused? */
  private windowFocused = true;
  /** Original page title */
  private originalTitle = document.title;
  /** Title flash interval */
  private titleInterval: any = null;
  /** Called when user clicks a desktop notification — switch to that channel/thread */
  onNotificationClick?: (target: NotificationTarget) => void;

  constructor() {
    // Track window focus
    window.addEventListener('focus', () => {
      this.windowFocused = true;
      this.clearTitleFlash();
      if (this.focusedChannelId) {
        this.markRead(this.focusedChannelId);
      }
    });

    window.addEventListener('blur', () => {
      this.windowFocused = false;
    });
  }

  /**
   * Request notification permission
   */
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;

    if (Notification.permission === 'granted') {
      this.permission = 'granted';
      return true;
    }

    if (Notification.permission === 'denied') {
      this.permission = 'denied';
      return false;
    }

    const result = await Notification.requestPermission();
    this.permission = result;
    return result === 'granted';
  }

  /**
   * Notify about a new message
   */
  notify(channelId: string, channelName: string, senderName: string, content: string, target: Omit<NotificationTarget, 'channelId'> = {}): void {
    // Don't notify for the focused channel when window is active
    if (this.windowFocused && channelId === this.focusedChannelId) return;

    // Increment unread count
    this.unreadCounts.set(channelId, (this.unreadCounts.get(channelId) || 0) + 1);
    this.updateTitleBadge();

    // Desktop notification
    if (this.permission === 'granted' && !this.windowFocused) {
      const notification = new Notification(`${senderName} in ${channelName}`, {
        body: content.slice(0, 200),
        icon: '/icon-192.png',
        tag: `decent-${channelId}`, // Replace previous notification for same channel
        silent: false,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
        this.onNotificationClick?.({ channelId, ...target });
      };

      // Auto-close after 5s
      setTimeout(() => notification.close(), 5000);
    }

    // Flash title if window not focused
    if (!this.windowFocused) {
      this.startTitleFlash(senderName, content);
    }
  }

  /**
   * Set the currently focused channel
   */
  setFocusedChannel(channelId: string | null): void {
    this.focusedChannelId = channelId;
    if (channelId) this.markRead(channelId);
  }

  /**
   * Mark a channel as read
   */
  markRead(channelId: string): void {
    this.unreadCounts.delete(channelId);
    this.updateTitleBadge();
  }

  /**
   * Get unread count for a channel
   */
  getUnreadCount(channelId: string): number {
    return this.unreadCounts.get(channelId) || 0;
  }

  /**
   * Get total unread count across all channels
   */
  getTotalUnread(): number {
    let total = 0;
    for (const count of this.unreadCounts.values()) total += count;
    return total;
  }

  /**
   * Get all channels with unread messages
   */
  getUnreadChannels(): Map<string, number> {
    return new Map(this.unreadCounts);
  }

  // === Internal ===

  private updateTitleBadge(): void {
    const total = this.getTotalUnread();
    if (total > 0) {
      document.title = `(${total}) ${this.originalTitle}`;
    } else {
      document.title = this.originalTitle;
    }
  }

  private startTitleFlash(sender: string, content: string): void {
    this.clearTitleFlash();
    const msg = `💬 ${sender}: ${content.slice(0, 30)}`;
    let showMsg = true;

    this.titleInterval = setInterval(() => {
      document.title = showMsg ? msg : `(${this.getTotalUnread()}) ${this.originalTitle}`;
      showMsg = !showMsg;
    }, 1500);
  }

  private clearTitleFlash(): void {
    if (this.titleInterval) {
      clearInterval(this.titleInterval);
      this.titleInterval = null;
    }
    this.updateTitleBadge();
  }
}
