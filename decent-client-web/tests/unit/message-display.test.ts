import { describe, test, expect } from 'bun:test';
import {
  MAX_MESSAGE_CHARS,
  countLines,
  containsCodeBlock,
  shouldCollapseMessage,
  shouldShowCounter,
  formatMessageCounter,
} from '../../src/lib/utils/messageDisplay';

describe('message display helpers', () => {
  test('does not collapse normal short messages', () => {
    expect(shouldCollapseMessage('hello world')).toBe(false);
    expect(shouldCollapseMessage('short\nmessage\nwith\na\nfew\nlines')).toBe(false);
  });

  test('collapses long plain text by character count', () => {
    expect(shouldCollapseMessage('a'.repeat(801))).toBe(true);
  });

  test('collapses long plain text by line count', () => {
    expect(shouldCollapseMessage(Array.from({ length: 13 }, (_, i) => `line ${i + 1}`).join('\n'))).toBe(true);
  });

  test('collapses code blocks earlier', () => {
    const code = ['```ts', ...Array.from({ length: 9 }, (_, i) => `const x${i} = ${i};`), '```'].join('\n');
    expect(containsCodeBlock(code)).toBe(true);
    expect(shouldCollapseMessage(code)).toBe(true);
  });

  test('counts lines sanely', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('one')).toBe(1);
    expect(countLines('one\ntwo\nthree')).toBe(3);
  });

  test('counter only shows near the limit', () => {
    expect(shouldShowCounter(100)).toBe(false);
    expect(shouldShowCounter(Math.floor(MAX_MESSAGE_CHARS * 0.75))).toBe(true);
  });

  test('formats counter text', () => {
    expect(formatMessageCounter(120)).toBe(`120/${MAX_MESSAGE_CHARS}`);
  });
});
