import { MAX_MESSAGE_CHARS } from './messageDisplay';

export interface NormalizedOutgoingMessage {
  text: string;
  truncated: boolean;
  empty: boolean;
}

export function normalizeOutgoingMessageContent(raw: string, maxLength = MAX_MESSAGE_CHARS): NormalizedOutgoingMessage {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { text: '', truncated: false, empty: true };
  }

  if (trimmed.length <= maxLength) {
    return { text: trimmed, truncated: false, empty: false };
  }

  return {
    text: trimmed.slice(0, maxLength),
    truncated: true,
    empty: false,
  };
}
