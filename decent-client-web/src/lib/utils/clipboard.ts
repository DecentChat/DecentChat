/**
 * Copy text to the clipboard with a fallback for non-secure contexts.
 *
 * Tries the modern Clipboard API first (`navigator.clipboard.writeText`).
 * When that is unavailable or throws (e.g. HTTP, iframes, denied permission),
 * falls back to the classic textarea + `document.execCommand('copy')` trick.
 *
 * @returns `true` if the text was (likely) copied, `false` otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern Clipboard API first
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy fallback
    }
  }

  // Legacy fallback: hidden textarea + execCommand
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');

  // Make it invisible but keep it in the layout flow so execCommand works
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length); // iOS support
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
