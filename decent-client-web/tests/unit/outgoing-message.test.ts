import { describe, test, expect } from 'bun:test';
import { MAX_MESSAGE_CHARS } from '../../src/lib/utils/messageDisplay';
import { normalizeOutgoingMessageContent } from '../../src/lib/utils/outgoingMessage';

describe('normalizeOutgoingMessageContent', () => {
  test('trims and preserves normal text without truncation', () => {
    expect(normalizeOutgoingMessageContent('  hello  ')).toEqual({
      text: 'hello',
      truncated: false,
      empty: false,
    });
  });

  test('marks empty after trim', () => {
    expect(normalizeOutgoingMessageContent('   ')).toEqual({
      text: '',
      truncated: false,
      empty: true,
    });
  });

  test('truncates oversized text and reports it', () => {
    const raw = `${'x'.repeat(MAX_MESSAGE_CHARS)}tail`;
    const result = normalizeOutgoingMessageContent(raw);
    expect(result.empty).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(MAX_MESSAGE_CHARS);
    expect(result.text).toBe('x'.repeat(MAX_MESSAGE_CHARS));
  });
});
