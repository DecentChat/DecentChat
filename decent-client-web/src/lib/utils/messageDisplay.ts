export const MAX_MESSAGE_CHARS = 16000;
export const LONG_MESSAGE_PREVIEW_CHARS = 800;
export const LONG_MESSAGE_PREVIEW_LINES = 12;
export const LONG_CODE_PREVIEW_CHARS = 400;
export const LONG_CODE_PREVIEW_LINES = 8;

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

export function containsCodeBlock(text: string): boolean {
  return /```/.test(text);
}

export function shouldCollapseMessage(text: string): boolean {
  const lines = countLines(text);
  const hasCode = containsCodeBlock(text);

  if (hasCode) {
    return text.length > LONG_CODE_PREVIEW_CHARS || lines > LONG_CODE_PREVIEW_LINES;
  }

  return text.length > LONG_MESSAGE_PREVIEW_CHARS || lines > LONG_MESSAGE_PREVIEW_LINES;
}

export function formatMessageCounter(currentLength: number, maxLength = MAX_MESSAGE_CHARS): string {
  return `${currentLength}/${maxLength}`;
}

export function shouldShowCounter(currentLength: number, maxLength = MAX_MESSAGE_CHARS): boolean {
  return currentLength >= Math.floor(maxLength * 0.75);
}
