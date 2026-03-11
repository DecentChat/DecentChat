export const MAX_MESSAGE_CHARS = 16000;

export function validateMessageContentLength(content: string): void {
  if (content.length > MAX_MESSAGE_CHARS) {
    throw new Error(`Message too long (${content.length}/${MAX_MESSAGE_CHARS} chars)`);
  }
}
