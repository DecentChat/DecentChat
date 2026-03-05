/**
 * Messages Store — Reactive Svelte state for message display.
 * 
 * During migration, UIRenderer pushes message updates here.
 * After migration, ChatController writes directly.
 */

export interface DisplayMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  threadId?: string;
  threadReplyCount?: number;
  attachments?: DisplayAttachment[];
  reactions?: Map<string, Set<string>>;
  isStreaming?: boolean;
  editedAt?: number;
}

export interface DisplayAttachment {
  name: string;
  mimeType: string;
  url: string;
  size?: number;
}

// ── Reactive state ──
export const messageStore = $state({
  messages: [] as DisplayMessage[],
  threadMessages: [] as DisplayMessage[],
  activeThreadId: null as string | null,
  threadOpen: false,
  typingUsers: [] as string[],
});

// ── Sync functions ──

export function syncMessages(messages: DisplayMessage[]): void {
  messageStore.messages = messages;
}

export function syncThreadMessages(messages: DisplayMessage[]): void {
  messageStore.threadMessages = messages;
}

export function syncThreadState(threadId: string | null, open: boolean): void {
  messageStore.activeThreadId = threadId;
  messageStore.threadOpen = open;
}

export function syncTypingUsers(users: string[]): void {
  messageStore.typingUsers = users;
}
